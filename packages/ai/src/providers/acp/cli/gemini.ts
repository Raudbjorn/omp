import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasExecutable } from "../auth-probe";
import type { AcpConfig } from "../stream";
import type { AuthStatus, CliAdapter } from "./types";

const INSTALL_HINT = "npm i -g @google/gemini-cli";

export const geminiAdapter: CliAdapter = {
	id: "gemini-cli-acp",
	displayName: "Gemini CLI (ACP)",
	binary: "gemini",
	installHint: INSTALL_HINT,
	loginCommand: ["gemini", "auth", "login"],

	async probeAuth(env: NodeJS.ProcessEnv): Promise<AuthStatus> {
		if (!(await hasExecutable("gemini"))) {
			return { kind: "missing", hint: INSTALL_HINT };
		}
		if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
			return { kind: "logged_in_api_key" };
		}
		const credsPath = join(homedir(), ".gemini", "oauth_creds.json");
		try {
			const creds = await stat(credsPath);
			return { kind: "logged_in_oauth", mtime: creds.mtime };
		} catch {
			return { kind: "logged_out", hint: "Run `gemini auth login`" };
		}
	},

	spawnArgs(config: AcpConfig): readonly string[] {
		const args: string[] = ["--experimental-acp"];
		if (config.model) {
			args.push("--model", config.model);
		}
		return args;
	},

	extraEnv(config: AcpConfig): Readonly<Record<string, string>> {
		return config.apiKey ? { GEMINI_API_KEY: config.apiKey } : {};
	},
};
