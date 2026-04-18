const ELLIPSIS = "…";

/**
 * Head-truncate text with a leading ellipsis when it exceeds `maxLen` UTF-16
 * code units. Keeps the visually informative tail (rightmost path components,
 * branch-name suffix, etc.) and collapses overflow at the front. When `maxLen`
 * is smaller than the ellipsis, the output is capped to `maxLen` code units.
 *
 * Pure / dependency-free so it can be imported by tests without pulling in
 * the theme module.
 */
export function truncateWithEllipsis(text: string, maxLen: number): string {
	if (maxLen <= 0) return "";
	if (text.length <= maxLen) return text;
	if (maxLen <= ELLIPSIS.length) return ELLIPSIS.slice(0, maxLen);
	const sliceLen = maxLen - ELLIPSIS.length;
	return `${ELLIPSIS}${text.slice(-sliceLen)}`;
}
