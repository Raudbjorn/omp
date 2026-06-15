import type { ImageContent } from "@oh-my-pi/pi-ai";
import {
	executeFileSlashCommand,
	type FileSlashCommand,
	isPromptChainFileSlashCommand,
} from "../../extensibility/slash-commands";
import { executeBuiltinSlashCommand, isBuiltinSlashCommandName } from "../../slash-commands/builtin-registry";
import type { InteractiveModeContext } from "../types";
import { classifyMultiBlockCommand, parseSlashCommandName } from "./multi-block/command-policy";
import { getLastHandledBlockKind, hasFutureHandledBlock } from "./multi-block/turn-contributors";
import { type SubmissionBlock, type SubmissionLineIntentEntry, splitSubmissionIntoBlocks } from "./submission-blocks";

type SkillCommandHandler = (
	text: string,
	options?: { addToHistory?: boolean; suppressTurn?: boolean },
) => Promise<"not-handled" | "handled" | "error">;

interface CommandBlockExecutionResult {
	success: boolean;
	appendedText?: string;
	contributesPromptContent?: boolean;
	startsTurn?: boolean;
}

type ShortcutBlockHandler = (commandOrCode: string, excludeFromContext: boolean) => Promise<boolean>;

type TextBlockDispatcher = (text: string, options: { suppressTurn: boolean }) => Promise<void>;

interface ExecuteCommandBlockOptions {
	ctx: InteractiveModeContext;
	fileCommands: FileSlashCommand[];
	images?: readonly ImageContent[];
	suppressTurn: boolean;
	handleSkillCommand: SkillCommandHandler;
	handleBackgroundCommand: () => void;
}

export type MultiBlockProcessingResult =
	| { processed: false }
	| {
			processed: true;
			success: boolean;
			remainingText: string | null;
			startedTurnDirectly: boolean;
			continueFromContext: boolean;
			fallbackPromptText: string | null;
	  };

export interface MultiBlockRunnerOptions {
	ctx: InteractiveModeContext;
	text: string;
	images?: readonly ImageContent[];
	lineIntents?: SubmissionLineIntentEntry[];
	handleSkillCommand: SkillCommandHandler;
	handleBackgroundCommand: () => void;
	handleBashShortcut: ShortcutBlockHandler;
	handlePythonShortcut: ShortcutBlockHandler;
	handleTextBlock: TextBlockDispatcher;
}

/**
 * Expands a stacked submission into per-block chat entries while ensuring downstream code still
 * triggers exactly one agent turn. Intermediate text is rendered immediately for ordering; when
 * the final renderable block is a command, callers can continue from the already-persisted context
 * instead of emitting a duplicate trailing user message.
 */
export async function runMultiBlockSubmission(options: MultiBlockRunnerOptions): Promise<MultiBlockProcessingResult> {
	const { ctx, text } = options;
	if (!text.includes("\n")) {
		return { processed: false };
	}
	if (ctx.session.isStreaming || ctx.session.isCompacting) {
		return { processed: false };
	}

	const splitResult = splitSubmissionIntoBlocks(text, {
		isSupportedSlashCommand: candidate => isRecognizedSlashCommand(ctx, candidate),
		lineIntents: options.lineIntents,
	});
	if (splitResult.parseError) {
		ctx.showError(splitResult.parseError.message);
		return {
			processed: true,
			success: false,
			remainingText: null,
			startedTurnDirectly: false,
			continueFromContext: false,
			fallbackPromptText: null,
		};
	}

	const blocks = splitResult.blocks;
	const executableBlockCount = blocks.filter(block => block.type !== "text").length;
	const isSingleFencedShortcut =
		blocks.length === 1 &&
		(blocks[0]?.type === "bash-shortcut" || blocks[0]?.type === "python-shortcut") &&
		blocks[0].fenced === true;
	if (executableBlockCount === 0 || (blocks.length === 1 && !isSingleFencedShortcut)) {
		return { processed: false };
	}

	const editorSnapshot = ctx.editor.getText();
	const fileCommands = Array.from(ctx.session.fileCommands ?? []);
	const commandPolicyOptions = {
		fileCommands,
		hasSkillCommand: (commandName: string) => Boolean(ctx.skillCommands?.has(commandName)),
	};
	const invalidPromptChainCommand = findInvalidPromptChainCommand(blocks, commandPolicyOptions);
	if (invalidPromptChainCommand) {
		ctx.showError(
			`Prompt-chain command "/${invalidPromptChainCommand}" must be the final renderable block in a multi-block submission.`,
		);
		ctx.editor.setText(editorSnapshot);
		return {
			processed: true,
			success: false,
			remainingText: null,
			startedTurnDirectly: false,
			continueFromContext: false,
			fallbackPromptText: null,
		};
	}
	let remainingText: string | null = null;
	let startedTurnDirectly = false;
	let hasPromptableContent = false;
	let hasTurnStarter = false;
	let fallbackPromptText: string | null = null;

	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block.type === "command") {
			const policy = classifyMultiBlockCommand(block.text, commandPolicyOptions);
			if (isFinalRenderablePromptChainCommand(policy, blocks, i, commandPolicyOptions)) {
				ctx.flushPendingBashComponents();
			}
			const result = await executeCommandBlock(block.text, {
				ctx,
				fileCommands,
				images: options.images,
				suppressTurn: true,
				handleSkillCommand: options.handleSkillCommand,
				handleBackgroundCommand: options.handleBackgroundCommand,
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return {
					processed: true,
					success: false,
					remainingText: null,
					startedTurnDirectly: false,
					continueFromContext: false,
					fallbackPromptText: null,
				};
			}
			if (policy.kind === "file" && isPromptChainFileSlashCommand(policy.fileCommand)) {
				startedTurnDirectly = true;
			}
			const appended = result.appendedText?.trim();
			if (result.contributesPromptContent) {
				hasPromptableContent = true;
			}
			if (result.startsTurn) {
				hasTurnStarter = true;
			}
			if (appended) {
				fallbackPromptText = appended;
				const shouldDispatchImmediately = hasFutureHandledBlock(blocks, i, commandPolicyOptions);
				if (shouldDispatchImmediately) {
					await options.handleTextBlock(appended, { suppressTurn: true });
				} else {
					remainingText = appended;
				}
			}
			continue;
		}

		if (block.type === "bash-shortcut") {
			const result = await executeShortcutBlock(block.text, {
				ctx,
				handleShortcut: options.handleBashShortcut,
				prefix: "!",
				excludedPrefix: "!!",
				description: "bash",
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return {
					processed: true,
					success: false,
					remainingText: null,
					startedTurnDirectly: false,
					continueFromContext: false,
					fallbackPromptText: null,
				};
			}
			continue;
		}

		if (block.type === "python-shortcut") {
			const result = await executeShortcutBlock(block.text, {
				ctx,
				handleShortcut: options.handlePythonShortcut,
				prefix: "$",
				excludedPrefix: "$$",
				description: "python",
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return {
					processed: true,
					success: false,
					remainingText: null,
					startedTurnDirectly: false,
					continueFromContext: false,
					fallbackPromptText: null,
				};
			}
			continue;
		}

		const trimmed = block.text.trim();
		if (!trimmed) {
			continue;
		}
		hasPromptableContent = true;
		fallbackPromptText = trimmed;
		const shouldDispatchImmediately = hasFutureHandledBlock(blocks, i, commandPolicyOptions);
		if (shouldDispatchImmediately) {
			await options.handleTextBlock(trimmed, { suppressTurn: true });
		} else {
			remainingText = trimmed;
		}
	}

	const finalRenderableBlockKind = getLastHandledBlockKind(blocks, commandPolicyOptions);
	const continueFromContext =
		remainingText === null &&
		!startedTurnDirectly &&
		finalRenderableBlockKind === "command" &&
		(hasPromptableContent || hasTurnStarter);

	return {
		processed: true,
		success: true,
		remainingText,
		startedTurnDirectly,
		continueFromContext,
		fallbackPromptText,
	};
}

function findInvalidPromptChainCommand(
	blocks: SubmissionLineIntentEntry[] extends never ? never : ReturnType<typeof splitSubmissionIntoBlocks>["blocks"],
	options: Parameters<typeof hasFutureHandledBlock>[2],
): string | null {
	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block?.type !== "command") {
			continue;
		}
		const policy = classifyMultiBlockCommand(block.text, options);
		if (
			policy.kind === "file" &&
			isPromptChainFileSlashCommand(policy.fileCommand) &&
			hasFutureHandledBlock(blocks, i, options)
		) {
			return policy.commandName;
		}
	}

	return null;
}

function isFinalRenderablePromptChainCommand(
	policy: ReturnType<typeof classifyMultiBlockCommand>,
	blocks: SubmissionBlock[],
	blockIndex: number,
	options: Parameters<typeof hasFutureHandledBlock>[2],
): boolean {
	return (
		policy.kind === "file" &&
		isPromptChainFileSlashCommand(policy.fileCommand) &&
		!hasFutureHandledBlock(blocks, blockIndex, options)
	);
}

function isRecognizedSlashCommand(ctx: InteractiveModeContext, candidate: string): boolean {
	if (!candidate.startsWith("/")) {
		return false;
	}
	const commandName = parseSlashCommandName(candidate);
	if (!commandName) {
		return false;
	}
	if (commandName.startsWith("skill:")) {
		return Boolean(ctx.skillCommands?.has(commandName));
	}
	if (ctx.fileSlashCommands?.has(commandName)) {
		return true;
	}
	return isBuiltinSlashCommandName(commandName);
}

interface ExecuteShortcutBlockOptions {
	ctx: InteractiveModeContext;
	handleShortcut: ShortcutBlockHandler;
	prefix: string;
	excludedPrefix: string;
	description: "bash" | "python";
}

async function executeShortcutBlock(
	shortcutText: string,
	options: ExecuteShortcutBlockOptions,
): Promise<CommandBlockExecutionResult> {
	const isExcluded = shortcutText.startsWith(options.excludedPrefix);
	const payload = isExcluded
		? shortcutText.slice(options.excludedPrefix.length).trim()
		: shortcutText.slice(options.prefix.length).trim();

	if (!payload) {
		options.ctx.showError(`Unsupported ${options.description} shortcut in multi-block submission: ${shortcutText}`);
		return { success: false };
	}

	const handled = await options.handleShortcut(payload, isExcluded);
	return { success: handled, contributesPromptContent: false };
}

async function executeCommandBlock(
	commandText: string,
	options: ExecuteCommandBlockOptions,
): Promise<CommandBlockExecutionResult> {
	const policy = classifyMultiBlockCommand(commandText, {
		fileCommands: options.fileCommands,
		hasSkillCommand: (commandName: string) => Boolean(options.ctx.skillCommands?.has(commandName)),
	});

	if (policy.kind === "unsupported") {
		options.ctx.showError(policy.warning);
		return { success: false };
	}

	if (policy.kind === "builtin-unsupported") {
		options.ctx.showWarning(policy.warning);
		return { success: true, contributesPromptContent: false, startsTurn: false };
	}

	if (policy.kind === "skill") {
		const outcome = await options.handleSkillCommand(commandText, {
			addToHistory: true,
			suppressTurn: options.suppressTurn,
		});
		return {
			success: outcome === "handled",
			contributesPromptContent: outcome === "handled",
			startsTurn: outcome === "handled",
		};
	}

	if (policy.kind === "builtin-btw") {
		const slashResult = await executeBuiltinSlashCommand(commandText, {
			ctx: options.ctx,
		});
		if (slashResult === false) {
			options.ctx.showError(`Failed to execute "/${policy.commandName}" command.`);
			return { success: false };
		}
		if (slashResult === true) {
			return { success: true, contributesPromptContent: false, startsTurn: false };
		}

		const hasPromptContent = slashResult.trim().length > 0;
		return {
			success: true,
			appendedText: slashResult,
			contributesPromptContent: hasPromptContent,
			startsTurn: hasPromptContent,
		};
	}
	const fileResult = await executeFileSlashCommand(commandText, options.fileCommands, {
		cwd: options.ctx.sessionManager.getCwd(),
		images: options.images,
		promptChainExecutor: options.ctx.session.promptChainExecutor,
	});
	if (fileResult.kind === "handled") {
		return {
			success: true,
			contributesPromptContent: false,
			startsTurn: true,
		};
	}
	return {
		success: true,
		appendedText: fileResult.text,
		contributesPromptContent: fileResult.text.trim().length > 0,
		startsTurn: fileResult.text.trim().length > 0,
	};
}
