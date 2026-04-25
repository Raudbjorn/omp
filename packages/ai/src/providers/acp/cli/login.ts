import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AcpError } from "../errors";
import { hasExecutable } from "../auth-probe";

/**
 * Spawn an interactive `gemini` session with the TTY inherited so the user
 * can complete the OAuth flow via the `/auth` slash command. Resolves once
 * the subprocess exits; throws if the binary is missing or the credential
 * file wasn't produced.
 *
 * Older gemini-cli (≤ ~v0.30) supported `gemini auth login` as a subcommand;
 * v0.38+ removed it — positional args are now treated as initial-prompt
 * input ("Positional arguments now default to interactive mode"). The
 * supported way to authenticate is `/auth` from inside the interactive UI,
 * or the OAuth flow that fires automatically on first launch when
 * ~/.gemini/oauth_creds.json is missing.
 *
 * Callers must pause their TUI (raw mode, alternate screen) before
 * invoking; this function does not suspend/resume stdin state.
 */
export async function runGeminiCliAcpLogin(timeoutMs = 5 * 60 * 1000): Promise<void> {
	if (!(await hasExecutable("gemini"))) {
		throw new AcpError("binary_missing", "gemini CLI not found. Install: npm i -g @google/gemini-cli");
	}

	await new Promise<void>((resolve, reject) => {
		const child = spawn("gemini", [], { stdio: "inherit" });
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new AcpError("auth_required", `gemini interactive login timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.once("error", err => {
			clearTimeout(timer);
			reject(new AcpError("auth_required", `gemini failed to start: ${err.message}`));
		});
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			// Accept any clean exit (including the user quitting after /auth);
			// we verify success by checking the credentials file below.
			if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolve();
			else reject(new AcpError("auth_required", `gemini exited with code=${code} signal=${signal}`));
		});
	});

	const credsPath = join(homedir(), ".gemini", "oauth_creds.json");
	try {
		await stat(credsPath);
	} catch {
		throw new AcpError(
			"auth_required",
			`No credentials at ${credsPath}. Inside the gemini TUI, run /auth and complete the browser sign-in, then /quit.`,
		);
	}
}
