import { beforeAll, describe, expect, it } from "bun:test";
import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import { renderUsageReports } from "../../../src/modes/controllers/command-controller";
import { initTheme, theme } from "../../../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function createLimit(windowId: string, windowLabel: string, usedFraction: number): UsageLimit {
	return {
		id: `requests-${windowId}`,
		label: "Requests",
		scope: {
			provider: "openai-codex",
			windowId,
		},
		window: {
			id: windowId,
			label: windowLabel,
		},
		amount: {
			unit: "percent",
			usedFraction,
		},
		status: "ok",
	};
}

function extractBarSegments(line: string): string[] {
	return line.match(/\[[^\]]+\]/g) ?? [];
}

function countFilledBlocks(segment: string): number {
	return [...segment].filter(char => char === "█").length;
}

describe("renderUsageReports", () => {
	it("keeps account columns stable across quota windows", () => {
		const nowMs = 1_700_000_000_000;
		const reports: UsageReport[] = [
			{
				provider: "openai-codex",
				fetchedAt: nowMs - 1_000,
				metadata: { email: "alpha@example.com" },
				limits: [createLimit("5h", "5h", 0.2), createLimit("7d", "7d", 0.8)],
			},
			{
				provider: "openai-codex",
				fetchedAt: nowMs - 1_000,
				metadata: { email: "beta@example.com" },
				limits: [createLimit("5h", "5h", 0.8), createLimit("7d", "7d", 0.2)],
			},
		];

		const output = Bun.stripANSI(renderUsageReports(reports, theme, nowMs));
		const lines = output.split("\n");
		const fiveHourHeader = lines.findIndex(line => line.includes("Requests") && line.includes("(5h)"));
		const sevenDayHeader = lines.findIndex(line => line.includes("Requests") && line.includes("(7d)"));

		expect(fiveHourHeader).toBeGreaterThan(-1);
		expect(sevenDayHeader).toBeGreaterThan(-1);

		const fiveHourAccounts = lines[fiveHourHeader + 1]?.trim();
		const sevenDayAccounts = lines[sevenDayHeader + 1]?.trim();
		const fiveHourBars = extractBarSegments(lines[fiveHourHeader + 2] ?? "");
		const sevenDayBars = extractBarSegments(lines[sevenDayHeader + 2] ?? "");

		expect(fiveHourAccounts).toBe(sevenDayAccounts);
		expect(fiveHourAccounts).toContain("alpha@example.com");
		expect(fiveHourAccounts).toContain("beta@example.com");
		expect(fiveHourAccounts!.indexOf("alpha@example.com")).toBeLessThan(
			fiveHourAccounts!.indexOf("beta@example.com"),
		);

		expect(fiveHourBars).toHaveLength(2);
		expect(sevenDayBars).toHaveLength(2);
		expect(countFilledBlocks(fiveHourBars[0]!)).toBeLessThan(countFilledBlocks(fiveHourBars[1]!));
		expect(countFilledBlocks(sevenDayBars[0]!)).toBeGreaterThan(countFilledBlocks(sevenDayBars[1]!));
	});
});
