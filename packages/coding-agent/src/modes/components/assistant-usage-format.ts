import type { Usage } from "@oh-my-pi/pi-ai";
import { formatNumber } from "@oh-my-pi/pi-utils";
import { theme } from "../../modes/theme/theme";
import { formatDuration } from "../../tools/render-utils";

const CACHE_USAGE_ICON = "\uf49b";

export interface TimedMessageLike {
	role: string;
	timestamp: number;
}

export function formatAssistantUsageMetadata(usage: Usage, elapsedMs?: number): string {
	const totalInput = usage.input + usage.cacheWrite;
	const parts = [
		theme.fg("dim", `${theme.icon.input} ${formatNumber(totalInput)}`),
		theme.fg("dim", `${theme.icon.output} ${formatNumber(usage.output)}`),
	];
	if (typeof elapsedMs === "number" && elapsedMs >= 0) {
		parts.push(theme.fg("dim", `${theme.icon.time} ${formatDuration(elapsedMs)}`));
	}
	parts.push(
		usage.cacheRead === 0
			? `${theme.fg("dim", CACHE_USAGE_ICON)} ${theme.bold(theme.fg("error", "0"))}`
			: theme.fg("dim", `${CACHE_USAGE_ICON} ${formatNumber(usage.cacheRead)}`),
	);
	return parts.join("  ");
}

export function getElapsedSincePreviousAssistant(
	messages: ReadonlyArray<TimedMessageLike>,
	targetTimestamp: number,
): number | undefined {
	let previousTimestamp: number | undefined;
	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}
		if (message.timestamp === targetTimestamp) {
			return previousTimestamp === undefined ? undefined : Math.max(0, targetTimestamp - previousTimestamp);
		}
		previousTimestamp = message.timestamp;
	}
	return previousTimestamp === undefined ? undefined : Math.max(0, targetTimestamp - previousTimestamp);
}
