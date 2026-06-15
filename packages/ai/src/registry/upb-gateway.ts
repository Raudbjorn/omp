/**
 * UPB AI Gateway login flow.
 *
 * The UPB (Universität Paderborn) AI Gateway is a LiteLLM-based proxy at
 * https://ai-gateway.uni-paderborn.de/v1 that routes to OpenAI, GWDG, and
 * UPB PC2 compute backends.
 *
 * This is a simple API key flow — not OAuth.
 * Keys are issued via the UPB AI-Chat portal at https://ai-chat.uni-paderborn.de
 */

import type { OAuthController, OAuthLoginCallbacks } from "./oauth/types";
import type { ProviderDefinition } from "./types";

const PORTAL_URL = "https://ai-chat.uni-paderborn.de";

/**
 * Login to the UPB AI Gateway.
 *
 * Opens browser to the UPB AI-Chat portal, prompts user to paste their API key.
 * Returns the API key directly.
 */
export async function loginUPBGateway(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("UPB Gateway login requires onPrompt callback");
	}

	options.onAuth?.({
		url: PORTAL_URL,
		instructions:
			"Log in to the UPB AI-Chat portal, go to Settings → Account → API Keys, and create or copy your key",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your UPB AI Gateway API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	return trimmed;
}

export const upbGatewayProvider = {
	id: "upb-gateway",
	name: "UPB AI Gateway",
	envKeys: "UPB_GATEWAY_API_KEY",
	login: (cb: OAuthLoginCallbacks) => loginUPBGateway(cb),
} as const satisfies ProviderDefinition;
