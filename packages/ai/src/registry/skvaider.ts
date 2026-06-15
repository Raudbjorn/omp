/**
 * Skvaider (Flying Circus AI gateway) login flow.
 *
 * Skvaider exposes an OpenAI-compatible API. Authentication is via a
 * static bearer token that can be provisioned from the gateway admin.
 */

import type { OAuthController, OAuthLoginCallbacks } from "./oauth/types";
import type { ProviderDefinition } from "./types";

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
		throw new Error("skvaider login requires onPrompt callback");
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

export const skvaiderProvider = {
	id: "skvaider",
	name: "Skvaider",
	envKeys: "SKVAIDER_API_KEY",
	login: (cb: OAuthLoginCallbacks) => loginSkvaider(cb),
} as const satisfies ProviderDefinition;
