import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { AcpError } from "../src/providers/acp/errors";
import { readTextFile, scopedPath, writeTextFile } from "../src/providers/acp/fs-proxy";

const SID = "test-session" as const;

let workspace: string;
let outside: string;

beforeEach(async () => {
	workspace = await mkdtemp(path.join(tmpdir(), "acp-fs-ws-"));
	outside = await mkdtemp(path.join(tmpdir(), "acp-fs-out-"));
});

afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

describe("scopedPath", () => {
	it("accepts a path inside the workspace", async () => {
		await writeFile(path.join(workspace, "notes.md"), "hi");
		const real = await scopedPath(workspace, "notes.md");
		expect(real).toBe(path.join(workspace, "notes.md"));
	});

	it("rejects `..` traversal", async () => {
		await expect(scopedPath(workspace, "../escape.txt")).rejects.toBeInstanceOf(AcpError);
	});

	it("rejects absolute paths outside the workspace", async () => {
		await expect(scopedPath(workspace, "/etc/passwd")).rejects.toBeInstanceOf(AcpError);
	});

	it("rejects symlinks that escape the workspace", async () => {
		const outsideFile = path.join(outside, "secret.txt");
		await writeFile(outsideFile, "top secret");
		await symlink(outsideFile, path.join(workspace, "link.txt"));
		await expect(scopedPath(workspace, "link.txt")).rejects.toBeInstanceOf(AcpError);
	});

	it("accepts a non-existent path if its parent is inside", async () => {
		const real = await scopedPath(workspace, "newfile.txt");
		expect(real.startsWith(workspace)).toBe(true);
	});
});

describe("readTextFile", () => {
	it("reads an entire text file", async () => {
		await writeFile(path.join(workspace, "a.txt"), "alpha\nbeta\n");
		const res = await readTextFile(workspace, { sessionId: SID, path: "a.txt" });
		expect(res.content).toBe("alpha\nbeta\n");
	});

	it("respects 1-indexed line + limit slicing", async () => {
		await writeFile(path.join(workspace, "b.txt"), "one\ntwo\nthree\nfour\n");
		const res = await readTextFile(workspace, { sessionId: SID, path: "b.txt", line: 2, limit: 2 });
		expect(res.content).toBe("two\nthree");
	});

	it("rejects a directory", async () => {
		await mkdir(path.join(workspace, "d"));
		await expect(readTextFile(workspace, { sessionId: SID, path: "d" })).rejects.toBeInstanceOf(
			AcpError,
		);
	});

	it("rejects files larger than 10 MB", async () => {
		// Create a sparse-ish file over 10 MB
		const bigPath = path.join(workspace, "big.bin");
		const chunk = "x".repeat(1024 * 1024); // 1 MB
		let content = "";
		for (let i = 0; i < 11; i++) content += chunk;
		await writeFile(bigPath, content);
		await expect(
			readTextFile(workspace, { sessionId: SID, path: "big.bin" }),
		).rejects.toBeInstanceOf(AcpError);
	});
});

describe("writeTextFile", () => {
	it("writes a file inside the workspace", async () => {
		await writeTextFile(workspace, { sessionId: SID, path: "out.txt", content: "hello" });
		const res = await readTextFile(workspace, { sessionId: SID, path: "out.txt" });
		expect(res.content).toBe("hello");
	});

	it("rejects a write that escapes the workspace", async () => {
		await expect(
			writeTextFile(workspace, { sessionId: SID, path: "../evil.txt", content: "pwn" }),
		).rejects.toBeInstanceOf(AcpError);
	});
});
