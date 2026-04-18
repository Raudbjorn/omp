import { describe, expect, it } from "bun:test";
import { truncateWithEllipsis } from "../src/modes/components/status-line/truncate";

describe("truncateWithEllipsis", () => {
	it("returns the text unchanged when within the limit", () => {
		expect(truncateWithEllipsis("short/path", 40)).toBe("short/path");
	});

	it("returns the text unchanged when exactly at the limit", () => {
		expect(truncateWithEllipsis("abcdefghij", 10)).toBe("abcdefghij");
	});

	it("prepends ellipsis when text exceeds the limit", () => {
		expect(truncateWithEllipsis("projects/alpha/beta/gamma/delta/epsilon", 20)).toBe("…gamma/delta/epsilon");
	});

	it("keeps the trailing characters (informative tail)", () => {
		const result = truncateWithEllipsis("a/b/c/d/e/f/g/h/i/j/k", 10);
		expect(result.endsWith("g/h/i/j/k")).toBe(true);
		expect(result.startsWith("…")).toBe(true);
		expect(result.length).toBe(10);
	});

	it("returns empty string for zero or negative limit", () => {
		expect(truncateWithEllipsis("anything", 0)).toBe("");
		expect(truncateWithEllipsis("anything", -5)).toBe("");
	});

	it("preserves the original head-truncation behavior from the path segment", () => {
		// Mirrors the original inline implementation byte-for-byte.
		const pwd = "projects/really/deep/nested/structure/that/exceeds/40/chars";
		const maxLen = 40;
		const ellipsis = "…";
		const sliceLen = Math.max(0, maxLen - ellipsis.length);
		const expected = `${ellipsis}${pwd.slice(-sliceLen)}`;
		expect(truncateWithEllipsis(pwd, maxLen)).toBe(expected);
	});
});
