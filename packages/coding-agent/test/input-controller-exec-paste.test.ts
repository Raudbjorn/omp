import { describe, expect, it, vi } from "bun:test";
import type { EditorSubmitMetadata } from "@oh-my-pi/pi-tui";

import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext, SubmittedUserInput } from "../src/modes/types";
import * as clipboard from "../src/utils/clipboard";

function createSubmission(input: {
	text: string;
	images?: InteractiveModeContext["pendingImages"];
}): SubmittedUserInput {
	return {
		text: input.text,
		images: input.images,
		cancelled: false,
		started: false,
	};
}

function createClipboardContext() {
	const insertPastedText = vi.fn();
	const showStatus = vi.fn();
	const requestRender = vi.fn();
	const ctx = {
		editor: {
			insertPastedText,
		},
		showStatus,
		ui: {
			requestRender,
		},
	} as unknown as InteractiveModeContext;

	return { ctx, insertPastedText, showStatus, requestRender };
}

function createSubmitContext() {
	let editorText = "";
	const addToHistory = vi.fn();
	const handleBashCommand = vi.fn(async () => {});
	const onInputCallback = vi.fn();
	const requestRender = vi.fn();
	const startPendingSubmission = vi.fn((input: { text: string; images?: InteractiveModeContext["pendingImages"] }) =>
		createSubmission(input),
	);
	const updateEditorBorderColor = vi.fn();
	const editor = {
		onSubmit: undefined as ((text: string, metadata?: EditorSubmitMetadata) => Promise<void>) | undefined,
		setText(text: string) {
			editorText = text;
		},
		getText() {
			return editorText;
		},
		addToHistory,
		setActionKeys: vi.fn(),
		setCustomKeyHandler: vi.fn(),
		clearCustomKeyHandlers: vi.fn(),
	};
	const ctx = {
		editor: editor as unknown as InteractiveModeContext["editor"],
		ui: { requestRender } as unknown as InteractiveModeContext["ui"],
		session: {
			isStreaming: false,
			isCompacting: false,
			isGeneratingHandoff: false,
			isBashRunning: false,
			isPythonRunning: false,
			queuedMessageCount: 0,
			messages: [],
			extensionRunner: undefined,
		} as unknown as InteractiveModeContext["session"],
		sessionManager: {
			getSessionName: () => "existing session",
		} as unknown as InteractiveModeContext["sessionManager"],
		keybindings: {
			getKeys: () => [],
		} as unknown as InteractiveModeContext["keybindings"],
		pendingImages: [],
		pendingImageLinks: [],
		isBashMode: false,
		isPythonMode: false,
		onInputCallback,
		startPendingSubmission,
		flushPendingBashComponents: vi.fn(),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor,
		showError: vi.fn(),
		showWarning: vi.fn(),
		showStatus: vi.fn(),
		handleBashCommand,
		handlePythonCommand: vi.fn(async () => {}),
		settings: {
			getModelRole: () => "default",
		} as unknown as InteractiveModeContext["settings"],
		agent: {
			state: { messages: [] },
		} as unknown as InteractiveModeContext["agent"],
		showDebugSelector: vi.fn(),
		handleHotkeysCommand: vi.fn(),
		handleSTTToggle: vi.fn(),
		toggleThinkingBlockVisibility: vi.fn(),
		showModelSelector: vi.fn(),
		showHistorySearch: vi.fn(),
		handlePlanModeCommand: vi.fn(),
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		showSessionSelector: vi.fn(),
		handleClearCommand: vi.fn(),
		hasActiveBtw: vi.fn(() => false),
		cancelPendingSubmission: vi.fn(() => false),
	} as unknown as InteractiveModeContext;

	return {
		ctx,
		editor,
		spies: {
			addToHistory,
			handleBashCommand,
			onInputCallback,
			requestRender,
			startPendingSubmission,
			updateEditorBorderColor,
		},
	};
}

describe("InputController execute-intent paste", () => {
	it("inserts clipboard text with exec intent when available", async () => {
		const { ctx, insertPastedText, showStatus, requestRender } = createClipboardContext();
		vi.spyOn(clipboard, "readTextFromClipboard").mockResolvedValue("!ls -al");
		const controller = new InputController(ctx);

		await controller.handleExecuteIntentPaste();

		expect(insertPastedText).toHaveBeenCalledWith("!ls -al", "exec");
		expect(requestRender).toHaveBeenCalled();
		expect(showStatus).not.toHaveBeenCalled();
	});

	it("shows non-blocking status and keeps editor unchanged when clipboard is unavailable", async () => {
		const { ctx, insertPastedText, showStatus, requestRender } = createClipboardContext();
		vi.spyOn(clipboard, "readTextFromClipboard").mockResolvedValue(null);
		const controller = new InputController(ctx);

		await controller.handleExecuteIntentPaste();

		expect(showStatus).toHaveBeenCalledWith(
			"Clipboard text unavailable for execute-intent paste (use terminal paste for safe text)",
		);
		expect(insertPastedText).not.toHaveBeenCalled();
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("shows non-blocking status and keeps editor unchanged when clipboard read throws", async () => {
		const { ctx, insertPastedText, showStatus, requestRender } = createClipboardContext();
		vi.spyOn(clipboard, "readTextFromClipboard").mockRejectedValue(new Error("boom"));
		const controller = new InputController(ctx);

		await controller.handleExecuteIntentPaste();

		expect(showStatus).toHaveBeenCalledWith(
			"Clipboard text unavailable for execute-intent paste (use terminal paste for safe text)",
		);
		expect(insertPastedText).not.toHaveBeenCalled();
		expect(requestRender).not.toHaveBeenCalled();
	});
});

describe("InputController safe paste submit behavior", () => {
	it("keeps safe-pasted bash shortcuts as normal user text on submit", async () => {
		const { ctx, editor, spies } = createSubmitContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await editor.onSubmit?.("!ls -al", { lineIntents: [{ line: 0, intent: "safe" }] });

		expect(spies.handleBashCommand).not.toHaveBeenCalled();
		// The base submission shape also carries imageLinks/streamingBehavior; the
		// safe-paste contract only requires the shortcut text pass through verbatim
		// as a normal submission (not the bash path), so match on those fields.
		expect(spies.startPendingSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ text: "!ls -al", images: undefined }),
		);
		expect(spies.onInputCallback).toHaveBeenCalledWith(createSubmission({ text: "!ls -al" }));
	});

	it("runs exec-intent-pasted bash shortcuts through the bash path on submit", async () => {
		const { ctx, editor, spies } = createSubmitContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await editor.onSubmit?.("!ls -al", { lineIntents: [{ line: 0, intent: "exec" }] });

		expect(spies.handleBashCommand).toHaveBeenCalledWith("ls -al", false);
		expect(spies.addToHistory).toHaveBeenCalledWith("!ls -al");
		expect(spies.onInputCallback).not.toHaveBeenCalled();
		expect(spies.updateEditorBorderColor).toHaveBeenCalled();
	});
});
