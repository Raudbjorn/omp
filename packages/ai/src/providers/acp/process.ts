import { type ChildProcessByStdio, spawn } from "node:child_process";
import { Readable, Transform, type Writable } from "node:stream";

const debugEnabled = () => (process.env.DEBUG_ACP ?? process.env.PI_DEBUG_ACP) !== undefined;

function debugLog(tag: string, data: Record<string, unknown>): void {
	if (!debugEnabled()) return;
	try {
		console.error(`[acp] ${tag}`, JSON.stringify(data));
	} catch {
		console.error(`[acp] ${tag}`, data);
	}
}

/**
 * Drop any line that doesn't look like a JSON-RPC frame.
 *
 * Gemini CLI (issue #22647) prints lines like `Loaded cached credentials.`
 * and `<EPHEMERAL_MESSAGE>...</EPHEMERAL_MESSAGE>` on stdout alongside the
 * ndjson frames. This filter keeps only lines whose first non-whitespace
 * character is `{` or `[` and passes them through untouched, line-buffering
 * so no partial frames leak.
 */
export function filterNonJsonLines(): Transform {
	let buf = "";
	return new Transform({
		transform(chunk, _enc, cb) {
			buf += chunk.toString("utf8");
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
					this.push(`${line}\n`);
				} else {
					debugLog("stdout-drop", { line: trimmed.slice(0, 200) });
				}
			}
			cb();
		},
		flush(cb) {
			const trimmed = buf.trim();
			if (trimmed && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
				this.push(`${buf}\n`);
			} else if (trimmed) {
				debugLog("stdout-drop-final", { line: trimmed.slice(0, 200) });
			}
			buf = "";
			cb();
		},
	});
}

const STDERR_RING_MAX_LINES = 256;
const STDERR_RING_MAX_BYTES = 64 * 1024;

/** Bounded ring buffer for stderr tails (for failure reporting). */
export class StderrRing {
	#lines: string[] = [];
	#bytes = 0;
	#tailBuf = "";

	write(chunk: string): void {
		this.#tailBuf += chunk;
		const parts = this.#tailBuf.split("\n");
		this.#tailBuf = parts.pop() ?? "";
		for (const line of parts) {
			this.#push(line);
		}
	}

	flush(): void {
		if (this.#tailBuf) {
			this.#push(this.#tailBuf);
			this.#tailBuf = "";
		}
	}

	tail(maxLines = 20): string {
		this.flush();
		return this.#lines.slice(-maxLines).join("\n");
	}

	#push(line: string): void {
		this.#lines.push(line);
		this.#bytes += line.length + 1;
		while (this.#lines.length > STDERR_RING_MAX_LINES || this.#bytes > STDERR_RING_MAX_BYTES) {
			const dropped = this.#lines.shift();
			if (dropped === undefined) break;
			this.#bytes -= dropped.length + 1;
		}
	}
}

export interface SpawnAcpResult {
	child: ChildProcessByStdio<Writable, Readable, Readable>;
	/** Raw stdin (agent writes JSON-RPC frames into this). */
	stdin: Writable;
	/** Filtered stdout — safe to feed to ndJsonStream. */
	stdout: Readable;
	/** Stderr ring buffer for failure tails. */
	stderr: StderrRing;
}

export interface SpawnAcpOptions {
	binary: string;
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	cwd?: string;
	/** Override stderr drain behavior (defaults to ring-buffer + optional debug log). */
	onStderr?: (chunk: string) => void;
}

/**
 * Spawn an ACP agent subprocess with `stdio: ['pipe','pipe','pipe']`.
 *
 * stderr is always piped (never inherited, never merged into stdout) and fed
 * into a bounded ring buffer so we can attach a tail to any failure report.
 *
 * stdout is passed through `filterNonJsonLines` before being returned, so the
 * consumer can hand the returned `stdout` directly to `ndJsonStream` without
 * worrying about stdout pollution.
 *
 * The caller is responsible for `child.unref()` once handshake succeeds and
 * for wiring up process lifecycle (`close`, `exit`, etc).
 */
export function spawnAcp(opts: SpawnAcpOptions): SpawnAcpResult {
	const child = spawn(opts.binary, [...opts.args], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...opts.env },
		cwd: opts.cwd,
		// Detach so we can cleanly signal the process group on shutdown.
		detached: false,
	}) as ChildProcessByStdio<Writable, Readable, Readable>;

	const ring = new StderrRing();
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		ring.write(chunk);
		if (opts.onStderr) opts.onStderr(chunk);
		else debugLog("stderr", { chunk: chunk.slice(0, 500) });
	});

	const filteredStdout = child.stdout.pipe(filterNonJsonLines());

	return {
		child,
		stdin: child.stdin,
		stdout: filteredStdout as Readable,
		stderr: ring,
	};
}

/**
 * Convert Node streams to Web streams suitable for ndJsonStream from the SDK.
 */
export function toWebStreams(opts: {
	nodeReadable: Readable;
	nodeWritable: Writable;
}): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } {
	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			opts.nodeReadable.on("data", chunk => {
				const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
				controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
			});
			opts.nodeReadable.on("end", () => controller.close());
			opts.nodeReadable.on("error", err => controller.error(err));
		},
	});

	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			return new Promise<void>((resolve, reject) => {
				opts.nodeWritable.write(Buffer.from(chunk), err => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
		close() {
			return new Promise<void>(resolve => opts.nodeWritable.end(() => resolve()));
		},
	});

	return { readable, writable };
}
