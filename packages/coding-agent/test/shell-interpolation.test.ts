import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { interpolateShellExpressions } from "../src/extensibility/shell-interpolation";

describe("interpolateShellExpressions", () => {
	it("expands one valid single-line expression and trims exactly one trailing newline", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-interpolation-"));
		try {
			const result = await interpolateShellExpressions({
				body: "Start !`printf 'alpha\\nbeta\\n'` End",
				cwd,
				sourceLabel: "/demo",
			});

			expect(result).toBe("Start alpha\nbeta End");
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("expands multiple expressions independently in left-to-right order", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-interpolation-"));
		try {
			const result = await interpolateShellExpressions({
				body: "Order !`printf first >> sequence.txt; cat sequence.txt` then !`printf second >> sequence.txt; cat sequence.txt` done",
				cwd,
				sourceLabel: "/demo",
			});

			expect(result).toBe("Order first then firstsecond done");
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("rejects expressions with a missing closing backtick", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-interpolation-"));
		try {
			await expect(
				interpolateShellExpressions({
					body: "Broken !`printf nope",
					cwd,
					sourceLabel: "/demo",
				}),
			).rejects.toThrow(
				"Malformed shell interpolation in /demo for command `printf nope`: missing closing backtick before end of line",
			);
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("rejects expressions that cross a newline before the closing backtick", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-interpolation-"));
		try {
			await expect(
				interpolateShellExpressions({
					body: "Broken !`printf nope\nstill broken`",
					cwd,
					sourceLabel: "/demo",
				}),
			).rejects.toThrow(
				"Malformed shell interpolation in /demo for command `printf nope`: missing closing backtick before end of line",
			);
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("surfaces non-zero exit failures with the source label and command text", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-interpolation-"));
		try {
			await expect(
				interpolateShellExpressions({
					body: "Broken !`false`",
					cwd,
					sourceLabel: "/demo",
				}),
			).rejects.toThrow("Shell interpolation failed in /demo for command `false`: command exited with code 1");
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});
});
