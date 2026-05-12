/**
 * IPEX-LLM login flow.
 *
 * IPEX-LLM (Intel PyTorch Extension for LLM) serves XPU-accelerated models
 * over an OpenAI-compatible endpoint. Typical launch:
 *   python -m ipex_llm.serving.fastchat.vllm_worker --port 8000 ...
 *   python -m ipex_llm.serving.fastapi.openai_api_server --port 8000 ...
 *
 * Usually runs unauthenticated; a bearer token can be configured upstream.
 * This flow stores an API-key-style credential used by `/login` and auth storage.
 */

import type { OAuthController, OAuthProvider } from "./types";

const PROVIDER_ID: OAuthProvider = "ipex-llm";
export const DEFAULT_LOCAL_TOKEN = "ipex-llm-local";

/**
 * Login to IPEX-LLM.
 *
 * Prompts for an optional token and returns a stored key value.
 */
export async function loginIpexLlm(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_ID} login requires onPrompt callback`);
	}

	const apiKey = await options.onPrompt({
		message: "Optional: Paste IPEX-LLM API key (to customize endpoint, set IPEX_LLM_BASE_URL env var)",
		placeholder: DEFAULT_LOCAL_TOKEN,
		allowEmpty: true,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_LOCAL_TOKEN;
}
