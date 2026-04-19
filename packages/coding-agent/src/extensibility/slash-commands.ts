import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
import { parseFrontmatter } from "@oh-my-pi/pi-utils";
import { isPromptChainSlashCommand, type SlashCommand, slashCommandCapability } from "../capability/slash-command";
import {
	appendInlineArgsFallback,
	renderPromptTemplate,
	templateUsesInlineArgPlaceholders,
} from "../config/prompt-templates";
import type { PromptChainExecutor, PromptChainStreamingBehavior } from "../danger-pi/command-chain-files/runtime";
import { loadCapability } from "../discovery";
import {
	BUILTIN_SLASH_COMMAND_DEFS,
	type BuiltinSlashCommand,
	type SubcommandDef,
} from "../slash-commands/builtin-registry";
import { EMBEDDED_COMMAND_TEMPLATES } from "../task/commands";
import { parseCommandArgs, substituteArgs } from "../utils/command-args";
import { interpolateShellExpressions } from "./shell-interpolation";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

export type { BuiltinSlashCommand, SubcommandDef } from "../slash-commands/builtin-registry";

function buildArgumentCompletions(subcommands: SubcommandDef[]): (prefix: string) => AutocompleteItem[] | null {
	return (argumentPrefix: string) => {
		if (argumentPrefix.includes(" ")) return null;
		const lower = argumentPrefix.toLowerCase();
		const matches = subcommands
			.filter(subcommand => subcommand.name.startsWith(lower))
			.map(subcommand => ({
				value: `${subcommand.name} `,
				label: subcommand.name,
				description: subcommand.description,
				hint: subcommand.usage,
			}));
		return matches.length > 0 ? matches : null;
	};
}

function buildSubcommandInlineHint(subcommands: SubcommandDef[]): (argumentText: string) => string | null {
	return (argumentText: string) => {
		const trimmed = argumentText.trimStart();
		const spaceIndex = trimmed.indexOf(" ");

		if (spaceIndex === -1) {
			const prefix = trimmed.toLowerCase();
			if (prefix.length === 0) return null;
			const match = subcommands.find(subcommand => subcommand.name.startsWith(prefix));
			if (!match) return null;
			const remaining = match.name.slice(prefix.length);
			return remaining + (match.usage ? ` ${match.usage}` : "");
		}

		const subName = trimmed.slice(0, spaceIndex).toLowerCase();
		const afterSub = trimmed.slice(spaceIndex + 1);
		const subcommand = subcommands.find(candidate => candidate.name === subName);
		if (!subcommand?.usage) return null;

		if (afterSub.length > 0) {
			const usageParts = subcommand.usage.split(" ");
			const inputParts = afterSub.trim().split(/\s+/);
			const remaining = usageParts.slice(inputParts.length);
			return remaining.length > 0 ? remaining.join(" ") : null;
		}

		return subcommand.usage;
	};
}

function buildStaticInlineHint(hint: string): (argumentText: string) => string | null {
	return (argumentText: string) => (argumentText.trim().length === 0 ? hint : null);
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<
	BuiltinSlashCommand & {
		getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
		getInlineHint?: (argumentText: string) => string | null;
	}
> = BUILTIN_SLASH_COMMAND_DEFS.map(command => {
	if (command.subcommands) {
		return {
			...command,
			getArgumentCompletions: buildArgumentCompletions(command.subcommands),
			getInlineHint: buildSubcommandInlineHint(command.subcommands),
		};
	}
	if (command.inlineHint) {
		return {
			...command,
			getInlineHint: buildStaticInlineHint(command.inlineHint),
		};
	}
	return command;
});

interface BaseFileSlashCommand {
	name: string;
	description: string;
	source: string;
	_source?: SlashCommand["_source"];
}

export interface TemplateFileSlashCommand extends BaseFileSlashCommand {
	kind: "template";
	content: string;
}

export interface PromptChainFileSlashCommand extends BaseFileSlashCommand {
	kind: "prompt-chain";
	stepTemplates: readonly string[];
}

export type FileSlashCommand = TemplateFileSlashCommand | PromptChainFileSlashCommand;

export function isPromptChainFileSlashCommand(command: FileSlashCommand): command is PromptChainFileSlashCommand {
	return command.kind === "prompt-chain";
}

export function isTemplateFileSlashCommand(command: FileSlashCommand): command is TemplateFileSlashCommand {
	return command.kind === "template";
}

const EMBEDDED_SLASH_COMMANDS = EMBEDDED_COMMAND_TEMPLATES;
const COMMAND_FILE_WARNING_PREFIX = "Command file errors:";

function parseCommandTemplate(
	content: string,
	options: { source: string; level?: "off" | "warn" | "fatal" },
): { description: string; body: string } {
	const { frontmatter, body } = parseFrontmatter(content, options);
	const frontmatterDesc = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";

	let description = frontmatterDesc;
	if (!description) {
		const firstLine = body.split("\n").find(line => line.trim());
		if (firstLine) {
			description = firstLine.slice(0, 60);
			if (firstLine.length > 60) description += "...";
		}
	}

	return { description, body };
}

export interface LoadSlashCommandsOptions {
	cwd?: string;
}

export interface LoadSlashCommandSetResult {
	commands: FileSlashCommand[];
	warnings: string[];
}

function materializeCapabilityCommand(command: SlashCommand): FileSlashCommand {
	const capitalizedLevel = command.level.charAt(0).toUpperCase() + command.level.slice(1);
	const source = `via ${command._source.providerName} ${capitalizedLevel}`;

	if (isPromptChainSlashCommand(command)) {
		return {
			kind: "prompt-chain",
			name: command.name,
			description: command.description,
			stepTemplates: [...command.stepTemplates],
			source,
			_source: command._source,
		};
	}

	const { description, body } = parseCommandTemplate(command.content, {
		source: command.path ?? `slash-command:${command.name}`,
		level: command.level === "native" ? "fatal" : "warn",
	});
	return {
		kind: "template",
		name: command.name,
		description,
		content: body,
		source,
		_source: command._source,
	};
}

export async function loadSlashCommandSet(options: LoadSlashCommandsOptions = {}): Promise<LoadSlashCommandSetResult> {
	const result = await loadCapability<SlashCommand>(slashCommandCapability.id, { cwd: options.cwd });

	const commands: FileSlashCommand[] = result.items.map(materializeCapabilityCommand);
	const seenNames = new Set(commands.map(command => command.name));
	for (const command of EMBEDDED_SLASH_COMMANDS) {
		const name = command.name.replace(/\.md$/, "");
		if (seenNames.has(name)) continue;

		const { description, body } = parseCommandTemplate(command.content, {
			source: `embedded:${command.name}`,
			level: "fatal",
		});
		commands.push({
			kind: "template",
			name,
			description,
			content: body,
			source: "bundled",
		});
		seenNames.add(name);
	}

	return {
		commands,
		warnings: [...(result.warnings ?? [])],
	};
}

export async function loadSlashCommands(options: LoadSlashCommandsOptions = {}): Promise<FileSlashCommand[]> {
	return (await loadSlashCommandSet(options)).commands;
}

export function renderSlashCommandWarnings(warnings: readonly string[]): string | undefined {
	const bodies = warnings
		.map(warning => {
			if (warning.startsWith(`${COMMAND_FILE_WARNING_PREFIX}\n\n`)) {
				return warning.slice(COMMAND_FILE_WARNING_PREFIX.length + 2).trim();
			}
			if (warning.startsWith(COMMAND_FILE_WARNING_PREFIX)) {
				return warning.slice(COMMAND_FILE_WARNING_PREFIX.length).trim();
			}
			return warning.trim();
		})
		.filter(Boolean);
	if (bodies.length === 0) {
		return undefined;
	}
	return `${COMMAND_FILE_WARNING_PREFIX}\n\n${bodies.join("\n\n")}`;
}

export async function expandSlashCommand(
	text: string,
	fileCommands: readonly FileSlashCommand[],
	options: { cwd: string },
): Promise<string> {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	const fileCommand = fileCommands.find(command => command.name === commandName);
	if (!fileCommand || !isTemplateFileSlashCommand(fileCommand)) {
		return text;
	}

	const args = parseCommandArgs(argsString);
	const argsText = args.join(" ");
	const usesInlineArgPlaceholders = templateUsesInlineArgPlaceholders(fileCommand.content);
	const substituted = substituteArgs(fileCommand.content, args);
	const rendered = renderPromptTemplate(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
	const expanded =
		fileCommand._source?.provider === "native"
			? await interpolateShellExpressions({
					body: rendered,
					cwd: options.cwd,
					sourceLabel: `/${fileCommand.name}`,
				})
			: rendered;
	return appendInlineArgsFallback(expanded, argsText, usesInlineArgPlaceholders);
}

export async function executeFileSlashCommand(
	text: string,
	fileCommands: readonly FileSlashCommand[],
	options: {
		cwd: string;
		promptChainExecutor: PromptChainExecutor;
		streamingBehavior?: PromptChainStreamingBehavior;
		images?: readonly ImageContent[];
	},
): Promise<{ kind: "text"; text: string } | { kind: "handled" }> {
	if (!text.startsWith("/")) {
		return { kind: "text", text };
	}

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	const fileCommand = fileCommands.find(command => command.name === commandName);
	if (!fileCommand) {
		return { kind: "text", text };
	}
	if (isTemplateFileSlashCommand(fileCommand)) {
		return {
			kind: "text",
			text: await expandSlashCommand(text, fileCommands, { cwd: options.cwd }),
		};
	}

	await options.promptChainExecutor.execute(fileCommand.name, fileCommand.stepTemplates, argsString, {
		images: options.images,
		streamingBehavior: options.streamingBehavior,
	});
	return { kind: "handled" };
}
