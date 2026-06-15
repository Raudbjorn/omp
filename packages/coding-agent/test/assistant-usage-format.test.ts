import { beforeAll, describe, expect, it } from "bun:test";
import {
	formatAssistantUsageMetadata,
	getElapsedSincePreviousAssistant,
} from "../src/modes/components/assistant-usage-format";
import { initTheme, theme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("assistant usage helpers", () => {
	it("shows cache before elapsed time and marks both red when cache is zero", () => {
		const formatted = formatAssistantUsageMetadata(
			{
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 2,
				totalTokens: 17,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			12_000,
		);
		const text = Bun.stripANSI(formatted);

		expect(formatted).toContain(`${theme.fg("dim", "\uf49b")} ${theme.bold(theme.fg("error", "0"))}`);
		expect(formatted).toContain(`${theme.fg("dim", theme.icon.time)} ${theme.fg("error", "12.0s")}`);
		expect(text.indexOf("\uf49b 0")).toBeGreaterThan(-1);
		expect(text.indexOf(`${theme.icon.time} 12.0s`)).toBeGreaterThan(text.indexOf("\uf49b 0"));
	});

	it("keeps elapsed time dim when cache is nonzero", () => {
		const formatted = formatAssistantUsageMetadata(
			{
				input: 10,
				output: 5,
				cacheRead: 7,
				cacheWrite: 2,
				totalTokens: 24,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			12_000,
		);

		expect(formatted).toContain(theme.fg("dim", `${theme.icon.time} 12.0s`));
	});

	it("computes elapsed time from the previous assistant message", () => {
		const elapsed = getElapsedSincePreviousAssistant(
			[
				{ role: "user", timestamp: 1_000 },
				{ role: "assistant", timestamp: 2_000 },
				{ role: "assistant", timestamp: 6_500 },
			],
			6_500,
		);

		expect(elapsed).toBe(4_500);
	});
});
