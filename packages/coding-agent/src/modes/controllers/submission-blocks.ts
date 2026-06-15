export type SubmissionBlockType = "command" | "bash-shortcut" | "python-shortcut" | "text";

export type SubmissionBlock = {
	type: SubmissionBlockType;
	text: string;
	fenced?: boolean;
};

export interface SubmissionParseError {
	line: number;
	message: string;
}

export interface SplitSubmissionResult {
	blocks: SubmissionBlock[];
	parseError?: SubmissionParseError;
}

export type SubmissionBlockDetector = (candidate: string) => boolean;

export type SubmissionLineIntent = "safe" | "exec";

export interface SubmissionLineIntentEntry {
	line: number;
	intent: SubmissionLineIntent;
}

export interface SplitSubmissionOptions {
	isSupportedSlashCommand: SubmissionBlockDetector;
	lineIntents?: SubmissionLineIntentEntry[];
}

const FENCED_SHORTCUT_TOKEN = "```";
const ESCAPED_FENCED_SHORTCUT_TOKEN = `\\${FENCED_SHORTCUT_TOKEN}`;

function startsWithMarkdownImageSyntax(trimmed: string): boolean {
	if (!trimmed.startsWith("![")) {
		return false;
	}

	const altTextClose = trimmed.indexOf("]", 2);
	if (altTextClose === -1) {
		return false;
	}

	const suffixLead = trimmed[altTextClose + 1];
	return suffixLead === "(" || suffixLead === "[";
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

function flushPendingText(pending: string, result: SubmissionBlock[], trimTrailingNewline = false): string {
	if (pending.length > 0) {
		let textValue = pending;
		if (trimTrailingNewline) {
			textValue = textValue.replace(/\n$/, "");
		}
		if (textValue.length > 0) {
			result.push({ type: "text", text: textValue });
		}
		return "";
	}
	return pending;
}

function parseExecutableShortcutBlock(trimmed: string): SubmissionBlock | null {
	if (trimmed.startsWith("!!")) {
		return trimmed.slice(2).trim().length > 0 ? { type: "bash-shortcut", text: trimmed } : null;
	}

	if (trimmed.startsWith("!")) {
		if (startsWithMarkdownImageSyntax(trimmed)) {
			return null;
		}
		return trimmed.slice(1).trim().length > 0 ? { type: "bash-shortcut", text: trimmed } : null;
	}

	if (trimmed.startsWith("$$")) {
		return trimmed.slice(2).trim().length > 0 ? { type: "python-shortcut", text: trimmed } : null;
	}

	if (trimmed.startsWith("$")) {
		return trimmed.slice(1).trim().length > 0 ? { type: "python-shortcut", text: trimmed } : null;
	}

	return null;
}

function parseFencedShortcutOpener(
	trimmed: string,
): { type: "bash-shortcut" | "python-shortcut"; prefix: string } | null {
	if (trimmed === `!${FENCED_SHORTCUT_TOKEN}`) {
		return { type: "bash-shortcut", prefix: "!" };
	}

	if (trimmed === `!!${FENCED_SHORTCUT_TOKEN}`) {
		return { type: "bash-shortcut", prefix: "!!" };
	}

	if (trimmed === `$${FENCED_SHORTCUT_TOKEN}`) {
		return { type: "python-shortcut", prefix: "$" };
	}

	if (trimmed === `$$${FENCED_SHORTCUT_TOKEN}`) {
		return { type: "python-shortcut", prefix: "$$" };
	}

	return null;
}

function parseFencedShortcutBlock(
	lines: string[],
	startIndex: number,
): {
	block?: SubmissionBlock;
	nextIndex: number;
	parseError?: SubmissionParseError;
} | null {
	const opener = parseFencedShortcutOpener(lines[startIndex]?.trim() ?? "");
	if (!opener) {
		return null;
	}

	const payloadLines: string[] = [];
	for (let i = startIndex + 1; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();
		if (trimmed === FENCED_SHORTCUT_TOKEN) {
			return {
				block: {
					type: opener.type,
					text: `${opener.prefix}${payloadLines.join("\n")}`,
					fenced: true,
				},
				nextIndex: i,
			};
		}

		if (trimmed === ESCAPED_FENCED_SHORTCUT_TOKEN) {
			payloadLines.push(line.replace(ESCAPED_FENCED_SHORTCUT_TOKEN, FENCED_SHORTCUT_TOKEN));
			continue;
		}

		payloadLines.push(line);
	}

	const language = opener.type === "bash-shortcut" ? "bash" : "python";
	const line = startIndex + 1;
	return {
		nextIndex: lines.length - 1,
		parseError: {
			line,
			message: `Unterminated ${language} fenced shortcut block starting at line ${line}.`,
		},
	};
}

export function splitSubmissionIntoBlocks(submission: string, options: SplitSubmissionOptions): SplitSubmissionResult {
	const normalized = normalizeNewlines(submission);
	const lines = normalized.split("\n");
	const lineIntentByIndex = new Map<number, SubmissionLineIntent>();
	for (const entry of options.lineIntents ?? []) {
		lineIntentByIndex.set(entry.line, entry.intent);
	}
	const result: SubmissionBlock[] = [];
	let pendingText = "";

	for (let i = 0; i < lines.length; i += 1) {
		const isSafeLine = lineIntentByIndex.get(i) === "safe";
		if (!isSafeLine) {
			const fencedResult = parseFencedShortcutBlock(lines, i);
			if (fencedResult) {
				pendingText = flushPendingText(pendingText, result, true);
				if (fencedResult.parseError) {
					return { blocks: result, parseError: fencedResult.parseError };
				}
				if (fencedResult.block) {
					result.push(fencedResult.block);
				}
				i = fencedResult.nextIndex;
				continue;
			}
		}

		const line = lines[i];
		const suffix = i < lines.length - 1 ? "\n" : "";
		const trimmed = line.trim();
		const candidate = trimmed.startsWith("/") ? trimmed : null;
		const isCommand = !isSafeLine && Boolean(candidate && options.isSupportedSlashCommand(trimmed));
		const shortcutBlock = isCommand || isSafeLine ? null : parseExecutableShortcutBlock(trimmed);

		if (isCommand && candidate) {
			pendingText = flushPendingText(pendingText, result, true);
			result.push({ type: "command", text: trimmed });
		} else if (shortcutBlock) {
			pendingText = flushPendingText(pendingText, result, true);
			result.push(shortcutBlock);
		} else {
			pendingText += line + suffix;
		}
	}

	flushPendingText(pendingText, result);
	return { blocks: result };
}
