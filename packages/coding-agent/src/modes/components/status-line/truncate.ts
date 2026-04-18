const ELLIPSIS = "…";

/**
 * Head-truncate text with a leading ellipsis when it exceeds `maxLen` display
 * characters. Keeps the visually informative tail (rightmost path components,
 * branch-name suffix, etc.) and collapses overflow at the front.
 *
 * Pure / dependency-free so it can be imported by tests without pulling in
 * the theme module.
 */
export function truncateWithEllipsis(text: string, maxLen: number): string {
	if (maxLen <= 0) return "";
	if (text.length <= maxLen) return text;
	const sliceLen = Math.max(0, maxLen - ELLIPSIS.length);
	return `${ELLIPSIS}${text.slice(-sliceLen)}`;
}
