import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	deletePlanFile,
	formatPlansList,
	loadPlans,
	type PlanEntry,
	readPlanContents,
	resolvePlanArg,
} from "../../src/slash-commands/plans";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-plans-test-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writePlan(id: string, body: string, mtime?: Date): Promise<string> {
	const filePath = path.join(tmpDir, `${id}.md`);
	await fs.writeFile(filePath, body, { encoding: "utf8" });
	if (mtime) await fs.utimes(filePath, mtime, mtime);
	return filePath;
}

describe("loadPlans", () => {
	it("returns empty array when directory does not exist", async () => {
		const missing = path.join(tmpDir, "does-not-exist");
		expect(await loadPlans(missing)).toEqual([]);
	});

	it("returns empty array for empty directory", async () => {
		expect(await loadPlans(tmpDir)).toEqual([]);
	});

	it("skips non-markdown files", async () => {
		await fs.writeFile(path.join(tmpDir, "note.txt"), "ignored", { encoding: "utf8" });
		await fs.writeFile(path.join(tmpDir, "data.json"), "{}", { encoding: "utf8" });
		expect(await loadPlans(tmpDir)).toEqual([]);
	});

	it("extracts title from `# Plan: ` heading", async () => {
		await writePlan("my-plan", "# Plan: Build the thing\n\nBody here.");
		const plans = await loadPlans(tmpDir);
		expect(plans).toHaveLength(1);
		expect(plans[0]?.title).toBe("Build the thing");
		expect(plans[0]?.id).toBe("my-plan");
	});

	it("extracts title from plain `# ` heading", async () => {
		await writePlan("other-plan", "# A regular heading\n\nRest.");
		const plans = await loadPlans(tmpDir);
		expect(plans[0]?.title).toBe("A regular heading");
	});

	it("falls back to id when no heading is present", async () => {
		await writePlan("no-title", "Just some body text without headings.");
		const plans = await loadPlans(tmpDir);
		expect(plans[0]?.title).toBe("no-title");
	});

	it("sorts plans by modification time descending", async () => {
		const older = new Date("2026-01-01T00:00:00Z");
		const newer = new Date("2026-02-01T00:00:00Z");
		await writePlan("old", "# Old", older);
		await writePlan("new", "# New", newer);
		const plans = await loadPlans(tmpDir);
		expect(plans.map(p => p.id)).toEqual(["new", "old"]);
	});
});

describe("resolvePlanArg", () => {
	const plans: readonly PlanEntry[] = [
		{ id: "alpha", title: "Alpha", path: "/tmp/alpha.md", modified: new Date(), size: 10 },
		{ id: "beta", title: "Beta", path: "/tmp/beta.md", modified: new Date(), size: 20 },
	];

	it("resolves by 1-based index", () => {
		expect(resolvePlanArg(plans, "1")?.id).toBe("alpha");
		expect(resolvePlanArg(plans, "2")?.id).toBe("beta");
	});

	it("resolves by id string", () => {
		expect(resolvePlanArg(plans, "beta")?.id).toBe("beta");
	});

	it("returns null for out-of-range index", () => {
		expect(resolvePlanArg(plans, "0")).toBeNull();
		expect(resolvePlanArg(plans, "99")).toBeNull();
	});

	it("returns null for unknown id", () => {
		expect(resolvePlanArg(plans, "gamma")).toBeNull();
	});

	it("returns null for empty input", () => {
		expect(resolvePlanArg(plans, "")).toBeNull();
		expect(resolvePlanArg(plans, "   ")).toBeNull();
	});
});

describe("formatPlansList", () => {
	it("shows a helpful empty-state message", () => {
		const output = formatPlansList([]);
		expect(output).toContain("No saved plans");
		expect(output).toContain("*.md");
	});

	it("formats populated list with numbered entries and usage hint", () => {
		const plans: readonly PlanEntry[] = [
			{ id: "first-id", title: "First Plan", path: "/tmp/first.md", modified: new Date(), size: 10 },
			{ id: "second", title: "second", path: "/tmp/second.md", modified: new Date(), size: 20 },
		];
		const output = formatPlansList(plans);
		expect(output).toContain("Saved plans (2):");
		expect(output).toContain("1. First Plan");
		expect(output).toContain("id: first-id");
		expect(output).toContain("2. second");
		expect(output).not.toContain("id: second");
		expect(output).toContain("/plans load");
	});
});

describe("deletePlanFile + readPlanContents", () => {
	it("reads plan contents from disk", async () => {
		await writePlan("readme", "# Plan: Readable\n\nContent.");
		const [plan] = await loadPlans(tmpDir);
		expect(plan).toBeDefined();
		expect(await readPlanContents(plan!)).toContain("Readable");
	});

	it("deletes the plan file", async () => {
		await writePlan("to-delete", "# Plan: Gone soon");
		const [plan] = await loadPlans(tmpDir);
		expect(plan).toBeDefined();
		await deletePlanFile(plan!);
		expect(await loadPlans(tmpDir)).toEqual([]);
	});
});
