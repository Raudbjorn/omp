/**
 * OpenVINO login flow.
 *
 * OpenVINO exposes an OpenAI-compatible endpoint through either:
 *   - OpenVINO Model Server (OVMS) with a text-generation graph
 *   - openvino-genai `llm_pipeline.serve()` / FastAPI wrapper
 *
 * Usually runs unauthenticated; a bearer token can be configured upstream.
 * This flow stores an API-key-style credential used by `/login` and auth storage.
 */

import type { OAuthController, OAuthProvider } from "./types";

const PROVIDER_ID: OAuthProvider = "openvino";
export const DEFAULT_LOCAL_TOKEN = "openvino-local";

/**
 * Login to OpenVINO.
 *
 * Prompts for an optional token and returns a stored key value.
 */
export async function loginOpenvino(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_ID} login requires onPrompt callback`);
	}

	const apiKey = await options.onPrompt({
		message: "Optional: Paste OpenVINO API key (to customize endpoint, set OPENVINO_BASE_URL env var)",
		placeholder: DEFAULT_LOCAL_TOKEN,
		allowEmpty: true,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_LOCAL_TOKEN;
}
