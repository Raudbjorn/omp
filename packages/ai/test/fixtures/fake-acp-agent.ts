#!/usr/bin/env bun
/**
 * Minimal ACP agent fixture used by integration tests.
 *
 * Implements the bare slice needed to round-trip a single prompt:
 *   initialize → session/new → session/prompt (with a canned update sequence)
 *
 * Reads newline-delimited JSON-RPC frames on stdin, writes them on stdout.
 * Any non-protocol output (spurious `Loaded cached credentials.` etc.) goes
 * to stderr, matching the behaviour of a real CLI so the filterNonJsonLines
 * transform can be exercised.
 *
 * Usage: bun packages/ai/test/fixtures/fake-acp-agent.ts [--polluted]
 */
import { stdin, stdout, stderr } from "node:process";

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

const polluted = process.argv.includes("--polluted");

function writeFrame(obj: JsonRpcResponse | JsonRpcNotification): void {
	stdout.write(`${JSON.stringify(obj)}\n`);
}

function sendNotification(method: string, params: unknown): void {
	writeFrame({ jsonrpc: "2.0", method, params });
}

async function sleep(ms: number): Promise<void> {
	await new Promise(r => setTimeout(r, ms));
}

async function handle(req: JsonRpcRequest): Promise<void> {
	switch (req.method) {
		case "initialize": {
			writeFrame({
				jsonrpc: "2.0",
				id: req.id,
				result: {
					protocolVersion: 1,
					agentCapabilities: {
						loadSession: false,
						promptCapabilities: { audio: false, image: false, embeddedContext: false },
						mcpCapabilities: { http: false, sse: false },
					},
					authMethods: [],
				},
			});
			if (polluted) {
				stdout.write("Loaded cached credentials.\n");
				stdout.write("<EPHEMERAL_MESSAGE>spurious junk</EPHEMERAL_MESSAGE>\n");
			}
			return;
		}
		case "session/new": {
			writeFrame({
				jsonrpc: "2.0",
				id: req.id,
				result: { sessionId: "fake-session-1", modes: null },
			});
			return;
		}
		case "session/prompt": {
			const sessionId = "fake-session-1";
			// Canned stream: thinking → text (split into 2 chunks) → stop
			await sleep(5);
			sendNotification("session/update", {
				sessionId,
				update: {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: "Thinking about the answer..." },
				},
			});
			await sleep(5);
			sendNotification("session/update", {
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello" },
				},
			});
			await sleep(5);
			sendNotification("session/update", {
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: ", world!" },
				},
			});
			await sleep(5);
			writeFrame({
				jsonrpc: "2.0",
				id: req.id,
				result: { stopReason: "end_turn" },
			});
			return;
		}
		case "session/cancel": {
			// Notifications don't have responses, but session/cancel arrives as
			// a request in some agents. Reply with an empty result.
			writeFrame({ jsonrpc: "2.0", id: req.id, result: {} });
			return;
		}
		default: {
			writeFrame({
				jsonrpc: "2.0",
				id: req.id,
				error: { code: -32601, message: `Method not found: ${req.method}` },
			});
		}
	}
}

let buf = "";
stdin.setEncoding("utf8");
stdin.on("data", chunk => {
	buf += chunk;
	let idx = buf.indexOf("\n");
	while (idx !== -1) {
		const line = buf.slice(0, idx);
		buf = buf.slice(idx + 1);
		const trimmed = line.trim();
		if (trimmed) {
			try {
				const parsed = JSON.parse(trimmed) as JsonRpcRequest | JsonRpcNotification;
				if ("id" in parsed && parsed.id !== undefined) {
					void handle(parsed as JsonRpcRequest);
				}
			} catch (err) {
				stderr.write(`fake-acp-agent: parse error: ${String(err)}\n`);
			}
		}
		idx = buf.indexOf("\n");
	}
});

stdin.on("end", () => {
	process.exit(0);
});

// Don't exit immediately when orphaned; let parent manage lifecycle.
