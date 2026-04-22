import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { AssistantMessageEvent, Context, Model } from "../src/types";
import { registerAdapter, streamAcp } from "../src/providers/acp";
import type { CliAdapter } from "../src/providers/acp";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "fake-acp-agent.ts");

const fakeAdapter: CliAdapter = {
	id: "fake-acp",
	displayName: "Fake ACP (test fixture)",
	binary: process.execPath, // bun or node
	installHint: "n/a",
	loginCommand: [],
	async probeAuth() {
		return { kind: "logged_in_api_key" };
	},
	spawnArgs() {
		// Pass the fixture script as the first arg so `bun run <file>` executes it.
		return [FIXTURE_PATH];
	},
	extraEnv() {
		return {};
	},
};

const pollutedAdapter: CliAdapter = {
	...fakeAdapter,
	id: "fake-acp-polluted",
	spawnArgs() {
		return [FIXTURE_PATH, "--polluted"];
	},
};

registerAdapter("fake-acp", fakeAdapter);
registerAdapter("fake-acp-polluted", pollutedAdapter);

function makeModel(provider: string): Model<"acp-agent"> {
	return {
		id: "fake-model",
		name: "Fake Model",
		api: "acp-agent",
		provider,
		baseUrl: "",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 1_000,
	};
}

const context: Context = {
	messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
};

async function collectEvents(
	model: Model<"acp-agent">,
): Promise<AssistantMessageEvent[]> {
	const stream = streamAcp(model, context, {
		permissionMode: "auto-allow",
		workspaceRoot: process.cwd(),
		timeouts: { initializeMs: 5_000, sessionNewMs: 5_000, promptMs: 10_000, cancelMs: 2_000, sigtermMs: 2_000 },
	});
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("streamAcp integration (fake fixture)", () => {
	it("round-trips a prompt through the fake agent and emits nested spans", async () => {
		const events = await collectEvents(makeModel("fake-acp"));
		const types = events.map(e => e.type);

		// At minimum we expect: start, then one thinking span, then one text span, then done.
		expect(types[0]).toBe("start");
		expect(types).toContain("thinking_start");
		expect(types).toContain("thinking_end");
		expect(types).toContain("text_start");
		expect(types).toContain("text_end");

		const done = events.find(e => e.type === "done");
		expect(done).toBeDefined();
		if (done?.type !== "done") throw new Error("unreachable");
		expect(done.reason).toBe("stop");

		const textEnd = events.find(e => e.type === "text_end");
		if (textEnd?.type !== "text_end") throw new Error("expected text_end");
		expect(textEnd.content).toBe("Hello, world!");

		const thinkingEnd = events.find(e => e.type === "thinking_end");
		if (thinkingEnd?.type !== "thinking_end") throw new Error("expected thinking_end");
		expect(thinkingEnd.content).toBe("Thinking about the answer...");

		// Spans must be well-nested: thinking_end precedes text_start.
		const thinkingEndIdx = types.indexOf("thinking_end");
		const textStartIdx = types.indexOf("text_start");
		expect(thinkingEndIdx).toBeGreaterThan(-1);
		expect(textStartIdx).toBeGreaterThan(thinkingEndIdx);
	}, 15_000);

	it("tolerates non-JSON stdout pollution via filterNonJsonLines", async () => {
		const events = await collectEvents(makeModel("fake-acp-polluted"));
		const done = events.find(e => e.type === "done");
		expect(done).toBeDefined();
		if (done?.type !== "done") throw new Error("unreachable");
		expect(done.reason).toBe("stop");
	}, 15_000);
});
