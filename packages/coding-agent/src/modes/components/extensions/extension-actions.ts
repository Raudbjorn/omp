import * as fs from "node:fs/promises";
import * as path from "node:path";
import { invalidate } from "../../../capability";
import { SOURCE_PATHS, type SourceId } from "../../../discovery/helpers";
import type { Extension, ExtensionKind } from "./types";

export interface ActionResult {
	ok: boolean;
	error?: string;
}
export interface MoveTarget {
	label: string;
	provider: string;
	scope: "user" | "project";
	targetDir: string;
	current?: boolean;
}

const KIND_DIRS: Partial<Record<ExtensionKind, string>> = {
	skill: "skills",
	rule: "rules",
	prompt: "prompts",
	"slash-command": "commands",
	instruction: "instructions",
	hook: "hooks",
	tool: "tools",
	"extension-module": "extensions",
};

export { KIND_DIRS };

export async function deleteExtension(ext: Extension): Promise<ActionResult> {
	try {
		if (ext.source.level === "native") {
			return { ok: false, error: "Cannot delete native extensions" };
		}

		try {
			await fs.access(ext.path);
		} catch {
			return { ok: false, error: "File not found" };
		}

		if (ext.kind === "mcp") {
			const raw = await fs.readFile(ext.path, "utf-8");
			const json = JSON.parse(raw) as Record<string, unknown>;

			const serversKey = "mcpServers" in json ? "mcpServers" : "servers" in json ? "servers" : null;
			if (serversKey !== null) {
				const servers = json[serversKey] as Record<string, unknown>;
				delete servers[ext.name];

				const serversEmpty = Object.keys(servers).length === 0;
				const otherKeys = Object.keys(json).filter(k => k !== serversKey);
				if (serversEmpty && otherKeys.length === 0) {
					await fs.unlink(ext.path);
				} else {
					if (serversEmpty) {
						delete json[serversKey];
					}
					await fs.writeFile(ext.path, JSON.stringify(json, null, 2), "utf-8");
				}
			}
		} else if (ext.kind === "tool" || ext.kind === "extension-module") {
			const stat = await fs.stat(ext.path);
			if (stat.isDirectory()) {
				await fs.rm(ext.path, { recursive: true, force: true });
			} else {
				await fs.unlink(ext.path);
			}
		} else if (ext.kind === "skill") {
			// Skills are directories containing SKILL.md + supplementary files
			const skillDir = path.dirname(ext.path);
			await fs.rm(skillDir, { recursive: true, force: true });
		} else {
			await fs.unlink(ext.path);
		}

		invalidate(ext.path);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/**
 * Build valid move targets for an extension across all provider directories.
 * Excludes the extension's current directory.
 */
export function getMoveTargets(ext: Extension, cwd: string, homeDir: string): MoveTarget[] {
	const targets: MoveTarget[] = [];
	const kindDir = KIND_DIRS[ext.kind];

	for (const [providerId, paths] of Object.entries(SOURCE_PATHS) as [SourceId, (typeof SOURCE_PATHS)[SourceId]][]) {
		if (ext.kind === "mcp") {
			// MCP: target is the provider directory containing mcp.json
			if (paths.projectDir) {
				const targetDir = path.join(cwd, paths.projectDir);
				targets.push({
					label: `${providerId} Project (${paths.projectDir}/mcp.json)`,
					provider: providerId,
					scope: "project",
					targetDir,
				});
			}
			if (paths.userAgent) {
				const targetDir = path.join(homeDir, paths.userAgent);
				targets.push({
					label: `${providerId} User (~/${paths.userAgent}/mcp.json)`,
					provider: providerId,
					scope: "user",
					targetDir,
				});
			}
		} else if (kindDir) {
			if (paths.projectDir) {
				const targetDir = path.join(cwd, paths.projectDir, kindDir);
				targets.push({
					label: `${providerId} Project (${paths.projectDir}/${kindDir}/)`,
					provider: providerId,
					scope: "project",
					targetDir,
				});
			}
			if (paths.userAgent) {
				const targetDir = path.join(homeDir, paths.userAgent, kindDir);
				targets.push({
					label: `${providerId} User (~/${paths.userAgent}/${kindDir}/)`,
					provider: providerId,
					scope: "user",
					targetDir,
				});
			}
		}
	}

	// Mark current location instead of filtering it out
	const currentDir = ext.kind === "skill" ? path.dirname(path.dirname(ext.path)) : path.dirname(ext.path);
	for (const t of targets) {
		if (t.targetDir === currentDir) t.current = true;
	}
	return targets;
}

/**
 * Move an extension to a new directory.
 * For MCP: transfers the server entry between JSON config files.
 * For files/dirs: moves with EXDEV fallback (copy + unlink).
 */
export async function moveExtension(ext: Extension, targetDir: string): Promise<ActionResult> {
	try {
		if (ext.source.level === "native") {
			return { ok: false, error: "Cannot move native extensions" };
		}

		try {
			await fs.access(ext.path);
		} catch {
			return { ok: false, error: "Source file not found" };
		}

		if (ext.kind === "mcp") {
			return await moveMcpEntry(ext, targetDir);
		}
		// Skills live in directories — move the whole directory
		if (ext.kind === "skill") {
			const skillDir = path.dirname(ext.path);
			const dirName = path.basename(skillDir);
			const newPath = path.join(targetDir, dirName);
			await fs.mkdir(targetDir, { recursive: true });
			try {
				await fs.rename(skillDir, newPath);
			} catch (err: unknown) {
				if ((err as NodeJS.ErrnoException).code === "EXDEV") {
					await fs.cp(skillDir, newPath, { recursive: true });
					await fs.rm(skillDir, { recursive: true, force: true });
				} else {
					throw err;
				}
			}
			invalidate(skillDir);
			invalidate(newPath);
			return { ok: true };
		}

		// File-based: move the single file
		await fs.mkdir(targetDir, { recursive: true });
		const basename = path.basename(ext.path);
		const newPath = path.join(targetDir, basename);

		try {
			await fs.rename(ext.path, newPath);
		} catch (err: unknown) {
			if ((err as NodeJS.ErrnoException).code === "EXDEV") {
				await fs.copyFile(ext.path, newPath);
				await fs.unlink(ext.path);
			} else {
				throw err;
			}
		}

		invalidate(ext.path);
		invalidate(newPath);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/** Transfer an MCP server entry from one JSON config to another. */
async function moveMcpEntry(ext: Extension, targetDir: string): Promise<ActionResult> {
	// Read source config
	const srcRaw = await fs.readFile(ext.path, "utf-8");
	const srcJson = JSON.parse(srcRaw) as Record<string, unknown>;
	const srcKey = "mcpServers" in srcJson ? "mcpServers" : "servers" in srcJson ? "servers" : null;
	if (!srcKey) return { ok: false, error: "Cannot find servers key in source config" };

	const srcServers = srcJson[srcKey] as Record<string, unknown>;
	const entry = srcServers[ext.name];
	if (entry === undefined) return { ok: false, error: `Server "${ext.name}" not found in source config` };

	// Determine target mcp.json path
	await fs.mkdir(targetDir, { recursive: true });
	const targetPath = path.join(targetDir, "mcp.json");

	// Read or create target config
	let destJson: Record<string, unknown> = {};
	try {
		const destRaw = await fs.readFile(targetPath, "utf-8");
		destJson = JSON.parse(destRaw) as Record<string, unknown>;
	} catch {
		// File doesn't exist yet, start fresh
	}

	// Use same key convention as target, or default to mcpServers
	const destKey = "mcpServers" in destJson ? "mcpServers" : "servers" in destJson ? "servers" : "mcpServers";
	if (!destJson[destKey]) destJson[destKey] = {};
	(destJson[destKey] as Record<string, unknown>)[ext.name] = entry;

	// Write target
	await fs.writeFile(targetPath, JSON.stringify(destJson, null, 2), "utf-8");

	// Remove from source
	delete srcServers[ext.name];
	const srcServersEmpty = Object.keys(srcServers).length === 0;
	const otherKeys = Object.keys(srcJson).filter(k => k !== srcKey);
	if (srcServersEmpty && otherKeys.length === 0) {
		await fs.unlink(ext.path);
	} else {
		if (srcServersEmpty) delete srcJson[srcKey];
		await fs.writeFile(ext.path, JSON.stringify(srcJson, null, 2), "utf-8");
	}

	invalidate(ext.path);
	invalidate(targetPath);
	return { ok: true };
}

/**
 * Rename an extension (file, directory, or MCP key).
 * Preserves file extension for file-based kinds.
 */
export async function renameExtension(ext: Extension, newName: string): Promise<ActionResult> {
	try {
		if (ext.source.level === "native") {
			return { ok: false, error: "Cannot rename native extensions" };
		}
		if (ext.kind === "context-file") {
			return { ok: false, error: "Context files have fixed names" };
		}

		// Validate name
		if (!newName || newName.includes("/") || newName.includes("\\")) {
			return { ok: false, error: "Invalid name: must not contain path separators" };
		}
		if (newName === ext.name) {
			return { ok: true }; // No-op
		}

		try {
			await fs.access(ext.path);
		} catch {
			return { ok: false, error: "Source file not found" };
		}

		if (ext.kind === "mcp") {
			return await renameMcpEntry(ext, newName);
		}
		// Skills live in directories (skills/<name>/SKILL.md).
		// Rename the parent directory and update frontmatter name.
		if (ext.kind === "skill") {
			const skillDir = path.dirname(ext.path);
			const parentDir = path.dirname(skillDir);
			const newDir = path.join(parentDir, newName);
			await fs.rename(skillDir, newDir);

			// Update frontmatter name field so discovery picks up the new name
			const newSkillPath = path.join(newDir, path.basename(ext.path));
			try {
				const content = await fs.readFile(newSkillPath, "utf-8");
				const updated = updateFrontmatterName(content, newName);
				if (updated !== content) {
					await fs.writeFile(newSkillPath, updated, "utf-8");
				}
			} catch {
				// Directory renamed successfully; frontmatter update is best-effort
			}

			invalidate(skillDir);
			invalidate(newDir);
			return { ok: true };
		}

		// File-based: rename preserving extension
		const dir = path.dirname(ext.path);
		const extname = path.extname(ext.path);
		const newPath = newName.endsWith(extname) ? path.join(dir, newName) : path.join(dir, newName + extname);

		await fs.rename(ext.path, newPath);
		invalidate(ext.path);
		invalidate(newPath);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/** Rename an MCP server key in its JSON config. */
async function renameMcpEntry(ext: Extension, newName: string): Promise<ActionResult> {
	const raw = await fs.readFile(ext.path, "utf-8");
	const json = JSON.parse(raw) as Record<string, unknown>;
	const serversKey = "mcpServers" in json ? "mcpServers" : "servers" in json ? "servers" : null;
	if (!serversKey) return { ok: false, error: "Cannot find servers key in config" };

	const servers = json[serversKey] as Record<string, unknown>;
	if (!(ext.name in servers)) return { ok: false, error: `Server "${ext.name}" not found` };
	if (newName in servers) return { ok: false, error: `Server "${newName}" already exists` };

	// Preserve insertion order: rebuild with renamed key in same position
	const rebuilt: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(servers)) {
		rebuilt[key === ext.name ? newName : key] = value;
	}
	json[serversKey] = rebuilt;

	await fs.writeFile(ext.path, JSON.stringify(json, null, 2), "utf-8");
	invalidate(ext.path);
	return { ok: true };
}

/** Replace the `name:` field in YAML frontmatter (between --- delimiters). */
function updateFrontmatterName(content: string, newName: string): string {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return content;
	const frontmatter = match[1];
	const updated = frontmatter.replace(/^name:\s*.+$/m, `name: ${newName}`);
	if (updated === frontmatter) return content; // no name field found
	return content.replace(match[0], `---\n${updated}\n---`);
}
