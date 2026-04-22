import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveLocalUrlToPath } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { initTheme, setThemeInstance, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Text } from "@oh-my-pi/pi-tui";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

describe("InteractiveMode plan review rendering", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-review-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		}

		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: "Test",
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		_resetSettingsForTest();
	});

	it("re-appends refreshed plan review previews at the chat tail", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# First plan\n\nalpha");

		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Stay in plan mode");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		const firstPreview = mode.chatContainer.children.at(-1);
		expect(firstPreview).toBeDefined();
		expect(firstPreview!.render(120).join("\n")).toContain("First plan");

		const marker = new Text("MARKER", 0, 0);
		mode.chatContainer.addChild(marker);
		await Bun.write(resolvedPlanPath, "# Second plan\n\nbeta");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		expect(mode.chatContainer.children.at(-1)).toBe(firstPreview);
		expect(mode.chatContainer.children.at(-2)).toBe(marker);
		expect(firstPreview!.render(120).join("\n")).toContain("Second plan");
	});

	it("queues Approved in the current session when that review option is selected", async () => {
		const planFilePath = "local://PLAN.md";
		const finalPlanFilePath = "local://CURRENT_SESSION_PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		const resolvedFinalPath = resolveLocalUrlToPath(finalPlanFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Current session plan\n\nship it");

		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		const submissionSpy = vi.fn();
		mode.onInputCallback = submissionSpy;
		vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, options) => {
			expect(options).toContain("Approve and execute (current session)");
			return "Approve and execute (current session)";
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "CURRENT_SESSION_PLAN",
			finalPlanFilePath,
		});

		expect(mode.planModeEnabled).toBe(false);
		expect(submissionSpy).toHaveBeenCalledTimes(1);
		expect(submissionSpy.mock.calls[0]?.[0]).toMatchObject({
			text: "Approved",
			cancelled: false,
			started: false,
		});
		expect(await Bun.file(resolvedPlanPath).exists()).toBe(false);
		expect(await Bun.file(resolvedFinalPath).text()).toContain("Current session plan");
	});

	it("unsubscribes from theme changes on stop", async () => {
		await mode.init();
		const invalidateSpy = vi.spyOn(mode.ui, "invalidate");
		const requestRenderSpy = vi.spyOn(mode.ui, "requestRender");

		mode.stop();
		invalidateSpy.mockClear();
		requestRenderSpy.mockClear();
		_resetSettingsForTest();

		expect(() => setThemeInstance(theme)).not.toThrow();
		expect(invalidateSpy).not.toHaveBeenCalled();
		expect(requestRenderSpy).not.toHaveBeenCalled();
	});
});
