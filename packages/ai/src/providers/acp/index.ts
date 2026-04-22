import { registerOAuthProvider } from "../../utils/oauth";
import { geminiAdapter } from "./cli/gemini";
import { runGeminiCliAcpLogin } from "./cli/login";
import { registerAdapter, streamAcp } from "./stream";

// Register built-in adapters. Future CLI adapters (Claude Code, Copilot, Kiro)
// add an import + `registerAdapter(...)` call here — no changes to
// `stream.ts` or the rest of the module.
registerAdapter("gemini-cli-acp", geminiAdapter);

// Custom OAuth provider: login is delegated to a subprocess (`gemini auth login`)
// because credentials live in `~/.gemini/oauth_creds.json` managed by the gemini
// CLI itself. We store a sentinel api key so `/login` and `hasAuth` reflect the
// user's intent; the ACP adapter re-probes the credential file at spawn time.
const GEMINI_CLI_ACP_SENTINEL = "managed-by-gemini-cli";
registerOAuthProvider({
	id: "gemini-cli-acp",
	name: "Gemini CLI (ACP)",
	async login(callbacks) {
		callbacks.onProgress?.("Launching `gemini auth login` in the terminal…");
		await runGeminiCliAcpLogin();
		callbacks.onProgress?.("gemini auth login completed. Credentials stored in ~/.gemini/oauth_creds.json.");
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
