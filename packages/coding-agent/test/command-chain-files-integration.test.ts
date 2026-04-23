import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
import { reset as resetCapabilities } from "../src/capability";
import { ModelRegistry } from "../src/config/model-registry";
import { EventBus } from "../src/utils/event-bus";

class MockAssistantStream extends AssistantMessageEventStream {}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("command chain files integration", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
		if (typeof process.stdin.setRawMode === "function") {
			vi.spyOn(process.stdin, "setRawMode").mockReturnValue(process.stdin);
		}

		_resetSettingsForTest();
		resetCapabilities();
		tempDir = TempDir.createSync("@pi-command-chain-files-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected claude-sonnet-4-5 model to exist");
		}

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("Done") });
				});
				return stream;
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test", undefined, () => {}, [], undefined, new EventBus());
	});

	afterEach(async () => {
		mode?.stop();
		vi.restoreAllMocks();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		resetCapabilities();
		_resetSettingsForTest();
	});

	it("loads mixed command directories, warns on startup and reload, and keeps valid commands active", async () => {
		const commandsDir = path.join(tempDir.path(), ".omp", "commands");
		await Bun.write(
			path.join(commandsDir, "review.cmd.yaml"),
			["description: Review chain", "steps:", '  - "First review: $ARGUMENTS"', '  - "Second review"'].join("\n"),
		);
		await Bun.write(path.join(commandsDir, "winner.md"), "---\ndescription: Winner\n---\nWinner body");
		await Bun.write(
			path.join(commandsDir, "winner.cmd.yaml"),
			["description: Loser", "steps:", '  - "Ignored"'].join("\n"),
		);
		await Bun.write(path.join(commandsDir, "broken.cmd.yaml"), "description: nope\nsteps: [unterminated");
		await Bun.write(
			path.join(commandsDir, "schema.cmd.yaml"),
			["description: 123", "steps:", "  - ok", "  - 42"].join("\n"),
		);

		const showWarningSpy = vi.spyOn(mode, "showWarning");
		await mode.init();

		expect(showWarningSpy).toHaveBeenCalledTimes(1);
		const warningBlock = showWarningSpy.mock.calls[0]?.[0] ?? "";
		expect(warningBlock).toContain("Command file errors:");
		expect(warningBlock).toContain("broken");
		expect(warningBlock).toContain("schema");
		expect(warningBlock).toContain("winner");
		expect(warningBlock).toContain(path.join(commandsDir, "winner.md"));
		expect(warningBlock).toContain(path.join(commandsDir, "winner.cmd.yaml"));

		expect(mode.fileSlashCommands.has("review")).toBe(true);
		expect(mode.fileSlashCommands.has("winner")).toBe(true);
		expect(mode.fileSlashCommands.has("broken")).toBe(false);
		expect(mode.fileSlashCommands.has("schema")).toBe(false);
		expect(session.fileCommands).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "prompt-chain",
					name: "review",
					stepTemplates: ["First review: $ARGUMENTS", "Second review"],
				}),
				expect.objectContaining({ kind: "template", name: "winner", content: "Winner body" }),
			]),
		);

		await mode.refreshSlashCommandState(tempDir.path());
		expect(showWarningSpy).toHaveBeenCalledTimes(2);
	});

	it("dispatches prompt-chain steps for normal prompt submission", async () => {
		const commandsDir = path.join(tempDir.path(), ".omp", "commands");
		await Bun.write(
			path.join(commandsDir, "review.cmd.yaml"),
			["description: Review chain", "steps:", '  - "First review: $ARGUMENTS"', '  - "Second review"'].join("\n"),
		);

		await mode.init();
		await session.prompt("/review parser");
		await Bun.sleep(10);
		await session.waitForIdle();

		const userTexts = session.messages
			.filter(message => message.role === "user")
			.map(message =>
				typeof message.content === "string"
					? message.content
					: message.content[0]?.type === "text"
						? message.content[0].text
						: "",
			);
		expect(userTexts).toEqual(["First review: parser", "Second review"]);
	});

	it("attaches images only to the first prompt-chain step", async () => {
		const commandsDir = path.join(tempDir.path(), ".omp", "commands");
		await Bun.write(
			path.join(commandsDir, "review.cmd.yaml"),
			["description: Review chain", "steps:", '  - "First review: $ARGUMENTS"', '  - "Second review"'].join("\n"),
		);

		await mode.init();
		const image = { type: "image", data: "abc", mimeType: "image/png" } as const;
		await session.prompt("/review parser", { images: [image] });
		await Bun.sleep(10);
		await session.waitForIdle();

		const userMessages = session.messages.filter(message => message.role === "user");
		expect(userMessages).toHaveLength(2);
		expect(userMessages[0]?.content).toEqual([{ type: "text", text: "First review: parser" }, image]);
		expect(userMessages[1]?.content).toEqual([{ type: "text", text: "Second review" }]);
	});

	it("starts a fresh prompt chain immediately after an errored assistant turn", async () => {
		const localTempDir = TempDir.createSync("@pi-command-chain-files-error-");
		let localAuthStorage: AuthStorage | undefined;
		let localSession: AgentSession | undefined;
		let localMode: InteractiveMode | undefined;

		try {
			await Settings.init({ inMemory: true, cwd: localTempDir.path() });
			localAuthStorage = await AuthStorage.create(path.join(localTempDir.path(), "testauth.db"));
			localAuthStorage.setRuntimeApiKey("anthropic", "test-key");
			const localModelRegistry = new ModelRegistry(localAuthStorage);
			const model = getBundledModel("anthropic", "claude-sonnet-4-5");
			if (!model) {
				throw new Error("Expected claude-sonnet-4-5 model to exist");
			}

			const responses = [
				{ kind: "error", text: "Failed" },
				{ kind: "done", text: "Recovered" },
			] as const;
			let streamCallCount = 0;
			const agent = new Agent({
				getApiKey: () => "test-key",
				initialState: {
					model,
					systemPrompt: "Test",
					tools: [],
					messages: [],
				},
				streamFn: () => {
					const response = responses[streamCallCount];
					streamCallCount += 1;
					const stream = new MockAssistantStream();
					queueMicrotask(() => {
						if (response?.kind === "error") {
							const message: AssistantMessage = {
								...createAssistantMessage(response.text),
								stopReason: "error",
								errorMessage: "boom",
							};
							stream.push({ type: "start", partial: message });
							stream.push({ type: "error", reason: "error", error: message });
							return;
						}
						stream.push({ type: "start", partial: createAssistantMessage("") });
						stream.push({
							type: "done",
							reason: "stop",
							message: createAssistantMessage(response?.text ?? "Done"),
						});
					});
					return stream;
				},
			});

			localSession = new AgentSession({
				agent,
				sessionManager: SessionManager.create(localTempDir.path(), localTempDir.path()),
				settings: Settings.isolated({ "compaction.enabled": false }),
				modelRegistry: localModelRegistry,
			});
			localMode = new InteractiveMode(localSession, "test", undefined, () => {}, [], undefined, new EventBus());

			const commandsDir = path.join(localTempDir.path(), ".omp", "commands");
			await Bun.write(
				path.join(commandsDir, "review.cmd.yaml"),
				["description: Review chain", "steps:", '  - "First review: $ARGUMENTS"', '  - "Second review"'].join("\n"),
			);

			await localMode.init();
			await localSession.prompt("/review parser");
			await Bun.sleep(10);
			await localSession.waitForIdle();
			await localSession.prompt("/review docs");
			await Bun.sleep(10);
			await localSession.waitForIdle();

			const userTexts = localSession.messages
				.filter(message => message.role === "user")
				.map(message =>
					typeof message.content === "string"
						? message.content
						: message.content[0]?.type === "text"
							? message.content[0].text
							: "",
				);
			expect(streamCallCount).toBe(3);
			expect(userTexts).toEqual(["First review: parser", "First review: docs", "Second review"]);
		} finally {
			localMode?.stop();
			await localSession?.dispose();
			localAuthStorage?.close();
			localTempDir.removeSync();
		}
	});
});
