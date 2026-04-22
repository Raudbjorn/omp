/**
 * ScriptTool — programmatic tool calling via an isolated raw Python subprocess.
 *
 * The model writes Python code that calls other registered tools as regular
 * functions. The code runs in a child Python process that has no access to the
 * parent's environment variables (API keys, auth tokens, etc.). Tool calls are
 * bridged via a short-lived localhost HTTP server (ToolBridgeServer) that
 * performs live tool lookups, so tools activated after startup (dynamic MCP
 * servers) are accessible through the `tools` proxy inside the script.
 *
 * See script-bridge.ts for the bridge server and script-worker.txt for the
 * subprocess entry point.
 */
import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { logger } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { filterEnv, resolvePythonRuntime } from "../ipy/runtime";
import scriptDescription from "../prompts/tools/script.md" with { type: "text" };
import { DEFAULT_MAX_BYTES, TailBuffer } from "../session/streaming-output";
import type { ToolSession } from "./index";
import { ToolBridgeServer } from "./script-bridge";
import workerSource from "./script-worker.txt" with { type: "text" };
import { ToolAbortError } from "./tool-errors";

// ── Schema ────────────────────────────────────────────────────────────────────

const scriptSchema = Type.Object({
	code: Type.String({
		description:
			"Python code to execute. Named tool functions (bash, read, write, edit, grep, find, fetch, web_search, lsp, browser, …) are available directly when their names are valid Python identifiers. Use tools.name(args) for MCP or dynamically loaded tools. Call list_tools() to discover all available tools. Use print(...) for output and assign to global result to append a final value.",
	}),
	timeout: Type.Optional(Type.Number({ description: "Maximum execution time in seconds (default: 30)", minimum: 1 })),
});

type ScriptParams = Static<typeof scriptSchema>;

export interface ScriptToolDetails {
	exitCode: number | undefined;
	stderr?: string;
}

// ── Tools excluded from the script environment ────────────────────────────────
//
// ask      — blocks waiting for user input; meaningless inside an automated script
// task     — spawns an LLM subagent; recursive LLM calls inside code would be
//            extremely expensive and are better expressed as top-level tool calls
// script   — no recursion
// poll_jobs / cancel_job — job lifecycle belongs outside the script
// submit_result / report_finding / exit_plan_mode — agent lifecycle signals

const EXCLUDED_TOOLS = new Set([
	"script",
	"ask",
	"task",
	"poll_jobs",
	"cancel_job",
	"submit_result",
	"report_finding",
	"exit_plan_mode",
]);

// ── Safe environment for the subprocess ──────────────────────────────────────
//
// Deliberately excludes API keys, auth tokens, and session secrets.
// The subprocess can still use the Python standard library and basic OS facilities,
// but it cannot read secrets from the environment.

function buildSafeEnv(
	bridgePort: number,
	scriptFile: string,
	bridgeSecret: string,
	pythonEnv: Record<string, string | undefined>,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(filterEnv(pythonEnv))) {
		if (typeof value === "string") env[key] = value;
	}
	env.OMP_BRIDGE_PORT = String(bridgePort);
	env.OMP_SCRIPT_FILE = scriptFile;
	env.OMP_BRIDGE_SECRET = bridgeSecret;
	return env;
}

// ── Worker file (compiled-binary safe) ──────────────────────────────────────
//
// import.meta.dir resolves to /$bunfs/root/ inside a compiled Bun binary, where
// script-worker.txt does not exist on the real filesystem. Instead, embed the
// worker source as text at build time and write it to tmpdir lazily on first
// use. Subsequent executions reuse the same path (content is immutable).

// Deterministic filename from worker-source content hash so concurrent OMP
// processes share one file and restarts reuse it (content is immutable).
const WORKER_FILE_HASH = createHash("sha256").update(workerSource).digest("hex").slice(0, 16);
const WORKER_FILE_PATH = path.join(os.tmpdir(), `omp-script-worker-${WORKER_FILE_HASH}.py`);
let workerReady: Promise<void> | null = null;
let exitHandlerRegistered = false;

function ensureWorkerFile(): Promise<void> {
	if (!workerReady) {
		workerReady = Bun.write(WORKER_FILE_PATH, workerSource)
			.then(() => {
				if (!exitHandlerRegistered) {
					exitHandlerRegistered = true;
					// Best-effort unlink on process exit. Concurrent OMP instances may race,
					// but the file contains only workerSource — no secrets to leak.
					process.once("exit", () => {
						try {
							unlinkSync(WORKER_FILE_PATH);
						} catch {
							// another instance may have already cleaned it up
						}
					});
				}
			})
			.catch(err => {
				workerReady = null; // allow retry on next call
				throw err as Error;
			});
	}
	return workerReady;
}

// ── ScriptTool ────────────────────────────────────────────────────────────────

export class ScriptTool implements AgentTool<typeof scriptSchema, ScriptToolDetails> {
	readonly name = "script";
	readonly label = "Script";
	readonly description = scriptDescription;
	readonly parameters = scriptSchema;

	constructor(private readonly session: ToolSession) {}

	static create(session: ToolSession): ScriptTool {
		return new ScriptTool(session);
	}

	async execute(
		_toolCallId: string,
		params: ScriptParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<ScriptToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<ScriptToolDetails>> {
		const timeoutMs = (params.timeout ?? 30) * 1000;

		// Combine the parent abort signal with a per-execution timeout
		const timeoutController = new AbortController();
		const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
		const effectiveSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

		// Only expose tools that make sense inside a script
		const getFilteredTools = () => {
			const all = this.session.getTools?.() ?? [];
			return all.filter(t => !EXCLUDED_TOOLS.has(t.name));
		};

		const bridge = new ToolBridgeServer();
		const bridgeSecret = crypto.randomUUID();
		let tmpFile: string | null = null;

		try {
			const bridgePort = bridge.start(getFilteredTools, effectiveSignal, bridgeSecret, context);

			// Write the script code to an isolated temp file
			tmpFile = path.join(os.tmpdir(), `omp-script-${crypto.randomUUID()}.py`);
			await Bun.write(tmpFile, params.code);
			let pythonRuntime: { pythonPath: string; env: Record<string, string | undefined> };
			try {
				pythonRuntime = resolvePythonRuntime(this.session.cwd, process.env);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Script execution failed: ${message}` }],
					details: { exitCode: undefined },
				};
			}

			await ensureWorkerFile();
			const child = Bun.spawn([pythonRuntime.pythonPath, WORKER_FILE_PATH], {
				cwd: this.session.cwd,
				env: buildSafeEnv(bridgePort, tmpFile, bridgeSecret, pythonRuntime.env),
				stdout: "pipe",
				stderr: "pipe",
			});

			// Kill the child if the effective signal fires (timeout or parent abort)
			const onAbort = () => {
				try {
					child.kill();
				} catch {
					// Already exited — ignore
				}
			};
			effectiveSignal.addEventListener("abort", onAbort, { once: true });

			// Stream stdout concurrently with process execution, feeding live previews
			// through onUpdate (same tail-buffered pattern as bash).
			const stdoutParts: string[] = [];
			const tailBuffer = new TailBuffer(DEFAULT_MAX_BYTES);
			const stdoutDecoder = new TextDecoder();

			const readStdoutStream = async () => {
				const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						const chunk = stdoutDecoder.decode(value, { stream: true });
						stdoutParts.push(chunk);
						tailBuffer.append(chunk);
						onUpdate?.({
							content: [{ type: "text", text: tailBuffer.text() }],
							details: { exitCode: undefined },
						});
					}
					const tail = stdoutDecoder.decode();
					if (tail) {
						stdoutParts.push(tail);
						tailBuffer.append(tail);
					}
				} catch {
					// Stream closed or aborted — ignore
				} finally {
					reader.releaseLock();
				}
			};

			// Drain stderr concurrently — not doing so allows the OS pipe buffer (~64KB)
			// to fill and deadlock child.exited if the script writes large errors.
			const stderrParts: string[] = [];
			const stderrDecoder = new TextDecoder();

			const readStderrStream = async () => {
				const reader = (child.stderr as ReadableStream<Uint8Array>).getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						stderrParts.push(stderrDecoder.decode(value, { stream: true }));
					}
					const tail = stderrDecoder.decode();
					if (tail) stderrParts.push(tail);
				} catch {
					// Stream closed or aborted — ignore
				} finally {
					reader.releaseLock();
				}
			};

			const [exitCode] = await Promise.all([child.exited, readStdoutStream(), readStderrStream()]);
			const stdout = stdoutParts.join("");
			const stderr = stderrParts.join("");

			effectiveSignal.removeEventListener("abort", onAbort);
			clearTimeout(timeoutHandle);

			if (signal?.aborted) {
				throw new ToolAbortError();
			}

			if (timeoutController.signal.aborted) {
				return {
					content: [{ type: "text", text: `Script timed out after ${params.timeout ?? 30}s` }],
					details: { exitCode: undefined },
				};
			}

			logger.debug("Script execution complete", { exitCode, stdoutLen: stdout.length });

			if (exitCode !== 0) {
				const errorText = stderr.trim() || `Script exited with code ${exitCode}`;
				return {
					content: [{ type: "text", text: errorText }],
					details: { exitCode, stderr: stderr.trim() || undefined },
				};
			}

			return {
				content: [{ type: "text", text: stdout.trim() || "(no output)" }],
				details: {
					exitCode: 0,
					stderr: stderr.trim() || undefined,
				},
			};
		} catch (err) {
			clearTimeout(timeoutHandle);
			if (err instanceof ToolAbortError) throw err;
			if (signal?.aborted) throw new ToolAbortError();
			const message = err instanceof Error ? err.message : String(err);
			logger.error("Script tool execution failed", { error: message });
			return {
				content: [{ type: "text", text: `Script execution failed: ${message}` }],
				details: { exitCode: undefined },
			};
		} finally {
			clearTimeout(timeoutHandle);
			bridge.stop();
			if (tmpFile) {
				try {
					await fs.unlink(tmpFile);
				} catch {
					// Ignore cleanup failures
				}
			}
		}
	}
}
