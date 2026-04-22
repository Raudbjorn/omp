import { describe, expect, it } from "bun:test";
import { filterNonJsonLines, StderrRing } from "../src/providers/acp/process";

function drainTransform(chunks: readonly string[]): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const t = filterNonJsonLines();
		let out = "";
		t.on("data", (c: Buffer | string) => {
			out += typeof c === "string" ? c : c.toString("utf8");
		});
		t.on("end", () => resolve(out));
		t.on("error", reject);
		for (const chunk of chunks) t.write(chunk);
		t.end();
	});
}

describe("filterNonJsonLines", () => {
	it("passes valid JSON-RPC frames through untouched", async () => {
		const frame = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`;
		const out = await drainTransform([frame]);
		expect(out).toBe(frame);
	});

	it("drops non-JSON preamble lines (credentials, ephemeral)", async () => {
		const out = await drainTransform([
			"Loaded cached credentials.\n",
			"<EPHEMERAL_MESSAGE>\n",
			`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`,
		]);
		expect(out).toBe(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`);
	});

	it("handles half-lines split across chunks", async () => {
		const frame = JSON.stringify({ jsonrpc: "2.0", id: 1 });
		const out = await drainTransform([`${frame.slice(0, 10)}`, `${frame.slice(10)}\n`]);
		expect(out).toBe(`${frame}\n`);
	});

	it("accepts JSON arrays as well", async () => {
		const line = "[1,2,3]\n";
		const out = await drainTransform([line]);
		expect(out).toBe(line);
	});

	it("preserves leading whitespace before `{`", async () => {
		const line = '  {"jsonrpc":"2.0","id":1}\n';
		const out = await drainTransform([line]);
		expect(out).toBe(line);
	});

	it("skips blank lines without emitting them", async () => {
		const out = await drainTransform(["\n", "\n", "\n"]);
		expect(out).toBe("");
	});

	it("flushes trailing JSON without newline on stream end", async () => {
		const line = '{"jsonrpc":"2.0","id":1}';
		const out = await drainTransform([line]);
		// Flush appends a newline when emitting from the buffer.
		expect(out).toBe(`${line}\n`);
	});

	it("drops trailing non-JSON without newline on stream end", async () => {
		const out = await drainTransform(["Loaded cached credentials."]);
		expect(out).toBe("");
	});
});

describe("StderrRing", () => {
	it("captures recent lines up to maxLines", () => {
		const ring = new StderrRing();
		ring.write("one\ntwo\nthree\n");
		expect(ring.tail()).toContain("one");
		expect(ring.tail()).toContain("three");
	});

	it("keeps the tail bounded when overflowing", () => {
		const ring = new StderrRing();
		for (let i = 0; i < 1_000; i++) ring.write(`line-${i}\n`);
		const tail = ring.tail(5).split("\n");
		expect(tail).toHaveLength(5);
		expect(tail.at(-1)).toBe("line-999");
	});

	it("flushes a trailing line without newline", () => {
		const ring = new StderrRing();
		ring.write("no-newline-here");
		expect(ring.tail()).toContain("no-newline-here");
	});
});
