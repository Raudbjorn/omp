import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Check whether `bin` is on the current PATH (or resolves via `$PATH`). */
export async function hasExecutable(bin: string, timeoutMs = 2_000): Promise<boolean> {
	// Use `--version` to both confirm presence and rule out permission / exec errors.
	try {
		await execFileAsync(bin, ["--version"], { timeout: timeoutMs });
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return false;
		// Fall back to which/where-style resolution if --version is rejected
		// (some agents use `-v`, `-V`, etc). Treat a non-ENOENT error as "present".
		return true;
	}
}

/** Look up an executable in $PATH using node's path semantics. */
export function resolveOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const paths = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
	for (const dir of paths) {
		const candidate = path.join(dir, bin);
		try {
			// Best-effort stat-free check deferred to execFile; caller should use hasExecutable.
			return candidate;
		} catch {
			// continue
		}
	}
	return null;
}
