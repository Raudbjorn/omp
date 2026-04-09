import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { reset as resetCapabilities } from "../src/capability";
import { expandSlashCommand, type FileSlashCommand, loadSlashCommands } from "../src/extensibility/slash-commands";

function createCommand(overrides: Partial<FileSlashCommand> = {}): FileSlashCommand {
	return {
		name: "demo",
		description: "Demo command",
		content: "",
		source: "test",
		...overrides,
	};
}

describe("native slash command shell interpolation", () => {
	it("executes rendered shell expressions only for native commands", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-slash-shell-"));
		try {
			const nativeCommand = createCommand({
				content: "{{#if (lookup args 0)}}!`printf rendered`{{else}}fallback{{/if}}",
				_source: { provider: "native", providerName: "OMP", path: "/tmp/demo.md", level: "project" },
			});

			expect(await expandSlashCommand("/demo yes", [nativeCommand], { cwd })).toBe("rendered");
			expect(await expandSlashCommand("/demo", [nativeCommand], { cwd })).toBe("fallback");
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("leaves non-native command sources literal even when they contain shell syntax", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-slash-shell-"));
		try {
			const importedCommand = createCommand({
				content: "Literal !`false`",
				_source: { provider: "claude", providerName: "Claude", path: "/tmp/demo.md", level: "project" },
			});

			expect(await expandSlashCommand("/demo", [importedCommand], { cwd })).toBe("Literal !`false`");
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("keeps command frontmatter literal by expanding only the parsed body", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-slash-shell-"));
		try {
			const commandsDir = path.join(cwd, ".omp", "commands");
			await fs.mkdir(commandsDir, { recursive: true });
			await Bun.write(
				path.join(commandsDir, "frontmatter.md"),
				'---\ndescription: "!`false`"\n---\nBody stays literal',
			);

			const commands = await loadSlashCommands({ cwd });
			const frontmatterCommand = commands.find(command => command.name === "frontmatter");
			expect(frontmatterCommand).toBeDefined();
			expect(await expandSlashCommand("/frontmatter", [frontmatterCommand!], { cwd })).toBe("Body stays literal");
		} finally {
			resetCapabilities();
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("reloads edited markdown command content after a capability cache reset", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-slash-reload-"));
		try {
			const commandsDir = path.join(cwd, ".omp", "commands");
			const commandPath = path.join(commandsDir, "reloadable.md");
			await fs.mkdir(commandsDir, { recursive: true });
			await Bun.write(commandPath, "---\ndescription: Old description\n---\nOld body");

			const initial = (await loadSlashCommands({ cwd })).find(command => command.name === "reloadable");
			expect(initial).toEqual(expect.objectContaining({ description: "Old description", content: "Old body" }));

			await Bun.write(commandPath, "---\ndescription: New description\n---\nNew body");

			const stale = (await loadSlashCommands({ cwd })).find(command => command.name === "reloadable");
			expect(stale).toEqual(expect.objectContaining({ description: "Old description", content: "Old body" }));

			resetCapabilities();

			const refreshed = (await loadSlashCommands({ cwd })).find(command => command.name === "reloadable");
			expect(refreshed).toEqual(expect.objectContaining({ description: "New description", content: "New body" }));
		} finally {
			resetCapabilities();
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});
});
