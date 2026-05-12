#!/usr/bin/env bun
/**
 * Manual smoke test for the Gemini CLI ACP adapter.
 *
 * Runs a single prompt through `gemini --acp` via the real `streamAcp`
 * orchestrator and prints each event to the console. Intended for
 * developers validating the stack on a host that has `gemini` installed
 * and authenticated (via the TUI's `/auth` command or a GEMINI_API_KEY
 * env var).
 *
 * Gated by the `GEMINI_SMOKE=1` environment variable so it cannot run in
 * unattended CI and rack up API usage or hit an unauthenticated host.
 *
 * Usage (from packages/ai):
 *   GEMINI_SMOKE=1 bun scripts/smoke-gemini-acp.ts "Hello"
 *   GEMINI_SMOKE=1 GEMINI_CLI_ACP_TRACE=1 bun scripts/smoke-gemini-acp.ts
 */
import { streamAcp } from "../src/providers/acp";
import type { Context, Model } from "../src/types";

function die(msg: string, code = 1): never {
	console.error(`smoke-gemini-acp: ${msg}`);
	process.exit(code);
}

if (process.env.GEMINI_SMOKE !== "1") {
	die("refusing to run without GEMINI_SMOKE=1 (manual gate)", 2);
}

const prompt = process.argv.slice(2).join(" ").trim() || "Say hello in one short sentence.";

const model: Model<"acp-agent"> = {
	id: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
	name: "Gemini (smoke)",
	api: "acp-agent",
	provider: "gemini-cli-acp",
	baseUrl: "",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_048_576,
	maxTokens: 65_536,
};

const context: Context = {
	messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
};

const stream = streamAcp(model, context, {
	permissionMode: "deny-destructive",
	workspaceRoot: process.cwd(),
});

let pushed = 0;
const start = Date.now();
for await (const event of stream) {
	pushed += 1;
	const elapsed = `${((Date.now() - start) / 1000).toFixed(2)}s`;
	switch (event.type) {
		case "start":
			console.log(`[${elapsed}] start`);
			break;
		case "text_start":
			console.log(`[${elapsed}] text_start #${event.contentIndex}`);
			break;
		case "text_delta":
			process.stdout.write(event.delta);
			break;
		case "text_end":
			console.log(`\n[${elapsed}] text_end #${event.contentIndex}`);
			break;
		case "thinking_start":
			console.log(`[${elapsed}] thinking_start #${event.contentIndex}`);
			break;
		case "thinking_delta":
			process.stdout.write(`💭 ${event.delta}`);
			break;
		case "thinking_end":
			console.log(`\n[${elapsed}] thinking_end #${event.contentIndex}`);
			break;
		case "toolcall_start":
			console.log(`[${elapsed}] toolcall_start #${event.contentIndex}`);
			break;
		case "toolcall_end":
			console.log(`[${elapsed}] toolcall_end #${event.contentIndex} ${event.toolCall.name}`);
			break;
		case "done":
			console.log(`[${elapsed}] done reason=${event.reason} (${pushed} events)`);
			break;
		case "error":
			console.error(`[${elapsed}] error reason=${event.reason} msg=${event.error.errorMessage}`);
			process.exitCode = 1;
			break;
	}
}
