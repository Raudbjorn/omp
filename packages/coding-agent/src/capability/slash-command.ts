/**
 * Slash Commands Capability
 *
 * File-based slash commands defined as markdown files.
 */
import { defineCapability } from ".";
import type { SourceMeta } from "./types";

interface BaseSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Absolute path to command file */
	path: string;
	/** Source level */
	level: "user" | "project" | "native";
	/** Source metadata */
	_source: SourceMeta;
}

export interface TemplateSlashCommand extends BaseSlashCommand {
	kind?: "template";
	/** Command content (markdown template) */
	content: string;
}

export interface PromptChainSlashCommand extends BaseSlashCommand {
	kind: "prompt-chain";
	description: string;
	stepTemplates: string[];
}

/**
 * A file-based slash command.
 */
export type SlashCommand = TemplateSlashCommand | PromptChainSlashCommand;

export function isPromptChainSlashCommand(command: SlashCommand): command is PromptChainSlashCommand {
	return command.kind === "prompt-chain";
}

export function isTemplateSlashCommand(command: SlashCommand): command is TemplateSlashCommand {
	return command.kind !== "prompt-chain";
}

export const slashCommandCapability = defineCapability<SlashCommand>({
	id: "slash-commands",
	displayName: "Slash Commands",
	description: "Custom slash commands defined as markdown files",
	key: cmd => cmd.name,
	toExtensionId: cmd => `slash-command:${cmd.name}`,
	validate: cmd => {
		if (!cmd.name) return "Missing name";
		if (!cmd.path) return "Missing path";
		if (cmd.level !== "user" && cmd.level !== "project" && cmd.level !== "native") {
			return "Invalid level: must be 'user', 'project', or 'native'";
		}
		if (cmd.kind === "prompt-chain") {
			if (typeof cmd.description !== "string") return "Missing description";
			if (!Array.isArray(cmd.stepTemplates) || !cmd.stepTemplates.every(step => typeof step === "string")) {
				return "Missing stepTemplates";
			}
			return undefined;
		}
		if (cmd.content === undefined) return "Missing content";
		return undefined;
	},
});
