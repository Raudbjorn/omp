import { registerOAuthProvider } from "../../utils/oauth";
import { geminiAdapter } from "./cli/gemini";
import { runGeminiCliAcpLogin } from "./cli/login";
import { registerAdapter, streamAcp } from "./stream";

// Register built-in adapters. Future CLI adapters (Claude Code, Copilot, Kiro)
// add an import + `registerAdapter(...)` call here — no changes to
// `stream.ts` or the rest of the module.
registerAdapter("gemini-cli-acp", geminiAdapter);

// Custom OAuth provider: login is delegated to an interactive `gemini`
// subprocess because credentials live in `~/.gemini/oauth_creds.json` managed
// by the gemini CLI itself. gemini-cli ≥ v0.38 removed the `auth login`
// subcommand — auth is now via the `/auth` slash command inside the TUI, or
// the OAuth flow that fires automatically when oauth_creds.json is missing.
// We store a sentinel api key so `/login` and `hasAuth` reflect the user's
// intent; the ACP adapter re-probes the credential file at spawn time.
const GEMINI_CLI_ACP_SENTINEL = "managed-by-gemini-cli";
registerOAuthProvider({
	id: "gemini-cli-acp",
	name: "Gemini CLI (ACP)",
	async login(callbacks) {
		callbacks.onProgress?.("Launching `gemini` interactively — run `/auth` to sign in, then `/quit`…");
		await runGeminiCliAcpLogin();
		callbacks.onProgress?.("gemini sign-in completed. Credentials stored in ~/.gemini/oauth_creds.json.");
		return GEMINI_CLI_ACP_SENTINEL;
	},
});

export { streamAcp };
export { registerAdapter } from "./stream";
export type { AcpAgentOptions, AcpConfig, AcpTimeouts } from "./stream";
export type { CliAdapter, AuthStatus } from "./cli/types";
export { AcpError } from "./errors";
export type { PermissionMode } from "./permissions";
export { makePermissionPolicy } from "./permissions";
export { runGeminiCliAcpLogin } from "./cli/login";
