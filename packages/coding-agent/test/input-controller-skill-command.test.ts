import { describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { FileSlashCommand } from "../src/extensibility/slash-commands";
import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext, SubmittedUserInput } from "../src/modes/types";

class StubEditor {
	text = "";
	history: string[] = [];
	onSubmit?: (text: string) => Promise<void>;

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
	const promptMock = vi.fn(async () => {});
	const continueFromContextMock = vi.fn(async () => {});
	const promptCustomMessageMock = vi.fn(
		async (
			_message: { content: string; details: { name: string; path: string; args?: string } },
			_options: { streamingBehavior?: string },
		) => {},
	);
	const sendCustomMessageMock = vi.fn(async () => {});
	const handleBashCommandMock = vi.fn(async () => {});
	const handlePythonCommandMock = vi.fn(async () => {});
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
		keybindings: {} as InteractiveModeContext["keybindings"],
		agent: {
			state: { messages: [{ role: "user" }] },
		} as InteractiveModeContext["agent"],
		pendingImages: [] as InteractiveModeContext["pendingImages"],
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
		skillCommands: new Map<string, { filePath: string; isNative: boolean }>(),
		startPendingSubmission,
		showError,
		showWarning: vi.fn(),
		showStatus: vi.fn(),
		reloadTodos: vi.fn(async () => {}),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		flushPendingBashComponents: vi.fn(),
		queueCompactionMessage: vi.fn(),
		handleBashCommand: handleBashCommandMock,
		handlePythonCommand: handlePythonCommandMock,
		handlePlanModeCommand: vi.fn(async () => {}),
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		handleBackgroundCommand: vi.fn(),
		setToolUIContext: vi.fn(),
		initializeHookRunner: vi.fn(),
		createBackgroundUiContext: vi.fn(),
		setHookWidget: vi.fn(),
		setHookStatus: vi.fn(),
		setTodos: vi.fn(),
		agentStart: vi.fn(),
		showWarningMessage: vi.fn(),
	} as unknown as InteractiveModeContext;

	return { ctx, editor, showError, promptCustomMessageMock };
}

describe("InputController skill commands", () => {
	it("includes the anti-reread note in the injected skill prompt", async () => {
		const { ctx, editor, showError, promptCustomMessageMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-skill-command-"));
		const skillPath = path.join(tempDir, "demo-skill", "SKILL.md");
		await Bun.write(skillPath, "---\ndescription: Demo skill\n---\nSkill body contents");
		ctx.skillCommands.set("skill:demo-skill", { filePath: skillPath, isNative: false });

		try {
			const submission = "/skill:demo-skill with args";
			editor.setText(submission);
			await ctx.editor.onSubmit!(submission);

			expect(showError).not.toHaveBeenCalled();
			expect(promptCustomMessageMock).toHaveBeenCalledTimes(1);
			const [message, options] = promptCustomMessageMock.mock.calls[0]!;
			expect(message).toEqual(
				expect.objectContaining({
					details: expect.objectContaining({ name: "demo-skill", path: skillPath, args: "with args" }),
				}),
			);
			expect(message.content).toContain("Skill body contents");
			expect(message.content).toContain(`Skill: ${skillPath}`);
			expect(message.content).toContain("Do not read SKILL.md for demo-skill.");
			expect(options).toEqual(expect.objectContaining({ streamingBehavior: "followUp" }));
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("interpolates native skill bodies before appending metadata lines", async () => {
		const { ctx, editor, showError, promptCustomMessageMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-skill-command-"));
		const skillPath = path.join(tempDir, "native-skill", "SKILL.md");
		await Bun.write(skillPath, "---\ndescription: Demo skill\n---\nSkill body says !`printf body-output`");
		ctx.sessionManager.getCwd = () => tempDir;
		ctx.skillCommands.set("skill:native-skill", { filePath: skillPath, isNative: true });

		try {
			const submission = "/skill:native-skill !`false`";
			editor.setText(submission);
			await ctx.editor.onSubmit!(submission);

			expect(showError).not.toHaveBeenCalled();
			const [message] = promptCustomMessageMock.mock.calls[0]!;
			expect(message.content).toContain("Skill body says body-output");
			expect(message.content).toContain("User: !`false`");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps native skill frontmatter literal by expanding only the parsed body", async () => {
		const { ctx, editor, showError, promptCustomMessageMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-skill-command-"));
		const skillPath = path.join(tempDir, "frontmatter-skill", "SKILL.md");
		await Bun.write(skillPath, '---\ndescription: "!`false`"\n---\nLiteral body');
		ctx.sessionManager.getCwd = () => tempDir;
		ctx.skillCommands.set("skill:frontmatter-skill", { filePath: skillPath, isNative: true });

		try {
			const submission = "/skill:frontmatter-skill";
			editor.setText(submission);
			await ctx.editor.onSubmit!(submission);

			expect(showError).not.toHaveBeenCalled();
			const [message] = promptCustomMessageMock.mock.calls[0]!;
			expect(message.content).toContain("Literal body");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("leaves non-native skill bodies literal even when they contain shell syntax", async () => {
		const { ctx, editor, showError, promptCustomMessageMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-skill-command-"));
		const skillPath = path.join(tempDir, "imported-skill", "SKILL.md");
		await Bun.write(skillPath, "---\ndescription: Demo skill\n---\nLiteral !`false`");
		ctx.skillCommands.set("skill:imported-skill", { filePath: skillPath, isNative: false });

		try {
			const submission = "/skill:imported-skill";
			editor.setText(submission);
			await ctx.editor.onSubmit!(submission);

			expect(showError).not.toHaveBeenCalled();
			const [message] = promptCustomMessageMock.mock.calls[0]!;
			expect(message.content).toContain("Literal !`false`");
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
