import { once } from "@oh-my-pi/pi-utils";
import type { ModelManagerOptions } from "../model-manager";
import { fetchCodexModels } from "../utils/discovery/codex";
import { fetchOpenAICompatibleModels } from "../utils/discovery/openai-compatible";

// ---------------------------------------------------------------------------
// OpenAI Codex
// ---------------------------------------------------------------------------

export interface OpenAICodexModelManagerConfig {
	accessToken?: string;
	accountId?: string;
	clientVersion?: string;
}

export function openaiCodexModelManagerOptions(
	config: OpenAICodexModelManagerConfig = {},
): ModelManagerOptions<"openai-codex-responses"> {
	const { accessToken, accountId, clientVersion } = config;
	return {
		providerId: "openai-codex",
		...(accessToken
			? {
					fetchDynamicModels: async () => {
						const result = await fetchCodexModels({ accessToken, accountId, clientVersion });
						return result?.models ?? null;
					},
				}
			: undefined),
	};
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface CursorModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
	clientVersion?: string;
}

export function cursorModelManagerOptions(config: CursorModelManagerConfig = {}): ModelManagerOptions<"cursor-agent"> {
	const { apiKey, baseUrl, clientVersion } = config;
	return {
		providerId: "cursor",
		...(apiKey
			? {
					fetchDynamicModels: async () => {
						const { fetchCursorUsableModels } = await cursorDiscovery();
						return fetchCursorUsableModels({ apiKey, baseUrl, clientVersion });
					},
				}
			: undefined),
	};
}

const cursorDiscovery = once(() => import("../utils/discovery/cursor"));

// ---------------------------------------------------------------------------
// Zai
// ---------------------------------------------------------------------------

export interface ZaiModelManagerConfig {}

export function zaiModelManagerOptions(_config: ZaiModelManagerConfig = {}): ModelManagerOptions<"anthropic-messages"> {
	return { providerId: "zai" };
}

// ---------------------------------------------------------------------------
// Xiaomi MiMo Coding Plan
// ---------------------------------------------------------------------------

export interface MimoCodeModelManagerConfig {
	apiKey?: string;
	baseUrl?: string;
}

export function mimoCodeModelManagerOptions(
	config: MimoCodeModelManagerConfig = {},
): ModelManagerOptions<"openai-completions"> {
	const { apiKey, baseUrl } = config;
	return {
		providerId: "mimo-code",
		fetchDynamicModels: () =>
			fetchOpenAICompatibleModels({
				api: "openai-completions",
				provider: "mimo-code",
				baseUrl: baseUrl ?? "https://token-plan-ams.xiaomimimo.com/v1",
				apiKey,
				mapModel: (_entry, defaults) => ({
					...defaults,
					contextWindow: 1_048_576,
					maxTokens: 131_072,
				}),
			}),
	};
}
