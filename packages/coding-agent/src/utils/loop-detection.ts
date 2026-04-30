export interface ToolCallEntry {
	tool: string;
	key: string;
}

export interface LoopDetectionResult {
	isLoop: boolean;
	severity: "ok" | "loop";
}

/**
 * JSON.stringify with stable key ordering.
 * Prevents false negatives where same args produce different keys
 * due to object key ordering.
 */
export function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object" || Array.isArray(value)) {
		return JSON.stringify(value);
	}
	const keys = Object.keys(value as Record<string, unknown>).sort();
	const pairs = keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
	return `{${pairs.join(",")}}`;
}

/**
 * Detect if the same tool with same arguments repeats above threshold
 * within the recent window.
 */
export function detectToolLoop(history: ToolCallEntry[], windowSize = 6, threshold = 3): LoopDetectionResult {
	if (windowSize <= 0 || threshold <= 0 || threshold > windowSize) {
		return { isLoop: false, severity: "ok" };
	}
	if (history.length < windowSize) return { isLoop: false, severity: "ok" };

	const recent = history.slice(-windowSize);
	const latest = recent[recent.length - 1];
	const repeats = recent.filter(t => t.tool === latest.tool && t.key === latest.key);

	return {
		isLoop: repeats.length >= threshold,
		severity: repeats.length >= threshold ? "loop" : "ok",
	};
}
