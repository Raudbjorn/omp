import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AcpError } from "../errors";
import { hasExecutable } from "../auth-probe";

/**
 * Spawn `gemini auth login` with the TTY inherited so the user can complete
 * the browser OAuth flow interactively. Resolves once the subprocess exits;
 * throws if the binary is missing or the credential file wasn't produced.
 *
 * Callers must pause their TUI (raw mode, alternate screen) before invoking;
 * this function does not attempt to suspend/resume stdin state.
 */
export async function runGeminiCliAcpLogin(timeoutMs = 5 * 60 * 1000): Promise<void> {
	if (!(await hasExecutable("gemini"))) {
		throw new AcpError("binary_missing", "gemini CLI not found. Install: npm i -g @google/gemini-cli");
	}

	await new Promise<void>((resolve, reject) => {
		const child = spawn("gemini", ["auth", "login"], { stdio: "inherit" });
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new AcpError("auth_required", `gemini auth login timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.once("error", err => {
			clearTimeout(timer);
			reject(new AcpError("auth_required", `gemini auth login failed to start: ${err.message}`));
		});
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new AcpError("auth_required", `gemini auth login exited with code=${code} signal=${signal}`));
		});
	});

	const credsPath = join(homedir(), ".gemini", "oauth_creds.json");
	try {
		await stat(credsPath);
	} catch {
		throw new AcpError(
			"auth_required",
			`gemini auth login completed but no credentials found at ${credsPath}`,
		);
	}
}
