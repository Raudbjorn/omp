import type { FileSlashCommand } from "../../../extensibility/slash-commands";
import { isBuiltinSlashCommandName } from "../../../slash-commands/builtin-registry";

export type MultiBlockCommandPolicy =
	| { kind: "skill"; commandName: string }
	| { kind: "builtin-btw"; commandName: "btw" }
	| { kind: "builtin-unsupported"; commandName: string; warning: string }
	| { kind: "file"; commandName: string; fileCommand: FileSlashCommand }
	| { kind: "unsupported"; warning: string };

export interface MultiBlockCommandPolicyOptions {
	fileCommands: readonly FileSlashCommand[];
	hasSkillCommand(commandName: string): boolean;
}

export function parseSlashCommandName(commandText: string): string | null {
	if (!commandText.startsWith("/")) return null;
	const body = commandText.slice(1);
	if (!body) return null;
	const whitespaceIndex = body.search(/\s/);
	return whitespaceIndex === -1 ? body : body.slice(0, whitespaceIndex);
}

export function classifyMultiBlockCommand(
	commandText: string,
	options: MultiBlockCommandPolicyOptions,
): MultiBlockCommandPolicy {
	const commandName = parseSlashCommandName(commandText);
	if (!commandName) {
		return { kind: "unsupported", warning: `Unsupported slash command in multi-block submission: ${commandText}` };
	}

	if (commandName.startsWith("skill:")) {
		return options.hasSkillCommand(commandName)
			? { kind: "skill", commandName }
			: { kind: "unsupported", warning: `Unsupported slash command in multi-block submission: ${commandText}` };
	}

	const fileCommand = options.fileCommands.find(command => command.name === commandName);
	if (fileCommand) {
		return { kind: "file", commandName, fileCommand };
	}

	if (isBuiltinSlashCommandName(commandName)) {
		if (commandName === "btw") {
			return { kind: "builtin-btw", commandName: "btw" };
		}
		return {
			kind: "builtin-unsupported",
			commandName,
			warning: `Skipping unsupported "/${commandName}" command in multi-block submission.`,
		};
	}

	return { kind: "unsupported", warning: `Unsupported slash command in multi-block submission: ${commandText}` };
}

export function isHandledMultiBlockCommand(policy: MultiBlockCommandPolicy): boolean {
	return policy.kind === "skill" || policy.kind === "builtin-btw" || policy.kind === "file";
}
