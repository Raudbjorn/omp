import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { FileSlashCommand } from "../src/extensibility/slash-commands";
import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext, SubmittedUserInput } from "../src/modes/types";
import * as builtinRegistry from "../src/slash-commands/builtin-registry";

async function createSkillCommand(
	body = "Follow the skill instructions.",
): Promise<{ filePath: string; isNative: false }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-skill-"));
	const filePath = path.join(dir, "demo.md");
	await Bun.write(filePath, body);
	return { filePath, isNative: false };
}

class StubEditor {
	public text = "";
	public history: string[] = [];
	public onSubmit?: (text: string) => Promise<void>;

	setText(value: string): void {
		this.text = value;
	}

	getText(): string {
		return this.text;
	}

	addToHistory(value: string): void {
		this.history.push(value);
	}
}

function createTestContext() {
	const editor = new StubEditor();
	const showError = vi.fn();
	const showWarning = vi.fn();
	const showStatus = vi.fn();
	const setForcedToolChoiceMock = vi.fn();
	const promptChainExecuteMock = vi.fn(async () => {});
	const promptMock = vi.fn(async () => {});
	const continueFromContextMock = vi.fn(async () => {});
	const promptCustomMessageMock = vi.fn(async () => {});
	const planMock = vi.fn(async () => {});
	const sendCustomMessageMock = vi.fn(async () => {});
	const handleBashCommandMock = vi.fn(async () => {});
	const handleBtwCommandMock = vi.fn(async () => {});
	const handlePythonCommandMock = vi.fn(async () => {});
	const flushPendingBashComponentsMock = vi.fn();
	const rebuildChatFromMessagesMock = vi.fn();
	const slashCommands: FileSlashCommand[] = [];
	const startPendingSubmission = vi.fn(
		(input: { text: string; images?: InteractiveModeContext["pendingImages"] }): SubmittedUserInput => ({
			text: input.text,
			images: input.images,
			cancelled: false,
			started: false,
		}),
	);

	const ctx = {
		ui: {} as InteractiveModeContext["ui"],
		chatContainer: {} as InteractiveModeContext["chatContainer"],
		pendingMessagesContainer: {} as InteractiveModeContext["pendingMessagesContainer"],
		statusContainer: {} as InteractiveModeContext["statusContainer"],
		todoContainer: {} as InteractiveModeContext["todoContainer"],
		editor,
		editorContainer: {} as InteractiveModeContext["editorContainer"],
		statusLine: {} as InteractiveModeContext["statusLine"],
		fileSlashCommands: new Set<string>(),
		session: {
			isStreaming: false,
			queuedMessageCount: 0,
			messages: [{ role: "assistant" }],
			abort: vi.fn(async () => {}),
			extensionRunner: undefined,
			isCompacting: false,
			prompt: promptMock,
			continueFromContext: continueFromContextMock,
			promptCustomMessage: promptCustomMessageMock,
			sendCustomMessage: sendCustomMessageMock,
			setForcedToolChoice: setForcedToolChoiceMock,
			promptChainExecutor: { execute: promptChainExecuteMock },
			setSlashCommands: vi.fn((commands: FileSlashCommand[]) => {
				slashCommands.splice(0, slashCommands.length, ...commands);
			}),
			get fileCommands() {
				return slashCommands;
			},
			modelRegistry: {} as InteractiveModeContext["session"]["modelRegistry"],
			sessionId: "test-session",
		} as unknown as InteractiveModeContext["session"],
		sessionManager: {
			getCwd: () => process.cwd(),
			getSessionName: () => "existing",
			setSessionName: vi.fn(async () => {}),
			getSessionDir: () => ".",
			getEntries: () => [],
		} as unknown as InteractiveModeContext["sessionManager"],
		settings: {
			get: () => false,
			getModelRole: () => "default",
		} as unknown as InteractiveModeContext["settings"],
		agent: {
			state: { messages: [{ role: "user" }] },
		} as InteractiveModeContext["agent"],
		pendingImages: [] as InteractiveModeContext["pendingImages"],
		pendingImageLinks: [] as InteractiveModeContext["pendingImageLinks"],
		compactionQueuedMessages: [] as InteractiveModeContext["compactionQueuedMessages"],
		pendingTools: new Map(),
		pendingBashComponents: [],
		pendingPythonComponents: [],
		isPythonMode: false,
		isBashMode: false,
		toolOutputExpanded: false,
		todoExpanded: false,
		planModeEnabled: false,
		planModePlanFilePath: undefined,
		hideThinkingBlock: false,
		pendingImagesQueue: undefined,
		isBackgrounded: false,
		pendingBashMessages: [],
		pendingPythonMessages: [],
		skillCommands: new Map<string, string>(),
		startPendingSubmission,
		showError,
		showWarning,
		showStatus,
		rebuildChatFromMessages: rebuildChatFromMessagesMock,
		reloadTodos: vi.fn(async () => {}),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		flushPendingBashComponents: flushPendingBashComponentsMock,
		queueCompactionMessage: vi.fn(),
		handleBashCommand: handleBashCommandMock,
		handleBtwCommand: handleBtwCommandMock,
		handlePythonCommand: handlePythonCommandMock,
		handlePlanModeCommand: planMock,
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		handleBackgroundCommand: vi.fn(),
		pendingImagesContainer: {} as InteractiveModeContext["pendingMessagesContainer"],
		setToolUIContext: vi.fn(),
		initializeHookRunner: vi.fn(),
		createBackgroundUiContext: vi.fn(),
		setHookWidget: vi.fn(),
		setHookStatus: vi.fn(),
		setTodos: vi.fn(),
		agentStart: vi.fn(),
		showWarningMessage: vi.fn(),
	} as unknown as InteractiveModeContext;

	return {
		ctx,
		editor,
		showError,
		showWarning,
		showStatus,
		promptChainExecuteMock,
		promptMock,
		promptCustomMessageMock,
		continueFromContextMock,
		setForcedToolChoiceMock,
		planMock,
		sendCustomMessageMock,
		handleBashCommandMock,
		handleBtwCommandMock,
		flushPendingBashComponentsMock,
		rebuildChatFromMessagesMock,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("InputController multi-block submissions", () => {
	it("skips unsupported builtin commands with warnings and no raw-envelope history", async () => {
		const { ctx, editor, showWarning, promptMock, planMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/settings\n/plan focus auth\n`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showWarning).toHaveBeenNthCalledWith(
			1,
			'Skipping unsupported "/settings" command in multi-block submission.',
		);
		expect(showWarning).toHaveBeenNthCalledWith(2, 'Skipping unsupported "/plan" command in multi-block submission.');
		expect(promptMock).not.toHaveBeenCalled();
		expect(planMock).not.toHaveBeenCalled();
		expect(editor.history).toHaveLength(0);
		expect(editor.getText()).toBe("");
	});

	it("skips unsupported builtins before final text", async () => {
		const { ctx, editor, planMock, showError, showWarning } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/plan\nNeed a summary of changes`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showError).not.toHaveBeenCalled();
		expect(showWarning).toHaveBeenCalledWith('Skipping unsupported "/plan" command in multi-block submission.');
		expect(planMock).not.toHaveBeenCalled();
		expect(onInput).toHaveBeenCalledWith({
			text: "Need a summary of changes",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual(["Need a summary of changes"]);
	});

	it("runs /btw before trailing text without persisting a btw transcript entry", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock, showError, rebuildChatFromMessagesMock } =
			createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/btw why is the cache warm?\nUse the cached path for the main fix`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showError).not.toHaveBeenCalled();
		expect(handleBtwCommandMock).toHaveBeenCalledWith("why is the cache warm?");
		expect(sendCustomMessageMock).not.toHaveBeenCalled();
		expect(rebuildChatFromMessagesMock).not.toHaveBeenCalled();
		expect(onInput).toHaveBeenCalledWith({
			text: "Use the cached path for the main fix",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual(["Use the cached path for the main fix"]);
	});

	it("passes through remaining prompt text from builtin slash commands in multi-block submissions", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock, showError } = createTestContext();
		ctx.skillCommands = new Map([
			["skill:demo", await createSkillCommand("Follow the skill instructions.")],
		]) as never;
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();
		const executeBuiltinSlashCommandSpy = vi
			.spyOn(builtinRegistry, "executeBuiltinSlashCommand")
			.mockResolvedValueOnce("Keep the current patch small");

		const submission = "/btw rewritten prompt\n\n/skill:demo";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(executeBuiltinSlashCommandSpy).toHaveBeenCalledWith(
			"/btw rewritten prompt",
			expect.objectContaining({
				ctx,
				handleBackgroundCommand: expect.any(Function),
			}),
		);
		expect(handleBtwCommandMock).not.toHaveBeenCalled();
		expect(showError).not.toHaveBeenCalled();
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "Keep the current patch small" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "skill-prompt" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["Keep the current patch small", "/skill:demo"]);
	});

	it("emits text before multi-block skills using the standalone skill path", async () => {
		const { ctx, editor, sendCustomMessageMock, showError, rebuildChatFromMessagesMock } = createTestContext();
		ctx.skillCommands = new Map([["skill:demo", await createSkillCommand("Summarize the current fix.")]]) as never;
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `Intro step\n\n/skill:demo\nNeed summary`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showError).not.toHaveBeenCalled();
		expect(onInput).toHaveBeenCalledWith({
			text: "Need summary",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "Intro step" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "skill-prompt" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(rebuildChatFromMessagesMock).toHaveBeenCalledTimes(2);
		expect(editor.history).toEqual(["Intro step", "/skill:demo", "Need summary"]);
	});

	it("rebuilds live chat for skill-text-skill stacks in source order", async () => {
		const { ctx, editor, sendCustomMessageMock, rebuildChatFromMessagesMock } = createTestContext();
		ctx.skillCommands = new Map([
			["skill:caveman", await createSkillCommand("Speak plainly.")],
			["skill:algorithmic_art", await createSkillCommand("Draw with code.")],
		]) as never;
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/skill:caveman\n\nhere is a bit of text\n\n/skill:algorithmic_art`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "skill-prompt" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "multi-block-text", content: "here is a bit of text" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ customType: "skill-prompt" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(rebuildChatFromMessagesMock).toHaveBeenCalledTimes(3);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
	});

	it("preserves text-before-final-skill order and triggers continue-from-context", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		ctx.skillCommands = new Map([["skill:demo", await createSkillCommand("Use the skill body.")]]) as never;
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "good\n\n/skill:demo";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "good" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "skill-prompt" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["good", "/skill:demo"]);
	});

	it("emits text before a final /btw and continues from context without a trailing user message", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock, rebuildChatFromMessagesMock } =
			createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "Keep the current patch small\n\n/btw what evidence justifies this path?";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).toHaveBeenCalledWith("what evidence justifies this path?");
		expect(sendCustomMessageMock).toHaveBeenCalledTimes(1);
		expect(sendCustomMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "multi-block-text", content: "Keep the current patch small" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(rebuildChatFromMessagesMock).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["Keep the current patch small"]);
	});

	it("runs /btw-only stacks without persisting transcript entries or starting a turn", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/btw first side question\n\n/btw second side question`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(1, "first side question");
		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(2, "second side question");
		expect(sendCustomMessageMock).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toHaveLength(0);
	});

	it("runs stacked /btw blocks in author order before final text", async () => {
		const { ctx, editor, handleBtwCommandMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/btw first replacement\n\n/btw second replacement\n\nFinal user turn`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(1, "first replacement");
		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(2, "second replacement");
		expect(onInput).toHaveBeenCalledWith({
			text: "Final user turn",
			images: undefined,
			cancelled: false,
			started: false,
		});
	});

	it("expands file commands and emits their text before final blocks", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		ctx.session.setSlashCommands([
			{
				kind: "template",
				name: "test-multi.block",
				description: "",
				content: "Generated block",
				source: "test",
			},
		] as unknown as FileSlashCommand[]);
		ctx.fileSlashCommands = new Set(["test-multi.block"]);
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/test-multi.block\n\nNext text`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(sendCustomMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "multi-block-text", content: "Generated block" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "Next text",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual(["Generated block", "Next text"]);
	});

	it("flushes earlier bash shortcut output before starting a final prompt-chain command", async () => {
		const { ctx, editor, flushPendingBashComponentsMock, promptChainExecuteMock, handleBashCommandMock } =
			createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		ctx.pendingImages = [{ type: "image", data: "diagram", mimeType: "image/png" }] as never;
		handleBashCommandMock.mockImplementationOnce(async () => {
			ctx.pendingBashComponents.push({} as never);
		});
		ctx.session.setSlashCommands([
			{
				kind: "prompt-chain",
				name: "review-chain",
				description: "",
				stepTemplates: ["First", "Second"],
				source: "test",
			},
		] as unknown as FileSlashCommand[]);
		ctx.fileSlashCommands = new Set(["review-chain"]);
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!ls\n\n/review-chain parser";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBashCommandMock).toHaveBeenCalledWith("ls", false);
		expect(promptChainExecuteMock).toHaveBeenCalledWith("review-chain", ["First", "Second"], "parser", {
			images: [{ type: "image", data: "diagram", mimeType: "image/png" }],
			streamingBehavior: undefined,
		});
		expect(flushPendingBashComponentsMock).toHaveBeenCalledTimes(1);
		expect(flushPendingBashComponentsMock.mock.invocationCallOrder[0]).toBeLessThan(
			promptChainExecuteMock.mock.invocationCallOrder[0]!,
		);
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.getText()).toBe("");
		expect(ctx.pendingImages).toEqual([]);
	});

	it("rejects prompt-chain commands before later multi-block content", async () => {
		const { ctx, editor, promptChainExecuteMock, sendCustomMessageMock, showError } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		ctx.session.setSlashCommands([
			{
				kind: "prompt-chain",
				name: "review-chain",
				description: "",
				stepTemplates: ["First", "Second"],
				source: "test",
			},
		] as unknown as FileSlashCommand[]);
		ctx.fileSlashCommands = new Set(["review-chain"]);
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "/review-chain parser\n\nFollow-up text";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(promptChainExecuteMock).not.toHaveBeenCalled();
		expect(sendCustomMessageMock).not.toHaveBeenCalled();
		expect(showError).toHaveBeenCalledWith(
			'Prompt-chain command "/review-chain" must be the final renderable block in a multi-block submission.',
		);
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toEqual([]);
		expect(editor.getText()).toBe(submission);
	});

	it("rejects prompt-chain commands before later multi-block content without running earlier handled blocks", async () => {
		const { ctx, editor, handleBtwCommandMock, promptChainExecuteMock, sendCustomMessageMock, showError } =
			createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		ctx.session.setSlashCommands([
			{
				kind: "prompt-chain",
				name: "review-chain",
				description: "",
				stepTemplates: ["First", "Second"],
				source: "test",
			},
		] as unknown as FileSlashCommand[]);
		ctx.fileSlashCommands = new Set(["review-chain"]);
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "/btw side question\n\n/review-chain parser\n\nTail";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).not.toHaveBeenCalled();
		expect(promptChainExecuteMock).not.toHaveBeenCalled();
		expect(sendCustomMessageMock).not.toHaveBeenCalled();
		expect(showError).toHaveBeenCalledWith(
			'Prompt-chain command "/review-chain" must be the final renderable block in a multi-block submission.',
		);
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toEqual([]);
		expect(editor.getText()).toBe(submission);
	});

	it("executes mixed shortcut and text blocks in author order", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!ls\nthis is a message\n!ls -al\nthis is another\n$print('hi')";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(1, "ls", false);
		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(2, "ls -al", false);
		expect(ctx.handlePythonCommand).toHaveBeenNthCalledWith(1, "print('hi')", false);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "this is a message" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "multi-block-text", content: "this is another" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["this is a message", "this is another"]);
	});

	it("handles command-only shortcut stacks without triggering an agent turn", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!ls\n!! pwd\n$print('hi')\n$$ print('hidden')";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(1, "ls", false);
		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(2, "pwd", true);
		expect(ctx.handlePythonCommand).toHaveBeenNthCalledWith(1, "print('hi')", false);
		expect(ctx.handlePythonCommand).toHaveBeenNthCalledWith(2, "print('hidden')", true);
		expect(sendCustomMessageMock).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toHaveLength(0);
	});

	it("treats multiline empty shortcut lines as plain text", async () => {
		const { ctx, editor } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!\n$$\nhello";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).not.toHaveBeenCalled();
		expect(ctx.handlePythonCommand).not.toHaveBeenCalled();
		expect(onInput).toHaveBeenCalledWith({
			text: submission,
			images: undefined,
			cancelled: false,
			started: false,
		});
	});

	it("executes fenced bash shortcuts as one command block", async () => {
		const { ctx, editor } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = '!```\necho "this\nis a test\nboo"\n```';
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenCalledWith('echo "this\nis a test\nboo"', false);
		expect(ctx.handlePythonCommand).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toHaveLength(0);
	});

	it("executes fenced python shortcuts as one command block", async () => {
		const { ctx, editor } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "$```\ntext = '''hello\nworld'''\nprint(text)\n```";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handlePythonCommand).toHaveBeenCalledWith("text = '''hello\nworld'''\nprint(text)", false);
		expect(ctx.handleBashCommand).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toHaveLength(0);
	});

	it("preserves order when text and fenced shortcuts are mixed", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!```\necho hi\n```\nmessage one\n$```\nprint('hi')\n```\nmessage two";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenCalledWith("echo hi", false);
		expect(ctx.handlePythonCommand).toHaveBeenCalledWith("print('hi')", false);
		expect(sendCustomMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "multi-block-text", content: "message one" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "message two",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual(["message one", "message two"]);
	});
});
