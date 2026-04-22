import { randomUUID } from "node:crypto";
import type * as schema from "@agentclientprotocol/sdk";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { Context, Message, Model, StreamFunction, StreamOptions, TextContent } from "../../types";
import { AssistantMessageEventStream } from "../../utils/event-stream";
import { makeClientHandler } from "./client";
import type { CliAdapter } from "./cli/types";
import { AcpError } from "./errors";
import { EventMapper } from "./event-mapping";
import { type PermissionMode, makePermissionPolicy } from "./permissions";
import { spawnAcp, toWebStreams } from "./process";
import { mapStopReason } from "./stop-reason";

export interface AcpAgentOptions extends StreamOptions {
	/** Permission policy; defaults to `deny-destructive`. */
	permissionMode?: PermissionMode;
	/** Absolute path to workspace root. Defaults to `process.cwd()`. */
	workspaceRoot?: string;
	/** Override timeouts (all in ms). */
	timeouts?: Partial<AcpTimeouts>;
}

export interface AcpTimeouts {
	initializeMs: number;
	sessionNewMs: number;
	promptMs: number;
	cancelMs: number;
	sigtermMs: number;
}

export const DEFAULT_TIMEOUTS: AcpTimeouts = {
	initializeMs: 15_000,
	sessionNewMs: 30_000,
	promptMs: 120_000,
	cancelMs: 10_000,
	sigtermMs: 5_000,
};

export interface AcpConfig {
	model?: string;
	apiKey?: string;
}

export interface StreamAcpDeps {
	adapter: CliAdapter;
}

const ADAPTERS: Record<string, CliAdapter> = {};

/**
 * Register a CLI adapter under a provider id. Called by module registration
 * (see `./index.ts`).
 */
export function registerAdapter(providerId: string, adapter: CliAdapter): void {
	ADAPTERS[providerId] = adapter;
}

function resolveAdapter(providerId: string): CliAdapter {
	const adapter = ADAPTERS[providerId];
	if (!adapter) {
		throw new AcpError("not_implemented", `No ACP adapter registered for provider '${providerId}'`);
	}
	return adapter;
}

// Track live child processes so we can clean them up on process exit.
// A dead process leaks a subprocess + fds; `beforeExit` is the last chance to
// catch children that survived a faulty shutdown path.
const LIVE_CHILDREN = new Set<import("node:child_process").ChildProcess>();
let beforeExitWired = false;
function wireBeforeExitOnce(): void {
	if (beforeExitWired) return;
	beforeExitWired = true;
	const drain = () => {
		for (const child of LIVE_CHILDREN) {
			try {
				child.kill("SIGTERM");
			} catch {
				// ignore
			}
		}
	};
	process.once("beforeExit", drain);
	process.once("SIGINT", drain);
	process.once("SIGTERM", drain);
}

/** User-friendly text for AcpError codes surfaced to the UI. */
function humanizeAcpError(err: AcpError, stderrTail?: string): string {
	switch (err.code) {
		case "binary_missing":
			return `ACP agent binary not found. ${err.details.hint ?? err.message}`;
		case "auth_required":
			return `ACP agent requires login. ${err.details.hint ?? err.message}`;
		case "handshake_timeout":
			return `ACP agent did not respond during handshake: ${err.message}${stderrTail ? `\n${stderrTail}` : ""}`;
		case "session_new_timeout":
			return `ACP agent session/new timed out: ${err.message}`;
		case "prompt_timeout":
			return `ACP agent session/prompt timed out: ${err.message}`;
		case "invalid_json_line":
			return `ACP agent emitted malformed JSON: ${err.message}`;
		case "fs_escape":
			return `ACP agent tried to access a path outside the workspace: ${err.message}`;
		case "fs_too_large":
			return `ACP agent tried to read a file exceeding the size cap: ${err.message}`;
		case "permission_denied":
			return `ACP permission request denied: ${err.message}`;
		case "child_exit_unexpected":
			return `ACP agent exited unexpectedly: ${err.message}${stderrTail ? `\n${stderrTail}` : ""}`;
		case "refusal":
			return `ACP agent refused the request: ${err.message}`;
		case "not_implemented":
			return `Feature not implemented: ${err.message}`;
	}
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new AcpError("handshake_timeout", `${label} timed out after ${ms}ms`));
		}, ms);
		p.then(
			v => {
				clearTimeout(timer);
				resolve(v);
			},
			e => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

function promptBlocksFromContext(ctx: Context): schema.ContentBlock[] {
	// Collapse user + system messages into a single turn. We send the full
	// conversation as text blocks to the agent; the agent is expected to keep
	// its own conversation state server-side via `sessionId`.
	const blocks: schema.ContentBlock[] = [];
	if (ctx.systemPrompt) {
		blocks.push({ type: "text", text: ctx.systemPrompt });
	}
	for (const msg of ctx.messages) {
		const text = messageAsText(msg);
		if (text) blocks.push({ type: "text", text });
	}
	if (blocks.length === 0) {
		// Agent requires at least one block.
		blocks.push({ type: "text", text: "" });
	}
	return blocks;
}

function messageAsText(msg: Message): string {
	if (typeof msg.content === "string") return msg.content;
	const parts: string[] = [];
	for (const c of msg.content) {
		if (c.type === "text") parts.push(c.text);
	}
	return parts.join("");
}

/**
 * Stream an ACP agent session.
 *
 * Lifecycle (happy path):
 *   probeAuth → spawn → ClientSideConnection → initialize
 *   → session/new → session/prompt
 *   → session/update notifications routed via EventMapper
 *   → PromptResponse stopReason → done event
 *   → close stdin → await exit
 *
 * Failure path teardown: `session/cancel` → SIGTERM → SIGKILL.
 */
export const streamAcp: StreamFunction<"acp-agent"> = (
	model: Model<"acp-agent">,
	context: Context,
	options?: AcpAgentOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();
	const timeouts: AcpTimeouts = { ...DEFAULT_TIMEOUTS, ...options?.timeouts };
	const permissionMode: PermissionMode = options?.permissionMode ?? "deny-destructive";
	const workspaceRoot = options?.workspaceRoot ?? process.cwd();

	(async () => {
		const adapter = resolveAdapter(model.provider);

		// 1) Pre-flight auth
		const authStatus = await adapter.probeAuth(process.env);
		if (authStatus.kind === "missing") {
			const mapper = new EventMapper({ api: "acp-agent", provider: model.provider, model: model.id });
			for (const e of mapper.startEvents()) stream.push(e);
			const errMsg = { ...mapper.message, stopReason: "error" as const, errorMessage: authStatus.hint };
			stream.push({ type: "error", reason: "error", error: errMsg });
			return;
		}
		if (authStatus.kind === "logged_out") {
			const mapper = new EventMapper({ api: "acp-agent", provider: model.provider, model: model.id });
			for (const e of mapper.startEvents()) stream.push(e);
			const errMsg = { ...mapper.message, stopReason: "error" as const, errorMessage: authStatus.hint };
			stream.push({ type: "error", reason: "error", error: errMsg });
			return;
		}

		// 2) Spawn subprocess
		const config: AcpConfig = { model: model.id, apiKey: options?.apiKey };
		const env = { ...process.env, ...adapter.extraEnv(config) };
		const spawned = spawnAcp({
			binary: adapter.binary,
			args: adapter.spawnArgs(config),
			env,
			cwd: workspaceRoot,
		});
		wireBeforeExitOnce();
		LIVE_CHILDREN.add(spawned.child);

		const mapper = new EventMapper({ api: "acp-agent", provider: model.provider, model: model.id });
		for (const e of mapper.startEvents()) stream.push(e);

		// 3) Wire ClientSideConnection onto piped stdio
		const webStreams = toWebStreams({ nodeReadable: spawned.stdout, nodeWritable: spawned.stdin });
		const jsonStream = ndJsonStream(webStreams.writable, webStreams.readable);

		const conn = new ClientSideConnection(
			() =>
				makeClientHandler({
					workspaceRoot,
					permissionPolicy: makePermissionPolicy(permissionMode),
					onSessionUpdate: notif => {
						for (const e of mapper.push(notif.update)) stream.push(e);
					},
				}),
			jsonStream,
		);

		let childExited = false;
		let exitCode: number | null = null;
		let exitSignal: NodeJS.Signals | null = null;
		spawned.child.once("exit", (code, signal) => {
			childExited = true;
			exitCode = code;
			exitSignal = signal;
			LIVE_CHILDREN.delete(spawned.child);
		});

		try {
			// 4) initialize
			await withTimeout(
				conn.initialize({
					protocolVersion: 1 as schema.ProtocolVersion,
					clientCapabilities: {
						fs: { readTextFile: true, writeTextFile: true },
						terminal: false,
					},
					clientInfo: { name: "omp", version: "0.0.0" } as schema.Implementation,
				}),
				timeouts.initializeMs,
				"initialize",
			);
			spawned.child.unref();

			// 5) session/new (no MCP — Gemini rejects non-stdio transports, issue #8672)
			const newSess = await withTimeout(
				conn.newSession({ cwd: workspaceRoot, mcpServers: [] }),
				timeouts.sessionNewMs,
				"session/new",
			);

			// 6) session/prompt
			const promptRes = await withTimeout(
				conn.prompt({
					sessionId: newSess.sessionId,
					prompt: promptBlocksFromContext(context),
					messageId: randomUUID(),
				}),
				timeouts.promptMs,
				"session/prompt",
			);

			// Close any trailing open span now that the turn is complete.
			for (const e of mapper.finish()) stream.push(e);

			// 7) Translate stopReason into final event
			const reason = mapStopReason(promptRes.stopReason);
			const finalMsg = mapper.message;
			finalMsg.stopReason = reason;
			if (reason === "stop" || reason === "length" || reason === "toolUse") {
				stream.push({ type: "done", reason, message: finalMsg });
			} else {
				if (reason === "error") {
					finalMsg.errorMessage = "Agent refused the request.";
				}
				stream.push({ type: "error", reason, error: finalMsg });
			}
		} catch (err) {
			// Flush any open span before erroring
			for (const e of mapper.finish()) stream.push(e);
			const errMsg = mapper.message;
			errMsg.stopReason = "error";
			if (err instanceof AcpError) {
				const stderrTail =
					err.code === "handshake_timeout" ||
					err.code === "session_new_timeout" ||
					err.code === "prompt_timeout" ||
					err.code === "child_exit_unexpected"
						? spawned.stderr.tail(20)
						: undefined;
				errMsg.errorMessage = humanizeAcpError(err, stderrTail);
			} else if (err instanceof Error) {
				errMsg.errorMessage = err.message;
			} else {
				errMsg.errorMessage = String(err);
			}
			if (childExited && exitCode !== 0 && exitCode !== null) {
				errMsg.errorMessage = `${errMsg.errorMessage}\n(child exit code=${exitCode} signal=${exitSignal ?? "none"})`;
			}
			stream.push({ type: "error", reason: "error", error: errMsg });
		} finally {
			// Shutdown ladder: close stdin → SIGTERM → SIGKILL
			// (session/cancel happens implicitly — the caller can invoke it
			// before disposing the stream if they want graceful cancellation;
			// for teardown after a completed/errored turn, closing stdin is
			// sufficient to signal EOF to any well-behaved ACP agent.)
			if (!childExited) {
				try {
					spawned.stdin.end();
				} catch {
					// ignore
				}
				const killDeadline = Date.now() + timeouts.sigtermMs;
				spawned.child.kill("SIGTERM");
				while (!childExited && Date.now() < killDeadline) {
					await new Promise(r => setTimeout(r, 50));
				}
				if (!childExited) {
					spawned.child.kill("SIGKILL");
				}
			}
			LIVE_CHILDREN.delete(spawned.child);
			void exitCode;
			void exitSignal;
			stream.end();
		}
	})().catch(err => {
		// Defensive: should not happen; the main body catches everything.
		const finalMsg = {
			role: "assistant" as const,
			content: [] as TextContent[],
			api: "acp-agent" as const,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error" as const,
			errorMessage: err instanceof Error ? err.message : String(err),
			timestamp: Date.now(),
		};
		stream.push({ type: "error", reason: "error", error: finalMsg });
		stream.end();
	});

	return stream;
};
