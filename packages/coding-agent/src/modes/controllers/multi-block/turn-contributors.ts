import type { FileSlashCommand } from "../../../extensibility/slash-commands";
import type { SubmissionBlock } from "../submission-blocks";
import { classifyMultiBlockCommand, isHandledMultiBlockCommand } from "./command-policy";

interface TurnContributorOptions {
	fileCommands: readonly FileSlashCommand[];
	hasSkillCommand(commandName: string): boolean;
}

function isHandledCommandBlock(block: SubmissionBlock, options: TurnContributorOptions): boolean {
	if (block.type === "bash-shortcut" || block.type === "python-shortcut") {
		return true;
	}
	if (block.type !== "command") {
		return false;
	}
	return isHandledMultiBlockCommand(
		classifyMultiBlockCommand(block.text, {
			fileCommands: options.fileCommands,
			hasSkillCommand: options.hasSkillCommand,
		}),
	);
}

export function hasFutureHandledBlock(
	blocks: SubmissionBlock[],
	startIndex: number,
	options: TurnContributorOptions,
): boolean {
	for (let i = startIndex + 1; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block.type === "text" && block.text.trim().length > 0) {
			return true;
		}
		if (isHandledCommandBlock(block, options)) {
			return true;
		}
	}
	return false;
}

export function getLastHandledBlockKind(
	blocks: SubmissionBlock[],
	options: TurnContributorOptions,
): "command" | "text" | null {
	for (let i = blocks.length - 1; i >= 0; i -= 1) {
		const block = blocks[i];
		if (block.type === "text" && block.text.trim().length > 0) {
			return "text";
		}
		if (isHandledCommandBlock(block, options)) {
			return "command";
		}
	}
	return null;
}
