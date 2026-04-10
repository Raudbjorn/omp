import { beforeAll, describe, expect, it } from "bun:test";
import {
	formatAssistantUsageMetadata,
	getElapsedSincePreviousAssistant,
} from "../src/modes/components/assistant-usage-format";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("assistant usage helpers", () => {
	it("keeps cache visible and marks zero-cache red", () => {
		const text = Bun.stripANSI(
			formatAssistantUsageMetadata(
				{
					input: 10,
					output: 5,
					cacheRead: 0,
					cacheWrite: 2,
					totalTokens: 17,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				12_000,
			),
		);

		expect(text).toContain("\uf49b 0");
		expect(text).toContain("12.0s");
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
