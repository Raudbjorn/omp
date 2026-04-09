import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { OmpLiveReloadController } from "../src/modes/omp-live-reload";

const testDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		testDirs.splice(0).map(async dir => {
			await fs.rm(dir, { recursive: true, force: true });
		}),
	);
});

async function createTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-live-reload-test-"));
	testDirs.push(dir);
	return dir;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await Bun.sleep(20);
	}
	throw new Error("Timed out waiting for watcher state");
}

describe("OMP live reload controller", () => {
	it("refreshes on command and skill file changes", async () => {
		const root = await createTempDir();
		const projectDir = path.join(root, "project");
		const userAgentDir = path.join(root, ".omp", "agent");
		const commandPath = path.join(projectDir, ".omp", "commands", "hello.md");
		const skillPath = path.join(projectDir, ".omp", "skills", "demo", "SKILL.md");
		await fs.mkdir(path.dirname(commandPath), { recursive: true });
		await fs.mkdir(path.dirname(skillPath), { recursive: true });
		await fs.mkdir(userAgentDir, { recursive: true });
		await fs.writeFile(skillPath, "# Skill\n");

		const refreshReasons: string[] = [];
		const controller = new OmpLiveReloadController(
			{
				onRefreshRequested: async reason => {
					refreshReasons.push(reason);
				},
				onErrorStateChanged: () => {},
			},
			{ mode: "omp", projectDir, userAgentDir },
		);

		await controller.configure({ mode: "omp", projectDir, userAgentDir });
		await fs.writeFile(commandPath, "# Command\n");
		await waitFor(() => refreshReasons.includes("commands"));

		refreshReasons.length = 0;
		await fs.writeFile(skillPath, "# Skill\nupdated\n");
		await waitFor(() => refreshReasons.includes("skills"));
		controller.dispose();
	});

	it("detects project .omp root creation mid-session", async () => {
		const root = await createTempDir();
		const projectDir = path.join(root, "project");
		const userAgentDir = path.join(root, ".omp", "agent");
		await fs.mkdir(projectDir, { recursive: true });
		await fs.mkdir(userAgentDir, { recursive: true });

		const refreshReasons: string[] = [];
		const controller = new OmpLiveReloadController(
			{
				onRefreshRequested: async reason => {
					refreshReasons.push(reason);
				},
				onErrorStateChanged: () => {},
			},
			{ mode: "omp", projectDir, userAgentDir },
		);

		await controller.configure({ mode: "omp", projectDir, userAgentDir });
		await fs.mkdir(path.join(projectDir, ".omp"), { recursive: true });
		await waitFor(() => refreshReasons.length > 0);
		expect(refreshReasons.length).toBeGreaterThan(0);
		controller.dispose();
	});

	it("ignores non-native root changes", async () => {
		const root = await createTempDir();
		const projectDir = path.join(root, "project");
		const userAgentDir = path.join(root, ".omp", "agent");
		await fs.mkdir(path.join(projectDir, ".omp", "commands"), { recursive: true });
		await fs.mkdir(userAgentDir, { recursive: true });

		let refreshCount = 0;
		const controller = new OmpLiveReloadController(
			{
				onRefreshRequested: async () => {
					refreshCount += 1;
				},
				onErrorStateChanged: () => {},
			},
			{ mode: "omp", projectDir, userAgentDir },
		);

		await controller.configure({ mode: "omp", projectDir, userAgentDir });
		await fs.mkdir(path.join(projectDir, ".claude", "commands"), { recursive: true });
		await fs.writeFile(path.join(projectDir, ".claude", "commands", "noop.md"), "# nope\n");
		await Bun.sleep(400);
		expect(refreshCount).toBe(0);
		controller.dispose();
	});

	it("keeps watcher failures visible until successful rebind", async () => {
		const root = await createTempDir();
		const projectDir = path.join(root, "project");
		const invalidUserAgentDir = path.join(root, "missing-parent", "agent");
		const validUserAgentDir = path.join(root, ".omp", "agent");
		await fs.mkdir(projectDir, { recursive: true });

		const errors: Array<string | undefined> = [];
		const controller = new OmpLiveReloadController(
			{
				onRefreshRequested: async () => {},
				onErrorStateChanged: message => {
					errors.push(message);
				},
			},
			{ mode: "omp", projectDir, userAgentDir: invalidUserAgentDir },
		);

		await controller.configure({ mode: "omp", projectDir, userAgentDir: invalidUserAgentDir });
		await waitFor(() => errors.some(message => typeof message === "string"));
		expect(errors.at(-1)).toContain("/reload");

		await fs.mkdir(validUserAgentDir, { recursive: true });
		await controller.configure({ mode: "omp", projectDir, userAgentDir: validUserAgentDir });
		await waitFor(() => errors.at(-1) === undefined);
		controller.dispose();
	});
});
