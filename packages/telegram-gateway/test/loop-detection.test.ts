import { describe, expect, it } from "bun:test";
import { detectToolLoop, stableStringify } from "../src/loop-detection";

describe("detectToolLoop", () => {
	it("returns ok on empty history", () => {
		expect(detectToolLoop([])).toEqual({ isLoop: false, severity: "ok" });
	});

	it("returns ok on single entry", () => {
		expect(detectToolLoop([{ tool: "bash", key: "ls" }])).toEqual({ isLoop: false, severity: "ok" });
	});

	it("returns ok on window - 1 entries", () => {
		expect(detectToolLoop(Array(5).fill({ tool: "bash", key: "ls" }))).toEqual({
			isLoop: false,
			severity: "ok",
		});
	});

	it("detects loop at exact threshold boundary (3/6)", () => {
		const history = [
			{ tool: "read", key: "a" },
			{ tool: "read", key: "b" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
		];
		// latest = bash/ls → 4 repeats ≥ 3
		expect(detectToolLoop(history)).toEqual({ isLoop: true, severity: "loop" });
	});

	it("returns ok just below threshold (2/6)", () => {
		const history = [
			{ tool: "read", key: "a" },
			{ tool: "read", key: "b" },
			{ tool: "read", key: "c" },
			{ tool: "read", key: "d" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
		];
		expect(detectToolLoop(history)).toEqual({ isLoop: false, severity: "ok" });
	});

	it("detects loop when all 6 window entries identical", () => {
		const history = Array(6).fill({ tool: "bash", key: "ls" });
		expect(detectToolLoop(history)).toEqual({ isLoop: true, severity: "loop" });
	});

	it("detects loop with larger window and custom threshold", () => {
		const history = Array(10).fill({ tool: "bash", key: "ls" });
		expect(detectToolLoop(history, 10, 7)).toEqual({ isLoop: true, severity: "loop" });
	});

	it("returns ok when threshold not met in custom window", () => {
		const history = Array(10).fill({ tool: "bash", key: "ls" });
		expect(detectToolLoop(history, 10, 11)).toEqual({ isLoop: false, severity: "ok" });
	});

	it("only considers last windowSize entries when history is larger", () => {
		const history = [
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			// window starts here — only 1 bash/ls in window
			{ tool: "write", key: "a" },
			{ tool: "read", key: "b" },
			{ tool: "bash", key: "ls" },
			{ tool: "read", key: "c" },
			{ tool: "write", key: "d" },
			{ tool: "grep", key: "e" },
		];
		expect(detectToolLoop(history)).toEqual({ isLoop: false, severity: "ok" });
	});

	it("returns ok when latest call is unique despite earlier repeats", () => {
		const history = [
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "read", key: "x" }, // latest — unique
		];
		expect(detectToolLoop(history)).toEqual({ isLoop: false, severity: "ok" });
	});

	it("handles windowSize=0 gracefully", () => {
		expect(detectToolLoop([{ tool: "bash", key: "ls" }], 0, 3)).toEqual({
			isLoop: false,
			severity: "ok",
		});
	});

	it("handles threshold=0 gracefully", () => {
		expect(detectToolLoop([{ tool: "bash", key: "ls" }], 6, 0)).toEqual({
			isLoop: false,
			severity: "ok",
		});
	});

	it("handles negative windowSize gracefully", () => {
		const many = Array(10).fill({ tool: "bash", key: "ls" });
		expect(detectToolLoop(many, -1, 3)).toEqual({ isLoop: false, severity: "ok" });
	});

	it("handles threshold > windowSize gracefully", () => {
		const many = Array(10).fill({ tool: "bash", key: "ls" });
		expect(detectToolLoop(many, 5, 10)).toEqual({ isLoop: false, severity: "ok" });
	});

	it("does not mutate input history", () => {
		const history = Array(6).fill({ tool: "bash", key: "ls" });
		const copy = [...history];
		detectToolLoop(history);
		expect(history).toEqual(copy);
	});

	it("uses defaults (window=6, threshold=3) when called positionally", () => {
		const below = Array(6).fill({ tool: "x", key: "y" });
		expect(detectToolLoop(below)).toEqual({ isLoop: true, severity: "loop" });
	});

describe("stableStringify", () => {
	it("produces same output for same object regardless of key order", () => {
		const a = { cmd: "ls", path: "/tmp", recursive: true };
		const b = { recursive: true, path: "/tmp", cmd: "ls" };
		expect(stableStringify(a)).toBe(stableStringify(b));
	});

	it("produces different output for different values", () => {
		expect(stableStringify({ cmd: "ls" })).not.toBe(stableStringify({ cmd: "pwd" }));
	});

	it("handles nested objects", () => {
		const a = { outer: { b: 2, a: 1 } };
		const b = { outer: { a: 1, b: 2 } };
		expect(stableStringify(a)).toBe(stableStringify(b));
	});

	it("handles arrays (preserves order)", () => {
		expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
	});

	it("handles primitives", () => {
		expect(stableStringify(42)).toBe("42");
		expect(stableStringify("str")).toBe('"str"');
		expect(stableStringify(null)).toBe("null");
		expect(stableStringify(true)).toBe("true");
	});

	it("handles undefined", () => {
		expect(stableStringify(undefined)).toBe("null");
	});

	it("handles empty object", () => {
		expect(stableStringify({})).toBe("{}");
	});
});

describe("detectToolLoop", () => {
		// 6 calls total, 5 unique tools, last one repeats 4x
		const history = [
			{ tool: "a", key: "1" },
			{ tool: "b", key: "2" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
			{ tool: "bash", key: "ls" },
		];
		expect(detectToolLoop(history)).toEqual({ isLoop: true, severity: "loop" });
	});
});
