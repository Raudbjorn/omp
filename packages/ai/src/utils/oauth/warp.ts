/**
 * Warp login flow — team API key from Warp platform settings.
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://docs.warp.dev/agent-platform/cloud-agents/team-access-billing-and-identity";

export async function loginWarp(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Warp login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Warp team API key from the Settings > Platform page.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Warp team API key",
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
