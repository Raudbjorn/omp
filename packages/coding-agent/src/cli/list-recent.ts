import * as path from "node:path";
import { truncateToWidth } from "@oh-my-pi/pi-tui";
import chalk from "chalk";
import { formatTimeAgo, type SessionInfo, SessionManager } from "../session/session-manager";
import { getSessionAccentHex } from "../utils/session-color";

const DEFAULT_RECENT_SESSION_LIMIT = 10;
const MAX_TITLE_WIDTH = 60;
const MAX_DIRECTORY_WIDTH = 30;
const LAST_USED_HEADER = "last used";
const untitledTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

interface RecentSessionRow {
	title: string;
	directory: string;
	id: string;
	lastUsed: string;
	accentHex?: string;
}

function writeLine(line = ""): void {
	process.stdout.write(`${line}\n`);
}

function sanitizeInlineText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const firstLine = value.split(/\r?\n/)[0] ?? "";
	const stripped = firstLine
		.replace(/[\x00-\x1F\x7F]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return stripped.length > 0 ? stripped : undefined;
}

function padCell(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));
}

function padCellStart(text: string, width: number): string {
	return " ".repeat(Math.max(0, width - Bun.stringWidth(text))) + text;
}

function getFallbackTitle(session: SessionInfo): string {
	const created = Number.isFinite(session.created.getTime()) ? session.created : session.modified;
	return `Untitled · ${untitledTimeFormatter.format(created)}`;
}

function getDirectoryName(session: SessionInfo): string {
	const cwd = sanitizeInlineText(session.cwd);
	if (!cwd) return "unknown";
	return path.basename(cwd) || cwd;
}

function buildRecentSessionRow(session: SessionInfo): RecentSessionRow {
	const title = truncateToWidth(
		sanitizeInlineText(session.title) ?? sanitizeInlineText(session.firstMessage) ?? getFallbackTitle(session),
		MAX_TITLE_WIDTH,
	);
	const directory = truncateToWidth(getDirectoryName(session), MAX_DIRECTORY_WIDTH);
	const accentSource = sanitizeInlineText(session.headerTitle);
	return {
		title,
		directory,
		id: session.id,
		lastUsed: formatTimeAgo(session.modified),
		accentHex: accentSource ? getSessionAccentHex(accentSource) : undefined,
	};
}

export function listRecentSessions(sessions: SessionInfo[], limit = DEFAULT_RECENT_SESSION_LIMIT): void {
	const recent = [...sessions]
		.sort((left, right) => right.modified.getTime() - left.modified.getTime())
		.slice(0, limit);
	if (recent.length === 0) {
		writeLine("No sessions found.");
		return;
	}

	const rows = recent.map(buildRecentSessionRow);
	const widths = {
		title: Math.max("title".length, ...rows.map(row => Bun.stringWidth(row.title))),
		directory: Math.max("directory".length, ...rows.map(row => Bun.stringWidth(row.directory))),
		id: Math.max("id".length, ...rows.map(row => Bun.stringWidth(row.id))),
		lastUsed: Math.max(LAST_USED_HEADER.length, ...rows.map(row => Bun.stringWidth(row.lastUsed))),
	};

	writeLine("Recent sessions (all directories)");
	writeLine();
	writeLine(
		chalk.dim(
			`${padCell("title", widths.title)}  ${padCell("directory", widths.directory)}  ${padCell("id", widths.id)}  ${padCell(LAST_USED_HEADER, widths.lastUsed)}`,
		),
	);
	for (const row of rows) {
		const plainLine = `${padCell(row.title, widths.title)}  ${padCell(row.directory, widths.directory)}  ${padCell(row.id, widths.id)}  ${padCellStart(row.lastUsed, widths.lastUsed)}`;
		writeLine(row.accentHex ? chalk.hex(row.accentHex)(plainLine) : plainLine);
	}
}

export async function runListRecentCommand(limit = DEFAULT_RECENT_SESSION_LIMIT): Promise<void> {
	const sessions = await SessionManager.listAll();
	listRecentSessions(sessions, limit);
}
