import type { ImageContent } from "@oh-my-pi/pi-ai";
import { parseFrontmatter, prompt } from "@oh-my-pi/pi-utils";
import { isPromptChainSlashCommand, type SlashCommand, slashCommandCapability } from "../capability/slash-command";
import { appendInlineArgsFallback, templateUsesInlineArgPlaceholders } from "../config/prompt-templates";
import type { PromptChainExecutor, PromptChainStreamingBehavior } from "../danger-pi/command-chain-files/runtime";
import { loadCapability } from "../discovery";
import { EMBEDDED_COMMAND_TEMPLATES } from "../task/commands";
import { parseCommandArgs, substituteArgs } from "../utils/command-args";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

export type { BuiltinSlashCommand, SubcommandDef } from "../slash-commands/types";

interface BaseFileSlashCommand {
	name: string;
	description: string;
	source: string; // e.g., "via Claude Code (User)"
	/** Source metadata for display */
	_source?: { providerName: string; level: "user" | "project" | "native" };
}

/**
 * Represents a custom slash command loaded from a file
 */
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

	// Get description from frontmatter or first non-empty line
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
	/** Working directory for project-local commands. Default: getProjectDir() */
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
			_source: { providerName: command._source.providerName, level: command.level },
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
		_source: { providerName: command._source.providerName, level: command.level },
	};
}

/**
 * Load all custom slash commands using the capability API.
 * Loads from all registered providers (builtin, user, project), surfacing any
 * non-fatal command-file warnings (e.g. invalid `.cmd.yaml` prompt chains).
 */
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

/**
 * Expand a template slash command if it matches a file-based command.
 * Returns the expanded content or the original text if not a slash command.
 * Prompt-chain commands are NOT expanded here — see executeFileSlashCommand.
 */
export function expandSlashCommand(text: string, fileCommands: readonly FileSlashCommand[]): string {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

	const fileCommand = fileCommands.find(cmd => cmd.name === commandName);
	if (fileCommand && isTemplateFileSlashCommand(fileCommand)) {
		const args = parseCommandArgs(argsString);
		const argsText = args.join(" ");
		const usesInlineArgPlaceholders = templateUsesInlineArgPlaceholders(fileCommand.content);
		const substituted = substituteArgs(fileCommand.content, args);
		const rendered = prompt.render(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
		return appendInlineArgsFallback(rendered, argsText, usesInlineArgPlaceholders);
	}

	return text;
}

/**
 * Execute a file-based slash command. Template commands are expanded to prompt
 * text ({ kind: "text" }); prompt-chain commands are dispatched through the
 * provided executor and report { kind: "handled" }.
 */
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
		return { kind: "text", text: expandSlashCommand(text, fileCommands) };
	}

	await options.promptChainExecutor.execute(fileCommand.name, fileCommand.stepTemplates, argsString, {
		images: options.images,
		streamingBehavior: options.streamingBehavior,
	});
	return { kind: "handled" };
}
