/**
 * Shared utilities for content codecs.
 */

import type { ToolResultMessage } from "@oh-my-pi/pi-ai";

/** Tool names that represent file reads. */
export const READ_TOOL_NAMES = new Set(["proxy_read", "read"]);

/** Check if a tool name represents a file read. */
export function isReadTool(toolName: string | undefined): boolean {
	if (!toolName) return false;
	const baseName = toolName.replace(/^proxy_/, "");
	return READ_TOOL_NAMES.has(baseName) || READ_TOOL_NAMES.has(toolName);
}

/**
 * Extract concatenated text from a tool result message content.
 * Returns the joined text of all text content blocks.
 */
export function extractText(message: ToolResultMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (typeof block === "string") {
			parts.push(block);
		} else if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
			parts.push(block.text as string);
		}
	}
	return parts.join("\n");
}

/**
 * Compute a fast content hash using Bun.hash (Wyhash).
 */
export function contentHash(text: string): number {
	return Bun.hash(text) as number;
}

/** Number of lines to keep from the start of output in peek compression. */
export const HEAD_LINES = 3;
/** Number of lines to keep from the end of output in peek compression. */
export const TAIL_LINES = 2;
/** Total peek lines — outputs at or below this size are kept verbatim. */
export const VERBATIM_LINE_THRESHOLD = HEAD_LINES + TAIL_LINES;

export function buildPeek(lines: string[], lineCount: number): string {
	if (lineCount <= VERBATIM_LINE_THRESHOLD) {
		return lines.join("\n");
	}
	const head = lines.slice(0, HEAD_LINES);
	const tail = lines.slice(-TAIL_LINES);
	const omitted = lineCount - HEAD_LINES - TAIL_LINES;
	return [...head, `[... ${omitted} lines omitted]`, ...tail].join("\n");
}
