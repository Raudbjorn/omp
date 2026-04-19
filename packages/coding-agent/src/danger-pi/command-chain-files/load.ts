import * as path from "node:path";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { YAML } from "bun";
import { readDirEntries, readFile } from "../../capability/fs";
import type { SlashCommand } from "../../capability/slash-command";
import type { LoadResult } from "../../capability/types";
import { createSourceMeta } from "../../discovery/helpers";
import { type CommandFileProblem, renderCommandFileProblemBody } from "./render-warning";
import { type CommandChainFile, CommandChainFileSchema } from "./schema";

const COMMAND_CHAIN_SUFFIX = ".cmd.yaml";
const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
const validateCommandChainFile = ajv.compile(CommandChainFileSchema) as ValidateFunction<CommandChainFile>;

type CommandFileFormat = "template" | "prompt-chain";

type CommandFileCandidate = {
	commandName: string;
	filePath: string;
	fileName: string;
	format: CommandFileFormat;
	content: string;
	level: "user" | "project";
};

function isCommandFileName(fileName: string): boolean {
	return fileName.endsWith(".md") || fileName.endsWith(COMMAND_CHAIN_SUFFIX);
}

function getCommandFormat(fileName: string): CommandFileFormat {
	return fileName.endsWith(COMMAND_CHAIN_SUFFIX) ? "prompt-chain" : "template";
}

function getCommandNameFromFileName(fileName: string): string {
	if (fileName.endsWith(COMMAND_CHAIN_SUFFIX)) {
		return fileName.slice(0, -COMMAND_CHAIN_SUFFIX.length);
	}
	return fileName.replace(/\.md$/, "");
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string[] {
	if (!errors || errors.length === 0) {
		return ["/: invalid"];
	}
	return errors.map(error => `${error.instancePath || "/"}: ${error.message ?? "invalid"}`);
}

function pickDuplicateWinner(candidates: readonly CommandFileCandidate[]): CommandFileCandidate {
	const markdownCandidates = [...candidates]
		.filter(candidate => candidate.format === "template")
		.sort((left, right) => left.filePath.localeCompare(right.filePath));
	if (markdownCandidates[0]) {
		return markdownCandidates[0];
	}
	return [...candidates].sort((left, right) => left.filePath.localeCompare(right.filePath))[0]!;
}

function materializeTemplateCommand(candidate: CommandFileCandidate, provider: string): SlashCommand {
	return {
		kind: "template",
		name: candidate.commandName,
		path: candidate.filePath,
		content: candidate.content,
		level: candidate.level,
		_source: createSourceMeta(provider, candidate.filePath, candidate.level),
	};
}

function materializePromptChainCommand(
	candidate: CommandFileCandidate,
	provider: string,
): { item?: SlashCommand; problem?: CommandFileProblem } {
	let parsed: unknown;
	try {
		parsed = YAML.parse(candidate.content);
	} catch (error) {
		return {
			problem: {
				kind: "file",
				commandName: candidate.commandName,
				filePath: candidate.filePath,
				messages: [error instanceof Error ? error.message : String(error)],
			},
		};
	}

	if (!validateCommandChainFile(parsed)) {
		return {
			problem: {
				kind: "file",
				commandName: candidate.commandName,
				filePath: candidate.filePath,
				messages: formatValidationErrors(validateCommandChainFile.errors),
			},
		};
	}

	return {
		item: {
			kind: "prompt-chain",
			name: candidate.commandName,
			path: candidate.filePath,
			description: parsed.description,
			stepTemplates: parsed.steps,
			level: candidate.level,
			_source: createSourceMeta(provider, candidate.filePath, candidate.level),
		},
	};
}

export async function loadCommandChainFilesFromDir(
	commandsDir: string,
	provider: string,
	level: "user" | "project",
): Promise<LoadResult<SlashCommand>> {
	const items: SlashCommand[] = [];
	const problems: CommandFileProblem[] = [];
	const entries = await readDirEntries(commandsDir);
	if (entries.length === 0) {
		return { items };
	}

	const candidates = await Promise.all(
		entries
			.filter(entry => (entry.isFile() || entry.isSymbolicLink()) && isCommandFileName(entry.name))
			.map(async entry => {
				const filePath = path.join(commandsDir, entry.name);
				const content = await readFile(filePath);
				if (content === null) {
					problems.push({
						kind: "file",
						commandName: getCommandNameFromFileName(entry.name),
						filePath,
						messages: ["Failed to read file"],
					});
					return undefined;
				}
				return {
					commandName: getCommandNameFromFileName(entry.name),
					filePath,
					fileName: entry.name,
					format: getCommandFormat(entry.name),
					content,
					level,
				} satisfies CommandFileCandidate;
			}),
	);

	const byCommandName = new Map<string, CommandFileCandidate[]>();
	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		const existing = byCommandName.get(candidate.commandName);
		if (existing) {
			existing.push(candidate);
			continue;
		}
		byCommandName.set(candidate.commandName, [candidate]);
	}

	for (const [commandName, groupedCandidates] of byCommandName) {
		const candidatesForCommand = [...groupedCandidates].sort((left, right) =>
			left.filePath.localeCompare(right.filePath),
		);
		const winner =
			candidatesForCommand.length > 1 ? pickDuplicateWinner(candidatesForCommand) : candidatesForCommand[0]!;

		if (candidatesForCommand.length > 1) {
			problems.push({
				kind: "duplicate",
				commandName,
				filePaths: candidatesForCommand.map(candidate => candidate.filePath),
				winnerPath: winner.filePath,
			});
		}

		if (winner.format === "template") {
			items.push(materializeTemplateCommand(winner, provider));
			continue;
		}

		const { item, problem } = materializePromptChainCommand(winner, provider);
		if (item) {
			items.push(item);
		}
		if (problem) {
			problems.push(problem);
		}
	}

	return {
		items,
		warnings: problems.length > 0 ? [renderCommandFileProblemBody(problems)] : undefined,
	};
}
