import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type * as schema from "@agentclientprotocol/sdk";
import { AcpError } from "./errors";

const MAX_READ_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Resolve `requested` relative to `workspaceRoot` and assert the final
 * (symlink-resolved) path stays within the workspace.
 *
 * Order matters: we must `realpath` AFTER joining, otherwise a relative path
 * like `notes/secret` that points at a symlink to `/etc/passwd` would pass
 * a prefix check on the unresolved path.
 */
export async function scopedPath(workspaceRoot: string, requested: string): Promise<string> {
	const absRoot = path.resolve(workspaceRoot);
	const resolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(absRoot, requested);

	let real: string;
	try {
		real = await fsp.realpath(resolved);
	} catch (err) {
		const errno = (err as NodeJS.ErrnoException).code;
		if (errno === "ENOENT") {
			// For writeTextFile we need to accept paths that don't exist yet;
			// resolve the parent and append the basename.
			const dir = path.dirname(resolved);
			const base = path.basename(resolved);
			const realDir = await fsp.realpath(dir).catch(() => {
				throw new AcpError("fs_escape", `Parent directory does not exist: ${dir}`, {
					context: { requested, resolved },
				});
			});
			real = path.join(realDir, base);
		} else {
			throw err;
		}
	}

	const relFromRoot = path.relative(absRoot, real);
	if (relFromRoot === "" || relFromRoot === ".") return real;
	if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
		throw new AcpError("fs_escape", `Path escapes workspace: ${requested}`, {
			context: { requested, resolved, real, workspaceRoot: absRoot },
		});
	}
	return real;
}

/**
 * Handle an ACP `fs/read_text_file` request.
 *
 * Per-spec:
 * - `line` and `limit` are 1-indexed (line numbers start at 1).
 * - The returned `content` is a string.
 *
 * We cap reads at 10 MB to avoid pulling arbitrarily large files into memory.
 */
export async function readTextFile(
	workspaceRoot: string,
	req: schema.ReadTextFileRequest,
): Promise<schema.ReadTextFileResponse> {
	const target = await scopedPath(workspaceRoot, req.path);
	const stat = await fsp.stat(target);
	if (stat.isDirectory()) {
		throw new AcpError("fs_escape", `Path is a directory: ${req.path}`);
	}
	if (stat.size > MAX_READ_BYTES) {
		throw new AcpError("fs_too_large", `File exceeds ${MAX_READ_BYTES} bytes: ${req.path}`, {
			context: { size: stat.size },
		});
	}

	const raw = await fsp.readFile(target, "utf8");

	let content = raw;
	const startLine = req.line ?? 1;
	const limit = req.limit ?? undefined;
	if (startLine !== 1 || limit !== undefined) {
		const lines = raw.split("\n");
		const startIdx = Math.max(0, startLine - 1);
		const endIdx = limit === undefined ? lines.length : Math.min(lines.length, startIdx + limit);
		content = lines.slice(startIdx, endIdx).join("\n");
	}

	return { content };
}

/**
 * Handle an ACP `fs/write_text_file` request.
 *
 * Non-atomic for MVP (plain `writeFile`). Directory is resolved through
 * `scopedPath` to catch escape attempts via symlinks in parents.
 */
export async function writeTextFile(
	workspaceRoot: string,
	req: schema.WriteTextFileRequest,
): Promise<schema.WriteTextFileResponse> {
	const target = await scopedPath(workspaceRoot, req.path);
	await fsp.writeFile(target, req.content, "utf8");
	return {};
}
