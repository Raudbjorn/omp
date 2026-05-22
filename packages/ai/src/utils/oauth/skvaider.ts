/**
 * Skvaider (Flying Circus AI gateway) login flow.
 *
 * Skvaider exposes an OpenAI-compatible API. Authentication is via a
 * static bearer token that can be provisioned from the gateway admin.
 */

import type { OAuthController, OAuthProvider } from "./types";

const PROVIDER_ID: OAuthProvider = "skvaider";
const AUTH_URL = "https://ai.dev.fcio.net/openai/v1";
const DEFAULT_BASE_URL = "https://ai.dev.fcio.net/openai/v1";
const DEFAULT_TOKEN = "skvaider-local";

/**
 * Login to Skvaider.
 *
 * Prompts for a bearer token. The token is used as `Authorization: Bearer <token>`.
 */
export async function loginSkvaider(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_ID} login requires onPrompt callback`);
	}
	options.onAuth?.({
		url: AUTH_URL,
		instructions: `Paste your Skvaider API token (bearer token from the gateway admin).\n\nTo use a custom endpoint, set SKVAIDER_BASE_URL env var before login. Default: ${DEFAULT_BASE_URL}`,
	});
	const apiKey = await options.onPrompt({
		message: "Paste your Skvaider API token",
		placeholder: DEFAULT_TOKEN,
		allowEmpty: true,
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_TOKEN;
}
