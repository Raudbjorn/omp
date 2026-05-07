import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	applyHashlineEdits,
	buildCompactHashlineDiffPreview,
	computeLineHash,
	type ExecuteHashlineSingleOptions,
	executeHashlineSingle,
	generateDiffString,
	HashlineMismatchError,
	HL_BODY_SEP,
	HL_BODY_SEP_RE_RAW,
	HL_EDIT_SEP,
	hashlineEditParamsSchema,
	parseHashline,
	splitHashlineInput,
	splitHashlineInputs,
} from "@oh-my-pi/pi-coding-agent/edit";
import type { Anchor, DocSymbol, HashlineEdit } from "@oh-my-pi/pi-coding-agent/edit/modes/hashline";
import {
	checkBoundariesForEdits,
	SharedBoundaryError,
	verifyTags,
} from "@oh-my-pi/pi-coding-agent/edit/modes/hashline";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { Value } from "@sinclair/typebox/value";

beforeAll(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: process.cwd() });
});

// Single source of truth for the payload separator under test. Every literal
// payload line in this file goes through `pl()` so flipping
// `HL_EDIT_SEP` (e.g. to ">" or "\\") flips the test inputs in
// lockstep without any `|`-vs-`>` churn.
const sep = HL_EDIT_SEP;
const pl = (text: string): string => `${sep}${text}`;
const outputSep = HL_BODY_SEP;
const outputSepRe = HL_BODY_SEP_RE_RAW;

function tag(line: number, content: string): string {
	return `${line}${computeLineHash(line, content)}`;
}

function makeTag(line: number, content: string): Anchor {
	return { line, hash: computeLineHash(line, content) };
}

function mistag(line: number, content: string): string {
	const hash = computeLineHash(line, content);
	return `${line}${hash === "zz" ? "yy" : "zz"}`;
}

function applyDiff(content: string, diff: string): string {
	return applyHashlineEdits(content, parseHashline(diff)).lines;
}

async function withTempDir(fn: (tempDir: string) => Promise<void>): Promise<void> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hashline-edit-"));
	try {
		await fn(tempDir);
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

function hashlineExecuteOptions(tempDir: string, input: string): ExecuteHashlineSingleOptions {
	return {
		session: { cwd: tempDir } as ToolSession,
		input,
		writethrough: async (targetPath, content) => {
			await Bun.write(targetPath, content);
			return undefined;
		},
		beginDeferredDiagnosticsForPath: () => ({
			onDeferredDiagnostics: () => {},
			signal: new AbortController().signal,
			finalize: () => {},
		}),
	};
}

describe("hashline parser — block op syntax", () => {
	const content = "aaa\nbbb\nccc";

	it("inserts payload before/after a Lid, and at BOF/EOF", () => {
		const diff = [
			`< ${tag(2, "bbb")}`,
			pl("before b"),
			`+ ${tag(2, "bbb")}`,
			pl("after b"),
			"+ BOF",
			pl("top"),
			"+ EOF",
			pl("tail"),
		].join("\n");
		expect(applyDiff(content, diff)).toBe("top\naaa\nbefore b\nbbb\nafter b\nccc\ntail");
	});

	it("inserts after the final line via `+ ANCHOR` instead of falling off the file", () => {
		const diff = [`+ ${tag(3, "ccc")}`, pl("tail")].join("\n");
		expect(applyDiff(content, diff)).toBe("aaa\nbbb\nccc\ntail");
	});

	it("blanks a line in place when `= ANCHOR` has no payload", () => {
		const diff = `= ${tag(2, "bbb")}`;
		expect(applyDiff(content, diff)).toBe("aaa\n\nccc");
	});

	it("blanks a range to a single empty line when `= A..B` has no payload", () => {
		const diff = `= ${tag(1, "aaa")}..${tag(2, "bbb")}`;
		expect(applyDiff(content, diff)).toBe("\nccc");
	});

	it("deletes one line or an inclusive range", () => {
		expect(applyDiff(content, `- ${tag(2, "bbb")}`)).toBe("aaa\nccc");
		expect(applyDiff(content, `- ${tag(2, "bbb")}..${tag(3, "ccc")}`)).toBe("aaa");
	});

	it("replaces one line or an inclusive range with payload lines", () => {
		const single = [`= ${tag(2, "bbb")}`, pl("BBB")].join("\n");
		expect(applyDiff(content, single)).toBe("aaa\nBBB\nccc");

		const range = [`= ${tag(2, "bbb")}..${tag(3, "ccc")}`, pl("BBB"), pl("CCC")].join("\n");
		expect(applyDiff(content, range)).toBe("aaa\nBBB\nCCC");
	});

	it("auto-absorbs duplicated multiline prefix boundaries during replacement", () => {
		const source = ["// one", "// two", "old();"].join("\n");
		const diff = [`= ${tag(3, "old();")}`, pl("// one"), pl("// two"), pl("new();")].join("\n");

		expect(applyDiff(source, diff)).toBe(["// one", "// two", "new();"].join("\n"));
	});

	it("auto-absorbs duplicated multiline suffix boundaries during replacement", () => {
		const source = ["old();", "// one", "// two"].join("\n");
		const diff = [`= ${tag(1, "old();")}`, pl("new();"), pl("// one"), pl("// two")].join("\n");

		expect(applyDiff(source, diff)).toBe(["new();", "// one", "// two"].join("\n"));
	});

	it("does not auto-absorb a single duplicated boundary line", () => {
		const source = ["keep", "old();"].join("\n");
		const diff = [`= ${tag(2, "old();")}`, pl("keep"), pl("new();")].join("\n");

		expect(applyDiff(source, diff)).toBe(["keep", "keep", "new();"].join("\n"));
	});

	it("does not auto-absorb a duplicate boundary that another op already targets", () => {
		// Lines 3-4 ("X","Y") match the payload's trailing block, but line 4
		// is also the anchor of a separate insert. Absorbing it would silently
		// steal that anchor and turn the insert into a replacement.
		const source = ["A", "B", "X", "Y", "Z"].join("\n");
		const diff = [
			`= ${tag(1, "A")}..${tag(2, "B")}`,
			pl("alpha"),
			pl("X"),
			pl("Y"),
			`< ${tag(4, "Y")}`,
			pl("extra"),
		].join("\n");

		expect(applyDiff(source, diff)).toBe(["alpha", "X", "Y", "X", "extra", "Y", "Z"].join("\n"));
	});

	it("surfaces a warning when boundary duplicates are auto-absorbed", () => {
		const source = ["// one", "// two", "old();"].join("\n");
		const diff = [`= ${tag(3, "old();")}`, pl("// one"), pl("// two"), pl("new();")].join("\n");

		const result = applyHashlineEdits(source, parseHashline(diff));
		expect(result.lines).toBe(["// one", "// two", "new();"].join("\n"));
		expect(result.warnings).toBeDefined();
		expect(result.warnings).toEqual(
			expect.arrayContaining([expect.stringMatching(/Auto-absorbed 2 duplicate line\(s\) above replacement/)]),
		);
	});

	it("preserves payload text exactly after the first separator", () => {
		const diff = [`= ${tag(2, "bbb")}`, pl(""), pl("# not a header"), pl("+ not an op"), pl("  spaced")].join("\n");
		expect(applyDiff(content, diff)).toBe("aaa\n\n# not a header\n+ not an op\n  spaced\nccc");
	});

	it("rejects missing payloads and orphan payload lines", () => {
		expect(() => parseHashline(`+ ${tag(1, "aaa")}`)).toThrow(/require at least one/);
		expect(() => parseHashline(pl("orphan"))).toThrow(/payload line has no preceding/);
	});

	it("rejects old cursor and equals-inline syntax after cutover", () => {
		expect(() => parseHashline(`@${tag(1, "aaa")}\n+old`)).toThrow(/unrecognized op/);
		expect(() => parseHashline(`${tag(1, "aaa")}=AAA`)).toThrow(/unrecognized op/);
	});
});

describe("hashline parser — inline modify syntax", () => {
	const content = "alpha\nbeta\ngamma";

	it("prepends text to the anchored line via `< ANCHOR<sep>TEXT`", () => {
		const diff = `< ${tag(2, "beta")}${pl("// ")}`;
		expect(applyDiff(content, diff)).toBe("alpha\n// beta\ngamma");
	});

	it("appends text to the anchored line via `+ ANCHOR<sep>TEXT`", () => {
		const diff = `+ ${tag(2, "beta")}${pl(" // tag")}`;
		expect(applyDiff(content, diff)).toBe("alpha\nbeta // tag\ngamma");
	});

	it("combines a prepend and an append on the same line", () => {
		const diff = [`< ${tag(2, "beta")}${pl("[")}`, `+ ${tag(2, "beta")}${pl("]")}`].join("\n");
		expect(applyDiff(content, diff)).toBe("alpha\n[beta]\ngamma");
	});

	it("stacks multiple prepends with later edits wrapping earlier ones", () => {
		const diff = [`< ${tag(2, "beta")}${pl("A")}`, `< ${tag(2, "beta")}${pl("B")}`].join("\n");
		expect(applyDiff(content, diff)).toBe("alpha\nBAbeta\ngamma");
	});

	it("stacks multiple appends with later edits wrapping earlier ones", () => {
		const diff = [`+ ${tag(2, "beta")}${pl("A")}`, `+ ${tag(2, "beta")}${pl("B")}`].join("\n");
		expect(applyDiff(content, diff)).toBe("alpha\nbetaAB\ngamma");
	});

	it("appends inline AND inserts payload lines after the modified line", () => {
		const diff = [`+ ${tag(2, "beta")}${pl(" // tag")}`, pl("inserted-after-1"), pl("inserted-after-2")].join("\n");
		expect(applyDiff(content, diff)).toBe("alpha\nbeta // tag\ninserted-after-1\ninserted-after-2\ngamma");
	});

	it("prepends inline AND inserts payload lines before the modified line", () => {
		const diff = [`< ${tag(2, "beta")}${pl("// ")}`, pl("inserted-before-1"), pl("inserted-before-2")].join("\n");
		expect(applyDiff(content, diff)).toBe("alpha\ninserted-before-1\ninserted-before-2\n// beta\ngamma");
	});

	it("allows a block insert-before to coexist with an inline modify on the same line", () => {
		const diff = [`< ${tag(2, "beta")}`, pl("// note"), `+ ${tag(2, "beta")}${pl("!")}`].join("\n");
		expect(applyDiff(content, diff)).toBe("alpha\n// note\nbeta!\ngamma");
	});

	it("rejects combining inline modify with a delete on the same line", () => {
		const diff = [`- ${tag(2, "beta")}`, `+ ${tag(2, "beta")}${pl("!")}`].join("\n");
		expect(() => applyDiff(content, diff)).toThrow(/cannot combine inline modify/);
	});

	it("validates the anchor hash for inline modify just like other ops", () => {
		const diff = `+ ${mistag(2, "beta")}${pl("!")}`;
		expect(() => applyDiff(content, diff)).toThrow(HashlineMismatchError);
	});

	it("treats an empty inline payload as a no-op when nothing else follows", () => {
		const diff = `+ ${tag(2, "beta")}${pl("")}`;
		const result = applyHashlineEdits(content, parseHashline(diff));
		expect(result.lines).toBe(content);
	});
});

describe("hashline — stale anchors", () => {
	it("throws HashlineMismatchError when a Lid hash no longer matches", () => {
		const diff = [`= ${mistag(2, "bbb")}`, pl("BBB")].join("\n");
		expect(() => applyDiff("aaa\nbbb\nccc", diff)).toThrow(HashlineMismatchError);
	});

	it("rebases a uniquely shifted anchor within the configured window", () => {
		const stale = tag(2, "bbb");
		const diff = [`= ${stale}`, pl("BBB")].join("\n");
		const result = applyHashlineEdits("aaa\nINSERTED\nbbb\nccc", parseHashline(diff));
		expect(result.lines).toBe("aaa\nINSERTED\nBBB\nccc");
		expect(result.warnings?.[0]).toContain(`Auto-rebased anchor ${stale}`);
	});

	it("rejects when the line is in bounds but the hash matches no nearby line", () => {
		// Two-char hash, fabricated by guaranteeing it equals neither line 2's nor any other line's hash
		const fakeHash = computeLineHash(2, "bbb") === "zz" ? "yy" : "zz";
		const diff = [`= 2${fakeHash}`, pl("BBB")].join("\n");
		expect(() => applyDiff("aaa\nbbb\nccc", diff)).toThrow(HashlineMismatchError);
	});

	it("rejects when multiple lines within the rebase window share the same hash", () => {
		// Significant-content lines hash by content alone; identical content gives
		// identical hashes, so multiple lines in ±5 collide and force a reject.
		const file = ["x = 1", "y = 2", "x = 1", "z = 3", "x = 1", "w = 4"].join("\n");
		const collidingHash = computeLineHash(1, "x = 1");
		// User points at line 4 (`z = 3`) with the colliding hash; the rebase
		// window covers lines 1, 3, and 5, all of which match — ambiguous.
		const diff = [`= 4${collidingHash}`, pl("REPLACED")].join("\n");
		expect(() => applyDiff(file, diff)).toThrow(HashlineMismatchError);
	});
});

describe("splitHashlineInput — @ headers", () => {
	it("extracts path and diff body from @path header", () => {
		const input = [`@src/foo.ts`, `= ${tag(2, "bbb")}`, pl("BBB")].join("\n");
		expect(splitHashlineInput(input)).toEqual({ path: "src/foo.ts", diff: `= ${tag(2, "bbb")}\n${pl("BBB")}` });
	});

	it("strips leading blank lines and unquotes matching path quotes", () => {
		expect(splitHashlineInput(`\n@"foo bar.ts"\n+ BOF\n${pl("x")}`)).toEqual({
			path: "foo bar.ts",
			diff: `+ BOF\n${pl("x")}`,
		});
	});

	it("normalizes cwd-prefixed absolute paths to cwd-relative paths", () => {
		const cwd = process.cwd();
		const absolute = path.join(cwd, "src", "foo.ts");
		expect(splitHashlineInput(`@${absolute}\n+ BOF\n${pl("x")}`, { cwd }).path).toBe("src/foo.ts");
	});

	it("uses explicit fallback path only when input has recognizable operations", () => {
		expect(splitHashlineInput(`+ BOF\n${pl("x")}`, { path: "a.ts" })).toEqual({
			path: "a.ts",
			diff: `+ BOF\n${pl("x")}`,
		});
		expect(() => splitHashlineInput("plain text", { path: "a.ts" })).toThrow(/must begin with/);
	});

	it("splits multiple edit sections", () => {
		const input = ["@a.ts", "+ BOF", pl("a"), "@b.ts", "+ EOF", pl("b")].join("\n");
		expect(splitHashlineInputs(input)).toEqual([
			{ path: "a.ts", diff: `+ BOF\n${pl("a")}` },
			{ path: "b.ts", diff: `+ EOF\n${pl("b")}` },
		]);
	});
});

describe("hashline executor", () => {
	it("creates a missing file with a file-scoped insert", async () => {
		await withTempDir(async tempDir => {
			const input = `@new.ts\n+ BOF\n${pl("export const x = 1;")}\n`;
			const result = await executeHashlineSingle(hashlineExecuteOptions(tempDir, input));
			expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("new.ts:");
			expect(await Bun.file(path.join(tempDir, "new.ts")).text()).toBe("export const x = 1;");
		});
	});

	it("preflights every section before writing multi-file edits", async () => {
		await withTempDir(async tempDir => {
			const aPath = path.join(tempDir, "a.ts");
			const bPath = path.join(tempDir, "b.ts");
			await Bun.write(aPath, "aaa\n");
			await Bun.write(bPath, "bbb\n");
			const input = ["@a.ts", `= ${tag(1, "aaa")}`, pl("AAA"), "@b.ts", `= ${mistag(1, "bbb")}`, pl("BBB")].join(
				"\n",
			);

			await expect(executeHashlineSingle(hashlineExecuteOptions(tempDir, input))).rejects.toThrow(
				/changed since the last read/,
			);
			expect(await Bun.file(aPath).text()).toBe("aaa\n");
			expect(await Bun.file(bPath).text()).toBe("bbb\n");
		});
	});
});

describe("hashlineEditParamsSchema — extra-field tolerance", () => {
	it("accepts extra `path` field alongside `input`", () => {
		expect(Value.Check(hashlineEditParamsSchema, { path: "x.ts", input: `@x.ts\n+ BOF\n${pl("x")}` })).toBe(true);
	});

	it("still requires `input`", () => {
		expect(Value.Check(hashlineEditParamsSchema, { path: "x.ts" })).toBe(false);
	});
});

describe("buildCompactHashlineDiffPreview — anchors track post-edit line numbers", () => {
	it("emits hashes against the new file's line numbers for context after a range expansion", () => {
		const before = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].join("\n");
		const after = ["a1", "a2", "a3", "X", "Y", "Z", "a5", "a6", "a7"].join("\n");
		const { diff } = generateDiffString(before, after);
		const preview = buildCompactHashlineDiffPreview(diff);

		// Walk the preview and verify every ` LINE+HASH${outputSep}content` line matches what
		// the file now has at that line number.
		const newFileLines = after.split("\n");
		for (const line of preview.preview.split("\n")) {
			if (!line.startsWith(" ")) continue;
			// Skip context-elision markers ("...") which carry no real file content.
			if (line.endsWith(`${outputSep}...`)) continue;
			const match = new RegExp(`^\\s(\\d+)([a-z]{2})${outputSepRe}(.*)$`).exec(line);
			expect(match).not.toBeNull();
			if (!match) continue;
			const lineNum = Number(match[1]);
			const hash = match[2];
			const content = match[3];
			expect(newFileLines[lineNum - 1]).toBe(content);
			expect(computeLineHash(lineNum, content)).toBe(hash);
		}
	});

	it("emits + lines with hashes against new line numbers and - lines with the placeholder", () => {
		const before = "alpha\nbeta\ngamma\n";
		const after = "alpha\nDELTA\nEPSILON\ngamma\n";
		const { diff } = generateDiffString(before, after);
		const preview = buildCompactHashlineDiffPreview(diff);

		const additions = preview.preview.split("\n").filter(line => line.startsWith("+"));
		expect(additions).toEqual([
			`+2${computeLineHash(2, "DELTA")}${outputSep}DELTA`,
			`+3${computeLineHash(3, "EPSILON")}${outputSep}EPSILON`,
		]);

		const removals = preview.preview.split("\n").filter(line => line.startsWith("-"));
		expect(removals).toEqual([`-2--${outputSep}beta`]);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyTags (pre-flight tag verification)
// ═══════════════════════════════════════════════════════════════════════════

describe("verifyTags", () => {
	it("returns valid when all tags match", () => {
		const text = "line one\nline two\nline three";
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: makeTag(2, "line two"), lines: ["new two"] },
		];
		expect(verifyTags(text, edits)).toEqual({ valid: true });
	});

	it("returns invalid with HashlineMismatchError when a tag is stale", () => {
		const text = "line one\nline two\nline three";
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: { line: 2, hash: "AA" }, lines: ["new two"] },
		];
		const result = verifyTags(text, edits);
		expect(result.valid).toBe(false);
		expect(result.error).toBeInstanceOf(HashlineMismatchError);
		expect(result.error?.mismatches).toHaveLength(1);
		expect(result.error?.mismatches[0]?.line).toBe(2);
	});

	it("validates both pos and end for replace_range", () => {
		const text = "a\nb\nc\nd";
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: { line: 1, hash: "XX" },
				end: { line: 3, hash: "YY" },
				lines: ["rewrite"],
			},
		];
		const result = verifyTags(text, edits);
		expect(result.valid).toBe(false);
		expect(result.error?.mismatches).toHaveLength(2);
	});

	it("skips validation for append_file / prepend_file (no anchor)", () => {
		const text = "a\nb\nc";
		const edits: HashlineEdit[] = [
			{ op: "append_file", lines: ["d"] },
			{ op: "prepend_file", lines: ["z"] },
		];
		expect(verifyTags(text, edits)).toEqual({ valid: true });
	});

	it("skips out-of-range anchors without throwing", () => {
		const text = "only line";
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: { line: 99, hash: "AA" }, lines: ["x"] },
		];
		expect(verifyTags(text, edits)).toEqual({ valid: true });
	});

	it("enriched remaps cover every line in a failing replace_range", () => {
		const text = "a\nb\nc\nd\ne";
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: { line: 2, hash: "WRONG" },
				end: { line: 4, hash: computeLineHash(4, "d") },
				lines: ["rewrite"],
			},
		];
		const result = verifyTags(text, edits);
		expect(result.valid).toBe(false);
		const remaps = result.error?.remaps;
		expect(remaps).toBeDefined();
		// Every line 2..4 has an entry, regardless of whether it mismatched
		for (const line of [2, 3, 4]) {
			const hash = computeLineHash(line, text.split("\n")[line - 1]);
			expect([...(remaps?.keys() ?? [])].some(k => k.startsWith(`${line}#`))).toBe(true);
			// Valid lines map to themselves; invalid map from old → new
			if (line !== 2) {
				expect(remaps?.get(`${line}#${hash}`)).toBe(`${line}#${hash}`);
			}
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// checkBoundariesForEdits (AST-guided shared-boundary rejection)
// ═══════════════════════════════════════════════════════════════════════════

describe("checkBoundariesForEdits", () => {
	const sym = (name: string, startLine: number, endLine: number, children?: DocSymbol[]): DocSymbol => ({
		name,
		range: { start: { line: startLine }, end: { line: endLine } },
		...(children ? { children } : {}),
	});

	it("is a no-op when symbols is null", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(3, "a"),
				end: makeTag(5, "b"),
				lines: ["x"],
			},
		];
		expect(() => checkBoundariesForEdits(edits, null)).not.toThrow();
	});

	it("is a no-op when symbols is empty", () => {
		const edits: HashlineEdit[] = [
			{ op: "replace_range", pos: makeTag(3, "a"), end: makeTag(5, "b"), lines: ["x"] },
		];
		expect(() => checkBoundariesForEdits(edits, [])).not.toThrow();
	});

	it("is a no-op when no replace_range edits are present", () => {
		// A single-line symbol at line 3 (LSP 0-indexed: line 2) — would be a
		// false positive under the old naïve check, but replace_line is skipped.
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: makeTag(3, "a"), lines: ["x"] },
			{ op: "append_at", pos: makeTag(1, "b"), lines: ["y"] },
		];
		const symbols: DocSymbol[] = [sym("CONST", 2, 2)];
		expect(() => checkBoundariesForEdits(edits, symbols)).not.toThrow();
	});

	it("throws SharedBoundaryError when replace_range starts on a shared boundary", () => {
		// Simulate `} else {` pattern: if-block ends on line 4 (LSP 3),
		// else-block starts on line 4 (LSP 3). Edit targets line 4.
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(4, "} else {"),
				end: makeTag(6, "}"),
				lines: ["} else {", "  x;", "}"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("if", 1, 3), // LSP 0-indexed: spans 0..3
			sym("else", 3, 5), // 3..5 — both end-of-if AND start-of-else share line 3
		];
		expect(() => checkBoundariesForEdits(edits, symbols)).toThrow(SharedBoundaryError);
	});

	it("throws when replace_range ends on a shared boundary", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(2, "body line"),
				end: makeTag(4, "} catch {"),
				lines: ["new body"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("try", 0, 3), // ends at LSP line 3
			sym("catch", 3, 5), // starts at LSP line 3
		];
		const thrown = (() => {
			try {
				checkBoundariesForEdits(edits, symbols);
				return null;
			} catch (e) {
				return e;
			}
		})();
		expect(thrown).toBeInstanceOf(SharedBoundaryError);
		expect((thrown as SharedBoundaryError).role).toBe("end");
		expect((thrown as SharedBoundaryError).editIndex).toBe(0);
	});

	it("does NOT flag a single-line symbol as a shared boundary (regression: self-match fix)", () => {
		// A single-line `const FOO = 1` has start.line === end.line.
		// The naïve "endsHere AND startsHere" check would false-positive; the fix
		// requires two DIFFERENT symbols overlapping at the line.
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(2, "const A = 1"),
				end: makeTag(4, "const C = 3"),
				lines: ["replaced"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("A", 1, 1), // LSP 0-indexed: single-line symbol
			sym("B", 2, 2),
			sym("C", 3, 3),
		];
		expect(() => checkBoundariesForEdits(edits, symbols)).not.toThrow();
	});

	it("flattens nested symbols before checking", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(5, "} else {"),
				end: makeTag(7, "}"),
				lines: ["x"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("outerFn", 0, 10, [
				sym("if", 2, 4), // ends at LSP line 4
				sym("else", 4, 6), // starts at LSP line 4
			]),
		];
		expect(() => checkBoundariesForEdits(edits, symbols)).toThrow(SharedBoundaryError);
	});

	it("error message names the construct when one is known", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(4, "} else {"),
				end: makeTag(5, "}"),
				lines: ["x"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("processRequest", 0, 3),
			sym("handleError", 3, 5),
		];
		try {
			checkBoundariesForEdits(edits, symbols);
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(SharedBoundaryError);
			expect((e as Error).message).toContain("processRequest");
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyTags (pre-flight tag verification)
// ═══════════════════════════════════════════════════════════════════════════

describe("verifyTags", () => {
	it("returns valid when all tags match", () => {
		const text = "line one\nline two\nline three";
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: makeTag(2, "line two"), lines: ["new two"] },
		];
		expect(verifyTags(text, edits)).toEqual({ valid: true });
	});

	it("returns invalid with HashlineMismatchError when a tag is stale", () => {
		const text = "line one\nline two\nline three";
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: { line: 2, hash: "AA" }, lines: ["new two"] },
		];
		const result = verifyTags(text, edits);
		expect(result.valid).toBe(false);
		expect(result.error).toBeInstanceOf(HashlineMismatchError);
		expect(result.error?.mismatches).toHaveLength(1);
		expect(result.error?.mismatches[0]?.line).toBe(2);
	});

	it("validates both pos and end for replace_range", () => {
		const text = "a\nb\nc\nd";
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: { line: 1, hash: "XX" },
				end: { line: 3, hash: "YY" },
				lines: ["rewrite"],
			},
		];
		const result = verifyTags(text, edits);
		expect(result.valid).toBe(false);
		expect(result.error?.mismatches).toHaveLength(2);
	});

	it("skips validation for append_file / prepend_file (no anchor)", () => {
		const text = "a\nb\nc";
		const edits: HashlineEdit[] = [
			{ op: "append_file", lines: ["d"] },
			{ op: "prepend_file", lines: ["z"] },
		];
		expect(verifyTags(text, edits)).toEqual({ valid: true });
	});

	it("skips out-of-range anchors without throwing", () => {
		const text = "only line";
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: { line: 99, hash: "AA" }, lines: ["x"] },
		];
		expect(verifyTags(text, edits)).toEqual({ valid: true });
	});

	it("enriched remaps cover every line in a failing replace_range", () => {
		const text = "a\nb\nc\nd\ne";
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: { line: 2, hash: "WRONG" },
				end: { line: 4, hash: computeLineHash(4, "d") },
				lines: ["rewrite"],
			},
		];
		const result = verifyTags(text, edits);
		expect(result.valid).toBe(false);
		const remaps = result.error?.remaps;
		expect(remaps).toBeDefined();
		// Every line 2..4 has an entry, regardless of whether it mismatched
		for (const line of [2, 3, 4]) {
			const hash = computeLineHash(line, text.split("\n")[line - 1]);
			expect([...(remaps?.keys() ?? [])].some(k => k.startsWith(`${line}#`))).toBe(true);
			// Valid lines map to themselves; invalid map from old → new
			if (line !== 2) {
				expect(remaps?.get(`${line}#${hash}`)).toBe(`${line}#${hash}`);
			}
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// checkBoundariesForEdits (AST-guided shared-boundary rejection)
// ═══════════════════════════════════════════════════════════════════════════

describe("checkBoundariesForEdits", () => {
	const sym = (name: string, startLine: number, endLine: number, children?: DocSymbol[]): DocSymbol => ({
		name,
		range: { start: { line: startLine }, end: { line: endLine } },
		...(children ? { children } : {}),
	});

	it("is a no-op when symbols is null", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(3, "a"),
				end: makeTag(5, "b"),
				lines: ["x"],
			},
		];
		expect(() => checkBoundariesForEdits(edits, null)).not.toThrow();
	});

	it("is a no-op when symbols is empty", () => {
		const edits: HashlineEdit[] = [
			{ op: "replace_range", pos: makeTag(3, "a"), end: makeTag(5, "b"), lines: ["x"] },
		];
		expect(() => checkBoundariesForEdits(edits, [])).not.toThrow();
	});

	it("is a no-op when no replace_range edits are present", () => {
		// A single-line symbol at line 3 (LSP 0-indexed: line 2) — would be a
		// false positive under the old naïve check, but replace_line is skipped.
		const edits: HashlineEdit[] = [
			{ op: "replace_line", pos: makeTag(3, "a"), lines: ["x"] },
			{ op: "append_at", pos: makeTag(1, "b"), lines: ["y"] },
		];
		const symbols: DocSymbol[] = [sym("CONST", 2, 2)];
		expect(() => checkBoundariesForEdits(edits, symbols)).not.toThrow();
	});

	it("throws SharedBoundaryError when replace_range starts on a shared boundary", () => {
		// Simulate `} else {` pattern: if-block ends on line 4 (LSP 3),
		// else-block starts on line 4 (LSP 3). Edit targets line 4.
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(4, "} else {"),
				end: makeTag(6, "}"),
				lines: ["} else {", "  x;", "}"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("if", 1, 3), // LSP 0-indexed: spans 0..3
			sym("else", 3, 5), // 3..5 — both end-of-if AND start-of-else share line 3
		];
		expect(() => checkBoundariesForEdits(edits, symbols)).toThrow(SharedBoundaryError);
	});

	it("throws when replace_range ends on a shared boundary", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(2, "body line"),
				end: makeTag(4, "} catch {"),
				lines: ["new body"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("try", 0, 3), // ends at LSP line 3
			sym("catch", 3, 5), // starts at LSP line 3
		];
		const thrown = (() => {
			try {
				checkBoundariesForEdits(edits, symbols);
				return null;
			} catch (e) {
				return e;
			}
		})();
		expect(thrown).toBeInstanceOf(SharedBoundaryError);
		expect((thrown as SharedBoundaryError).role).toBe("end");
		expect((thrown as SharedBoundaryError).editIndex).toBe(0);
	});

	it("does NOT flag a single-line symbol as a shared boundary (regression: self-match fix)", () => {
		// A single-line `const FOO = 1` has start.line === end.line.
		// The naïve "endsHere AND startsHere" check would false-positive; the fix
		// requires two DIFFERENT symbols overlapping at the line.
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(2, "const A = 1"),
				end: makeTag(4, "const C = 3"),
				lines: ["replaced"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("A", 1, 1), // LSP 0-indexed: single-line symbol
			sym("B", 2, 2),
			sym("C", 3, 3),
		];
		expect(() => checkBoundariesForEdits(edits, symbols)).not.toThrow();
	});

	it("flattens nested symbols before checking", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(5, "} else {"),
				end: makeTag(7, "}"),
				lines: ["x"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("outerFn", 0, 10, [
				sym("if", 2, 4), // ends at LSP line 4
				sym("else", 4, 6), // starts at LSP line 4
			]),
		];
		expect(() => checkBoundariesForEdits(edits, symbols)).toThrow(SharedBoundaryError);
	});

	it("error message names the construct when one is known", () => {
		const edits: HashlineEdit[] = [
			{
				op: "replace_range",
				pos: makeTag(4, "} else {"),
				end: makeTag(5, "}"),
				lines: ["x"],
			},
		];
		const symbols: DocSymbol[] = [
			sym("processRequest", 0, 3),
			sym("handleError", 3, 5),
		];
		try {
			checkBoundariesForEdits(edits, symbols);
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(SharedBoundaryError);
			expect((e as Error).message).toContain("processRequest");
		}
	});
});
