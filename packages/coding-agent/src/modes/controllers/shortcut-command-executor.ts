import type { InteractiveModeContext } from "../types";

/**
 * Fork-local helper that centralizes shortcut execution behavior so we can iterate on multi-block
 * shortcut experiments without expanding upstream-owned `input-controller` logic.
 */

export interface ShortcutExecutionOptions {
	historyEntry?: string;
}

export async function executeBashShortcut(
	ctx: InteractiveModeContext,
	command: string,
	excludeFromContext: boolean,
	options?: ShortcutExecutionOptions,
): Promise<boolean> {
	if (ctx.session.isBashRunning) {
		ctx.showWarning("A bash command is already running. Press Esc to cancel it first.");
		return false;
	}

	if (options?.historyEntry) {
		ctx.editor.addToHistory(options.historyEntry);
	}

	await ctx.handleBashCommand(command, excludeFromContext);
	ctx.isBashMode = false;
	ctx.updateEditorBorderColor();
	return true;
}

export async function executePythonShortcut(
	ctx: InteractiveModeContext,
	code: string,
	excludeFromContext: boolean,
	options?: ShortcutExecutionOptions,
): Promise<boolean> {
	if (ctx.session.isEvalRunning) {
		ctx.showWarning("A Python execution is already running. Press Esc to cancel it first.");
		return false;
	}

	if (options?.historyEntry) {
		ctx.editor.addToHistory(options.historyEntry);
	}

	await ctx.handlePythonCommand(code, excludeFromContext);
	ctx.isPythonMode = false;
	ctx.updateEditorBorderColor();
	return true;
}
