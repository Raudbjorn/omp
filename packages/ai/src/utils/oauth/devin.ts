/**
 * Devin login flow — API key from docs.devin.ai.
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://docs.devin.ai/";

export async function loginDevin(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Devin login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Devin API key from your account settings.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Devin API key",
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
