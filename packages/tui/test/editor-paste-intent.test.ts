import { describe, expect, it } from "bun:test";
import { Editor } from "@oh-my-pi/pi-tui/components/editor";
import type { EditorSubmitMetadata } from "@oh-my-pi/pi-tui/editor-component";

import { defaultEditorTheme } from "./test-themes";

describe("Editor paste intent metadata", () => {
	it("records safe intent metadata for bracketed terminal paste", () => {
		const editor = new Editor(defaultEditorTheme);
		let submissionText = "";
		let submissionMetadata: EditorSubmitMetadata | undefined;
		editor.onSubmit = (text, metadata) => {
			submissionText = text;
			submissionMetadata = metadata;
		};

		editor.handleInput("\x1b[200~!ls -al\n/plan focus auth\x1b[201~");
		editor.handleInput("\r");

		expect(submissionText).toBe("!ls -al\n/plan focus auth");
		expect(submissionMetadata?.lineIntents).toEqual([
			{ line: 0, intent: "safe" },
			{ line: 1, intent: "safe" },
		]);
	});

	it("records exec intent metadata for explicit execute-intent paste", () => {
		const editor = new Editor(defaultEditorTheme);
		let submissionMetadata: EditorSubmitMetadata | undefined;
		editor.onSubmit = (_text, metadata) => {
			submissionMetadata = metadata;
		};

		editor.insertPastedText("!ls -al\n$print('hi')", "exec");
		editor.handleInput("\r");

		expect(submissionMetadata?.lineIntents).toEqual([
			{ line: 0, intent: "exec" },
			{ line: 1, intent: "exec" },
		]);
	});

	it("does not emit line intents for typed text", () => {
		const editor = new Editor(defaultEditorTheme);
		let submissionMetadata: EditorSubmitMetadata | undefined;
		editor.onSubmit = (_text, metadata) => {
			submissionMetadata = metadata;
		};

		editor.handleInput("!");
		editor.handleInput("l");
		editor.handleInput("s");
		editor.handleInput("\r");

		expect(submissionMetadata?.lineIntents ?? []).toEqual([]);
	});
});
