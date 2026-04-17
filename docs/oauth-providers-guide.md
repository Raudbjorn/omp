# oh-my-pi Authentication and API Providers Guide

This document details the exact code implementations for every supported AI provider in `oh-my-pi`.
It covers both how they authenticate (via `packages/ai/src/utils/oauth`) and how they actually execute model calls and streaming (via `packages/ai/src/providers`).


## QIANFAN

### Authentication Implementation (`qianfan.ts`)

```typescript
/**
 * Qianfan login flow.
 *
 * Qianfan provides an OpenAI-compatible API endpoint.
 * Login is API-key based:
 * 1. Open browser to Qianfan API key console
 * 2. User copies API key
 * 3. User pastes key into CLI prompt
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://console.bce.baidu.com/qianfan/ais/console/apiKey";
const API_BASE_URL = "https://qianfan.baidubce.com/v2";
const VALIDATION_MODEL = "deepseek-v3.2";

/**
 * Login to Qianfan.
 *
 * Opens browser to API key page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginQianfan(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Qianfan login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Qianfan API key from the console",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Qianfan API key",
		placeholder: "bce-v3/ALTAK-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "qianfan",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## XIAOMI

### Authentication Implementation (`xiaomi.ts`)

```typescript
/**
 * Xiaomi MiMo login flow.
 *
 * Xiaomi MiMo provides Anthropic-compatible models via
 * https://api.xiaomimimo.com/anthropic.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Xiaomi MiMo API key console
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import type { OAuthController } from "./types";

const PROVIDER_ID = "xiaomi";
const PROVIDER_NAME = "Xiaomi MiMo";
const AUTH_URL = "https://platform.xiaomimimo.com/#/console/api-keys";
const API_BASE_URL = "https://api.xiaomimimo.com/anthropic";
const VALIDATION_MODEL = "mimo-v2-flash";
const ANTHROPIC_VERSION = "2023-06-01";
const VALIDATION_TIMEOUT_MS = 15_000;

async function validateXiaomiApiKey(apiKey: string, signal?: AbortSignal): Promise<void> {
	const timeoutSignal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
	const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

	const response = await fetch(`${API_BASE_URL}/v1/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": ANTHROPIC_VERSION,
		},
		body: JSON.stringify({
			model: VALIDATION_MODEL,
			max_tokens: 1,
			messages: [{ role: "user", content: "ping" }],
		}),
		signal: requestSignal,
	});

	if (response.ok) {
		return;
	}

	let details = "";
	try {
		details = (await response.text()).trim();
	} catch {
		// ignore body parse errors, status is enough
	}

	const message = details
		? `${PROVIDER_NAME} API key validation failed (${response.status}): ${details}`
		: `${PROVIDER_NAME} API key validation failed (${response.status})`;
	throw new Error(message);
}

/**
 * Login to Xiaomi MiMo.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginXiaomi(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_NAME} login requires onPrompt callback`);
	}
	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Xiaomi MiMo console",
	});
	const apiKey = await options.onPrompt({
		message: "Paste your Xiaomi API key",
		placeholder: "sk-...",
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.(`Validating ${PROVIDER_ID} API key...`);
	await validateXiaomiApiKey(trimmed, options.signal);
	return trimmed;
}

```


## VENICE

### Authentication Implementation (`venice.ts`)

```typescript
/**
 * Venice login flow.
 *
 * Venice provides OpenAI-compatible models via https://api.venice.ai/api/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Venice API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://venice.ai/settings/api";
const API_BASE_URL = "https://api.venice.ai/api/v1";
const VALIDATION_MODEL = "qwen3-4b";

/**
 * Login to Venice.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginVenice(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Venice login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Venice dashboard",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Venice API key",
		placeholder: "vapi_...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Venice",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## QWEN-PORTAL

### Authentication Implementation (`qwen-portal.ts`)

```typescript
/**
 * Qwen Portal login flow.
 *
 * Qwen Portal exposes an OpenAI-compatible endpoint at https://portal.qwen.ai/v1
 * and accepts OAuth bearer tokens or API keys.
 *
 * This is a token/API-key flow:
 * 1. Open Qwen Portal
 * 2. Copy either your OAuth token or API key
 * 3. Paste it into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://chat.qwen.ai";
const API_BASE_URL = "https://portal.qwen.ai/v1";
const VALIDATION_MODEL = "coder-model";

/**
 * Login to Qwen Portal.
 *
 * Prompts for either `QWEN_OAUTH_TOKEN` or `QWEN_PORTAL_API_KEY` value.
 * Returns the value directly (stored as api_key credential in auth storage).
 */
export async function loginQwenPortal(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Qwen Portal login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Qwen OAuth token or API key",
	});

	const token = await options.onPrompt({
		message: "Paste your Qwen OAuth token or API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = token.trim();
	if (!trimmed) {
		throw new Error("Qwen token/API key is required");
	}

	options.onProgress?.("Validating credentials...");
	await validateOpenAICompatibleApiKey({
		provider: "qwen-portal",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## OLLAMA

### Authentication Implementation (`ollama.ts`)

```typescript
/**
 * Ollama login flow.
 *
 * Ollama is typically used locally without authentication, but some hosted
 * deployments require a bearer token/API key.
 *
 * This flow is API-key based (not OAuth):
 * 1. Optionally open Ollama docs
 * 2. Prompt user for API key/token (optional)
 * 3. Persist key only when provided
 */

import type { OAuthController } from "./types";

const OLLAMA_DOCS_URL = "https://github.com/ollama/ollama/blob/main/docs/api.md";

/**
 * Login to Ollama.
 *
 * Returns a trimmed API key/token string. Empty string means local no-auth mode.
 */
export async function loginOllama(options: OAuthController): Promise<string> {
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	if (!options.onPrompt) {
		return "";
	}

	options.onAuth?.({
		url: OLLAMA_DOCS_URL,
		instructions:
			"Optional: paste an Ollama API key/token for authenticated hosts. Leave empty for local no-auth mode.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Ollama API key/token (optional)",
		placeholder: "ollama-local",
		allowEmpty: true,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	return apiKey.trim();
}

```


## CLOUDFLARE-AI-GATEWAY

### Authentication Implementation (`cloudflare-ai-gateway.ts`)

```typescript
/**
 * Cloudflare AI Gateway login flow.
 *
 * Cloudflare AI Gateway proxies upstream model providers.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open Cloudflare AI Gateway docs/dashboard
 * 2. User copies their Cloudflare AI Gateway token/API key
 * 3. User pastes the API key into the CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://developers.cloudflare.com/ai-gateway/configuration/authentication/";

/**
 * Login to Cloudflare AI Gateway.
 *
 * Opens browser to Cloudflare AI Gateway authentication docs and prompts for a gateway token/API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginCloudflareAiGateway(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Cloudflare AI Gateway login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions:
			"Copy your Cloudflare AI Gateway token/API key. Configure account/gateway base URL in models config.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Cloudflare AI Gateway token/API key",
		placeholder: "cf-aig-...",
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

```


## SYNTHETIC

### Authentication Implementation (`synthetic.ts`)

```typescript
/**
 * Synthetic login flow.
 *
 * Synthetic provides OpenAI-compatible and Anthropic-compatible APIs via
 * https://api.synthetic.new/openai/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Synthetic dashboard
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://dev.synthetic.new/docs/api/overview";
const API_BASE_URL = "https://api.synthetic.new/openai/v1";
const VALIDATION_MODEL = "hf:moonshotai/Kimi-K2.5";

/**
 * Login to Synthetic.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginSynthetic(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Synthetic login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Synthetic dashboard",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Synthetic API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Synthetic",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```

### Provider API Implementation (`synthetic.ts`)

```typescript
/**
 * Synthetic provider - wraps OpenAI or Anthropic API based on format setting.
 *
 * Synthetic offers both OpenAI-compatible and Anthropic-compatible APIs:
 * - OpenAI: https://api.synthetic.new/openai/v1/chat/completions
 * - Anthropic: https://api.synthetic.new/anthropic/v1/messages
 *
 * @see https://dev.synthetic.new/docs/api/overview
 */

import { ANTHROPIC_THINKING } from "../stream";
import type { Api, Context, Model, SimpleStreamOptions } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { streamAnthropic } from "./anthropic";
import { streamOpenAICompletions } from "./openai-completions";

export type SyntheticApiFormat = "openai" | "anthropic";

const SYNTHETIC_NEW_BASE_URL = "https://api.synthetic.new/openai/v1";
const SYNTHETIC_NEW_ANTHROPIC_BASE_URL = "https://api.synthetic.new/anthropic";

export interface SyntheticOptions extends SimpleStreamOptions {
	/** API format: "openai" or "anthropic". Default: "openai" */
	format?: SyntheticApiFormat;
}

/**
 * Stream from Synthetic, routing to either OpenAI or Anthropic API based on format.
 * Returns synchronously like other providers - async processing happens internally.
 */
export function streamSynthetic(
	model: Model<"openai-completions">,
	context: Context,
	options?: SyntheticOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const format = options?.format ?? "openai";

	// Async IIFE to handle stream piping
	(async () => {
		try {
			const mergedHeaders = options?.headers ?? {};

			if (format === "anthropic") {
				// Create a synthetic Anthropic model pointing to Synthetic's endpoint
				const anthropicModel: Model<"anthropic-messages"> = {
					id: model.id,
					name: model.name,
					api: "anthropic-messages",
					provider: model.provider,
					baseUrl: SYNTHETIC_NEW_ANTHROPIC_BASE_URL,
					headers: mergedHeaders,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
				};

				// Calculate thinking budget from reasoning level
				const reasoning = options?.reasoning;
				const reasoningEffort = reasoning;
				const thinkingEnabled = !!reasoningEffort && model.reasoning;
				const thinkingBudget = reasoningEffort
					? (options?.thinkingBudgets?.[reasoningEffort] ?? ANTHROPIC_THINKING[reasoningEffort])
					: undefined;

				const innerStream = streamAnthropic(anthropicModel, context, {
					apiKey: options?.apiKey,
					temperature: options?.temperature,
					topP: options?.topP,
					topK: options?.topK,
					minP: options?.minP,
					presencePenalty: options?.presencePenalty,
					repetitionPenalty: options?.repetitionPenalty,
					maxTokens: options?.maxTokens ?? Math.min(model.maxTokens, 32000),
					signal: options?.signal,
					headers: mergedHeaders,
					sessionId: options?.sessionId,
					onPayload: options?.onPayload,
					thinkingEnabled,
					thinkingBudgetTokens: thinkingBudget,
				});

				for await (const event of innerStream) {
					stream.push(event);
				}
			} else {
				// OpenAI format - use original model with Synthetic headers
				const syntheticModel: Model<"openai-completions"> = {
					...model,
					baseUrl: SYNTHETIC_NEW_BASE_URL,
					headers: mergedHeaders,
				};

				const reasoningEffort = options?.reasoning;
				const innerStream = streamOpenAICompletions(syntheticModel, context, {
					apiKey: options?.apiKey,
					temperature: options?.temperature,
					topP: options?.topP,
					topK: options?.topK,
					minP: options?.minP,
					presencePenalty: options?.presencePenalty,
					repetitionPenalty: options?.repetitionPenalty,
					maxTokens: options?.maxTokens ?? model.maxTokens,
					signal: options?.signal,
					headers: mergedHeaders,
					sessionId: options?.sessionId,
					onPayload: options?.onPayload,
					reasoning: reasoningEffort,
				});

				for await (const event of innerStream) {
					stream.push(event);
				}
			}
		} catch (err) {
			stream.push({
				type: "error",
				reason: "error",
				error: createErrorMessage(model, err),
			});
		}
	})();

	return stream;
}

function createErrorMessage(model: Model<Api>, err: unknown) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error" as const,
		timestamp: Date.now(),
	};
}

/**
 * Check if a model is a Synthetic model.
 */
export function isSyntheticModel(model: Model<Api>): boolean {
	return model.provider === "synthetic";
}

```


## ZENMUX

### Authentication Implementation (`zenmux.ts`)

```typescript
/**
 * ZenMux login flow.
 *
 * ZenMux provides both OpenAI-compatible and Anthropic-compatible endpoints.
 * This is an API key flow:
 * 1. Open browser to ZenMux API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into CLI
 */

import { validateApiKeyAgainstModelsEndpoint } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://zenmux.ai/settings/keys";
const API_BASE_URL = "https://zenmux.ai/api/v1";
const MODELS_URL = `${API_BASE_URL}/models`;

export async function loginZenMux(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("ZenMux login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Create or copy your ZenMux API key",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your ZenMux API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateApiKeyAgainstModelsEndpoint({
		provider: "ZenMux",
		apiKey: trimmed,
		modelsUrl: MODELS_URL,
		signal: options.signal,
	});

	return trimmed;
}

```


## ZAI

### Authentication Implementation (`zai.ts`)

```typescript
/**
 * Z.AI login flow.
 *
 * Z.AI is a platform that provides access to GLM models through an OpenAI-compatible API.
 * API docs: https://docs.z.ai/guides/overview/quick-start
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. User gets their API key from https://z.ai/settings/api-keys
 * 2. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://z.ai/manage-apikey/apikey-list";
const API_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const VALIDATION_MODEL = "glm-4.7";

/**
 * Login to Z.AI.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginZai(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Z.AI login requires onPrompt callback");
	}

	// Open browser to API keys page
	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the dashboard",
	});

	// Prompt user to paste their API key
	const apiKey = await options.onPrompt({
		message: "Paste your Z.AI API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Z.AI",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});
	return trimmed;
}

```


## ALIBABA-CODING-PLAN

### Authentication Implementation (`alibaba-coding-plan.ts`)

```typescript
/**
 * Alibaba Coding Plan login flow.
 *
 * Alibaba Coding Plan provides OpenAI-compatible models via https://coding-intl.dashscope.aliyuncs.com/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Alibaba Cloud DashScope API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://modelstudio.console.alibabacloud.com/";
const API_BASE_URL = "https://coding-intl.dashscope.aliyuncs.com/v1";
const VALIDATION_MODEL = "qwen3.5-plus";

/**
 * Login to Alibaba Coding Plan.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginAlibabaCodingPlan(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Alibaba Coding Plan login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Alibaba Cloud DashScope console",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Alibaba Coding Plan API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Alibaba Coding Plan",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## CURSOR

### Authentication Implementation (`cursor.ts`)

```typescript
import { generatePKCE } from "./pkce";
import type { OAuthCredentials } from "./types";

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

const POLL_MAX_ATTEMPTS = 150;
const POLL_BASE_DELAY = 1000;
const POLL_MAX_DELAY = 10000;
const POLL_BACKOFF_MULTIPLIER = 1.2;

export interface CursorAuthParams {
	verifier: string;
	challenge: string;
	uuid: string;
	loginUrl: string;
}

export async function generateCursorAuthParams(): Promise<CursorAuthParams> {
	const { verifier, challenge } = await generatePKCE();
	const uuid = crypto.randomUUID();

	const params = new URLSearchParams({
		challenge,
		uuid,
		mode: "login",
		redirectTarget: "cli",
	});

	const loginUrl = `${CURSOR_LOGIN_URL}?${params.toString()}`;

	return { verifier, challenge, uuid, loginUrl };
}

export async function pollCursorAuth(
	uuid: string,
	verifier: string,
): Promise<{ accessToken: string; refreshToken: string }> {
	let delay = POLL_BASE_DELAY;
	let consecutiveErrors = 0;

	for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
		await Bun.sleep(delay);

		try {
			const response = await fetch(`${CURSOR_POLL_URL}?uuid=${uuid}&verifier=${verifier}`);

			if (response.status === 404) {
				consecutiveErrors = 0;
				delay = Math.min(delay * POLL_BACKOFF_MULTIPLIER, POLL_MAX_DELAY);
				continue;
			}

			if (response.ok) {
				const data = (await response.json()) as {
					accessToken: string;
					refreshToken: string;
				};
				return {
					accessToken: data.accessToken,
					refreshToken: data.refreshToken,
				};
			}

			throw new Error(`Poll failed: ${response.status}`);
		} catch {
			consecutiveErrors++;
			if (consecutiveErrors >= 3) {
				throw new Error("Too many consecutive errors during Cursor auth polling");
			}
		}
	}

	throw new Error("Cursor authentication polling timeout");
}

export async function loginCursor(
	onAuthUrl: (url: string) => void,
	onPollStart?: () => void,
): Promise<OAuthCredentials> {
	const { verifier, uuid, loginUrl } = await generateCursorAuthParams();

	onAuthUrl(loginUrl);
	onPollStart?.();

	const { accessToken, refreshToken } = await pollCursorAuth(uuid, verifier);

	const expiresAt = getTokenExpiry(accessToken);

	return {
		access: accessToken,
		refresh: refreshToken,
		expires: expiresAt,
	};
}

export async function refreshCursorToken(apiKeyOrRefreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(CURSOR_REFRESH_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKeyOrRefreshToken}`,
			"Content-Type": "application/json",
		},
		body: "{}",
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Cursor token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		accessToken: string;
		refreshToken: string;
	};

	const expiresAt = getTokenExpiry(data.accessToken);

	return {
		access: data.accessToken,
		refresh: data.refreshToken || apiKeyOrRefreshToken,
		expires: expiresAt,
	};
}

function getTokenExpiry(token: string): number {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) {
			return Date.now() + 3600 * 1000;
		}
		const payload = parts[1];
		if (!payload) {
			return Date.now() + 3600 * 1000;
		}
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
		if (decoded && typeof decoded === "object" && typeof decoded.exp === "number") {
			return decoded.exp * 1000 - 5 * 60 * 1000;
		}
	} catch {
		// Ignore parsing errors
	}
	return Date.now() + 3600 * 1000;
}

export function isCursorTokenExpiringSoon(token: string, thresholdSeconds = 300): boolean {
	try {
		const [, payload] = token.split(".");
		if (!payload) return true;
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
		const currentTime = Math.floor(Date.now() / 1000);
		return decoded.exp - currentTime < thresholdSeconds;
	} catch {
		return true;
	}
}

```

### Provider API Implementation (`cursor.ts`)

```typescript
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import http2 from "node:http2";
import { create, fromBinary, fromJson, type JsonValue, toBinary, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { $env } from "@oh-my-pi/pi-utils";
import { calculateCost } from "../models";
import type {
	Api,
	AssistantMessage,
	Context,
	CursorExecHandlerResult,
	CursorExecHandlers,
	CursorMcpCall,
	CursorToolResultHandler,
	ImageContent,
	Message,
	Model,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { parseStreamingJson } from "../utils/json-parse";
import { formatErrorMessageWithRetryAfter } from "../utils/retry-after";
import type { McpToolDefinition } from "./cursor/gen/agent_pb";
import {
	AgentClientMessageSchema,
	AgentConversationTurnStructureSchema,
	AgentRunRequestSchema,
	type AgentServerMessage,
	AgentServerMessageSchema,
	AssistantMessageSchema,
	BackgroundShellSpawnResultSchema,
	ClientHeartbeatSchema,
	ComputerUseResultSchema,
	ConversationActionSchema,
	type ConversationStateStructure,
	ConversationStateStructureSchema,
	ConversationStepSchema,
	ConversationTurnStructureSchema,
	DeleteErrorSchema,
	DeleteRejectedSchema,
	DeleteResultSchema,
	DeleteSuccessSchema,
	DiagnosticsErrorSchema,
	DiagnosticsRejectedSchema,
	DiagnosticsResultSchema,
	DiagnosticsSuccessSchema,
	type ExecClientMessage,
	ExecClientMessageSchema,
	type ExecServerMessage,
	FetchErrorSchema,
	FetchResultSchema,
	GetBlobResultSchema,
	GrepContentMatchSchema,
	GrepContentResultSchema,
	GrepCountResultSchema,
	GrepErrorSchema,
	type GrepFileCount,
	GrepFileCountSchema,
	GrepFileMatchSchema,
	GrepFilesResultSchema,
	GrepResultSchema,
	GrepSuccessSchema,
	type GrepUnionResult,
	GrepUnionResultSchema,
	KvClientMessageSchema,
	type KvServerMessage,
	ListMcpResourcesExecResultSchema,
	type LsDirectoryTreeNode,
	type LsDirectoryTreeNode_File,
	LsDirectoryTreeNode_FileSchema,
	LsDirectoryTreeNodeSchema,
	LsErrorSchema,
	LsRejectedSchema,
	LsResultSchema,
	LsSuccessSchema,
	McpErrorSchema,
	McpImageContentSchema,
	McpResultSchema,
	McpSuccessSchema,
	McpTextContentSchema,
	McpToolDefinitionSchema,
	McpToolNotFoundSchema,
	McpToolResultContentItemSchema,
	ModelDetailsSchema,
	ReadErrorSchema,
	ReadMcpResourceExecResultSchema,
	ReadRejectedSchema,
	ReadResultSchema,
	ReadSuccessSchema,
	RecordScreenResultSchema,
	RequestContextResultSchema,
	RequestContextSchema,
	RequestContextSuccessSchema,
	SetBlobResultSchema,
	type ShellArgs,
	ShellFailureSchema,
	ShellRejectedSchema,
	ShellResultSchema,
	type ShellStream,
	ShellStreamExitSchema,
	ShellStreamSchema,
	ShellStreamStartSchema,
	ShellStreamStderrSchema,
	ShellStreamStdoutSchema,
	ShellSuccessSchema,
	UserMessageActionSchema,
	UserMessageSchema,
	WriteErrorSchema,
	WriteRejectedSchema,
	WriteResultSchema,
	WriteShellStdinErrorSchema,
	WriteShellStdinResultSchema,
	WriteSuccessSchema,
} from "./cursor/gen/agent_pb";

export const CURSOR_API_URL = "https://api2.cursor.sh";
export const CURSOR_CLIENT_VERSION = "cli-2026.01.09-231024f";

const conversationStateCache = new Map<string, ConversationStateStructure>();
const conversationBlobStores = new Map<string, Map<string, Uint8Array>>();

export interface CursorOptions extends StreamOptions {
	customSystemPrompt?: string;
	conversationId?: string;
	execHandlers?: CursorExecHandlers;
	onToolResult?: CursorToolResultHandler;
}

const CONNECT_END_STREAM_FLAG = 0b00000010;

interface CursorLogEntry {
	ts: number;
	type: string;
	subtype?: string;
	data?: unknown;
}

async function appendCursorDebugLog(entry: CursorLogEntry): Promise<void> {
	const logPath = $env.DEBUG_CURSOR_LOG;
	if (!logPath) return;
	try {
		await fs.appendFile(logPath, `${JSON.stringify(entry, debugReplacer)}\n`);
	} catch {
		// Ignore debug log failures
	}
}

function log(type: string, subtype?: string, data?: unknown): void {
	if (!$env.DEBUG_CURSOR) return;
	const normalizedData = data ? decodeLogData(data) : data;
	const entry: CursorLogEntry = { ts: Date.now(), type, subtype, data: normalizedData };
	const verbose = $env.DEBUG_CURSOR === "2" || $env.DEBUG_CURSOR === "verbose";
	const dataStr = verbose && normalizedData ? ` ${JSON.stringify(normalizedData, debugReplacer)?.slice(0, 500)}` : "";
	console.error(`[CURSOR] ${type}${subtype ? `: ${subtype}` : ""}${dataStr}`);
	void appendCursorDebugLog(entry);
}

function frameConnectMessage(data: Uint8Array, flags = 0): Buffer {
	const frame = Buffer.alloc(5 + data.length);
	frame[0] = flags;
	frame.writeUInt32BE(data.length, 1);
	frame.set(data, 5);
	return frame;
}

function parseConnectEndStream(data: Uint8Array): Error | null {
	try {
		const payload = JSON.parse(new TextDecoder().decode(data));
		const error = payload?.error;
		if (error) {
			const code = typeof error.code === "string" ? error.code : "unknown";
			const message = typeof error.message === "string" ? error.message : "Unknown error";
			return new Error(`Connect error ${code}: ${message}`);
		}
		return null;
	} catch {
		return new Error("Failed to parse Connect end stream");
	}
}

function debugBytes(bytes: Uint8Array, asHex: boolean): string {
	if (asHex) {
		return Buffer.from(bytes).toString("hex");
	}
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		if (/^[\x20-\x7E\s]*$/.test(text)) return text;
	} catch {}
	return Buffer.from(bytes).toString("hex");
}

function debugReplacer(key: string, value: unknown): unknown {
	if (
		value instanceof Uint8Array ||
		(value && typeof value === "object" && "type" in value && value.type === "Buffer")
	) {
		const bytes = value instanceof Uint8Array ? value : new Uint8Array((value as any).data);
		const asHex = key === "blobId" || key === "blob_id" || key.endsWith("Id") || key.endsWith("_id");
		return debugBytes(bytes, asHex);
	}
	if (typeof value === "bigint") return value.toString();
	return value;
}

function extractLogBytes(value: unknown): Uint8Array | null {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value && typeof value === "object" && "type" in value && value.type === "Buffer") {
		const data = (value as { data?: number[] }).data;
		if (Array.isArray(data)) {
			return new Uint8Array(data);
		}
	}
	return null;
}

function decodeMcpArgsForLog(args?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!args) {
		return undefined;
	}
	let mutated = false;
	const decoded: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		const bytes = extractLogBytes(value);
		if (bytes) {
			decoded[key] = decodeMcpArgValue(bytes);
			mutated = true;
			continue;
		}
		const normalizedValue = decodeLogData(value);
		decoded[key] = normalizedValue;
		if (normalizedValue !== value) {
			mutated = true;
		}
	}
	return mutated ? decoded : args;
}

function decodeLogData(value: unknown): unknown {
	if (!value || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(entry => decodeLogData(entry));
	}
	const record = value as Record<string, unknown>;
	const typeName = record.$typeName;
	const stripTypeName = typeof typeName === "string" && typeName.startsWith("agent.v1.");

	if (typeName === "agent.v1.McpArgs") {
		const decodedArgs = decodeMcpArgsForLog(record.args as Record<string, unknown> | undefined);
		const base = stripTypeName ? omitTypeName(record) : record;
		return decodedArgs ? { ...base, args: decodedArgs } : base;
	}
	if (typeName === "agent.v1.McpToolCall") {
		const argsRecord = record.args as Record<string, unknown> | undefined;
		const decodedArgs = decodeMcpArgsForLog(argsRecord?.args as Record<string, unknown> | undefined);
		const base = stripTypeName ? omitTypeName(record) : record;
		if (decodedArgs && argsRecord) {
			return { ...base, args: { ...argsRecord, args: decodedArgs } };
		}
		return base;
	}

	let mutated = stripTypeName;
	const decoded: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(record)) {
		if (stripTypeName && key === "$typeName") {
			continue;
		}
		const normalizedEntry = decodeLogData(entry);
		decoded[key] = normalizedEntry;
		if (normalizedEntry !== entry) {
			mutated = true;
		}
	}
	return mutated ? decoded : record;
}

function omitTypeName(record: Record<string, unknown>): Record<string, unknown> {
	const { $typeName: _, ...rest } = record;
	return rest;
}

export const streamCursor: StreamFunction<"cursor-agent"> = (
	model: Model<"cursor-agent">,
	context: Context,
	options?: CursorOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "cursor-agent" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		let h2Client: http2.ClientHttp2Session | null = null;
		let h2Request: http2.ClientHttp2Stream | null = null;
		let heartbeatTimer: NodeJS.Timeout | null = null;

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error("Cursor API key (access token) is required");
			}

			const conversationId = options?.conversationId ?? options?.sessionId ?? crypto.randomUUID();
			const blobStore = conversationBlobStores.get(conversationId) ?? new Map<string, Uint8Array>();
			conversationBlobStores.set(conversationId, blobStore);
			const cachedState = conversationStateCache.get(conversationId);
			const { requestBytes, conversationState } = buildGrpcRequest(model, context, options, {
				conversationId,
				blobStore,
				conversationState: cachedState,
			});
			conversationStateCache.set(conversationId, conversationState);
			const requestContextTools = buildMcpToolDefinitions(context.tools);

			const baseUrl = model.baseUrl || CURSOR_API_URL;
			h2Client = http2.connect(baseUrl);

			h2Request = h2Client.request({
				":method": "POST",
				":path": "/agent.v1.AgentService/Run",
				"content-type": "application/connect+proto",
				"connect-protocol-version": "1",
				te: "trailers",
				authorization: `Bearer ${apiKey}`,
				"x-ghost-mode": "true",
				"x-cursor-client-version": CURSOR_CLIENT_VERSION,
				"x-cursor-client-type": "cli",
				"x-request-id": crypto.randomUUID(),
			});

			stream.push({ type: "start", partial: output });

			let pendingBuffer = Buffer.alloc(0);
			let endStreamError: Error | null = null;
			let currentTextBlock: (TextContent & { index: number }) | null = null;
			let currentThinkingBlock: (ThinkingContent & { index: number }) | null = null;
			let currentToolCall: ToolCallState | null = null;
			const usageState: UsageState = { sawTokenDelta: false };

			const state: BlockState = {
				get currentTextBlock() {
					return currentTextBlock;
				},
				get currentThinkingBlock() {
					return currentThinkingBlock;
				},
				get currentToolCall() {
					return currentToolCall;
				},
				get firstTokenTime() {
					return firstTokenTime;
				},
				setTextBlock: b => {
					currentTextBlock = b;
				},
				setThinkingBlock: b => {
					currentThinkingBlock = b;
				},
				setToolCall: t => {
					currentToolCall = t;
				},
				setFirstTokenTime: () => {
					if (!firstTokenTime) firstTokenTime = Date.now();
				},
			};

			const onConversationCheckpoint = (checkpoint: ConversationStateStructure) => {
				conversationStateCache.set(conversationId, checkpoint);
			};

			h2Request.on("data", (chunk: Buffer) => {
				pendingBuffer = Buffer.concat([pendingBuffer, chunk]);

				while (pendingBuffer.length >= 5) {
					const flags = pendingBuffer[0];
					const msgLen = pendingBuffer.readUInt32BE(1);
					if (pendingBuffer.length < 5 + msgLen) break;

					const messageBytes = pendingBuffer.subarray(5, 5 + msgLen);
					pendingBuffer = pendingBuffer.subarray(5 + msgLen);

					if (flags & CONNECT_END_STREAM_FLAG) {
						const endError = parseConnectEndStream(messageBytes);
						if (endError) {
							endStreamError = endError;
							h2Request?.close();
						}
						continue;
					}

					try {
						const serverMessage = fromBinary(AgentServerMessageSchema, messageBytes);
						void handleServerMessage(
							serverMessage,
							output,
							stream,
							state,
							blobStore,
							h2Request!,
							options?.execHandlers,
							options?.onToolResult,
							usageState,
							requestContextTools,
							onConversationCheckpoint,
						).catch(error => {
							log("error", "handleServerMessage", { error: String(error) });
						});
					} catch (e) {
						log("error", "parseServerMessage", { error: String(e) });
					}
				}
			});

			h2Request.write(frameConnectMessage(requestBytes));

			const sendHeartbeat = () => {
				if (!h2Request || h2Request.closed) {
					return;
				}
				const heartbeatMessage = create(AgentClientMessageSchema, {
					message: { case: "clientHeartbeat", value: create(ClientHeartbeatSchema, {}) },
				});
				const heartbeatBytes = toBinary(AgentClientMessageSchema, heartbeatMessage);
				h2Request.write(frameConnectMessage(heartbeatBytes));
			};

			heartbeatTimer = setInterval(sendHeartbeat, 5000);

			await new Promise<void>((resolve, reject) => {
				h2Request!.on("trailers", trailers => {
					const status = trailers["grpc-status"];
					const msg = trailers["grpc-message"];
					if (status && status !== "0") {
						reject(new Error(`gRPC error ${status}: ${decodeURIComponent(String(msg || ""))}`));
					}
				});

				h2Request!.on("end", () => {
					if (endStreamError) {
						reject(endStreamError);
						return;
					}
					resolve();
				});

				h2Request!.on("error", reject);

				if (options?.signal) {
					options.signal.addEventListener("abort", () => {
						h2Request?.close();
						reject(new Error("Request was aborted"));
					});
				}
			});

			if (state.currentTextBlock) {
				const idx = output.content.indexOf(state.currentTextBlock);
				stream.push({
					type: "text_end",
					contentIndex: idx,
					content: state.currentTextBlock.text,
					partial: output,
				});
			}
			if (state.currentThinkingBlock) {
				const idx = output.content.indexOf(state.currentThinkingBlock);
				stream.push({
					type: "thinking_end",
					contentIndex: idx,
					content: state.currentThinkingBlock.thinking,
					partial: output,
				});
			}
			if (state.currentToolCall) {
				const idx = output.content.indexOf(state.currentToolCall);
				state.currentToolCall.arguments = parseStreamingJson(state.currentToolCall.partialJson);
				delete (state.currentToolCall as any).partialJson;
				delete (state.currentToolCall as any).index;
				stream.push({
					type: "toolcall_end",
					contentIndex: idx,
					toolCall: state.currentToolCall,
					partial: output,
				});
			}

			calculateCost(model, output.usage);

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({
				type: "done",
				reason: output.stopReason as "stop" | "length" | "toolUse",
				message: output,
			});
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatErrorMessageWithRetryAfter(error);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		} finally {
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}
			h2Request?.close();
			h2Client?.close();
		}
	})();

	return stream;
};

type ToolCallState = ToolCall & { index: number; partialJson?: string; kind: "mcp" | "todo_write" };

interface BlockState {
	currentTextBlock: (TextContent & { index: number }) | null;
	currentThinkingBlock: (ThinkingContent & { index: number }) | null;
	currentToolCall: ToolCallState | null;
	firstTokenTime: number | undefined;
	setTextBlock: (b: (TextContent & { index: number }) | null) => void;
	setThinkingBlock: (b: (ThinkingContent & { index: number }) | null) => void;
	setToolCall: (t: ToolCallState | null) => void;
	setFirstTokenTime: () => void;
}

interface UsageState {
	sawTokenDelta: boolean;
}

async function handleServerMessage(
	msg: AgentServerMessage,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	state: BlockState,
	blobStore: Map<string, Uint8Array>,
	h2Request: http2.ClientHttp2Stream,
	execHandlers: CursorExecHandlers | undefined,
	onToolResult: CursorToolResultHandler | undefined,
	usageState: UsageState,
	requestContextTools: McpToolDefinition[],
	onConversationCheckpoint?: (checkpoint: ConversationStateStructure) => void,
): Promise<void> {
	const msgCase = msg.message.case;

	log("serverMessage", msgCase, msg.message.value);

	if (msgCase === "interactionUpdate") {
		processInteractionUpdate(msg.message.value, output, stream, state, usageState);
	} else if (msgCase === "kvServerMessage") {
		handleKvServerMessage(msg.message.value as KvServerMessage, blobStore, h2Request);
	} else if (msgCase === "execServerMessage") {
		await handleExecServerMessage(
			msg.message.value as ExecServerMessage,
			h2Request,
			execHandlers,
			onToolResult,
			requestContextTools,
		);
	} else if (msgCase === "conversationCheckpointUpdate") {
		handleConversationCheckpointUpdate(msg.message.value, output, usageState, onConversationCheckpoint);
	}
}

function handleKvServerMessage(
	kvMsg: KvServerMessage,
	blobStore: Map<string, Uint8Array>,
	h2Request: http2.ClientHttp2Stream,
): void {
	const kvCase = kvMsg.message.case;

	if (kvCase === "getBlobArgs") {
		const blobId = kvMsg.message.value.blobId;
		const blobIdKey = Buffer.from(blobId).toString("hex");

		const blobData = blobStore.get(blobIdKey);

		const response = create(KvClientMessageSchema, {
			id: kvMsg.id,
			message: {
				case: "getBlobResult",
				value: create(GetBlobResultSchema, blobData ? { blobData } : {}),
			},
		});

		const kvClientMessage = create(AgentClientMessageSchema, {
			message: { case: "kvClientMessage", value: response },
		});

		const responseBytes = toBinary(AgentClientMessageSchema, kvClientMessage);
		h2Request.write(frameConnectMessage(responseBytes));

		log("kvClient", "getBlobResult", { blobId: blobIdKey.slice(0, 40) });
	} else if (kvCase === "setBlobArgs") {
		const { blobId, blobData } = kvMsg.message.value;
		const blobIdKey = Buffer.from(blobId).toString("hex");
		blobStore.set(blobIdKey, blobData);

		const response = create(KvClientMessageSchema, {
			id: kvMsg.id,
			message: {
				case: "setBlobResult",
				value: create(SetBlobResultSchema, {}),
			},
		});

		const kvClientMessage = create(AgentClientMessageSchema, {
			message: { case: "kvClientMessage", value: response },
		});

		const responseBytes = toBinary(AgentClientMessageSchema, kvClientMessage);
		h2Request.write(frameConnectMessage(responseBytes));

		log("kvClient", "setBlobResult", { blobId: blobIdKey.slice(0, 40) });
	}
}

function sendShellStreamEvent(
	h2Request: http2.ClientHttp2Stream,
	execMsg: ExecServerMessage,
	event: ShellStream["event"],
): void {
	sendExecClientMessage(h2Request, execMsg, "shellStream", create(ShellStreamSchema, { event }));
}

async function handleShellStreamArgs(
	args: ShellArgs,
	execMsg: ExecServerMessage,
	h2Request: http2.ClientHttp2Stream,
	execHandlers: CursorExecHandlers | undefined,
	onToolResult: CursorToolResultHandler | undefined,
): Promise<void> {
	const { execResult } = await resolveExecHandler(
		args as any,
		execHandlers?.shell?.bind(execHandlers),
		onToolResult,
		toolResult => buildShellResultFromToolResult(args as any, toolResult),
		reason => buildShellRejectedResult((args as any).command, (args as any).workingDirectory, reason),
		error => buildShellFailureResult((args as any).command, (args as any).workingDirectory, error),
	);

	sendShellStreamEvent(h2Request, execMsg, { case: "start", value: create(ShellStreamStartSchema, {}) });

	const result = execResult.result;
	switch (result.case) {
		case "success": {
			const value = result.value;
			if (value.stdout) {
				sendShellStreamEvent(h2Request, execMsg, {
					case: "stdout",
					value: create(ShellStreamStdoutSchema, { data: value.stdout }),
				});
			}
			if (value.stderr) {
				sendShellStreamEvent(h2Request, execMsg, {
					case: "stderr",
					value: create(ShellStreamStderrSchema, { data: value.stderr }),
				});
			}
			sendShellStreamEvent(h2Request, execMsg, {
				case: "exit",
				value: create(ShellStreamExitSchema, {
					code: value.exitCode,
					cwd: value.workingDirectory,
					aborted: false,
				}),
			});
			return;
		}
		case "failure": {
			const value = result.value;
			if (value.stdout) {
				sendShellStreamEvent(h2Request, execMsg, {
					case: "stdout",
					value: create(ShellStreamStdoutSchema, { data: value.stdout }),
				});
			}
			if (value.stderr) {
				sendShellStreamEvent(h2Request, execMsg, {
					case: "stderr",
					value: create(ShellStreamStderrSchema, { data: value.stderr }),
				});
			}
			sendShellStreamEvent(h2Request, execMsg, {
				case: "exit",
				value: create(ShellStreamExitSchema, {
					code: value.exitCode,
					cwd: value.workingDirectory,
					aborted: value.aborted,
					abortReason: value.abortReason,
				}),
			});
			return;
		}
		case "rejected": {
			sendShellStreamEvent(h2Request, execMsg, { case: "rejected", value: result.value });
			sendShellStreamEvent(h2Request, execMsg, {
				case: "exit",
				value: create(ShellStreamExitSchema, {
					code: 1,
					cwd: result.value.workingDirectory,
					aborted: false,
				}),
			});
			return;
		}
		case "timeout": {
			const value = result.value;
			sendShellStreamEvent(h2Request, execMsg, {
				case: "stderr",
				value: create(ShellStreamStderrSchema, {
					data: `Command timed out after ${value.timeoutMs}ms`,
				}),
			});
			sendShellStreamEvent(h2Request, execMsg, {
				case: "exit",
				value: create(ShellStreamExitSchema, {
					code: 1,
					cwd: value.workingDirectory,
					aborted: true,
				}),
			});
			return;
		}
		case "permissionDenied": {
			sendShellStreamEvent(h2Request, execMsg, { case: "permissionDenied", value: result.value });
			sendShellStreamEvent(h2Request, execMsg, {
				case: "exit",
				value: create(ShellStreamExitSchema, {
					code: 1,
					cwd: result.value.workingDirectory,
					aborted: false,
				}),
			});
			return;
		}
		default:
			return;
	}
}

async function handleExecServerMessage(
	execMsg: ExecServerMessage,
	h2Request: http2.ClientHttp2Stream,
	execHandlers: CursorExecHandlers | undefined,
	onToolResult: CursorToolResultHandler | undefined,
	requestContextTools: McpToolDefinition[],
): Promise<void> {
	const execCase = execMsg.message.case;
	if (execCase === "requestContextArgs") {
		const requestContext = create(RequestContextSchema, {
			rules: [],
			repositoryInfo: [],
			tools: requestContextTools,
			gitRepos: [],
			projectLayouts: [],
			mcpInstructions: [],
			fileContents: {},
			customSubagents: [],
		});

		const requestContextResult = create(RequestContextResultSchema, {
			result: {
				case: "success",
				value: create(RequestContextSuccessSchema, { requestContext }),
			},
		});

		sendExecClientMessage(h2Request, execMsg, "requestContextResult", requestContextResult);
		log("execClient", "requestContextResult");
		return;
	}

	if (!execCase) {
		return;
	}

	switch (execCase) {
		case "readArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.read?.bind(execHandlers),
				onToolResult,
				toolResult => buildReadResultFromToolResult(args.path, toolResult),
				reason => buildReadRejectedResult(args.path, reason),
				error => buildReadErrorResult(args.path, error),
			);
			sendExecClientMessage(h2Request, execMsg, "readResult", execResult);
			return;
		}
		case "lsArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.ls?.bind(execHandlers),
				onToolResult,
				toolResult => buildLsResultFromToolResult(args.path, toolResult),
				reason => buildLsRejectedResult(args.path, reason),
				error => buildLsErrorResult(args.path, error),
			);
			sendExecClientMessage(h2Request, execMsg, "lsResult", execResult);
			return;
		}
		case "grepArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.grep?.bind(execHandlers),
				onToolResult,
				toolResult => buildGrepResultFromToolResult(args, toolResult),
				reason => buildGrepErrorResult(reason),
				error => buildGrepErrorResult(error),
			);
			sendExecClientMessage(h2Request, execMsg, "grepResult", execResult);
			return;
		}
		case "writeArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.write?.bind(execHandlers),
				onToolResult,
				toolResult =>
					buildWriteResultFromToolResult(
						{
							path: args.path,
							fileText: args.fileText,
							fileBytes: args.fileBytes,
							returnFileContentAfterWrite: args.returnFileContentAfterWrite,
						},
						toolResult,
					),
				reason => buildWriteRejectedResult(args.path, reason),
				error => buildWriteErrorResult(args.path, error),
			);
			sendExecClientMessage(h2Request, execMsg, "writeResult", execResult);
			return;
		}
		case "deleteArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.delete?.bind(execHandlers),
				onToolResult,
				toolResult => buildDeleteResultFromToolResult(args.path, toolResult),
				reason => buildDeleteRejectedResult(args.path, reason),
				error => buildDeleteErrorResult(args.path, error),
			);
			sendExecClientMessage(h2Request, execMsg, "deleteResult", execResult);
			return;
		}
		case "shellArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.shell?.bind(execHandlers),
				onToolResult,
				toolResult => buildShellResultFromToolResult(args, toolResult),
				reason => buildShellRejectedResult(args.command, args.workingDirectory, reason),
				error => buildShellFailureResult(args.command, args.workingDirectory, error),
			);
			sendExecClientMessage(h2Request, execMsg, "shellResult", execResult);
			return;
		}
		case "shellStreamArgs": {
			const args = execMsg.message.value;
			await handleShellStreamArgs(args, execMsg, h2Request, execHandlers, onToolResult);
			return;
		}
		case "backgroundShellSpawnArgs": {
			const args = execMsg.message.value;
			const execResult = create(BackgroundShellSpawnResultSchema, {
				result: {
					case: "rejected",
					value: create(ShellRejectedSchema, {
						command: args.command,
						workingDirectory: args.workingDirectory,
						reason: "Not implemented",
						isReadonly: false,
					}),
				},
			});
			sendExecClientMessage(h2Request, execMsg, "backgroundShellSpawnResult", execResult);
			return;
		}
		case "writeShellStdinArgs": {
			const execResult = create(WriteShellStdinResultSchema, {
				result: {
					case: "error",
					value: create(WriteShellStdinErrorSchema, {
						error: "Not implemented",
					}),
				},
			});
			sendExecClientMessage(h2Request, execMsg, "writeShellStdinResult", execResult);
			return;
		}
		case "fetchArgs": {
			const args = execMsg.message.value;
			const execResult = create(FetchResultSchema, {
				result: {
					case: "error",
					value: create(FetchErrorSchema, {
						url: args.url,
						error: "Not implemented",
					}),
				},
			});
			sendExecClientMessage(h2Request, execMsg, "fetchResult", execResult);
			return;
		}
		case "diagnosticsArgs": {
			const args = execMsg.message.value;
			const { execResult } = await resolveExecHandler(
				args,
				execHandlers?.diagnostics?.bind(execHandlers),
				onToolResult,
				toolResult => buildDiagnosticsResultFromToolResult(args.path, toolResult),
				reason => buildDiagnosticsRejectedResult(args.path, reason),
				error => buildDiagnosticsErrorResult(args.path, error),
			);
			sendExecClientMessage(h2Request, execMsg, "diagnosticsResult", execResult);
			return;
		}
		case "mcpArgs": {
			const args = execMsg.message.value;
			const mcpCall = decodeMcpCall(args);
			const { execResult } = await resolveExecHandler(
				mcpCall,
				execHandlers?.mcp?.bind(execHandlers),
				onToolResult,
				toolResult => buildMcpResultFromToolResult(mcpCall, toolResult),
				_reason => buildMcpToolNotFoundResult(mcpCall),
				error => buildMcpErrorResult(error),
			);
			sendExecClientMessage(h2Request, execMsg, "mcpResult", execResult);
			return;
		}
		case "listMcpResourcesExecArgs": {
			const execResult = create(ListMcpResourcesExecResultSchema, {});
			sendExecClientMessage(h2Request, execMsg, "listMcpResourcesExecResult", execResult);
			return;
		}
		case "readMcpResourceExecArgs": {
			const execResult = create(ReadMcpResourceExecResultSchema, {});
			sendExecClientMessage(h2Request, execMsg, "readMcpResourceExecResult", execResult);
			return;
		}
		case "recordScreenArgs": {
			const execResult = create(RecordScreenResultSchema, {});
			sendExecClientMessage(h2Request, execMsg, "recordScreenResult", execResult);
			return;
		}
		case "computerUseArgs": {
			const execResult = create(ComputerUseResultSchema, {});
			sendExecClientMessage(h2Request, execMsg, "computerUseResult", execResult);
			return;
		}
		default:
			log("warn", "unhandledExecMessage", { execCase });
	}
}

function sendExecClientMessage<T>(
	h2Request: http2.ClientHttp2Stream,
	execMsg: ExecServerMessage,
	messageCase: ExecClientMessage["message"]["case"],
	value: T,
): void {
	const execClientMessage = create(ExecClientMessageSchema, {
		id: execMsg.id,
		execId: execMsg.execId,
		message: {
			case: messageCase,
			value: value as any,
		},
	});

	const clientMessage = create(AgentClientMessageSchema, {
		message: { case: "execClientMessage", value: execClientMessage },
	});

	const responseBytes = toBinary(AgentClientMessageSchema, clientMessage);
	h2Request.write(frameConnectMessage(responseBytes));

	log("execClientMessage", messageCase, value);
}

/** Exported for tests: verifies handler is invoked with correct `this` when passed as bound. */
export async function resolveExecHandler<TArgs, TResult>(
	args: TArgs,
	handler: ((args: TArgs) => Promise<CursorExecHandlerResult<TResult>>) | undefined,
	onToolResult: CursorToolResultHandler | undefined,
	buildFromToolResult: (toolResult: ToolResultMessage) => TResult,
	buildRejected: (reason: string) => TResult,
	buildError: (error: string) => TResult,
): Promise<{ execResult: TResult; toolResult?: ToolResultMessage }> {
	if (!handler) {
		return { execResult: buildRejected("Tool not available") };
	}

	try {
		const handlerResult = await handler(args);
		const { execResult, toolResult } = splitExecHandlerResult(handlerResult);
		const finalToolResult = await applyToolResultHandler(toolResult, onToolResult);

		if (execResult) {
			return { execResult, toolResult: finalToolResult };
		}
		if (finalToolResult) {
			return { execResult: buildFromToolResult(finalToolResult), toolResult: finalToolResult };
		}
		return { execResult: buildRejected("Tool returned no result") };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { execResult: buildError(message) };
	}
}

function splitExecHandlerResult<TResult>(result: CursorExecHandlerResult<TResult>): {
	execResult?: TResult;
	toolResult?: ToolResultMessage;
} {
	if (isToolResultMessage(result)) {
		return { toolResult: result };
	}
	if (result && typeof result === "object") {
		const record = result as Record<string, unknown>;
		if ("execResult" in record) {
			const { execResult, toolResult } = record as {
				execResult: TResult;
				toolResult?: ToolResultMessage;
			};
			return { execResult, toolResult };
		}
		if ("toolResult" in record && !isToolResultMessage(record)) {
			const { result: execResult, toolResult } = record as {
				result?: TResult;
				toolResult?: ToolResultMessage;
			};
			return { execResult, toolResult };
		}
		if ("result" in record && !("$typeName" in record)) {
			const { result: execResult, toolResult } = record as {
				result: TResult;
				toolResult?: ToolResultMessage;
			};
			return { execResult, toolResult };
		}
	}
	return { execResult: result as TResult };
}

function isToolResultMessage(value: unknown): value is ToolResultMessage {
	return !!value && typeof value === "object" && (value as ToolResultMessage).role === "toolResult";
}

async function applyToolResultHandler(
	toolResult: ToolResultMessage | undefined,
	onToolResult: CursorToolResultHandler | undefined,
): Promise<ToolResultMessage | undefined> {
	if (!toolResult || !onToolResult) {
		return toolResult;
	}
	const updated = await onToolResult(toolResult);
	return updated ?? toolResult;
}

function toolResultToText(toolResult: ToolResultMessage): string {
	return toolResult.content.map(item => (item.type === "text" ? item.text : `[${item.mimeType} image]`)).join("\n");
}

function toolResultWasTruncated(toolResult: ToolResultMessage): boolean {
	if (!toolResult.details || typeof toolResult.details !== "object") {
		return false;
	}
	const truncation = (toolResult.details as { truncation?: { truncated?: boolean } }).truncation;
	return !!truncation?.truncated;
}

function toolResultDetailBoolean(toolResult: ToolResultMessage, key: string): boolean {
	if (!toolResult.details || typeof toolResult.details !== "object") {
		return false;
	}
	const value = (toolResult.details as Record<string, unknown>)[key];
	return typeof value === "boolean" ? value : false;
}

function buildReadResultFromToolResult(path: string, toolResult: ToolResultMessage) {
	const text = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildReadErrorResult(path, text || "Read failed");
	}
	const totalLines = text ? text.split("\n").length : 0;
	return create(ReadResultSchema, {
		result: {
			case: "success",
			value: create(ReadSuccessSchema, {
				path,
				totalLines,
				fileSize: BigInt(Buffer.byteLength(text, "utf-8")),
				truncated: toolResultWasTruncated(toolResult),
				output: { case: "content", value: text },
			}),
		},
	});
}

function buildReadErrorResult(path: string, error: string) {
	return create(ReadResultSchema, {
		result: {
			case: "error",
			value: create(ReadErrorSchema, { path, error }),
		},
	});
}

function buildReadRejectedResult(path: string, reason: string) {
	return create(ReadResultSchema, {
		result: {
			case: "rejected",
			value: create(ReadRejectedSchema, { path, reason }),
		},
	});
}

function buildWriteResultFromToolResult(
	args: { path: string; fileText?: string; fileBytes?: Uint8Array; returnFileContentAfterWrite?: boolean },
	toolResult: ToolResultMessage,
) {
	const text = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildWriteErrorResult(args.path, text || "Write failed");
	}
	const fileText = args.fileText ?? "";
	const fileSize = args.fileBytes?.length ?? Buffer.byteLength(fileText, "utf-8");
	const linesCreated = fileText ? fileText.split("\n").length : 0;
	return create(WriteResultSchema, {
		result: {
			case: "success",
			value: create(WriteSuccessSchema, {
				path: args.path,
				linesCreated,
				fileSize,
				fileContentAfterWrite: args.returnFileContentAfterWrite ? fileText : undefined,
			}),
		},
	});
}

function buildWriteErrorResult(path: string, error: string) {
	return create(WriteResultSchema, {
		result: {
			case: "error",
			value: create(WriteErrorSchema, { path, error }),
		},
	});
}

function buildWriteRejectedResult(path: string, reason: string) {
	return create(WriteResultSchema, {
		result: {
			case: "rejected",
			value: create(WriteRejectedSchema, { path, reason }),
		},
	});
}

function buildDeleteResultFromToolResult(path: string, toolResult: ToolResultMessage) {
	const text = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildDeleteErrorResult(path, text || "Delete failed");
	}
	return create(DeleteResultSchema, {
		result: {
			case: "success",
			value: create(DeleteSuccessSchema, {
				path,
				deletedFile: path,
				fileSize: BigInt(0),
				prevContent: "",
			}),
		},
	});
}

function buildDeleteErrorResult(path: string, error: string) {
	return create(DeleteResultSchema, {
		result: {
			case: "error",
			value: create(DeleteErrorSchema, { path, error }),
		},
	});
}

function buildDeleteRejectedResult(path: string, reason: string) {
	return create(DeleteResultSchema, {
		result: {
			case: "rejected",
			value: create(DeleteRejectedSchema, { path, reason }),
		},
	});
}

function buildShellResultFromToolResult(
	args: { command: string; workingDirectory: string },
	toolResult: ToolResultMessage,
) {
	const output = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildShellFailureResult(args.command, args.workingDirectory, output || "Shell failed");
	}
	return create(ShellResultSchema, {
		result: {
			case: "success",
			value: create(ShellSuccessSchema, {
				command: args.command,
				workingDirectory: args.workingDirectory,
				exitCode: 0,
				signal: "",
				stdout: output,
				stderr: "",
				executionTime: 0,
			}),
		},
	});
}

function buildShellFailureResult(command: string, workingDirectory: string, error: string) {
	return create(ShellResultSchema, {
		result: {
			case: "failure",
			value: create(ShellFailureSchema, {
				command,
				workingDirectory,
				exitCode: 1,
				signal: "",
				stdout: "",
				stderr: error,
				executionTime: 0,
				aborted: false,
			}),
		},
	});
}

function buildShellRejectedResult(command: string, workingDirectory: string, reason: string) {
	return create(ShellResultSchema, {
		result: {
			case: "rejected",
			value: create(ShellRejectedSchema, {
				command,
				workingDirectory,
				reason,
				isReadonly: false,
			}),
		},
	});
}

function buildLsResultFromToolResult(path: string, toolResult: ToolResultMessage) {
	const text = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildLsErrorResult(path, text || "Ls failed");
	}
	const rootPath = path || ".";
	const entries = text
		.split("\n")
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith("["));
	const childrenDirs: LsDirectoryTreeNode[] = [];
	const childrenFiles: LsDirectoryTreeNode_File[] = [];

	for (const entry of entries) {
		const name = entry.split(" (")[0];
		if (name.endsWith("/")) {
			const dirName = name.slice(0, -1);
			childrenDirs.push(
				create(LsDirectoryTreeNodeSchema, {
					absPath: `${rootPath.replace(/\/$/, "")}/${dirName}`,
					childrenDirs: [],
					childrenFiles: [],
					childrenWereProcessed: false,
					fullSubtreeExtensionCounts: {},
					numFiles: 0,
				}),
			);
		} else {
			childrenFiles.push(create(LsDirectoryTreeNode_FileSchema, { name }));
		}
	}

	const root = create(LsDirectoryTreeNodeSchema, {
		absPath: rootPath,
		childrenDirs,
		childrenFiles,
		childrenWereProcessed: true,
		fullSubtreeExtensionCounts: {},
		numFiles: childrenFiles.length,
	});

	return create(LsResultSchema, {
		result: {
			case: "success",
			value: create(LsSuccessSchema, { directoryTreeRoot: root }),
		},
	});
}

function buildLsErrorResult(path: string, error: string) {
	return create(LsResultSchema, {
		result: {
			case: "error",
			value: create(LsErrorSchema, { path, error }),
		},
	});
}

function buildLsRejectedResult(path: string, reason: string) {
	return create(LsResultSchema, {
		result: {
			case: "rejected",
			value: create(LsRejectedSchema, { path, reason }),
		},
	});
}

function buildGrepResultFromToolResult(
	args: { pattern: string; path?: string; outputMode?: string },
	toolResult: ToolResultMessage,
) {
	const text = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildGrepErrorResult(text || "Grep failed");
	}

	const outputMode = args.outputMode || "content";
	const clientTruncated = toolResultDetailBoolean(toolResult, "truncated");
	const lines = text
		.split("\n")
		.map(line => line.trimEnd())
		.filter(line => line.length > 0 && !line.startsWith("[") && !line.toLowerCase().startsWith("no matches"));

	const workspaceKey = args.path || ".";
	let unionResult: GrepUnionResult;

	if (outputMode === "files_with_matches") {
		const files = lines;
		unionResult = create(GrepUnionResultSchema, {
			result: {
				case: "files",
				value: create(GrepFilesResultSchema, {
					files,
					totalFiles: files.length,
					clientTruncated,
					ripgrepTruncated: false,
				}),
			},
		});
	} else if (outputMode === "count") {
		const counts = lines
			.map(line => {
				const separatorIndex = line.lastIndexOf(":");
				if (separatorIndex === -1) {
					return null;
				}
				const file = line.slice(0, separatorIndex);
				const count = Number.parseInt(line.slice(separatorIndex + 1), 10);
				if (!file || Number.isNaN(count)) {
					return null;
				}
				return create(GrepFileCountSchema, { file, count });
			})
			.filter((entry): entry is GrepFileCount => entry !== null);
		const totalMatches = counts.reduce((sum, entry) => sum + entry.count, 0);
		unionResult = create(GrepUnionResultSchema, {
			result: {
				case: "count",
				value: create(GrepCountResultSchema, {
					counts,
					totalFiles: counts.length,
					totalMatches,
					clientTruncated,
					ripgrepTruncated: false,
				}),
			},
		});
	} else {
		const matchMap = new Map<string, Array<{ line: number; content: string; isContextLine: boolean }>>();
		let totalMatchedLines = 0;

		for (const line of lines) {
			const matchLine = line.match(/^(.+?):(\d+):\s?(.*)$/);
			const contextLine = line.match(/^(.+?)-(\d+)-\s?(.*)$/);
			const match = matchLine ?? contextLine;
			if (!match) {
				continue;
			}
			const [, file, lineNumber, content] = match;
			const isContextLine = Boolean(contextLine);
			const list = matchMap.get(file) ?? [];
			list.push({ line: Number(lineNumber), content, isContextLine });
			matchMap.set(file, list);
			if (!isContextLine) {
				totalMatchedLines += 1;
			}
		}

		const matches = Array.from(matchMap.entries()).map(([file, matches]) =>
			create(GrepFileMatchSchema, {
				file,
				matches: matches.map(entry =>
					create(GrepContentMatchSchema, {
						lineNumber: entry.line,
						content: entry.content,
						contentTruncated: false,
						isContextLine: entry.isContextLine,
					}),
				),
			}),
		);
		const totalLines = matches.reduce((sum, entry) => sum + entry.matches.length, 0);
		unionResult = create(GrepUnionResultSchema, {
			result: {
				case: "content",
				value: create(GrepContentResultSchema, {
					matches,
					totalLines,
					totalMatchedLines,
					clientTruncated,
					ripgrepTruncated: false,
				}),
			},
		});
	}

	return create(GrepResultSchema, {
		result: {
			case: "success",
			value: create(GrepSuccessSchema, {
				pattern: args.pattern,
				path: args.path || "",
				outputMode,
				workspaceResults: { [workspaceKey]: unionResult },
			}),
		},
	});
}

function buildGrepErrorResult(error: string) {
	return create(GrepResultSchema, {
		result: {
			case: "error",
			value: create(GrepErrorSchema, { error }),
		},
	});
}

function buildDiagnosticsResultFromToolResult(path: string, toolResult: ToolResultMessage) {
	const text = toolResultToText(toolResult);
	if (toolResult.isError) {
		return buildDiagnosticsErrorResult(path, text || "Diagnostics failed");
	}
	return create(DiagnosticsResultSchema, {
		result: {
			case: "success",
			value: create(DiagnosticsSuccessSchema, {
				path,
				diagnostics: [],
				totalDiagnostics: 0,
			}),
		},
	});
}

function buildDiagnosticsErrorResult(_path: string, error: string) {
	return create(DiagnosticsResultSchema, {
		result: {
			case: "error",
			value: create(DiagnosticsErrorSchema, { error }),
		},
	});
}

function buildDiagnosticsRejectedResult(path: string, reason: string) {
	return create(DiagnosticsResultSchema, {
		result: {
			case: "rejected",
			value: create(DiagnosticsRejectedSchema, { path, reason }),
		},
	});
}

function parseToolArgsJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) {
		return text;
	}
	try {
		const normalized = trimmed
			.replace(/\bNone\b/g, "null")
			.replace(/\bTrue\b/g, "true")
			.replace(/\bFalse\b/g, "false");
		return Bun.JSON5.parse(normalized);
	} catch {}
	return text;
}

function decodeMcpArgValue(value: Uint8Array): unknown {
	try {
		const parsedValue = fromBinary(ValueSchema, value);
		const jsonValue = toJson(ValueSchema, parsedValue) as JsonValue;
		if (typeof jsonValue === "string") {
			return parseToolArgsJson(jsonValue);
		}
		return jsonValue;
	} catch {}
	const text = new TextDecoder().decode(value);
	return parseToolArgsJson(text);
}

function decodeMcpArgsMap(args?: Record<string, Uint8Array>): Record<string, unknown> | undefined {
	if (!args) {
		return undefined;
	}
	const decoded: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		decoded[key] = decodeMcpArgValue(value);
	}
	return decoded;
}

function decodeMcpCall(args: {
	name: string;
	args: Record<string, Uint8Array>;
	toolCallId: string;
	providerIdentifier: string;
	toolName: string;
}): CursorMcpCall {
	const decodedArgs: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args.args ?? {})) {
		decodedArgs[key] = decodeMcpArgValue(value);
	}
	return {
		name: args.name,
		providerIdentifier: args.providerIdentifier,
		toolName: args.toolName || args.name,
		toolCallId: args.toolCallId,
		args: decodedArgs,
		rawArgs: args.args ?? {},
	};
}

function mapTodoStatusValue(status?: number): "pending" | "in_progress" | "completed" {
	switch (status) {
		case 2:
			return "in_progress";
		case 3:
			return "completed";
		default:
			return "pending";
	}
}

interface CursorTodoItem {
	id?: string;
	content?: string;
	status?: number;
}

interface CursorUpdateTodosToolCall {
	updateTodosToolCall?: { args?: { todos?: CursorTodoItem[] } };
}

function buildTodoWriteArgs(toolCall: CursorUpdateTodosToolCall): {
	todos: Array<{ id?: string; content: string; activeForm: string; status: "pending" | "in_progress" | "completed" }>;
} | null {
	const todos = toolCall.updateTodosToolCall?.args?.todos;
	if (!todos) return null;
	return {
		todos: todos.map(todo => ({
			id: typeof todo.id === "string" && todo.id.length > 0 ? todo.id : undefined,
			content: typeof todo.content === "string" ? todo.content : "",
			activeForm: typeof todo.content === "string" ? todo.content : "",
			status: mapTodoStatusValue(typeof todo.status === "number" ? todo.status : undefined),
		})),
	};
}

function buildMcpResultFromToolResult(_mcpCall: CursorMcpCall, toolResult: ToolResultMessage) {
	if (toolResult.isError) {
		return buildMcpErrorResult(toolResultToText(toolResult) || "MCP tool failed");
	}
	const content = toolResult.content.map(item => {
		if (item.type === "image") {
			return create(McpToolResultContentItemSchema, {
				content: {
					case: "image",
					value: create(McpImageContentSchema, {
						data: Uint8Array.from(Buffer.from(item.data, "base64")),
						mimeType: item.mimeType,
					}),
				},
			});
		}
		return create(McpToolResultContentItemSchema, {
			content: {
				case: "text",
				value: create(McpTextContentSchema, { text: item.text }),
			},
		});
	});

	return create(McpResultSchema, {
		result: {
			case: "success",
			value: create(McpSuccessSchema, {
				content,
				isError: false,
			}),
		},
	});
}

function buildMcpToolNotFoundResult(mcpCall: CursorMcpCall) {
	return create(McpResultSchema, {
		result: {
			case: "toolNotFound",
			value: create(McpToolNotFoundSchema, { name: mcpCall.toolName, availableTools: [] }),
		},
	});
}

function buildMcpErrorResult(error: string) {
	return create(McpResultSchema, {
		result: {
			case: "error",
			value: create(McpErrorSchema, { error }),
		},
	});
}

function processInteractionUpdate(
	update: any,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	state: BlockState,
	usageState: UsageState,
): void {
	const updateCase = update.message?.case;

	log("interactionUpdate", updateCase, update.message?.value);

	if (updateCase === "textDelta") {
		state.setFirstTokenTime();
		const delta = update.message.value.text || "";
		if (!state.currentTextBlock) {
			const block: TextContent & { index: number } = {
				type: "text",
				text: "",
				index: output.content.length,
			};
			output.content.push(block);
			state.setTextBlock(block);
			stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
		}
		state.currentTextBlock!.text += delta;
		const idx = output.content.indexOf(state.currentTextBlock!);
		stream.push({ type: "text_delta", contentIndex: idx, delta, partial: output });
	} else if (updateCase === "thinkingDelta") {
		state.setFirstTokenTime();
		const delta = update.message.value.text || "";
		if (!state.currentThinkingBlock) {
			const block: ThinkingContent & { index: number } = {
				type: "thinking",
				thinking: "",
				index: output.content.length,
			};
			output.content.push(block);
			state.setThinkingBlock(block);
			stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
		}
		state.currentThinkingBlock!.thinking += delta;
		const idx = output.content.indexOf(state.currentThinkingBlock!);
		stream.push({ type: "thinking_delta", contentIndex: idx, delta, partial: output });
	} else if (updateCase === "thinkingCompleted") {
		if (state.currentThinkingBlock) {
			const idx = output.content.indexOf(state.currentThinkingBlock);
			delete (state.currentThinkingBlock as any).index;
			stream.push({
				type: "thinking_end",
				contentIndex: idx,
				content: state.currentThinkingBlock.thinking,
				partial: output,
			});
			state.setThinkingBlock(null);
		}
	} else if (updateCase === "toolCallStarted") {
		const toolCall = update.message.value.toolCall;
		if (toolCall) {
			const mcpCall = toolCall.mcpToolCall;
			if (mcpCall) {
				const args = mcpCall.args || {};
				const block: ToolCallState = {
					type: "toolCall",
					id: args.toolCallId || crypto.randomUUID(),
					name: args.name || args.toolName || "",
					arguments: {},
					index: output.content.length,
					partialJson: "",
					kind: "mcp",
				};
				output.content.push(block);
				state.setToolCall(block);
				stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
				return;
			}

			const todoArgs = buildTodoWriteArgs(toolCall);
			if (todoArgs) {
				const callId = update.message.value.callId || crypto.randomUUID();
				const block: ToolCallState = {
					type: "toolCall",
					id: callId,
					name: "todo_write",
					arguments: todoArgs,
					index: output.content.length,
					kind: "todo_write",
				};
				output.content.push(block);
				state.setToolCall(block);
				stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
			}
		}
	} else if (updateCase === "toolCallDelta" || updateCase === "partialToolCall") {
		if (state.currentToolCall?.kind === "mcp") {
			const delta = update.message.value.argsTextDelta || "";
			state.currentToolCall.partialJson = `${state.currentToolCall.partialJson ?? ""}${delta}`;
			state.currentToolCall.arguments = parseStreamingJson(state.currentToolCall.partialJson ?? "");
			const idx = output.content.indexOf(state.currentToolCall);
			stream.push({ type: "toolcall_delta", contentIndex: idx, delta, partial: output });
		}
	} else if (updateCase === "toolCallCompleted") {
		if (state.currentToolCall) {
			const toolCall = update.message.value.toolCall;
			if (state.currentToolCall.kind === "mcp") {
				const decodedArgs = decodeMcpArgsMap(toolCall?.mcpToolCall?.args?.args);
				if (decodedArgs) {
					state.currentToolCall.arguments = decodedArgs;
				}
			} else if (state.currentToolCall.kind === "todo_write" && toolCall) {
				const todoArgs = buildTodoWriteArgs(toolCall);
				if (todoArgs) {
					state.currentToolCall.arguments = todoArgs;
				}
			}
			const idx = output.content.indexOf(state.currentToolCall);
			delete (state.currentToolCall as any).partialJson;
			delete (state.currentToolCall as any).index;
			delete (state.currentToolCall as any).kind;
			stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: state.currentToolCall, partial: output });
			state.setToolCall(null);
		}
	} else if (updateCase === "turnEnded") {
		output.stopReason = "stop";
	} else if (updateCase === "tokenDelta") {
		const tokenDelta = update.message.value;
		usageState.sawTokenDelta = true;
		output.usage.output += tokenDelta.tokens || 0;
		output.usage.totalTokens = output.usage.input + output.usage.output;
	}
}

function handleConversationCheckpointUpdate(
	checkpoint: ConversationStateStructure,
	output: AssistantMessage,
	usageState: UsageState,
	onConversationCheckpoint?: (checkpoint: ConversationStateStructure) => void,
): void {
	onConversationCheckpoint?.(checkpoint);
	if (usageState.sawTokenDelta) {
		return;
	}
	const usedTokens = checkpoint.tokenDetails?.usedTokens ?? 0;
	if (usedTokens <= 0) {
		return;
	}
	if (output.usage.output !== usedTokens) {
		output.usage.output = usedTokens;
		output.usage.totalTokens = output.usage.input + output.usage.output;
	}
}

function createBlobId(data: Uint8Array): Uint8Array {
	return new Uint8Array(createHash("sha256").update(data).digest());
}

const CURSOR_NATIVE_TOOL_NAMES = new Set(["bash", "read", "write", "delete", "ls", "grep", "lsp", "todo_write"]);

function buildMcpToolDefinitions(tools: Tool[] | undefined): McpToolDefinition[] {
	if (!tools || tools.length === 0) {
		return [];
	}

	const advertisedTools = tools.filter(tool => !CURSOR_NATIVE_TOOL_NAMES.has(tool.name));
	if (advertisedTools.length === 0) {
		return [];
	}

	return advertisedTools.map(tool => {
		const jsonSchema = tool.parameters as Record<string, unknown> | undefined;
		const schemaValue: JsonValue =
			jsonSchema && typeof jsonSchema === "object"
				? (jsonSchema as JsonValue)
				: { type: "object", properties: {}, required: [] };
		const inputSchema = toBinary(ValueSchema, fromJson(ValueSchema, schemaValue));
		return create(McpToolDefinitionSchema, {
			name: tool.name,
			description: tool.description || "",
			providerIdentifier: "pi-agent",
			toolName: tool.name,
			inputSchema,
		});
	});
}

/**
 * Extract text content from a user or developer message.
 */
function extractUserMessageText(msg: Message): string {
	if (msg.role !== "user" && msg.role !== "developer") return "";
	const content = msg.content;
	if (typeof content === "string") return content.trim();
	const text = content
		.filter((c): c is TextContent => c.type === "text")
		.map(c => c.text)
		.join("\n");
	return text.trim();
}

/**
 * Extract text content from an assistant message.
 */
function extractAssistantMessageText(msg: Message): string {
	if (msg.role !== "assistant") return "";
	if (!Array.isArray(msg.content)) return "";
	return msg.content
		.filter((c): c is TextContent => c.type === "text")
		.map(c => c.text)
		.join("\n");
}

/**
 * Convert context.messages to Cursor's serialized ConversationTurn format.
 * Groups messages into turns: each turn is a user message followed by the assistant's response.
 * Excludes the last user message (which goes in the action).
 * Returns serialized bytes for ConversationStateStructure.turns field.
 */
function buildConversationTurns(messages: Message[]): Uint8Array[] {
	const turns: Uint8Array[] = [];

	// Find turn boundaries - each turn starts with a user message
	let i = 0;
	while (i < messages.length) {
		const msg = messages[i];

		// Skip non-user messages at the start
		if (msg.role !== "user" && msg.role !== "developer") {
			i++;
			continue;
		}

		// Check if this is the last user message (which goes in the action, not turns)
		let isLastUserMessage = true;
		for (let j = i + 1; j < messages.length; j++) {
			if (messages[j].role === "user" || messages[j].role === "developer") {
				isLastUserMessage = false;
				break;
			}
		}
		if (isLastUserMessage) {
			break;
		}

		// Create and serialize user message
		const userText = extractUserMessageText(msg);
		if (!userText || userText.length === 0) {
			i++;
			continue;
		}

		const userMessage = create(UserMessageSchema, {
			text: userText,
			messageId: crypto.randomUUID(),
		});
		const userMessageBytes = toBinary(UserMessageSchema, userMessage);

		// Collect and serialize steps until next user message
		const stepBytes: Uint8Array[] = [];
		i++;

		while (i < messages.length && messages[i].role !== "user" && messages[i].role !== "developer") {
			const stepMsg = messages[i];

			if (stepMsg.role === "assistant") {
				const text = extractAssistantMessageText(stepMsg);
				if (text) {
					const step = create(ConversationStepSchema, {
						message: {
							case: "assistantMessage",
							value: create(AssistantMessageSchema, { text }),
						},
					});
					stepBytes.push(toBinary(ConversationStepSchema, step));
				}
			} else if (stepMsg.role === "toolResult") {
				// Include tool results as assistant text for context
				const text = toolResultToText(stepMsg);
				if (text) {
					const step = create(ConversationStepSchema, {
						message: {
							case: "assistantMessage",
							value: create(AssistantMessageSchema, { text: `[Tool Result]\n${text}` }),
						},
					});
					stepBytes.push(toBinary(ConversationStepSchema, step));
				}
			}

			i++;
		}

		// Create the serialized turn using Structure types (bytes)
		const agentTurn = create(AgentConversationTurnStructureSchema, {
			userMessage: userMessageBytes,
			steps: stepBytes,
		});
		const turn = create(ConversationTurnStructureSchema, {
			turn: {
				case: "agentConversationTurn",
				value: agentTurn,
			},
		});
		turns.push(toBinary(ConversationTurnStructureSchema, turn));
	}

	return turns;
}

function buildGrpcRequest(
	model: Model<"cursor-agent">,
	context: Context,
	options: CursorOptions | undefined,
	state: {
		conversationId: string;
		blobStore: Map<string, Uint8Array>;
		conversationState?: ConversationStateStructure;
	},
): {
	requestBytes: Uint8Array;
	blobStore: Map<string, Uint8Array>;
	conversationState: ConversationStateStructure;
} {
	const blobStore = state.blobStore;

	const systemPromptJson = JSON.stringify({
		role: "system",
		content: context.systemPrompt || "You are a helpful assistant.",
	});
	const systemPromptBytes = new TextEncoder().encode(systemPromptJson);
	const systemPromptId = createBlobId(systemPromptBytes);
	blobStore.set(Buffer.from(systemPromptId).toString("hex"), systemPromptBytes);

	const lastMessage = context.messages[context.messages.length - 1];
	const userText =
		lastMessage?.role === "user" || lastMessage?.role === "developer"
			? typeof lastMessage.content === "string"
				? lastMessage.content.trim()
				: extractText(lastMessage.content)
			: "";

	// Validate that we have non-empty user text for the action
	if (!userText || userText.trim().length === 0) {
		throw new Error("Cannot send empty user message to Cursor API");
	}

	const userMessage = create(UserMessageSchema, {
		text: userText,
		messageId: crypto.randomUUID(),
	});

	const action = create(ConversationActionSchema, {
		action: {
			case: "userMessageAction",
			value: create(UserMessageActionSchema, { userMessage }),
		},
	});

	// Build conversation turns from prior messages (excluding the last user message)
	const turns = buildConversationTurns(context.messages);

	const hasMatchingPrompt = state.conversationState?.rootPromptMessagesJson?.some(entry =>
		Buffer.from(entry).equals(systemPromptId),
	);

	// Use cached state if available and system prompt matches, but always update turns
	// from context.messages to ensure full conversation history is sent
	const baseState =
		state.conversationState && hasMatchingPrompt
			? state.conversationState
			: create(ConversationStateStructureSchema, {
					rootPromptMessagesJson: [systemPromptId],
					turns: [],
					todos: [],
					pendingToolCalls: [],
					previousWorkspaceUris: [],
					fileStates: {},
					fileStatesV2: {},
					summaryArchives: [],
					turnTimings: [],
					subagentStates: {},
					selfSummaryCount: 0,
					readPaths: [],
				});

	// Always populate turns from context.messages to ensure Cursor sees full conversation
	const conversationState = create(ConversationStateStructureSchema, {
		...baseState,
		turns: turns.length > 0 ? turns : baseState.turns,
	});

	const modelDetails = create(ModelDetailsSchema, {
		modelId: model.id,
		displayModelId: model.id,
		displayName: model.name,
	});

	const runRequest = create(AgentRunRequestSchema, {
		conversationState,
		action,
		modelDetails,
		conversationId: state.conversationId,
	});

	options?.onPayload?.(runRequest);

	// Tools are sent later via requestContext (exec handshake)

	if (options?.customSystemPrompt) {
		runRequest.customSystemPrompt = options.customSystemPrompt;
	}

	const clientMessage = create(AgentClientMessageSchema, {
		message: { case: "runRequest", value: runRequest },
	});

	const requestBytes = toBinary(AgentClientMessageSchema, clientMessage);

	const toolNames = context.tools?.map(tool => tool.name) ?? [];
	const detail =
		$env.DEBUG_CURSOR === "2"
			? ` ${JSON.stringify(clientMessage.message.value, debugReplacer, 2)?.slice(0, 2000)}`
			: "";
	log("info", "builtRunRequest", {
		bytes: requestBytes.length,
		tools: toolNames.length,
		toolNames: toolNames.slice(0, 20),
		detail: detail || undefined,
	});

	return { requestBytes, blobStore, conversationState };
}

function extractText(content: (TextContent | ImageContent)[]): string {
	return content
		.filter((c): c is TextContent => c.type === "text")
		.map(c => c.text)
		.join("\n");
}

```


## PARALLEL

### Authentication Implementation (`parallel.ts`)

```typescript
/**
 * Parallel login flow.
 *
 * Parallel uses an API key from the account settings page.
 * This is an API key flow:
 * 1. Open browser to Parallel API key settings
 * 2. User copies API key
 * 3. User pastes key into the CLI/TUI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://platform.parallel.ai/settings?tab=api-keys";

/**
 * Login to Parallel.
 *
 * Opens browser to the API keys page, prompts the user to paste their API key,
 * and returns the API key directly.
 */
export async function loginParallel(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Parallel login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Parallel API key from the Parallel settings page.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Parallel API key",
		placeholder: "sk_...",
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

```


## DEVIN

### Authentication Implementation (`devin.ts`)

```typescript
/**
 * Devin login flow.
 *
 * Devin uses an API key from the account settings page.
 * This is an API key flow:
 * 1. Open browser to Devin settings (or just prompt for it)
 * 2. User copies API key
 * 3. User pastes key into CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://docs.devin.ai/";

/**
 * Login to Devin.
 *
 * Prompts user to paste their API key.
 * Returns the API key directly.
 */
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

```

### Provider API Implementation (`devin.ts`)

```typescript
import { calculateCost } from "../models";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	StreamFunction,
	StreamOptions,
	TextContent,
} from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { formatErrorMessageWithRetryAfter } from "../utils/retry-after";

export interface DevinOptions extends StreamOptions {}

export const streamDevin: StreamFunction<"devin-agent"> = (
	model: Model<"devin-agent">,
	context: Context,
	options?: DevinOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "devin-agent" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error("Devin API key is required");
			}

			const baseUrl = model.baseUrl || "https://api.devin.ai/v3";
			const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

			// Find Org ID if targeting v3
			let orgId = process.env.DEVIN_ORG_ID;
			if (!orgId && normalizedBaseUrl.includes("/v3")) {
				const selfRes = await fetch(`${normalizedBaseUrl}/self`, {
					headers: { Authorization: `Bearer ${apiKey}` },
					signal: options?.signal,
				});
				if (!selfRes.ok) {
					throw new Error(`Devin API self lookup failed (${selfRes.status}): ${await selfRes.text()}`);
				}
				const selfData = await selfRes.json();
				orgId = selfData?.org_id;
				if (!orgId) {
					throw new Error("Devin API self lookup returned no org_id");
				}
			}

			// Extract the prompt from context messages.
			const prompt = context.messages
				.map(m => {
					let content = "";
					if (typeof m.content === "string") {
						content = m.content;
					} else {
						content = m.content
							.map(c => {
								if (c.type === "text") return c.text;
								return "";
							})
							.join("");
					}
					return `${m.role}: ${content}`;
				})
				.join("\n\n");

			const title =
				context.systemPrompt && context.systemPrompt.trim().length > 0
					? `Devin Session: ${context.systemPrompt.split("\n", 1)[0].slice(0, 80)}`
					: "Devin Session";

			const devinUser = process.env.DEVIN_USER;
			const sessionEndpoint = normalizedBaseUrl.includes("/v3")
				? `${normalizedBaseUrl}/organizations/${orgId}/sessions`
				: `${normalizedBaseUrl}/sessions`;

			const createRes = await fetch(sessionEndpoint, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					prompt: context.systemPrompt ? `${context.systemPrompt}\n\n${prompt}` : prompt,
					title,
					...(devinUser ? { create_as_user_id: devinUser } : {}),
				}),
				signal: options?.signal,
			});

			if (!createRes.ok) {
				const text = await createRes.text();
				throw new Error(`Devin API session creation failed (${createRes.status}): ${text}`);
			}

			const sessionData = await createRes.json();
			const sessionId = sessionData?.session_id;

			stream.push({ type: "start", partial: output });

			const currentTextBlock: TextContent & { index: number } = {
				type: "text",
				text: "",
				index: 0,
			};
			output.content.push(currentTextBlock);
			stream.push({ type: "text_start", contentIndex: 0, partial: output });

			if (sessionId) {
				// Poll session
				let isDone = false;
				let lastStatus = "";
				while (!isDone) {
					if (options?.signal?.aborted) {
						throw new Error("Request was aborted");
					}

					const pollRes = await fetch(`${sessionEndpoint}/${sessionId}`, {
						headers: { Authorization: `Bearer ${apiKey}` },
						signal: options?.signal,
					});

					if (!pollRes.ok) {
						const text = await pollRes.text();
						throw new Error(`Devin API polling failed (${pollRes.status}): ${text}`);
					}

					const pollData = await pollRes.json();

					if (pollData) {
						if (
							pollData.status === "finished" ||
							pollData.status === "errored" ||
							pollData.status === "stopped" ||
							pollData.status === "blocked" ||
							pollData.status === "canceled"
						) {
							isDone = true;
							if (pollData.status === "errored") output.stopReason = "error";
							if (pollData.status === "canceled") output.stopReason = "aborted";
						}

						const msg = `Session ${sessionId} status: ${pollData.status}\n`;
						if (msg !== lastStatus) {
							if (!firstTokenTime) firstTokenTime = Date.now();
							currentTextBlock.text += msg;
							stream.push({ type: "text_delta", contentIndex: 0, delta: msg, partial: output });
							lastStatus = msg;
						}
					}

					if (!isDone) {
						await new Promise(r => setTimeout(r, 5000));
					}
				}
			} else {
				throw new Error("Successfully requested Devin session, but could not parse session ID.");
			}

			stream.push({
				type: "text_end",
				contentIndex: 0,
				content: currentTextBlock.text,
				partial: output,
			});

			calculateCost(model, output.usage);

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			const stopReason = output.stopReason;
			if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse") {
				stream.push({
					type: "done",
					reason: stopReason,
					message: output,
				});
			} else {
				stream.push({ type: "error", reason: stopReason, error: output });
			}
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatErrorMessageWithRetryAfter(error);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

```


## TAVILY

### Authentication Implementation (`tavily.ts`)

```typescript
/**
 * Tavily login flow.
 *
 * Tavily web search uses an API key from the account settings page.
 * This is an API key flow:
 * 1. Open browser to Tavily settings
 * 2. User copies API key
 * 3. User pastes key into CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://app.tavily.com/home";

/**
 * Login to Tavily.
 *
 * Opens browser to API keys page and prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginTavily(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Tavily login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your Tavily API key from the API Keys page.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Tavily API key",
		placeholder: "tvly-...",
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

```


## API-KEY-VALIDATION

### Authentication Implementation (`api-key-validation.ts`)

```typescript
type OpenAICompatibleValidationOptions = {
	provider: string;
	apiKey: string;
	baseUrl: string;
	model: string;
	signal?: AbortSignal;
};

type ModelListValidationOptions = {
	provider: string;
	apiKey: string;
	modelsUrl: string;
	signal?: AbortSignal;
};

const VALIDATION_TIMEOUT_MS = 15_000;

/**
 * Validate an API key against an OpenAI-compatible chat completions endpoint.
 *
 * Performs a minimal request to verify credentials and endpoint access.
 */
export async function validateOpenAICompatibleApiKey(options: OpenAICompatibleValidationOptions): Promise<void> {
	const timeoutSignal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

	const response = await fetch(`${options.baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${options.apiKey}`,
		},
		body: JSON.stringify({
			model: options.model,
			messages: [{ role: "user", content: "ping" }],
			max_tokens: 1,
			temperature: 0,
		}),
		signal,
	});

	if (response.ok) {
		return;
	}

	let details = "";
	try {
		details = (await response.text()).trim();
	} catch {
		// ignore body parse errors, status is enough
	}

	const message = details
		? `${options.provider} API key validation failed (${response.status}): ${details}`
		: `${options.provider} API key validation failed (${response.status})`;
	throw new Error(message);
}

/**
 * Validate an API key against a provider models endpoint.
 *
 * Useful for providers where access to specific models may vary by plan and
 * should not block key validation.
 */
export async function validateApiKeyAgainstModelsEndpoint(options: ModelListValidationOptions): Promise<void> {
	const timeoutSignal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

	const response = await fetch(options.modelsUrl, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
		},
		signal,
	});

	if (response.ok) {
		return;
	}

	let details = "";
	try {
		details = (await response.text()).trim();
	} catch {
		// ignore body parse errors, status is enough
	}

	const message = details
		? `${options.provider} API key validation failed (${response.status}): ${details}`
		: `${options.provider} API key validation failed (${response.status})`;
	throw new Error(message);
}

```


## OPENAI-CODEX

### Authentication Implementation (`openai-codex.ts`)

```typescript
/**
 * OpenAI Codex (ChatGPT OAuth) flow
 */
import { OAuthCallbackFlow } from "./callback-server";
import { generatePKCE } from "./pkce";
import type { OAuthController, OAuthCredentials } from "./types";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const JWT_PROFILE_CLAIM = "https://api.openai.com/profile";
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

type JwtPayload = {
	[JWT_CLAIM_PATH]?: {
		chatgpt_account_id?: string;
	};
	[JWT_PROFILE_CLAIM]?: {
		email?: string;
	};
	[key: string]: unknown;
};

function decodeJwt(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

function getTokenProfile(accessToken: string): { accountId?: string; email?: string } {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[JWT_CLAIM_PATH];
	const accountId = auth?.chatgpt_account_id;
	const email = payload?.[JWT_PROFILE_CLAIM]?.email?.trim().toLowerCase();
	return {
		accountId: typeof accountId === "string" && accountId.length > 0 ? accountId : undefined,
		email: typeof email === "string" && email.length > 0 ? email : undefined,
	};
}

interface PKCE {
	verifier: string;
	challenge: string;
}

class OpenAICodexOAuthFlow extends OAuthCallbackFlow {
	constructor(
		ctrl: OAuthController,
		private readonly pkce: PKCE,
		private readonly originator: string,
	) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const searchParams = new URLSearchParams({
			response_type: "code",
			client_id: CLIENT_ID,
			redirect_uri: redirectUri,
			scope: SCOPE,
			code_challenge: this.pkce.challenge,
			code_challenge_method: "S256",
			state,
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: this.originator,
		});

		const url = `${AUTHORIZE_URL}?${searchParams.toString()}`;
		return { url, instructions: "A browser window should open. Complete login to finish." };
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		return exchangeCodeForToken(code, this.pkce.verifier, redirectUri);
	}
}

async function exchangeCodeForToken(code: string, verifier: string, redirectUri: string): Promise<OAuthCredentials> {
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
	});

	if (!tokenResponse.ok) {
		throw new Error(`Token exchange failed: ${tokenResponse.status}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!tokenData.access_token || !tokenData.refresh_token || typeof tokenData.expires_in !== "number") {
		throw new Error("Token response missing required fields");
	}

	const { accountId, email } = getTokenProfile(tokenData.access_token);
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}

	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token,
		expires: Date.now() + tokenData.expires_in * 1000,
		accountId,
		email,
	};
}

/**
 * Login with OpenAI Codex OAuth
 */
export type OpenAICodexLoginOptions = OAuthController & {
	/** Optional originator value for OpenAI Codex OAuth. Default: "opencode". */
	originator?: string;
};

export async function loginOpenAICodex(options: OpenAICodexLoginOptions): Promise<OAuthCredentials> {
	const pkce = await generatePKCE();
	const originator = options.originator?.trim() || "opencode";
	const flow = new OpenAICodexOAuthFlow(options, pkce, originator);

	return flow.login();
}

/**
 * Refresh OpenAI Codex OAuth token
 */
export async function refreshOpenAICodexToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
	});

	if (!response.ok) {
		let detail = `${response.status}`;
		try {
			const body = (await response.json()) as { error?: string; error_description?: string };
			if (body.error)
				detail = `${response.status} ${body.error}${body.error_description ? `: ${body.error_description}` : ""}`;
		} catch {}
		throw new Error(`OpenAI Codex token refresh failed: ${detail}`);
	}

	const tokenData = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (!tokenData.access_token || !tokenData.refresh_token || typeof tokenData.expires_in !== "number") {
		throw new Error("Token response missing required fields");
	}

	const { accountId, email } = getTokenProfile(tokenData.access_token);

	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token || refreshToken,
		expires: Date.now() + tokenData.expires_in * 1000,
		accountId: accountId ?? undefined,
		email,
	};
}

```


## OPENCODE

### Authentication Implementation (`opencode.ts`)

```typescript
/**
 * OpenCode Zen login flow.
 *
 * OpenCode Zen is a subscription service that provides access to various AI models
 * (GPT-5.x, Claude 4.x, Gemini 3, etc.) through a unified API at opencode.ai/zen.
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to https://opencode.ai/auth
 * 2. User logs in and copies their API key
 * 3. User pastes the API key back into the CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://opencode.ai/auth";

/**
 * Login to OpenCode Zen.
 *
 * Opens browser to auth page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginOpenCode(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("OpenCode Zen login requires onPrompt callback");
	}

	// Open browser to auth page
	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Log in and copy your API key",
	});

	// Prompt user to paste their API key
	const apiKey = await options.onPrompt({
		message: "Paste your OpenCode Zen API key",
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

```


## WARP

### Authentication Implementation (`warp.ts`)

```typescript
/**
 * Warp login flow.
 *
 * Warp Oz uses an API key from the platform settings page.
 * This is an API key flow:
 * 1. Open browser to Warp settings (or just prompt for it)
 * 2. User copies API key
 * 3. User pastes key into CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://docs.warp.dev/agent-platform/cloud-agents/team-access-billing-and-identity";

/**
 * Login to Warp.
 *
 * Prompts user to paste their API key.
 * Returns the API key directly.
 */
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

```

### Provider API Implementation (`warp.ts`)

```typescript
import { calculateCost } from "../models";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	StreamFunction,
	StreamOptions,
	TextContent,
} from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { formatErrorMessageWithRetryAfter } from "../utils/retry-after";

export interface WarpOptions extends StreamOptions {}

export const streamWarp: StreamFunction<"warp-agent"> = (
	model: Model<"warp-agent">,
	context: Context,
	options?: WarpOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "warp-agent" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error("Warp API key is required");
			}

			const baseUrl = model.baseUrl || "https://app.warp.dev/api/v1";

			// Format messages into a prompt string. Warp API takes a single prompt.
			const prompt = context.messages
				.map(m => {
					let content = "";
					if (typeof m.content === "string") {
						content = m.content;
					} else {
						content = m.content
							.map(c => {
								if (c.type === "text") return c.text;
								return "";
							})
							.join("");
					}
					return `${m.role}: ${content}`;
				})
				.join("\n\n");

			// 1. Create the run
			const runRes = await fetch(`${baseUrl}/agent/run`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					prompt: context.systemPrompt ? `${context.systemPrompt}\n\n${prompt}` : prompt,
					config: {
						model_id: model.id,
					},
					interactive: false,
				}),
				signal: options?.signal,
			});

			if (!runRes.ok) {
				const text = await runRes.text();
				throw new Error(`Warp API error (${runRes.status}): ${text}`);
			}

			const runData = (await runRes.json()) as { run_id: string };
			const runId = runData.run_id;

			stream.push({ type: "start", partial: output });

			const currentTextBlock: TextContent & { index: number } = {
				type: "text",
				text: "",
				index: 0,
			};
			output.content.push(currentTextBlock);
			stream.push({ type: "text_start", contentIndex: 0, partial: output });

			// 2. Poll for completion
			let isDone = false;
			let lastLength = 0;
			while (!isDone) {
				if (options?.signal?.aborted) {
					// Attempt to cancel
					await fetch(`${baseUrl}/agent/runs/${runId}/cancel`, {
						method: "POST",
						headers: { Authorization: `Bearer ${apiKey}` },
					}).catch(() => {});
					throw new Error("Request was aborted");
				}

				const pollRes = await fetch(`${baseUrl}/agent/runs/${runId}`, {
					headers: { Authorization: `Bearer ${apiKey}` },
					signal: options?.signal,
				});

				if (!pollRes.ok) {
					const text = await pollRes.text();
					throw new Error(`Warp API error during polling (${pollRes.status}): ${text}`);
				}

				const pollData = (await pollRes.json()) as any;

				// Simulate streaming by diffing the artifacts or status message if any is available
				// Warp runs return `artifacts` or `status_message`. Let's just output the status or final artifact.
				let newText = "";

				if (pollData.state === "SUCCEEDED") {
					isDone = true;
					if (pollData.artifacts && pollData.artifacts.length > 0) {
						newText = JSON.stringify(pollData.artifacts, null, 2);
					} else {
						newText = "Run succeeded.";
					}
				} else if (pollData.state === "FAILED" || pollData.state === "ERROR") {
					isDone = true;
					output.stopReason = "error";
					newText = pollData.status_message?.message || "Run failed with an error.";
				} else if (pollData.state === "CANCELLED") {
					isDone = true;
					output.stopReason = "aborted";
					newText = "Run was cancelled.";
				} else if (pollData.state === "BLOCKED") {
					isDone = true;
					output.stopReason = "stop";
					newText = "Run is blocked (awaiting user input/approval).";
				} else {
					// INPROGRESS, QUEUED, PENDING, CLAIMED
					// Can we get live logs? The API docs don't show a clear streaming endpoint.
					// Just wait.
					await new Promise(r => setTimeout(r, 2000));
					continue;
				}

				if (newText && newText.length > lastLength) {
					if (!firstTokenTime) firstTokenTime = Date.now();
					const delta = newText.slice(lastLength);
					currentTextBlock.text += delta;
					stream.push({ type: "text_delta", contentIndex: 0, delta, partial: output });
					lastLength = newText.length;
				}
			}

			stream.push({
				type: "text_end",
				contentIndex: 0,
				content: currentTextBlock.text,
				partial: output,
			});

			calculateCost(model, output.usage);

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			const stopReason = output.stopReason;
			if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse") {
				stream.push({
					type: "done",
					reason: stopReason,
					message: output,
				});
			} else {
				stream.push({ type: "error", reason: stopReason, error: output });
			}
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatErrorMessageWithRetryAfter(error);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

```


## KILO

### Authentication Implementation (`kilo.ts`)

```typescript
import type { OAuthController, OAuthCredentials } from "./types";

const KILO_DEVICE_AUTH_BASE_URL = "https://api.kilo.ai/api/device-auth";
const POLL_INTERVAL_MS = 5000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface KiloDeviceAuthCodeResponse {
	code?: string;
	verificationUrl?: string;
	expiresIn?: number;
}

interface KiloDeviceAuthPollResponse {
	status?: string;
	token?: string;
}

/**
 * Login with Kilo Gateway OAuth (device code flow).
 */
export async function loginKilo(callbacks: OAuthController): Promise<OAuthCredentials> {
	const initiateResponse = await fetch(`${KILO_DEVICE_AUTH_BASE_URL}/codes`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
	});

	if (!initiateResponse.ok) {
		if (initiateResponse.status === 429) {
			throw new Error("Too many pending authorization requests. Please try again later.");
		}
		throw new Error(`Failed to initiate device authorization: ${initiateResponse.status}`);
	}

	const initiateData = (await initiateResponse.json()) as KiloDeviceAuthCodeResponse;
	const userCode = initiateData.code;
	const verificationUrl = initiateData.verificationUrl;
	const expiresInSeconds = initiateData.expiresIn;
	if (!userCode || !verificationUrl || typeof expiresInSeconds !== "number" || expiresInSeconds <= 0) {
		throw new Error("Kilo device authorization response missing required fields");
	}

	callbacks.onAuth?.({
		url: verificationUrl,
		instructions: `Enter code: ${userCode}`,
	});

	const deadline = Date.now() + expiresInSeconds * 1000;
	while (Date.now() < deadline) {
		if (callbacks.signal?.aborted) {
			throw new Error("Login cancelled");
		}

		const pollResponse = await fetch(`${KILO_DEVICE_AUTH_BASE_URL}/codes/${encodeURIComponent(userCode)}`);
		if (pollResponse.status === 202) {
			await Bun.sleep(POLL_INTERVAL_MS);
			continue;
		}
		if (pollResponse.status === 403) {
			throw new Error("Authorization was denied");
		}
		if (pollResponse.status === 410) {
			throw new Error("Authorization code expired. Please try again.");
		}
		if (!pollResponse.ok) {
			throw new Error(`Failed to poll device authorization: ${pollResponse.status}`);
		}

		const pollData = (await pollResponse.json()) as KiloDeviceAuthPollResponse;
		if (pollData.status === "approved" && pollData.token) {
			return {
				refresh: "",
				access: pollData.token,
				expires: Date.now() + ONE_YEAR_MS,
			};
		}
		if (pollData.status === "denied") {
			throw new Error("Authorization was denied");
		}
		if (pollData.status === "expired") {
			throw new Error("Authorization code expired. Please try again.");
		}

		await Bun.sleep(POLL_INTERVAL_MS);
	}

	throw new Error("Authentication timed out. Please try again.");
}

```


## LITELLM

### Authentication Implementation (`litellm.ts`)

```typescript
/**
 * LiteLLM login flow.
 *
 * LiteLLM is an OpenAI-compatible proxy that routes requests to many upstream providers.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to LiteLLM docs/dashboard
 * 2. User copies their LiteLLM API key
 * 3. User pastes the API key into the CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://docs.litellm.ai/docs/proxy/deploy";

/**
 * Login to LiteLLM.
 *
 * Opens browser to LiteLLM setup docs, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginLiteLLM(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("LiteLLM login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Run LiteLLM proxy (default http://localhost:4000/v1), then copy your master key or virtual key",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your LiteLLM API key (master key or virtual key)",
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

```


## PERPLEXITY

### Authentication Implementation (`perplexity.ts`)

```typescript
/**
 * Perplexity login and token refresh.
 *
 * Login paths (in priority order):
 * 1. macOS native app: reads JWT from NSUserDefaults (`defaults read ai.perplexity.mac authToken`)
 * 2. HTTP email OTP: `GET /api/auth/csrf` → `POST /api/auth/signin-email` → `POST /api/auth/signin-otp`
 *
 * No browser or manual cookie paste required.
 * Refresh: Socket.IO `refreshJWT` RPC over authenticated WebSocket connection.
 *
 * Protocol: Engine.IO v4 + Socket.IO v4 over WebSocket (bypasses Cloudflare managed challenge).
 * Architecture reverse-engineered from Perplexity macOS app (ai.perplexity.mac).
 */
import * as os from "node:os";
import { $env } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import type { OAuthController, OAuthCredentials } from "./types";

const API_VERSION = "2.18";
const NATIVE_APP_BUNDLE = "ai.perplexity.mac";
const APP_USER_AGENT = "Perplexity/641 CFNetwork/1568 Darwin/25.2.0";

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/** Extract expiry from a JWT. Falls back to 1 hour from now. Subtracts 5 min safety margin. */
function getJwtExpiry(token: string): number {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return Date.now() + 3600_000;
		const payload = parts[1] ?? "";
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
		if (decoded?.exp && typeof decoded.exp === "number") {
			return decoded.exp * 1000 - 5 * 60_000;
		}
	} catch {
		// Ignore decode errors
	}
	return Date.now() + 3600_000;
}

/** Build OAuthCredentials from a Perplexity JWT string. */
function jwtToCredentials(jwt: string, email?: string): OAuthCredentials {
	return {
		access: jwt,
		refresh: jwt,
		expires: getJwtExpiry(jwt),
		email,
	};
}

// ---------------------------------------------------------------------------
// Desktop app extraction
// ---------------------------------------------------------------------------

/**
 * Read the Perplexity JWT from the native macOS Catalyst app's UserDefaults.
 * Tokens are stored in NSUserDefaults (not Keychain), readable by any same-UID process.
 */
async function extractFromNativeApp(): Promise<string | null> {
	if (os.platform() !== "darwin") return null;

	try {
		const result = await $`defaults read ${NATIVE_APP_BUNDLE} authToken`.quiet().nothrow();
		if (result.exitCode !== 0) return null;
		const token = result.text().trim();
		if (!token || token === "(null)") return null;
		return token;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Socket.IO email OTP login
// ---------------------------------------------------------------------------

/**
 * Send email OTP and exchange it for a Perplexity JWT via HTTP endpoints.
 */
async function httpEmailLogin(ctrl: OAuthController): Promise<OAuthCredentials> {
	if (!ctrl.onPrompt) {
		throw new Error("Perplexity login requires onPrompt callback");
	}
	const email = await ctrl.onPrompt({
		message: "Enter your Perplexity email address",
		placeholder: "user@example.com",
	});
	const trimmedEmail = email.trim();
	if (!trimmedEmail) throw new Error("Email is required for Perplexity login");
	if (ctrl.signal?.aborted) throw new Error("Login cancelled");

	ctrl.onProgress?.("Fetching Perplexity CSRF token...");
	const csrfResponse = await fetch("https://www.perplexity.ai/api/auth/csrf", {
		headers: {
			"User-Agent": APP_USER_AGENT,
			"X-App-ApiVersion": API_VERSION,
		},
		signal: ctrl.signal,
	});

	if (!csrfResponse.ok) {
		throw new Error(`Perplexity CSRF request failed: ${csrfResponse.status}`);
	}

	const csrfData = (await csrfResponse.json()) as { csrfToken?: string };
	if (!csrfData.csrfToken) {
		throw new Error("Perplexity CSRF response missing csrfToken");
	}
	ctrl.onProgress?.("Sending login code to your email...");
	const sendResponse = await fetch("https://www.perplexity.ai/api/auth/signin-email", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": APP_USER_AGENT,
			"X-App-ApiVersion": API_VERSION,
		},
		body: JSON.stringify({
			email: trimmedEmail,
			csrfToken: csrfData.csrfToken,
		}),
		signal: ctrl.signal,
	});

	if (!sendResponse.ok) {
		const body = await sendResponse.text();
		throw new Error(`Perplexity send login code failed (${sendResponse.status}): ${body}`);
	}
	const otp = await ctrl.onPrompt({
		message: "Enter the code sent to your email",
		placeholder: "123456",
	});
	const trimmedOtp = otp.trim();
	if (!trimmedOtp) throw new Error("OTP code is required");
	if (ctrl.signal?.aborted) throw new Error("Login cancelled");
	ctrl.onProgress?.("Verifying login code...");
	const verifyResponse = await fetch("https://www.perplexity.ai/api/auth/signin-otp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": APP_USER_AGENT,
			"X-App-ApiVersion": API_VERSION,
		},
		body: JSON.stringify({
			email: trimmedEmail,
			otp: trimmedOtp,
			csrfToken: csrfData.csrfToken,
		}),
		signal: ctrl.signal,
	});

	const verifyData = (await verifyResponse.json()) as {
		token?: string;
		status?: string;
		error_code?: string;
		text?: string;
	};

	if (!verifyResponse.ok) {
		const reason = verifyData.text ?? verifyData.error_code ?? verifyData.status ?? "OTP verification failed";
		throw new Error(`Perplexity OTP verification failed: ${reason}`);
	}

	if (!verifyData.token) {
		throw new Error("Perplexity OTP verification response missing token");
	}

	return jwtToCredentials(verifyData.token, trimmedEmail);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Login to Perplexity.
 *
 * Tries auto-extraction from the desktop app, then runs HTTP email OTP login.
 *
 * No browser/manual token paste fallback is used.
 */
export async function loginPerplexity(ctrl: OAuthController): Promise<OAuthCredentials> {
	if (!ctrl.onPrompt) {
		throw new Error("Perplexity login requires onPrompt callback");
	}

	// Path 1: Native macOS app JWT (skip if PI_AUTH_NO_BORROW=1)
	if (!$env.PI_AUTH_NO_BORROW) {
		ctrl.onProgress?.("Checking for Perplexity desktop app...");
		const nativeJwt = await extractFromNativeApp();
		if (nativeJwt) {
			ctrl.onProgress?.("Found Perplexity JWT from native app");
			return jwtToCredentials(nativeJwt);
		}
	}

	// Path 2: HTTP email OTP
	return httpEmailLogin(ctrl);
}

```


## NVIDIA

### Authentication Implementation (`nvidia.ts`)

```typescript
/**
 * NVIDIA login flow.
 *
 * NVIDIA provides OpenAI-compatible models via https://integrate.api.nvidia.com/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to NVIDIA NGC catalog
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://org.ngc.nvidia.com/setup/personal-keys";
const API_BASE_URL = "https://integrate.api.nvidia.com/v1";
const VALIDATION_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct";
const PROVIDER_ID = "nvidia";

/**
 * Login to NVIDIA.
 *
 * Opens browser to NVIDIA dashboard, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginNvidia(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("NVIDIA login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from NVIDIA NGC Personal Keys",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your NVIDIA API key",
		placeholder: "nvapi-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key (optional)...");
	try {
		await validateOpenAICompatibleApiKey({
			provider: PROVIDER_ID,
			apiKey: trimmed,
			baseUrl: API_BASE_URL,
			model: VALIDATION_MODEL,
			signal: options.signal,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const statusMatch = message.match(/\((\d{3})\)/);
		const statusCode = statusMatch?.[1];
		if (statusCode === "401" || statusCode === "403") {
			throw error;
		}
		options.onProgress?.("Skipping NVIDIA validation endpoint; continuing with provided API key.");
	}

	return trimmed;
}

```


## MINIMAX-CODE

### Authentication Implementation (`minimax-code.ts`)

```typescript
/**
 * MiniMax Coding Plan login flow.
 *
 * MiniMax Coding Plan is a subscription service that provides access to
 * MiniMax models (M2, M2.1) through an OpenAI-compatible API.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to https://platform.minimax.io/subscribe/coding-plan
 * 2. User subscribes and copies their API key
 * 3. User pastes the API key back into the CLI
 *
 * International: https://api.minimax.io/v1
 * China: https://api.minimaxi.com/v1
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://platform.minimax.io/subscribe/coding-plan";
const API_BASE_URL_INTL = "https://api.minimax.io/v1";
const API_BASE_URL_CN = "https://api.minimaxi.com/v1";
const VALIDATION_MODEL = "MiniMax-M2";

/**
 * Login to MiniMax Coding Plan (international).
 *
 * Opens browser to subscription page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginMiniMaxCode(options: OAuthController): Promise<string> {
	return loginMiniMaxCodeWithBaseUrl(options, API_BASE_URL_INTL, "MiniMax Coding Plan");
}

async function loginMiniMaxCodeWithBaseUrl(
	options: OAuthController,
	baseUrl: string,
	providerName: string,
): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("MiniMax Coding Plan login requires onPrompt callback");
	}
	// Open browser to subscription page
	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Subscribe to Coding Plan and copy your API key",
	});
	// Prompt user to paste their API key
	const apiKey = await options.onPrompt({
		message: "Paste your MiniMax Coding Plan API key",
		placeholder: "sk-...",
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: providerName,
		apiKey: trimmed,
		baseUrl,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});
	return trimmed;
}

/**
 * Login to MiniMax Coding Plan (China).
 *
 * Same flow as international but uses China endpoint.
 */
export async function loginMiniMaxCodeCn(options: OAuthController): Promise<string> {
	return loginMiniMaxCodeWithBaseUrl(options, API_BASE_URL_CN, "MiniMax Coding Plan (China)");
}

```


## KAGI

### Authentication Implementation (`kagi.ts`)

```typescript
/**
 * Kagi login flow.
 *
 * Kagi web search uses an API key from the account settings page.
 * This is an API key flow:
 * 1. Open browser to Kagi API settings
 * 2. User copies API key
 * 3. User pastes key into CLI
 */

import type { OAuthController } from "./types";

const AUTH_URL = "https://kagi.com/settings/api";

/**
 * Login to Kagi.
 *
 * Opens browser to API settings and prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginKagi(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Kagi login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions:
			"Copy your Kagi Search API key from Kagi API settings. Search API access is beta-only; if unavailable, email support@kagi.com.",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Kagi API key",
		placeholder: "KG_...",
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

```


## GOOGLE-GEMINI-CLI

### Authentication Implementation (`google-gemini-cli.ts`)

```typescript
/**
 * Gemini CLI OAuth flow (Google Cloud Code Assist)
 * Standard Gemini models only (gemini-2.0-flash, gemini-2.5-*)
 */

import { $env } from "@oh-my-pi/pi-utils";
import { getGeminiCliHeaders } from "../../providers/google-gemini-cli";
import { OAuthCallbackFlow } from "./callback-server";
import type { OAuthController, OAuthCredentials } from "./types";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode(
	"NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const CLIENT_SECRET = decode("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");
const CALLBACK_PORT = 8085;
const CALLBACK_PATH = "/oauth2callback";
const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";

interface LoadCodeAssistPayload {
	cloudaicompanionProject?: string;
	currentTier?: { id?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

interface LongRunningOperationResponse {
	name?: string;
	done?: boolean;
	response?: {
		cloudaicompanionProject?: { id?: string };
	};
}

const TIER_FREE = "free-tier";
const TIER_LEGACY = "legacy-tier";
const TIER_STANDARD = "standard-tier";

interface GoogleRpcErrorResponse {
	error?: {
		details?: Array<{ reason?: string }>;
	};
}

function getDefaultTier(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): { id?: string } {
	if (!allowedTiers || allowedTiers.length === 0) return { id: TIER_LEGACY };
	const defaultTier = allowedTiers.find(t => t.isDefault);
	return defaultTier ?? { id: TIER_LEGACY };
}

function isVpcScAffectedUser(payload: unknown): boolean {
	if (!payload || typeof payload !== "object") return false;
	if (!("error" in payload)) return false;
	const error = (payload as GoogleRpcErrorResponse).error;
	if (!error?.details || !Array.isArray(error.details)) return false;
	return error.details.some(detail => detail.reason === "SECURITY_POLICY_VIOLATED");
}

async function pollOperation(
	operationName: string,
	headers: Record<string, string>,
	onProgress?: (message: string) => void,
): Promise<LongRunningOperationResponse> {
	let attempt = 0;
	while (true) {
		if (attempt > 0) {
			onProgress?.(`Waiting for project provisioning (attempt ${attempt + 1})...`);
			await Bun.sleep(5000);
		}

		const response = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`, {
			method: "GET",
			headers,
		});

		if (!response.ok) {
			throw new Error(`Failed to poll operation: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as LongRunningOperationResponse;
		if (data.done) {
			return data;
		}

		attempt += 1;
	}
}

async function discoverProject(accessToken: string, onProgress?: (message: string) => void): Promise<string> {
	const envProjectId = $env.GOOGLE_CLOUD_PROJECT || $env.GOOGLE_CLOUD_PROJECT_ID;

	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		...getGeminiCliHeaders(),
	};

	onProgress?.("Checking for existing Cloud Code Assist project...");
	const loadResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			cloudaicompanionProject: envProjectId,
			metadata: {
				ideType: "IDE_UNSPECIFIED",
				platform: "PLATFORM_UNSPECIFIED",
				pluginType: "GEMINI",
				duetProject: envProjectId,
			},
		}),
	});

	let data: LoadCodeAssistPayload;

	if (!loadResponse.ok) {
		let errorPayload: unknown;
		try {
			errorPayload = await loadResponse.clone().json();
		} catch {
			errorPayload = undefined;
		}

		if (isVpcScAffectedUser(errorPayload)) {
			data = { currentTier: { id: TIER_STANDARD } };
		} else {
			const errorText = await loadResponse.text();
			throw new Error(`loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${errorText}`);
		}
	} else {
		data = (await loadResponse.json()) as LoadCodeAssistPayload;
	}

	if (data.currentTier) {
		if (data.cloudaicompanionProject) {
			return data.cloudaicompanionProject;
		}
		if (envProjectId) {
			return envProjectId;
		}
		throw new Error(
			"This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable. " +
				"See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
		);
	}

	const tier = getDefaultTier(data.allowedTiers);
	const tierId = tier?.id ?? TIER_FREE;

	if (tierId !== TIER_FREE && !envProjectId) {
		throw new Error(
			"This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable. " +
				"See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
		);
	}

	onProgress?.("Provisioning Cloud Code Assist project (this may take a moment)...");

	const onboardBody: Record<string, unknown> = {
		tierId,
		metadata: {
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		},
	};

	if (tierId !== TIER_FREE && envProjectId) {
		onboardBody.cloudaicompanionProject = envProjectId;
		(onboardBody.metadata as Record<string, unknown>).duetProject = envProjectId;
	}

	const onboardResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
		method: "POST",
		headers,
		body: JSON.stringify(onboardBody),
	});

	if (!onboardResponse.ok) {
		const errorText = await onboardResponse.text();
		throw new Error(`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${errorText}`);
	}

	let lroData = (await onboardResponse.json()) as LongRunningOperationResponse;

	if (!lroData.done && lroData.name) {
		lroData = await pollOperation(lroData.name, headers, onProgress);
	}

	const projectId = lroData.response?.cloudaicompanionProject?.id;
	if (projectId) {
		return projectId;
	}

	if (envProjectId) {
		return envProjectId;
	}

	throw new Error(
		"Could not discover or provision a Google Cloud project. " +
			"Try setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable. " +
			"See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
	);
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
	try {
		const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (response.ok) {
			const data = (await response.json()) as { email?: string };
			return data.email;
		}
	} catch {
		// Ignore errors, email is optional
	}
	return undefined;
}

class GeminiCliOAuthFlow extends OAuthCallbackFlow {
	constructor(ctrl: OAuthController) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES.join(" "),
			state,
			access_type: "offline",
			prompt: "consent",
		});

		const url = `${AUTH_URL}?${authParams.toString()}`;
		return { url, instructions: "Complete the sign-in in your browser." };
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		this.ctrl.onProgress?.("Exchanging authorization code for tokens...");

		const tokenResponse = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			throw new Error(`Token exchange failed: ${error}`);
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		if (!tokenData.refresh_token) {
			throw new Error("No refresh token received. Please try again.");
		}

		this.ctrl.onProgress?.("Getting user info...");
		const email = await getUserEmail(tokenData.access_token);

		const projectId = await discoverProject(tokenData.access_token, this.ctrl.onProgress);

		return {
			refresh: tokenData.refresh_token,
			access: tokenData.access_token,
			expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
			projectId,
			email,
		};
	}
}

/**
 * Login with Gemini CLI (Google Cloud Code Assist) OAuth
 */
export async function loginGeminiCli(ctrl: OAuthController): Promise<OAuthCredentials> {
	const flow = new GeminiCliOAuthFlow(ctrl);
	return flow.login();
}

/**
 * Refresh Google Cloud Code Assist token
 */
export async function refreshGoogleCloudToken(refreshToken: string, projectId: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Google Cloud token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	return {
		refresh: data.refresh_token || refreshToken,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
		projectId,
	};
}

```

### Provider API Implementation (`google-gemini-cli.ts`)

```typescript
/**
 * Google Gemini CLI / Antigravity provider.
 * Shared implementation for both google-gemini-cli and google-antigravity providers.
 * Uses the Cloud Code Assist API endpoint to access Gemini and Claude models.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Content, FunctionCallingConfigMode, ThinkingConfig } from "@google/genai";
import { abortableSleep, readSseJson } from "@oh-my-pi/pi-utils";
import { calculateCost } from "../models";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { appendRawHttpRequestDumpFor400, type RawHttpRequestDump, withHttpStatus } from "../utils/http-inspector";
import { refreshAntigravityToken } from "../utils/oauth/google-antigravity";
import { refreshGoogleCloudToken } from "../utils/oauth/google-gemini-cli";
import { extractHttpStatusFromError } from "../utils/retry";
import { sanitizeSchemaForCCA } from "../utils/schema";
import {
	convertMessages,
	convertTools,
	isThinkingPart,
	mapStopReasonString,
	mapToolChoice,
	retainThoughtSignature,
} from "./google-shared";

/**
 * Thinking level for Gemini 3 models.
 * Mirrors Google's ThinkingLevel enum values.
 */
export type GoogleThinkingLevel = "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface GoogleGeminiCliOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	/**
	 * Thinking/reasoning configuration.
	 * - Gemini 2.x models: use `budgetTokens` to set the thinking budget
	 * - Gemini 3 models (gemini-3-pro-*, gemini-3-flash-*): use `level` instead
	 *
	 * When using `streamSimple`, this is handled automatically based on the model.
	 */
	thinking?: {
		enabled: boolean;
		/** Thinking budget in tokens. Use for Gemini 2.x models. */
		budgetTokens?: number;
		/** Thinking level. Use for Gemini 3 models (LOW/HIGH for Pro, MINIMAL/LOW/MEDIUM/HIGH for Flash). */
		level?: GoogleThinkingLevel;
	};
	projectId?: string;
}

const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ANTIGRAVITY_ENDPOINT_FALLBACKS = [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT] as const;

/**
 * Build a User-Agent string that identifies as Gemini CLI to unlock higher rate limits.
 * Uses the same format as the official Gemini CLI:
 * GeminiCLI/VERSION/MODEL (PLATFORM; ARCH) google-api-nodejs-client/10.5.0
 */
export function getGeminiCliUserAgent(modelId = "gemini-3.1-pro-preview"): string {
	const version = process.env.PI_AI_GEMINI_CLI_VERSION || "0.34.0";
	const platform = process.platform === "win32" ? "win32" : process.platform;
	const arch = process.arch === "x64" ? "x64" : process.arch;
	return `GeminiCLI/${version}/${modelId} (${platform}; ${arch}) google-api-nodejs-client/10.5.0`;
}

const ANTIGRAVITY_USER_AGENT = (() => {
	const DEFAULT_ANTIGRAVITY_VERSION = "1.104.0";
	const version = process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION;
	// Map Node.js platform/arch to Antigravity's expected format.
	// Verified against Antigravity source: _qn() and wqn() in main.js.
	// process.platform: win32→windows, others pass through (darwin, linux)
	// process.arch:     x64→amd64, ia32→386, others pass through (arm64)
	const os = process.platform === "win32" ? "windows" : process.platform;
	const arch = process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "386" : process.arch;
	return `antigravity/${version} ${os}/${arch}`;
})();

const GEMINI_CLI_HEADERS = (modelId?: string) =>
	Object.freeze({
		"User-Agent": getGeminiCliUserAgent(modelId),
		"Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
	});

// Antigravity auth headers (project discovery/onboarding).
// Verified from binary: kae.w() and kae.y() send only Content-Type + User-Agent.
// X-Goog-Api-Client and Client-Metadata are NOT sent by the real client — product
// identification (ideType, ideName, ideVersion) goes in the protobuf request body.
const ANTIGRAVITY_AUTH_HEADERS = Object.freeze({
	"User-Agent": ANTIGRAVITY_USER_AGENT,
});

// Antigravity executor headers (streaming/generation).
// Same header set as auth calls — only User-Agent per binary analysis.
const ANTIGRAVITY_STREAMING_HEADERS = Object.freeze({
	"User-Agent": ANTIGRAVITY_USER_AGENT,
});

// Headers for Gemini CLI (prod endpoint)
export function getGeminiCliHeaders(modelId?: string) {
	return GEMINI_CLI_HEADERS(modelId);
}
export function getGeminiCliUserAgentValue(modelId?: string) {
	return getGeminiCliUserAgent(modelId);
}

// Headers for Antigravity (sandbox endpoint)
export function getAntigravityAuthHeaders() {
	return ANTIGRAVITY_AUTH_HEADERS;
}
export function getAntigravityHeaders() {
	return ANTIGRAVITY_STREAMING_HEADERS;
}
export function getAntigravityUserAgent() {
	return ANTIGRAVITY_USER_AGENT;
}

// Antigravity system instruction (compact version from CLIProxyAPI).
export const ANTIGRAVITY_SYSTEM_INSTRUCTION =
	"You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
	"You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
	"**Absolute paths only**" +
	"**Proactiveness**";

// Counter for generating unique tool call IDs
let toolCallCounter = 0;

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_EMPTY_STREAM_RETRIES = 2;
const EMPTY_STREAM_BASE_DELAY_MS = 500;
const RATE_LIMIT_BUDGET_MS = 5 * 60 * 1000;
const CLAUDE_THINKING_BETA_HEADER = "interleaved-thinking-2025-05-14";
const GOOGLE_GEMINI_REFRESH_SKEW_MS = 60_000;
const ANTIGRAVITY_REFRESH_SKEW_MS = 60_000;

/**
 * Extract retry delay from Gemini error response (in milliseconds).
 * Checks headers first (Retry-After, x-ratelimit-reset, x-ratelimit-reset-after),
 * then parses body patterns like:
 * - "Your quota will reset after 39s"
 * - "Your quota will reset after 18h31m10s"
 * - "Please retry in Xs" or "Please retry in Xms"
 * - "retryDelay": "34.074824224s" (JSON field)
 */
export function extractRetryDelay(errorText: string, response?: Response | Headers): number | undefined {
	const normalizeDelay = (ms: number): number | undefined => (ms > 0 ? Math.ceil(ms + 1000) : undefined);

	const headers = response instanceof Headers ? response : response?.headers;
	if (headers) {
		const retryAfter = headers.get("retry-after");
		if (retryAfter) {
			const retryAfterSeconds = Number(retryAfter);
			if (Number.isFinite(retryAfterSeconds)) {
				const delay = normalizeDelay(retryAfterSeconds * 1000);
				if (delay !== undefined) {
					return delay;
				}
			}
			const retryAfterDate = new Date(retryAfter);
			const retryAfterMs = retryAfterDate.getTime();
			if (!Number.isNaN(retryAfterMs)) {
				const delay = normalizeDelay(retryAfterMs - Date.now());
				if (delay !== undefined) {
					return delay;
				}
			}
		}

		const rateLimitReset = headers.get("x-ratelimit-reset");
		if (rateLimitReset) {
			const resetSeconds = Number.parseInt(rateLimitReset, 10);
			if (!Number.isNaN(resetSeconds)) {
				const delay = normalizeDelay(resetSeconds * 1000 - Date.now());
				if (delay !== undefined) {
					return delay;
				}
			}
		}

		const rateLimitResetAfter = headers.get("x-ratelimit-reset-after");
		if (rateLimitResetAfter) {
			const resetAfterSeconds = Number(rateLimitResetAfter);
			if (Number.isFinite(resetAfterSeconds)) {
				const delay = normalizeDelay(resetAfterSeconds * 1000);
				if (delay !== undefined) {
					return delay;
				}
			}
		}
	}

	// Pattern 1: "Your quota will reset after ..." (formats: "18h31m10s", "10m15s", "6s", "39s")
	const durationMatch = errorText.match(/reset after (?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
	if (durationMatch) {
		const hours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
		const minutes = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
		const seconds = parseFloat(durationMatch[3]);
		if (!Number.isNaN(seconds)) {
			const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
			const delay = normalizeDelay(totalMs);
			if (delay !== undefined) {
				return delay;
			}
		}
	}

	// Pattern 2: "Please retry in X[ms|s]"
	const retryInMatch = errorText.match(/Please retry in ([0-9.]+)(ms|s)/i);
	if (retryInMatch?.[1]) {
		const value = parseFloat(retryInMatch[1]);
		if (!Number.isNaN(value) && value > 0) {
			const ms = retryInMatch[2].toLowerCase() === "ms" ? value : value * 1000;
			const delay = normalizeDelay(ms);
			if (delay !== undefined) {
				return delay;
			}
		}
	}

	// Pattern 3: "retryDelay": "34.074824224s" (JSON field in error details)
	const retryDelayMatch = errorText.match(/"retryDelay":\s*"([0-9.]+)(ms|s)"/i);
	if (retryDelayMatch?.[1]) {
		const value = parseFloat(retryDelayMatch[1]);
		if (!Number.isNaN(value) && value > 0) {
			const ms = retryDelayMatch[2].toLowerCase() === "ms" ? value : value * 1000;
			const delay = normalizeDelay(ms);
			if (delay !== undefined) {
				return delay;
			}
		}
	}

	return undefined;
}

function isClaudeModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("claude");
}

function needsClaudeThinkingBetaHeader(model: Model<"google-gemini-cli">): boolean {
	return model.provider === "google-antigravity" && model.id.startsWith("claude-") && model.reasoning;
}

function shouldInjectAntigravitySystemInstruction(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return normalized.includes("claude") || normalized.includes("gemini-3-pro-high");
}

/**
 * Check if an error is retryable (rate limit, server error, network error, etc.)
 */
function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
		return true;
	}
	return /resource.?exhausted|rate.?limit|overloaded|service.?unavailable|other.?side.?closed/i.test(errorText);
}

/**
 * Extract a clean, user-friendly error message from Google API error response.
 * Parses JSON error responses and returns just the message field.
 */
function extractErrorMessage(errorText: string): string {
	try {
		const parsed = JSON.parse(errorText) as { error?: { message?: string } };
		if (parsed.error?.message) {
			return parsed.error.message;
		}
	} catch {
		// Not JSON, return as-is
	}
	return errorText;
}

interface GeminiCliApiKeyPayload {
	token?: unknown;
	projectId?: unknown;
	project_id?: unknown;
	refreshToken?: unknown;
	expiresAt?: unknown;
	refresh?: unknown;
	expires?: unknown;
}
interface ParsedGeminiCliCredentials {
	accessToken: string;
	projectId: string;
	refreshToken?: string;
	expiresAt?: number;
}

function normalizeExpiryMs(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value < 10_000_000_000 ? value * 1000 : value;
}

export function parseGeminiCliCredentials(apiKeyRaw: string): ParsedGeminiCliCredentials {
	const invalidCredentialsMessage = "Invalid Google Cloud Code Assist credentials. Use /login to re-authenticate.";
	const missingCredentialsMessage =
		"Missing token or projectId in Google Cloud credentials. Use /login to re-authenticate.";

	let parsed: GeminiCliApiKeyPayload;
	try {
		parsed = JSON.parse(apiKeyRaw) as GeminiCliApiKeyPayload;
	} catch {
		throw new Error(invalidCredentialsMessage);
	}

	const projectId =
		typeof parsed.projectId === "string"
			? parsed.projectId
			: typeof parsed.project_id === "string"
				? parsed.project_id
				: undefined;

	if (typeof parsed.token !== "string" || typeof projectId !== "string") {
		throw new Error(missingCredentialsMessage);
	}

	const refreshToken =
		typeof parsed.refreshToken === "string"
			? parsed.refreshToken
			: typeof parsed.refresh === "string"
				? parsed.refresh
				: undefined;
	const expiresAt = normalizeExpiryMs(parsed.expiresAt ?? parsed.expires);

	return {
		accessToken: parsed.token,
		projectId,
		refreshToken,
		expiresAt,
	};
}

export function shouldRefreshGeminiCliCredentials(
	expiresAt: number | undefined,
	isAntigravity: boolean,
	nowMs = Date.now(),
): boolean {
	if (expiresAt === undefined) {
		return false;
	}

	const skewMs = isAntigravity ? ANTIGRAVITY_REFRESH_SKEW_MS : GOOGLE_GEMINI_REFRESH_SKEW_MS;
	return nowMs + skewMs >= expiresAt;
}

async function refreshGeminiCliCredentialsIfNeeded(
	credentials: ParsedGeminiCliCredentials,
	isAntigravity: boolean,
): Promise<ParsedGeminiCliCredentials> {
	if (!credentials.refreshToken || !shouldRefreshGeminiCliCredentials(credentials.expiresAt, isAntigravity)) {
		return credentials;
	}

	try {
		const refreshed = isAntigravity
			? await refreshAntigravityToken(credentials.refreshToken, credentials.projectId)
			: await refreshGoogleCloudToken(credentials.refreshToken, credentials.projectId);
		return {
			accessToken: refreshed.access,
			projectId: credentials.projectId,
			refreshToken: refreshed.refresh,
			expiresAt: refreshed.expires,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		// Permanent auth failure (revoked/invalid token) — re-authentication required.
		// Google returns 400 invalid_grant when a token is revoked or expired server-side.
		if (/invalid_grant|invalid_token|token.*revoked|account.*disabled/i.test(reason)) {
			throw new Error(`OAuth token has been revoked or invalidated. Use /login to re-authenticate. (${reason})`);
		}
		// Transient failure (network, 5xx) — fall back to existing token if not yet expired.
		if (credentials.expiresAt !== undefined && Date.now() >= credentials.expiresAt) {
			throw new Error(`OAuth token refresh failed before request: ${reason}`);
		}
		return credentials;
	}
}
interface CloudCodeAssistRequest {
	project: string;
	model: string;
	request: {
		contents: Content[];
		sessionId?: string;
		systemInstruction?: { role?: string; parts: { text: string }[] };
		generationConfig?: {
			maxOutputTokens?: number;
			temperature?: number;
			topP?: number;
			topK?: number;
			minP?: number;
			presencePenalty?: number;
			repetitionPenalty?: number;
			thinkingConfig?: ThinkingConfig;
		};
		tools?: { functionDeclarations: Record<string, unknown>[] }[] | undefined;
		toolConfig?: {
			functionCallingConfig: {
				mode: FunctionCallingConfigMode;
			};
		};
	};
	requestType?: string;
	userAgent?: string;
	requestId?: string;
}

interface CloudCodeAssistResponseChunk {
	response?: {
		candidates?: Array<{
			content?: {
				role: string;
				parts?: Array<{
					text?: string;
					thought?: boolean;
					thoughtSignature?: string;
					functionCall?: {
						name: string;
						args: Record<string, unknown>;
						id?: string;
					};
				}>;
			};
			finishReason?: string;
		}>;
		usageMetadata?: {
			promptTokenCount?: number;
			candidatesTokenCount?: number;
			thoughtsTokenCount?: number;
			totalTokenCount?: number;
			cachedContentTokenCount?: number;
		};
		modelVersion?: string;
		responseId?: string;
	};
	traceId?: string;
}

export const streamGoogleGeminiCli: StreamFunction<"google-gemini-cli"> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: GoogleGeminiCliOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "google-gemini-cli" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		let rawRequestDump: RawHttpRequestDump | undefined;

		try {
			const apiKeyRaw = options?.apiKey;
			if (!apiKeyRaw) {
				throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
			}

			const isAntigravity = model.provider === "google-antigravity";
			const parsedCredentials = parseGeminiCliCredentials(apiKeyRaw);
			const activeCredentials = await refreshGeminiCliCredentialsIfNeeded(parsedCredentials, isAntigravity);
			const { accessToken, projectId } = activeCredentials;

			const baseUrl = model.baseUrl?.trim();
			const endpoints = baseUrl ? [baseUrl] : isAntigravity ? ANTIGRAVITY_ENDPOINT_FALLBACKS : [DEFAULT_ENDPOINT];

			let requestBody = buildRequest(model, context, projectId, options, isAntigravity);
			const replacementPayload = await options?.onPayload?.(requestBody, model);
			if (replacementPayload !== undefined) {
				requestBody = replacementPayload as typeof requestBody;
			}
			const headers = isAntigravity ? getAntigravityHeaders() : getGeminiCliHeaders(model.id);

			const requestHeaders = {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				...headers,
				...(needsClaudeThinkingBetaHeader(model) ? { "anthropic-beta": CLAUDE_THINKING_BETA_HEADER } : {}),
				...(options?.headers ?? {}),
			};
			const requestBodyJson = JSON.stringify(requestBody);
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				body: requestBody,
				headers: requestHeaders,
			};

			// Fetch with retry logic for rate limits and transient errors
			let response: Response | undefined;
			let lastError: Error | undefined;
			let requestUrl: string | undefined;
			let rateLimitTimeSpent = 0;

			for (let attempt = 0; ; attempt++) {
				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				try {
					const endpoint = endpoints[Math.min(attempt, endpoints.length - 1)];
					requestUrl = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;
					response = await fetch(requestUrl, {
						method: "POST",
						headers: requestHeaders,
						body: requestBodyJson,
						signal: options?.signal,
					});

					if (response.ok) {
						break; // Success, exit retry loop
					}

					const errorText = await response.text();

					// Handle 429 rate limits with time budget
					if (response.status === 429) {
						if (/quota|exhausted/i.test(errorText)) {
							throw withHttpStatus(
								new Error(`Cloud Code Assist API error (429): ${extractErrorMessage(errorText)}`),
								429,
							);
						}
						const serverDelay = extractRetryDelay(errorText, response);
						if (serverDelay && rateLimitTimeSpent + serverDelay <= RATE_LIMIT_BUDGET_MS) {
							rateLimitTimeSpent += serverDelay;
							await abortableSleep(serverDelay, options?.signal);
							continue;
						}
						// Fallback: use exponential backoff if no server delay, up to MAX_RETRIES
						if (!serverDelay && attempt < MAX_RETRIES) {
							await abortableSleep(BASE_DELAY_MS * 2 ** attempt, options?.signal);
							continue;
						}
					} else if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
						// Non-429 retryable errors use standard attempt cap
						const serverDelay = extractRetryDelay(errorText, response);
						const delayMs = serverDelay ?? BASE_DELAY_MS * 2 ** attempt;

						// Check if server delay exceeds max allowed (default: 60s) for non-429 errors
						const maxDelayMs = options?.maxRetryDelayMs ?? 60000;
						if (maxDelayMs > 0 && serverDelay && serverDelay > maxDelayMs) {
							const delaySeconds = Math.ceil(serverDelay / 1000);
							throw withHttpStatus(
								new Error(
									`Server requested ${delaySeconds}s retry delay (max: ${Math.ceil(maxDelayMs / 1000)}s). ${extractErrorMessage(errorText)}`,
								),
								response.status,
							);
						}

						await abortableSleep(delayMs, options?.signal);
						continue;
					}

					// Not retryable or budget exceeded
					throw withHttpStatus(
						new Error(`Cloud Code Assist API error (${response.status}): ${extractErrorMessage(errorText)}`),
						response.status,
					);
				} catch (error) {
					// Check for abort - fetch throws AbortError, our code throws "Request was aborted"
					if (error instanceof Error) {
						if (error.name === "AbortError" || error.message === "Request was aborted") {
							throw new Error("Request was aborted");
						}
					}

					// HTTP responses are handled inside the try block.
					// If we intentionally throw with status metadata, don't convert it into a network retry.
					if (extractHttpStatusFromError(error) !== undefined) {
						throw error;
					}
					// Extract detailed error message from fetch errors (Node includes cause)
					lastError = error instanceof Error ? error : new Error(String(error));
					if (lastError.message === "fetch failed" && lastError.cause instanceof Error) {
						lastError = new Error(`Network error: ${lastError.cause.message}`);
					}
					// Network errors are retryable
					if (attempt < MAX_RETRIES) {
						const delayMs = BASE_DELAY_MS * 2 ** attempt;
						await abortableSleep(delayMs, options?.signal);
						continue;
					}
					throw lastError;
				}
			}

			if (!response || !response.ok) {
				throw lastError ?? new Error("Failed to get response after retries");
			}

			let started = false;
			const ensureStarted = () => {
				if (!started) {
					if (!firstTokenTime) firstTokenTime = Date.now();
					stream.push({ type: "start", partial: output });
					started = true;
				}
			};

			const resetOutput = () => {
				output.content = [];
				output.usage = {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
				output.stopReason = "stop";
				output.errorMessage = undefined;
				output.timestamp = Date.now();
				started = false;
			};

			const streamResponse = async (activeResponse: Response): Promise<boolean> => {
				if (!activeResponse.body) {
					throw new Error("No response body");
				}

				let hasContent = false;
				let currentBlock: TextContent | ThinkingContent | null = null;
				const blocks = output.content;
				const blockIndex = () => blocks.length - 1;

				for await (const chunk of readSseJson<CloudCodeAssistResponseChunk>(
					activeResponse.body!,
					options?.signal,
				)) {
					const responseData = chunk.response;
					if (!responseData) continue;

					const candidate = responseData.candidates?.[0];
					if (candidate?.content?.parts) {
						for (const part of candidate.content.parts) {
							if (part.text !== undefined) {
								hasContent = true;
								const isThinking = isThinkingPart(part);
								if (
									!currentBlock ||
									(isThinking && currentBlock.type !== "thinking") ||
									(!isThinking && currentBlock.type !== "text")
								) {
									if (currentBlock) {
										if (currentBlock.type === "text") {
											stream.push({
												type: "text_end",
												contentIndex: blocks.length - 1,
												content: currentBlock.text,
												partial: output,
											});
										} else {
											stream.push({
												type: "thinking_end",
												contentIndex: blockIndex(),
												content: currentBlock.thinking,
												partial: output,
											});
										}
									}
									if (isThinking) {
										currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
										output.content.push(currentBlock);
										ensureStarted();
										stream.push({
											type: "thinking_start",
											contentIndex: blockIndex(),
											partial: output,
										});
									} else {
										currentBlock = { type: "text", text: "" };
										output.content.push(currentBlock);
										ensureStarted();
										stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
									}
								}
								if (currentBlock.type === "thinking") {
									currentBlock.thinking += part.text;
									currentBlock.thinkingSignature = retainThoughtSignature(
										currentBlock.thinkingSignature,
										part.thoughtSignature,
									);
									stream.push({
										type: "thinking_delta",
										contentIndex: blockIndex(),
										delta: part.text,
										partial: output,
									});
								} else {
									currentBlock.text += part.text;
									currentBlock.textSignature = retainThoughtSignature(
										currentBlock.textSignature,
										part.thoughtSignature,
									);
									stream.push({
										type: "text_delta",
										contentIndex: blockIndex(),
										delta: part.text,
										partial: output,
									});
								}
							}

							if (part.functionCall) {
								hasContent = true;
								if (currentBlock) {
									if (currentBlock.type === "text") {
										stream.push({
											type: "text_end",
											contentIndex: blockIndex(),
											content: currentBlock.text,
											partial: output,
										});
									} else {
										stream.push({
											type: "thinking_end",
											contentIndex: blockIndex(),
											content: currentBlock.thinking,
											partial: output,
										});
									}
									currentBlock = null;
								}

								const providedId = part.functionCall.id;
								const needsNewId =
									!providedId || output.content.some(b => b.type === "toolCall" && b.id === providedId);
								const toolCallId = needsNewId
									? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
									: providedId;

								const toolCall: ToolCall = {
									type: "toolCall",
									id: toolCallId,
									name: part.functionCall.name || "",
									arguments: part.functionCall.args as Record<string, unknown>,
									...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
								};

								output.content.push(toolCall);
								ensureStarted();
								stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
								stream.push({
									type: "toolcall_delta",
									contentIndex: blockIndex(),
									delta: JSON.stringify(toolCall.arguments),
									partial: output,
								});
								stream.push({
									type: "toolcall_end",
									contentIndex: blockIndex(),
									toolCall,
									partial: output,
								});
							}
						}
					}

					if (candidate?.finishReason) {
						output.stopReason = mapStopReasonString(candidate.finishReason);
						if (output.content.some(b => b.type === "toolCall")) {
							output.stopReason = "toolUse";
						}
					}

					if (responseData.usageMetadata) {
						// promptTokenCount includes cachedContentTokenCount, so subtract to get fresh input
						const promptTokens = responseData.usageMetadata.promptTokenCount || 0;
						const cacheReadTokens = responseData.usageMetadata.cachedContentTokenCount || 0;
						output.usage = {
							input: promptTokens - cacheReadTokens,
							output:
								(responseData.usageMetadata.candidatesTokenCount || 0) +
								(responseData.usageMetadata.thoughtsTokenCount || 0),
							cacheRead: cacheReadTokens,
							cacheWrite: 0,
							totalTokens: responseData.usageMetadata.totalTokenCount || 0,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						};
						calculateCost(model, output.usage);
					}
				}

				if (currentBlock) {
					if (currentBlock.type === "text") {
						stream.push({
							type: "text_end",
							contentIndex: blockIndex(),
							content: currentBlock.text,
							partial: output,
						});
					} else {
						stream.push({
							type: "thinking_end",
							contentIndex: blockIndex(),
							content: currentBlock.thinking,
							partial: output,
						});
					}
				}

				return hasContent;
			};

			let receivedContent = false;
			let currentResponse = response;

			for (let emptyAttempt = 0; emptyAttempt <= MAX_EMPTY_STREAM_RETRIES; emptyAttempt++) {
				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				if (emptyAttempt > 0) {
					const backoffMs = EMPTY_STREAM_BASE_DELAY_MS * 2 ** (emptyAttempt - 1);
					try {
						await abortableSleep(backoffMs, options?.signal);
					} catch {
						// Normalize AbortError to expected message for consistent error handling
						throw new Error("Request was aborted");
					}

					if (!requestUrl) {
						throw new Error("Missing request URL");
					}

					currentResponse = await fetch(requestUrl, {
						method: "POST",
						headers: requestHeaders,
						body: requestBodyJson,
						signal: options?.signal,
					});

					if (!currentResponse.ok) {
						const retryErrorText = await currentResponse.text();
						throw withHttpStatus(
							new Error(`Cloud Code Assist API error (${currentResponse.status}): ${retryErrorText}`),
							currentResponse.status,
						);
					}
				}

				const streamed = await streamResponse(currentResponse);
				if (streamed) {
					receivedContent = true;
					break;
				}

				if (emptyAttempt < MAX_EMPTY_STREAM_RETRIES) {
					resetOutput();
				}
			}

			if (!receivedContent) {
				throw new Error("Cloud Code Assist API returned an empty response");
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				if ("index" in block) {
					delete (block as { index?: number }).index;
				}
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = await appendRawHttpRequestDumpFor400(
				error instanceof Error ? error.message : JSON.stringify(error),
				error,
				rawRequestDump,
			);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

const INT63_MASK = (1n << 63n) - 1n;
const ANTIGRAVITY_RANDOM_BOUND = 9_000_000_000_000_000_000n;

function formatSignedDecimalSessionId(value: bigint): string {
	return `-${value.toString()}`;
}

function deriveSignedDecimalFromHash(text: string): string {
	const digest = createHash("sha256").update(text).digest();
	let value = 0n;
	for (let index = 0; index < 8; index += 1) {
		value = (value << 8n) | BigInt(digest[index] ?? 0);
	}
	return formatSignedDecimalSessionId(value & INT63_MASK);
}

function randomBoundedInt63(maxExclusive: bigint): bigint {
	while (true) {
		const bytes = randomBytes(8);
		let value = 0n;
		for (const byte of bytes) {
			value = (value << 8n) | BigInt(byte);
		}
		value &= INT63_MASK;
		if (value < maxExclusive) {
			return value;
		}
	}
}

function randomSignedDecimalSessionId(): string {
	return formatSignedDecimalSessionId(randomBoundedInt63(ANTIGRAVITY_RANDOM_BOUND));
}

function getFirstUserTextForAntigravitySession(context: Context): string | undefined {
	for (const message of context.messages) {
		if (message.role !== "user") {
			continue;
		}

		if (typeof message.content === "string") {
			return message.content;
		}

		if (Array.isArray(message.content)) {
			const firstTextPart = message.content.find((item): item is TextContent => item.type === "text");
			return firstTextPart?.text;
		}

		return undefined;
	}

	return undefined;
}

function deriveAntigravitySessionId(context: Context): string {
	const text = getFirstUserTextForAntigravitySession(context);
	if (text && text.trim().length > 0) {
		return deriveSignedDecimalFromHash(text);
	}

	return randomSignedDecimalSessionId();
}

function normalizeAntigravityTools(
	tools: CloudCodeAssistRequest["request"]["tools"],
): CloudCodeAssistRequest["request"]["tools"] {
	return tools?.map(tool => ({
		...tool,
		functionDeclarations: tool.functionDeclarations.map(declaration => {
			if ("parameters" in declaration) {
				return declaration;
			}

			const { parametersJsonSchema, ...rest } = declaration;
			return {
				...rest,
				parameters: sanitizeSchemaForCCA(parametersJsonSchema),
			};
		}),
	}));
}

export function buildRequest(
	model: Model<"google-gemini-cli">,
	context: Context,
	projectId: string,
	options: GoogleGeminiCliOptions = {},
	isAntigravity = false,
): CloudCodeAssistRequest {
	const contents = convertMessages(model, context);

	const generationConfig: CloudCodeAssistRequest["request"]["generationConfig"] = {};
	if (options.temperature !== undefined) {
		generationConfig.temperature = options.temperature;
	}
	if (options.maxTokens !== undefined) {
		generationConfig.maxOutputTokens = options.maxTokens;
	}
	if (options.topP !== undefined) {
		generationConfig.topP = options.topP;
	}
	if (options.topK !== undefined) {
		generationConfig.topK = options.topK;
	}
	if (options.minP !== undefined) {
		generationConfig.minP = options.minP;
	}
	if (options.presencePenalty !== undefined) {
		generationConfig.presencePenalty = options.presencePenalty;
	}
	if (options.repetitionPenalty !== undefined) {
		generationConfig.repetitionPenalty = options.repetitionPenalty;
	}

	// Thinking config
	if (options.thinking?.enabled && model.reasoning) {
		generationConfig.thinkingConfig = {
			includeThoughts: true,
		};
		// Gemini 3 models use thinkingLevel, older models use thinkingBudget
		if (options.thinking.level !== undefined) {
			// Cast to any since our GoogleThinkingLevel mirrors Google's ThinkingLevel enum values
			generationConfig.thinkingConfig.thinkingLevel = options.thinking.level as any;
		} else if (options.thinking.budgetTokens !== undefined) {
			generationConfig.thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
		}
	}

	const request: CloudCodeAssistRequest["request"] = {
		contents,
	};

	if (isAntigravity) {
		request.sessionId = deriveAntigravitySessionId(context);
	}

	// System instruction must be object with parts, not plain string
	if (context.systemPrompt) {
		request.systemInstruction = {
			parts: [{ text: context.systemPrompt.toWellFormed() }],
		};
	}

	if (Object.keys(generationConfig).length > 0) {
		request.generationConfig = generationConfig;
	}

	if (context.tools && context.tools.length > 0) {
		const convertedTools = convertTools(context.tools, model);
		request.tools = isAntigravity ? normalizeAntigravityTools(convertedTools) : convertedTools;
		if (options.toolChoice) {
			request.toolConfig = {
				functionCallingConfig: {
					mode: mapToolChoice(options.toolChoice),
				},
			};
		}
	}

	if (isAntigravity && !isClaudeModel(model.id) && request.generationConfig?.maxOutputTokens !== undefined) {
		delete request.generationConfig.maxOutputTokens;
		if (Object.keys(request.generationConfig).length === 0) {
			delete request.generationConfig;
		}
	}

	if (isAntigravity && isClaudeModel(model.id)) {
		request.toolConfig = {
			functionCallingConfig: {
				mode: "VALIDATED" as FunctionCallingConfigMode,
			},
		};
	}

	if (isAntigravity && shouldInjectAntigravitySystemInstruction(model.id)) {
		const existingParts = request.systemInstruction?.parts ?? [];
		request.systemInstruction = {
			role: "user",
			parts: [
				{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
				{ text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
				...existingParts,
			],
		};
	}

	return {
		project: projectId,
		model: model.id,
		request,
		...(isAntigravity
			? {
					requestType: "agent",
					userAgent: "antigravity",
					requestId: `agent-${randomUUID()}`,
				}
			: {}),
	};
}

```


## MOONSHOT

### Authentication Implementation (`moonshot.ts`)

```typescript
/**
 * Moonshot login flow.
 *
 * Moonshot provides OpenAI-compatible models through https://api.moonshot.ai/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Moonshot API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://platform.moonshot.ai/console/api-keys";
const API_BASE_URL = "https://api.moonshot.ai/v1";
const VALIDATION_MODEL = "kimi-k2.5";

/**
 * Login to Moonshot.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginMoonshot(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Moonshot login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Moonshot dashboard",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Moonshot API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "moonshot",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## LM-STUDIO

### Authentication Implementation (`lm-studio.ts`)

```typescript
/**
 * LM Studio login flow.
 *
 * LM Studio provides an OpenAI-compatible API at a local base URL.
 * It usually runs unauthenticated but can be configured to require a bearer token.
 *
 * This flow stores an API-key-style credential used by `/login` and auth storage.
 */

import type { OAuthController, OAuthProvider } from "./types";

const PROVIDER_ID: OAuthProvider = "lm-studio";
const _AUTH_URL = "https://lmstudio.ai/docs/api";
const _DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:1234/v1";
export const DEFAULT_LOCAL_TOKEN = "lm-studio-local";

/**
 * Login to LM Studio.
 *
 * Opens LM Studio API docs, prompts for an optional token,
 * and returns a stored key value.
 */
export async function loginLmStudio(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_ID} login requires onPrompt callback`);
	}

	const apiKey = await options.onPrompt({
		message: "Optional: Paste LM Studio API key (to customize endpoint URL, set LM_STUDIO_BASE_URL env var)",
		placeholder: DEFAULT_LOCAL_TOKEN,
		allowEmpty: true,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_LOCAL_TOKEN;
}

```


## ANTHROPIC

### Authentication Implementation (`anthropic.ts`)

```typescript
/**
 * Anthropic OAuth flow (Claude Pro/Max)
 */
import { OAuthCallbackFlow } from "./callback-server";
import { generatePKCE } from "./pkce";
import type { OAuthController, OAuthCredentials } from "./types";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
const CALLBACK_PORT = 54545;
const CALLBACK_PATH = "/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

export class AnthropicOAuthFlow extends OAuthCallbackFlow {
	#verifier: string = "";
	#challenge: string = "";

	constructor(ctrl: OAuthController) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const pkce = await generatePKCE();
		this.#verifier = pkce.verifier;
		this.#challenge = pkce.challenge;

		const authParams = new URLSearchParams({
			code: "true",
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES,
			code_challenge: this.#challenge,
			code_challenge_method: "S256",
			state,
		});

		const url = `${AUTHORIZE_URL}?${authParams.toString()}`;
		return { url };
	}

	async exchangeToken(code: string, state: string, redirectUri: string): Promise<OAuthCredentials> {
		let exchangeCode = code;
		let exchangeState = state;
		const codeFragmentIndex = code.indexOf("#");
		if (codeFragmentIndex >= 0) {
			exchangeCode = code.slice(0, codeFragmentIndex);
			const codeFragmentState = code.slice(codeFragmentIndex + 1);
			if (codeFragmentState.length > 0) {
				exchangeState = codeFragmentState;
			}
		}

		const tokenResponse = await fetch(TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				grant_type: "authorization_code",
				client_id: CLIENT_ID,
				code: exchangeCode,
				state: exchangeState,
				redirect_uri: redirectUri,
				code_verifier: this.#verifier,
			}),
		});

		if (!tokenResponse.ok) {
			let error: string;
			try {
				error = await tokenResponse.text();
			} catch {
				error = `HTTP ${tokenResponse.status}`;
			}
			throw new Error(`Token exchange failed: ${error}`);
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		return {
			refresh: tokenData.refresh_token,
			access: tokenData.access_token,
			expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
		};
	}
}

/**
 * Login with Anthropic OAuth
 */
export async function loginAnthropic(ctrl: OAuthController): Promise<OAuthCredentials> {
	const flow = new AnthropicOAuthFlow(ctrl);
	return flow.login();
}

/**
 * Refresh Anthropic OAuth token
 */
export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Anthropic token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	};

	return {
		refresh: data.refresh_token || refreshToken,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
	};
}

```

### Provider API Implementation (`anthropic.ts`)

```typescript
import * as nodeCrypto from "node:crypto";
import * as fs from "node:fs";
import * as tls from "node:tls";
import Anthropic, { type ClientOptions as AnthropicSdkClientOptions } from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import { $env, abortableSleep, isEnoent } from "@oh-my-pi/pi-utils";
import { mapEffortToAnthropicAdaptiveEffort } from "../model-thinking";
import { calculateCost } from "../models";
import { getEnvApiKey, OUTPUT_FALLBACK_BUFFER } from "../stream";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Message,
	Model,
	RedactedThinkingContent,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types";
import { isAnthropicOAuthToken, normalizeToolCallId, resolveCacheRetention } from "../utils";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump } from "../utils/http-inspector";
import { parseStreamingJson } from "../utils/json-parse";
import {
	buildCopilotDynamicHeaders,
	hasCopilotVisionInput,
	resolveGitHubCopilotBaseUrl,
} from "./github-copilot-headers";
import { transformMessages } from "./transform-messages";

export type AnthropicHeaderOptions = {
	apiKey: string;
	baseUrl?: string;
	isOAuth?: boolean;
	extraBetas?: string[];
	stream?: boolean;
	modelHeaders?: Record<string, string>;
};

// Build deduplicated beta header string
export function buildBetaHeader(baseBetas: string[], extraBetas: string[]): string {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const beta of [...baseBetas, ...extraBetas]) {
		const trimmed = beta.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result.join(",");
}

const claudeCodeBetaDefaults = [
	"claude-code-20250219",
	"oauth-2025-04-20",
	"interleaved-thinking-2025-05-14",
	"context-management-2025-06-27",
	"prompt-caching-scope-2026-01-05",
];
function getHeaderCaseInsensitive(headers: Record<string, string> | undefined, headerName: string): string | undefined {
	if (!headers) return undefined;
	const normalizedName = headerName.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === normalizedName) return value;
	}
	return undefined;
}

function isClaudeCodeClientUserAgent(userAgent: string | undefined): userAgent is string {
	if (!userAgent) return false;
	return userAgent.toLowerCase().startsWith("claude-cli");
}

function isAnthropicApiBaseUrl(baseUrl?: string): boolean {
	if (!baseUrl) return true;
	try {
		const url = new URL(baseUrl);
		return url.protocol.toLowerCase() === "https:" && url.hostname.toLowerCase() === "api.anthropic.com";
	} catch {
		return false;
	}
}

const sharedHeaders = {
	"Accept-Encoding": "gzip, deflate, br, zstd",
	Connection: "keep-alive",
	"Content-Type": "application/json",
	"Anthropic-Version": "2023-06-01",
	"Anthropic-Dangerous-Direct-Browser-Access": "true",
	"X-App": "cli",
};

export function buildAnthropicHeaders(options: AnthropicHeaderOptions): Record<string, string> {
	const oauthToken = options.isOAuth ?? isAnthropicOAuthToken(options.apiKey);
	const extraBetas = options.extraBetas ?? [];
	const stream = options.stream ?? false;
	const betaHeader = buildBetaHeader(claudeCodeBetaDefaults, extraBetas);
	const acceptHeader = stream ? "text/event-stream" : "application/json";
	const modelHeaders = Object.fromEntries(
		Object.entries(options.modelHeaders ?? {}).filter(([key]) => !enforcedHeaderKeys.has(key.toLowerCase())),
	);

	if (oauthToken) {
		const incomingUserAgent = getHeaderCaseInsensitive(options.modelHeaders, "User-Agent");
		const userAgent = isClaudeCodeClientUserAgent(incomingUserAgent)
			? incomingUserAgent
			: `claude-cli/${claudeCodeVersion} (external, cli)`;
		return {
			...modelHeaders,
			...claudeCodeHeaders,
			Accept: acceptHeader,
			Authorization: `Bearer ${options.apiKey}`,
			...sharedHeaders,
			"Anthropic-Beta": betaHeader,
			"User-Agent": userAgent,
		};
	} else if (!isAnthropicApiBaseUrl(options.baseUrl)) {
		return {
			...modelHeaders,
			Accept: acceptHeader,
			Authorization: `Bearer ${options.apiKey}`,
			...sharedHeaders,
			"Anthropic-Beta": betaHeader,
		};
	} else {
		return {
			...modelHeaders,
			Accept: acceptHeader,
			...sharedHeaders,
			"Anthropic-Beta": betaHeader,
			"X-Api-Key": options.apiKey,
		};
	}
}

type AnthropicCacheControl = { type: "ephemeral"; ttl?: "1h" | "5m" };

type AnthropicSamplingParams = MessageCreateParamsStreaming & {
	top_p?: number;
	top_k?: number;
};
function getCacheControl(
	baseUrl: string,
	cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: AnthropicCacheControl } {
	const retention = resolveCacheRetention(cacheRetention);
	if (retention === "none") {
		return { retention };
	}
	const ttl = retention === "long" && baseUrl.includes("api.anthropic.com") ? "1h" : undefined;
	return {
		retention,
		cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
	};
}

// Stealth mode: Mimic Claude Code headers and tool prefixing.
export const claudeCodeVersion = "2.1.63";
export const claudeToolPrefix: string = "proxy_";
export const claudeCodeSystemInstruction = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

export function mapStainlessOs(platform: string): "MacOS" | "Windows" | "Linux" | "FreeBSD" | `Other::${string}` {
	switch (platform.toLowerCase()) {
		case "darwin":
			return "MacOS";
		case "windows":
		case "win32":
			return "Windows";
		case "linux":
			return "Linux";
		case "freebsd":
			return "FreeBSD";
		default:
			return `Other::${platform.toLowerCase()}`;
	}
}

export function mapStainlessArch(arch: string): "x64" | "arm64" | "x86" | `other::${string}` {
	switch (arch.toLowerCase()) {
		case "amd64":
		case "x64":
			return "x64";
		case "arm64":
		case "aarch64":
			return "arm64";
		case "386":
		case "x86":
		case "ia32":
			return "x86";
		default:
			return `other::${arch.toLowerCase()}`;
	}
}

export const claudeCodeHeaders = {
	"X-Stainless-Retry-Count": "0",
	"X-Stainless-Runtime-Version": "v24.3.0",
	"X-Stainless-Package-Version": "0.74.0",
	"X-Stainless-Runtime": "node",
	"X-Stainless-Lang": "js",
	"X-Stainless-Arch": mapStainlessArch(process.arch),
	"X-Stainless-Os": mapStainlessOs(process.platform),
	"X-Stainless-Timeout": "600",
} as const;

const enforcedHeaderKeys = new Set(
	[
		...Object.keys(claudeCodeHeaders),
		"Accept",
		"Accept-Encoding",
		"Connection",
		"Content-Type",
		"Anthropic-Version",
		"Anthropic-Dangerous-Direct-Browser-Access",
		"Anthropic-Beta",
		"User-Agent",
		"X-App",
		"Authorization",
		"X-Api-Key",
	].map(key => key.toLowerCase()),
);

const CLAUDE_BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";

function createClaudeBillingHeader(payload: unknown): string {
	const payloadJson = JSON.stringify(payload) ?? "";
	const cch = nodeCrypto.createHash("sha256").update(payloadJson).digest("hex").slice(0, 5);
	const randomBytes = new Uint8Array(2);
	crypto.getRandomValues(randomBytes);
	const buildHash = Array.from(randomBytes, byte => byte.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 3);
	return `${CLAUDE_BILLING_HEADER_PREFIX} cc_version=${claudeCodeVersion}.${buildHash}; cc_entrypoint=cli; cch=${cch};`;
}

const CLAUDE_CLOAKING_USER_ID_REGEX =
	/^user_[0-9a-fA-F]{64}_account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isClaudeCloakingUserId(userId: string): boolean {
	return CLAUDE_CLOAKING_USER_ID_REGEX.test(userId);
}

export function generateClaudeCloakingUserId(): string {
	const userHash = nodeCrypto.randomBytes(32).toString("hex");
	const accountId = nodeCrypto.randomUUID().toLowerCase();
	const sessionId = nodeCrypto.randomUUID().toLowerCase();
	return `user_${userHash}_account_${accountId}_session_${sessionId}`;
}

function resolveAnthropicMetadataUserId(userId: unknown, isOAuthToken: boolean): string | undefined {
	if (typeof userId === "string") {
		if (!isOAuthToken || isClaudeCloakingUserId(userId)) {
			return userId;
		}
	}

	if (!isOAuthToken) return undefined;
	return generateClaudeCloakingUserId();
}
const ANTHROPIC_BUILTIN_TOOL_NAMES = new Set(["web_search", "code_execution", "text_editor", "computer"]);
export const applyClaudeToolPrefix = (name: string, prefixOverride: string = claudeToolPrefix) => {
	if (!prefixOverride) return name;
	if (ANTHROPIC_BUILTIN_TOOL_NAMES.has(name.toLowerCase())) return name;
	const prefix = prefixOverride.toLowerCase();
	if (name.toLowerCase().startsWith(prefix)) return name;
	return `${prefixOverride}${name}`;
};

export const stripClaudeToolPrefix = (name: string, prefixOverride: string = claudeToolPrefix) => {
	if (!prefixOverride) return name;
	const prefix = prefixOverride.toLowerCase();
	if (!name.toLowerCase().startsWith(prefix)) return name;
	return name.slice(prefixOverride.length);
};

/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	// If only text blocks, return as concatenated string for simplicity
	const hasImages = content.some(c => c.type === "image");
	if (!hasImages) {
		return content
			.map(c => (c as TextContent).text)
			.join("\n")
			.toWellFormed();
	}

	// If we have images, convert to content block array
	const blocks = content.map(block => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: block.text.toWellFormed(),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	// If only images (no text), add placeholder text block
	const hasText = blocks.some(b => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

export type AnthropicEffort = "low" | "medium" | "high" | "max";

export interface AnthropicOptions extends StreamOptions {
	/**
	 * Enable extended thinking.
	 * For Opus 4.6+: uses adaptive thinking (Claude decides when/how much to think).
	 * For older models: uses budget-based thinking with thinkingBudgetTokens.
	 */
	thinkingEnabled?: boolean;
	/**
	 * Token budget for extended thinking (older models only).
	 * Ignored for Opus 4.6+ which uses adaptive thinking.
	 */
	thinkingBudgetTokens?: number;
	/**
	 * Effort level for adaptive thinking (Opus 4.6+ only).
	 * Controls how much thinking Claude allocates:
	 * - "max": Always thinks with no constraints
	 * - "high": Always thinks, deep reasoning (default)
	 * - "medium": Moderate thinking, may skip for simple queries
	 * - "low": Minimal thinking, skips for simple tasks
	 * Ignored for older models.
	 */
	effort?: AnthropicEffort;
	/**
	 * Optional reasoning level fallback for direct Anthropic provider usage.
	 * Converted to adaptive effort when effort is not explicitly provided.
	 */
	reasoning?: SimpleStreamOptions["reasoning"];
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	betas?: string[] | string;
	/** Force OAuth bearer auth mode for proxy tokens that don't match Anthropic token prefixes. */
	isOAuth?: boolean;
	/**
	 * Pre-built Anthropic client instance. When provided, skips internal client
	 * construction entirely. Use this to inject alternative SDK clients such as
	 * `AnthropicVertex` that shares the same messaging API.
	 */
	client?: Anthropic;
}

export type AnthropicClientOptionsArgs = {
	model: Model<"anthropic-messages">;
	apiKey: string;
	extraBetas?: string[];
	stream?: boolean;
	interleavedThinking?: boolean;
	headers?: Record<string, string>;
	dynamicHeaders?: Record<string, string>;
	isOAuth?: boolean;
};

export type AnthropicClientOptionsResult = {
	isOAuthToken: boolean;
	apiKey: string | null;
	authToken?: string;
	baseURL?: string;
	maxRetries: number;
	dangerouslyAllowBrowser: boolean;
	defaultHeaders: Record<string, string>;
	fetchOptions?: AnthropicSdkClientOptions["fetchOptions"];
};

const CLAUDE_CODE_TLS_CIPHERS = tls.DEFAULT_CIPHERS;

type FoundryTlsOptions = {
	ca?: string | string[];
	cert?: string;
	key?: string;
};

function isFoundryEnabled(): boolean {
	const value = $env.CLAUDE_CODE_USE_FOUNDRY;
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
	const trimmed = baseUrl?.trim();
	return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

function resolveAnthropicBaseUrl(model: Model<"anthropic-messages">, apiKey?: string): string | undefined {
	if (model.provider === "github-copilot") {
		return normalizeBaseUrl(resolveGitHubCopilotBaseUrl(model.baseUrl, apiKey) ?? model.baseUrl);
	}
	if (model.provider === "anthropic" && isFoundryEnabled()) {
		const foundryBaseUrl = normalizeBaseUrl($env.FOUNDRY_BASE_URL);
		if (foundryBaseUrl) {
			return foundryBaseUrl;
		}
	}
	if (model.provider === "anthropic") {
		return normalizeBaseUrl(model.baseUrl) ?? "https://api.anthropic.com";
	}
	return normalizeBaseUrl(model.baseUrl);
}

function parseAnthropicCustomHeaders(rawHeaders: string | undefined): Record<string, string> | undefined {
	const source = rawHeaders?.trim();
	if (!source) return undefined;

	const parsed: Record<string, string> = {};
	for (const token of source.split(/\r?\n|,/)) {
		const entry = token.trim();
		if (!entry) continue;
		const separatorIndex = entry.indexOf(":");
		if (separatorIndex <= 0) continue;
		const key = entry.slice(0, separatorIndex).trim();
		const value = entry.slice(separatorIndex + 1).trim();
		if (!key || !value) continue;
		parsed[key] = value;
	}

	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function resolveAnthropicCustomHeaders(model: Model<"anthropic-messages">): Record<string, string> | undefined {
	if (model.provider !== "anthropic") return undefined;
	if (!isFoundryEnabled()) return undefined;
	return parseAnthropicCustomHeaders($env.ANTHROPIC_CUSTOM_HEADERS);
}

function looksLikeFilePath(value: string): boolean {
	return value.includes("/") || value.includes("\\") || /\.(pem|crt|cer|key)$/i.test(value);
}

function resolvePemValue(value: string | undefined, name: string): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;

	const inline = trimmed.replace(/\\n/g, "\n");
	if (inline.includes("-----BEGIN")) {
		return inline;
	}

	if (looksLikeFilePath(trimmed)) {
		try {
			return fs.readFileSync(trimmed, "utf8");
		} catch (error) {
			if (isEnoent(error)) {
				throw new Error(`${name} path does not exist: ${trimmed}`);
			}
			throw error;
		}
	}

	return inline;
}

function resolveFoundryTlsOptions(model: Model<"anthropic-messages">): FoundryTlsOptions | undefined {
	if (model.provider !== "anthropic") return undefined;
	if (!isFoundryEnabled()) return undefined;

	const ca = resolvePemValue($env.NODE_EXTRA_CA_CERTS, "NODE_EXTRA_CA_CERTS");
	const cert = resolvePemValue($env.CLAUDE_CODE_CLIENT_CERT, "CLAUDE_CODE_CLIENT_CERT");
	const key = resolvePemValue($env.CLAUDE_CODE_CLIENT_KEY, "CLAUDE_CODE_CLIENT_KEY");

	if ((cert && !key) || (!cert && key)) {
		throw new Error("Both CLAUDE_CODE_CLIENT_CERT and CLAUDE_CODE_CLIENT_KEY must be set for mTLS.");
	}

	const options: FoundryTlsOptions = {};
	if (ca) options.ca = [...tls.rootCertificates, ca];
	if (cert) options.cert = cert;
	if (key) options.key = key;
	return Object.keys(options).length > 0 ? options : undefined;
}

function buildClaudeCodeTlsFetchOptions(
	model: Model<"anthropic-messages">,
	baseUrl: string | undefined,
): AnthropicSdkClientOptions["fetchOptions"] | undefined {
	if (model.provider !== "anthropic") return undefined;
	if (!baseUrl) return undefined;

	let serverName: string;
	try {
		serverName = new URL(baseUrl).hostname;
	} catch {
		return undefined;
	}

	if (!serverName) return undefined;

	const foundryTlsOptions = resolveFoundryTlsOptions(model);

	return {
		tls: {
			rejectUnauthorized: true,
			serverName,
			...(CLAUDE_CODE_TLS_CIPHERS ? { ciphers: CLAUDE_CODE_TLS_CIPHERS } : {}),
			...(foundryTlsOptions ?? {}),
		},
	};
}
function mergeHeaders(...headerSources: (Record<string, string> | undefined)[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}
	return merged;
}

const PROVIDER_MAX_RETRIES = 3;
const PROVIDER_BASE_DELAY_MS = 2000;

/**
 * Check if an error from the Anthropic SDK is a rate-limit/transient error that
 * should be retried before any content has been emitted.
 *
 * Includes malformed JSON stream-envelope parse errors seen from some
 * Anthropic-compatible proxy endpoints.
 */
/** Transient stream corruption errors where the response was truncated mid-JSON. */
function isTransientStreamParseError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /json parse error|unterminated string|unexpected end of json input/i.test(error.message);
}

export function isProviderRetryableError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message;
	return (
		/rate.?limit|too many requests|overloaded|service.?unavailable|internal_error|stream error.*received from peer|1302/i.test(
			msg,
		) || isTransientStreamParseError(error)
	);
}

export const streamAnthropic: StreamFunction<"anthropic-messages"> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const copilotDynamicHeaders =
			model.provider === "github-copilot"
				? buildCopilotDynamicHeaders({
						messages: context.messages,
						hasImages: hasCopilotVisionInput(context.messages),
						premiumMultiplier: model.premiumMultiplier,
						headers: { ...(model.headers ?? {}), ...(options?.headers ?? {}) },
						initiatorOverride: options?.initiatorOverride,
					})
				: undefined;
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		let rawRequestDump: RawHttpRequestDump | undefined;

		try {
			let client: Anthropic;
			let isOAuthToken: boolean;

			if (options?.client) {
				client = options.client;
				isOAuthToken = false;
			} else {
				const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";

				const created = createClient(model, {
					model,
					apiKey,
					extraBetas: normalizeExtraBetas(options?.betas),
					stream: true,
					interleavedThinking: options?.interleavedThinking ?? true,
					headers: options?.headers,
					dynamicHeaders: copilotDynamicHeaders?.headers,
					isOAuth: options?.isOAuth,
				});
				client = created.client;
				isOAuthToken = created.isOAuthToken;
			}
			const baseUrl =
				resolveAnthropicBaseUrl(model, options?.apiKey ?? getEnvApiKey(model.provider) ?? "") ??
				"https://api.anthropic.com";
			let params = buildParams(model, baseUrl, context, isOAuthToken, options);
			const replacementPayload = await options?.onPayload?.(params, model);
			if (replacementPayload !== undefined) {
				params = replacementPayload as typeof params;
			}
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url: `${baseUrl}/v1/messages`,
				body: params,
			};

			type Block = (
				| ThinkingContent
				| RedactedThinkingContent
				| TextContent
				| (ToolCall & { partialJson: string })
			) & { index: number };
			const blocks = output.content as Block[];
			stream.push({ type: "start", partial: output });
			// Retry loop for transient errors from the stream.
			// Rate-limit/overload: only before content starts (safe to restart).
			// Truncated JSON: also after content starts (partial response is unusable).
			let providerRetryAttempt = 0;
			let started = false;
			do {
				const anthropicStream = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
				if (copilotDynamicHeaders && output.usage.premiumRequests === undefined) {
					output.usage.premiumRequests = copilotDynamicHeaders.premiumRequests;
				}

				try {
					for await (const event of anthropicStream) {
						started = true;
						if (event.type === "message_start") {
							output.responseId = event.message.id;
							// Capture initial token usage from message_start event
							// This ensures we have input token counts even if the stream is aborted early
							output.usage.input = event.message.usage.input_tokens || 0;
							output.usage.output = event.message.usage.output_tokens || 0;
							output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
							output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
							// Anthropic doesn't provide total_tokens, compute from components
							output.usage.totalTokens =
								output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
							calculateCost(model, output.usage);
						} else if (event.type === "content_block_start") {
							if (!firstTokenTime) firstTokenTime = Date.now();
							if (event.content_block.type === "text") {
								const block: Block = {
									type: "text",
									text: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
							} else if (event.content_block.type === "thinking") {
								const block: Block = {
									type: "thinking",
									thinking: "",
									thinkingSignature: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({
									type: "thinking_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							} else if (event.content_block.type === "redacted_thinking") {
								const block: Block = {
									type: "redactedThinking",
									data: event.content_block.data,
									index: event.index,
								};
								output.content.push(block);
							} else if (event.content_block.type === "tool_use") {
								const block: Block = {
									type: "toolCall",
									id: event.content_block.id,
									name: isOAuthToken
										? stripClaudeToolPrefix(event.content_block.name)
										: event.content_block.name,
									arguments: (event.content_block.input as Record<string, unknown>) ?? {},
									partialJson: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({
									type: "toolcall_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							}
						} else if (event.type === "content_block_delta") {
							if (event.delta.type === "text_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "text") {
									block.text += event.delta.text;
									stream.push({
										type: "text_delta",
										contentIndex: index,
										delta: event.delta.text,
										partial: output,
									});
								}
							} else if (event.delta.type === "thinking_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "thinking") {
									block.thinking += event.delta.thinking;
									stream.push({
										type: "thinking_delta",
										contentIndex: index,
										delta: event.delta.thinking,
										partial: output,
									});
								}
							} else if (event.delta.type === "input_json_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "toolCall") {
									block.partialJson += event.delta.partial_json;
									block.arguments = parseStreamingJson(block.partialJson);
									stream.push({
										type: "toolcall_delta",
										contentIndex: index,
										delta: event.delta.partial_json,
										partial: output,
									});
								}
							} else if (event.delta.type === "signature_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "thinking") {
									block.thinkingSignature = block.thinkingSignature || "";
									block.thinkingSignature += event.delta.signature;
								}
							}
						} else if (event.type === "content_block_stop") {
							const index = blocks.findIndex(b => b.index === event.index);
							const block = blocks[index];
							if (block) {
								delete (block as { index?: number }).index;
								if (block.type === "text") {
									stream.push({
										type: "text_end",
										contentIndex: index,
										content: block.text,
										partial: output,
									});
								} else if (block.type === "thinking") {
									stream.push({
										type: "thinking_end",
										contentIndex: index,
										content: block.thinking,
										partial: output,
									});
								} else if (block.type === "toolCall") {
									block.arguments = parseStreamingJson(block.partialJson);
									delete (block as { partialJson?: string }).partialJson;
									stream.push({
										type: "toolcall_end",
										contentIndex: index,
										toolCall: block,
										partial: output,
									});
								}
							}
						} else if (event.type === "message_delta") {
							if (event.delta.stop_reason) {
								output.stopReason = mapStopReason(event.delta.stop_reason);
							}
							// Only update usage fields if present (not null).
							// Preserves input_tokens from message_start when proxies omit it in message_delta.
							if (event.usage.input_tokens != null) {
								output.usage.input = event.usage.input_tokens;
							}
							if (event.usage.output_tokens != null) {
								output.usage.output = event.usage.output_tokens;
							}
							if (event.usage.cache_read_input_tokens != null) {
								output.usage.cacheRead = event.usage.cache_read_input_tokens;
							}
							if (event.usage.cache_creation_input_tokens != null) {
								output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
							}
							// Anthropic doesn't provide total_tokens, compute from components
							output.usage.totalTokens =
								output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
							calculateCost(model, output.usage);
						}
					}

					if (options?.signal?.aborted) {
						throw new Error("Request was aborted");
					}

					if (output.stopReason === "aborted" || output.stopReason === "error") {
						throw new Error("An unknown error occurred");
					}
					break; // Stream completed successfully
				} catch (streamError) {
					// Transient stream parse errors (truncated JSON) are retryable even after content
					// has started streaming, since the partial response is unusable anyway.
					// Rate-limit/overload errors are only retried before content starts.
					const isTransient = isTransientStreamParseError(streamError);
					if (
						options?.signal?.aborted ||
						providerRetryAttempt >= PROVIDER_MAX_RETRIES ||
						(!isTransient && firstTokenTime !== undefined) ||
						(!isTransient && !isProviderRetryableError(streamError))
					) {
						throw streamError;
					}
					providerRetryAttempt++;
					const delayMs = PROVIDER_BASE_DELAY_MS * 2 ** (providerRetryAttempt - 1);
					await abortableSleep(delayMs, options?.signal);
					// Reset output state for clean retry
					output.content.length = 0;
					output.stopReason = "stop";
					firstTokenTime = undefined;
					started = false;
				}
			} while (!started);

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = await finalizeErrorMessage(error, rawRequestDump);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export type AnthropicSystemBlock = {
	type: "text";
	text: string;
	cache_control?: AnthropicCacheControl;
};
type SystemBlockOptions = {
	includeClaudeCodeInstruction?: boolean;
	extraInstructions?: string[];
	billingPayload?: unknown;
	cacheControl?: AnthropicCacheControl;
};

export function buildAnthropicSystemBlocks(
	systemPrompt: string | undefined,
	options: SystemBlockOptions = {},
): AnthropicSystemBlock[] | undefined {
	const { includeClaudeCodeInstruction = false, extraInstructions = [], billingPayload, cacheControl } = options;
	const blocks: AnthropicSystemBlock[] = [];
	const sanitizedPrompt = systemPrompt ? systemPrompt.toWellFormed() : "";
	const trimmedInstructions = extraInstructions.map(instruction => instruction.trim()).filter(Boolean);
	const hasBillingHeader = sanitizedPrompt.includes(CLAUDE_BILLING_HEADER_PREFIX);

	if (includeClaudeCodeInstruction && !hasBillingHeader) {
		const payloadSeed = billingPayload ?? {
			system: sanitizedPrompt,
			extraInstructions: trimmedInstructions,
		};
		blocks.push(
			{ type: "text", text: createClaudeBillingHeader(payloadSeed) },
			{
				type: "text",
				text: claudeCodeSystemInstruction,
			},
		);
	}

	for (const instruction of trimmedInstructions) {
		blocks.push({
			type: "text",
			text: instruction,
			...(cacheControl ? { cache_control: cacheControl } : {}),
		});
	}

	if (systemPrompt) {
		blocks.push({
			type: "text",
			text: sanitizedPrompt,
			...(cacheControl ? { cache_control: cacheControl } : {}),
		});
	}

	return blocks.length > 0 ? blocks : undefined;
}

export function normalizeExtraBetas(betas?: string[] | string): string[] {
	if (!betas) return [];
	const raw = Array.isArray(betas) ? betas : betas.split(",");
	return raw.map(beta => beta.trim()).filter(beta => beta.length > 0);
}

export function buildAnthropicClientOptions(args: AnthropicClientOptionsArgs): AnthropicClientOptionsResult {
	const {
		model,
		apiKey,
		extraBetas = [],
		stream = true,
		interleavedThinking = true,
		headers,
		dynamicHeaders,
		isOAuth,
	} = args;
	const oauthToken = isOAuth ?? isAnthropicOAuthToken(apiKey);
	const baseUrl = resolveAnthropicBaseUrl(model, apiKey);
	const foundryCustomHeaders = resolveAnthropicCustomHeaders(model);
	const tlsFetchOptions = buildClaudeCodeTlsFetchOptions(model, baseUrl);
	if (model.provider === "github-copilot") {
		const betaFeatures = [...extraBetas];
		if (interleavedThinking) {
			betaFeatures.push("interleaved-thinking-2025-05-14");
		}
		const defaultHeaders = mergeHeaders(
			{
				Accept: stream ? "text/event-stream" : "application/json",
				"Anthropic-Dangerous-Direct-Browser-Access": "true",
				Authorization: `Bearer ${apiKey}`,
				...(betaFeatures.length > 0 ? { "anthropic-beta": buildBetaHeader([], betaFeatures) } : {}),
			},
			model.headers,
			dynamicHeaders,
			headers,
		);

		return {
			isOAuthToken: false,
			apiKey: null,
			authToken: apiKey,
			baseURL: baseUrl,
			maxRetries: 5,
			dangerouslyAllowBrowser: true,
			defaultHeaders,
			...(tlsFetchOptions ? { fetchOptions: tlsFetchOptions } : {}),
		};
	}

	const betaFeatures = [...extraBetas];
	if (interleavedThinking) {
		betaFeatures.push("interleaved-thinking-2025-05-14");
	}

	const defaultHeaders = buildAnthropicHeaders({
		apiKey,
		baseUrl,
		isOAuth: oauthToken,
		extraBetas: betaFeatures,
		stream,
		modelHeaders: mergeHeaders(model.headers, foundryCustomHeaders, headers, dynamicHeaders),
	});

	return {
		isOAuthToken: oauthToken,
		apiKey: oauthToken ? null : apiKey,
		authToken: oauthToken ? apiKey : undefined,
		baseURL: baseUrl,
		maxRetries: 5,
		dangerouslyAllowBrowser: true,
		defaultHeaders,
		...(tlsFetchOptions ? { fetchOptions: tlsFetchOptions } : {}),
	};
}

function createClient(
	model: Model<"anthropic-messages">,
	args: AnthropicClientOptionsArgs,
): { client: Anthropic; isOAuthToken: boolean } {
	const { isOAuthToken: oauthToken, ...clientOptions } = buildAnthropicClientOptions({ ...args, model });
	const client = new Anthropic(clientOptions);
	return { client, isOAuthToken: oauthToken };
}

function disableThinkingIfToolChoiceForced(params: MessageCreateParamsStreaming): void {
	const toolChoice = params.tool_choice;
	if (!toolChoice) return;
	if (toolChoice.type === "any" || toolChoice.type === "tool") {
		delete params.thinking;
		delete params.output_config;
	}
}

function ensureMaxTokensForThinking(params: MessageCreateParamsStreaming, model: Model<"anthropic-messages">): void {
	const thinking = params.thinking;
	if (!thinking || thinking.type !== "enabled") return;

	const budgetTokens = thinking.budget_tokens ?? 0;
	if (budgetTokens <= 0) return;

	const maxTokens = params.max_tokens ?? 0;
	const requiredMaxTokens = budgetTokens + OUTPUT_FALLBACK_BUFFER;
	if (maxTokens < requiredMaxTokens) {
		params.max_tokens = Math.min(requiredMaxTokens, model.maxTokens);
	}
}

type CacheControlBlock = {
	cache_control?: AnthropicCacheControl | null;
};

function applyCacheControlToLastBlock<T extends CacheControlBlock>(
	blocks: T[],
	cacheControl: AnthropicCacheControl,
): void {
	if (blocks.length === 0) return;
	const lastIndex = blocks.length - 1;
	blocks[lastIndex] = { ...blocks[lastIndex], cache_control: cacheControl };
}

function applyCacheControlToLastTextBlock(
	blocks: Array<ContentBlockParam & CacheControlBlock>,
	cacheControl: AnthropicCacheControl,
): void {
	if (blocks.length === 0) return;
	for (let i = blocks.length - 1; i >= 0; i--) {
		if (blocks[i].type === "text") {
			blocks[i] = { ...blocks[i], cache_control: cacheControl };
			return;
		}
	}
	applyCacheControlToLastBlock(blocks, cacheControl);
}

function applyPromptCaching(params: MessageCreateParamsStreaming, cacheControl?: AnthropicCacheControl): void {
	if (!cacheControl) return;

	// Skip if cache_control breakpoints were already placed externally on messages.
	for (const message of params.messages) {
		if (Array.isArray(message.content)) {
			if ((message.content as Array<ContentBlockParam & CacheControlBlock>).some(b => b.cache_control != null))
				return;
		}
	}

	const MAX_CACHE_BREAKPOINTS = 4;
	let cacheBreakpointsUsed = 0;

	if (params.tools && params.tools.length > 0) {
		applyCacheControlToLastBlock(params.tools as Array<CacheControlBlock>, cacheControl);
		cacheBreakpointsUsed++;
	}

	if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return;

	if (params.system && Array.isArray(params.system) && params.system.length > 0) {
		applyCacheControlToLastBlock(params.system, cacheControl);
		cacheBreakpointsUsed++;
	}

	if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return;

	const userIndexes = params.messages
		.map((message, index) => (message.role === "user" ? index : -1))
		.filter(index => index >= 0);

	if (userIndexes.length >= 2) {
		const penultimateUserIndex = userIndexes[userIndexes.length - 2];
		const penultimateUser = params.messages[penultimateUserIndex];
		if (penultimateUser) {
			if (typeof penultimateUser.content === "string") {
				const contentBlock: ContentBlockParam & CacheControlBlock = {
					type: "text",
					text: penultimateUser.content,
					cache_control: cacheControl,
				};
				penultimateUser.content = [contentBlock];
				cacheBreakpointsUsed++;
			} else if (Array.isArray(penultimateUser.content) && penultimateUser.content.length > 0) {
				applyCacheControlToLastTextBlock(
					penultimateUser.content as Array<ContentBlockParam & CacheControlBlock>,
					cacheControl,
				);
				cacheBreakpointsUsed++;
			}
		}
	}

	if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return;

	if (userIndexes.length >= 1) {
		const lastUserIndex = userIndexes[userIndexes.length - 1];
		const lastUser = params.messages[lastUserIndex];
		if (lastUser) {
			if (typeof lastUser.content === "string") {
				const contentBlock: ContentBlockParam & CacheControlBlock = {
					type: "text",
					text: lastUser.content,
					cache_control: cacheControl,
				};
				lastUser.content = [contentBlock];
			} else if (Array.isArray(lastUser.content) && lastUser.content.length > 0) {
				applyCacheControlToLastTextBlock(
					lastUser.content as Array<ContentBlockParam & CacheControlBlock>,
					cacheControl,
				);
			}
		}
	}
}

function normalizeCacheControlBlockTtl(block: CacheControlBlock, seenFiveMinute: { value: boolean }): void {
	const cacheControl = block.cache_control;
	if (!cacheControl) return;
	if (cacheControl.ttl !== "1h") {
		seenFiveMinute.value = true;
		return;
	}
	if (seenFiveMinute.value) {
		delete cacheControl.ttl;
	}
}

function normalizeCacheControlTtlOrdering(params: MessageCreateParamsStreaming): void {
	const seenFiveMinute = { value: false };
	if (params.tools) {
		for (const tool of params.tools as Array<Anthropic.Messages.Tool & CacheControlBlock>) {
			normalizeCacheControlBlockTtl(tool, seenFiveMinute);
		}
	}
	if (params.system && Array.isArray(params.system)) {
		for (const block of params.system as Array<AnthropicSystemBlock & CacheControlBlock>) {
			normalizeCacheControlBlockTtl(block, seenFiveMinute);
		}
	}
	for (const message of params.messages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content as Array<ContentBlockParam & CacheControlBlock>) {
			normalizeCacheControlBlockTtl(block, seenFiveMinute);
		}
	}
}

function findLastCacheControlIndex<T extends CacheControlBlock>(blocks: T[]): number {
	for (let index = blocks.length - 1; index >= 0; index--) {
		if (blocks[index]?.cache_control != null) return index;
	}
	return -1;
}

function stripCacheControlExceptIndex<T extends CacheControlBlock>(
	blocks: T[],
	preserveIndex: number,
	excessCounter: { value: number },
): void {
	for (let index = 0; index < blocks.length && excessCounter.value > 0; index++) {
		if (index === preserveIndex) continue;
		if (!blocks[index]?.cache_control) continue;
		delete blocks[index].cache_control;
		excessCounter.value--;
	}
}

function stripAllCacheControl<T extends CacheControlBlock>(blocks: T[], excessCounter: { value: number }): void {
	for (const block of blocks) {
		if (excessCounter.value <= 0) return;
		if (!block.cache_control) continue;
		delete block.cache_control;
		excessCounter.value--;
	}
}

function stripMessageCacheControl(
	messages: MessageCreateParamsStreaming["messages"],
	excessCounter: { value: number },
): void {
	for (const message of messages) {
		if (excessCounter.value <= 0) return;
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content as Array<ContentBlockParam & CacheControlBlock>) {
			if (excessCounter.value <= 0) return;
			if (!block.cache_control) continue;
			delete block.cache_control;
			excessCounter.value--;
		}
	}
}

function countCacheControlBreakpoints(params: MessageCreateParamsStreaming): number {
	let total = 0;
	if (params.tools) {
		for (const tool of params.tools as Array<Anthropic.Messages.Tool & CacheControlBlock>) {
			if (tool.cache_control) total++;
		}
	}
	if (params.system && Array.isArray(params.system)) {
		for (const block of params.system as Array<AnthropicSystemBlock & CacheControlBlock>) {
			if (block.cache_control) total++;
		}
	}
	for (const message of params.messages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content as Array<ContentBlockParam & CacheControlBlock>) {
			if (block.cache_control) total++;
		}
	}
	return total;
}

function enforceCacheControlLimit(params: MessageCreateParamsStreaming, maxBreakpoints: number): void {
	const total = countCacheControlBreakpoints(params);
	if (total <= maxBreakpoints) return;
	const excessCounter = { value: total - maxBreakpoints };
	const systemBlocks =
		params.system && Array.isArray(params.system)
			? (params.system as Array<AnthropicSystemBlock & CacheControlBlock>)
			: [];
	const toolBlocks = (params.tools ?? []) as Array<Anthropic.Messages.Tool & CacheControlBlock>;
	const lastSystemIndex = findLastCacheControlIndex(systemBlocks);
	const lastToolIndex = findLastCacheControlIndex(toolBlocks);
	if (systemBlocks.length > 0) {
		stripCacheControlExceptIndex(systemBlocks, lastSystemIndex, excessCounter);
	}
	if (excessCounter.value <= 0) return;
	if (toolBlocks.length > 0) {
		stripCacheControlExceptIndex(toolBlocks, lastToolIndex, excessCounter);
	}
	if (excessCounter.value <= 0) return;
	stripMessageCacheControl(params.messages, excessCounter);
	if (excessCounter.value <= 0) return;
	if (systemBlocks.length > 0) {
		stripAllCacheControl(systemBlocks, excessCounter);
	}
	if (excessCounter.value <= 0) return;
	if (toolBlocks.length > 0) {
		stripAllCacheControl(toolBlocks, excessCounter);
	}
}
function buildParams(
	model: Model<"anthropic-messages">,
	baseUrl: string,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const { cacheControl } = getCacheControl(baseUrl, options?.cacheRetention);
	const params: AnthropicSamplingParams = {
		model: model.id,
		messages: convertAnthropicMessages(context.messages, model, isOAuthToken),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}
	if (options?.topP !== undefined) {
		params.top_p = options.topP;
	}
	if (options?.topK !== undefined) {
		params.top_k = options.topK;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools, isOAuthToken);
	}

	if (options?.thinkingEnabled && model.reasoning) {
		const mode = model.thinking?.mode;
		const requestedEffort = options.reasoning;
		const effort =
			options.effort ?? (requestedEffort ? mapEffortToAnthropicAdaptiveEffort(model, requestedEffort) : undefined);

		if (mode === "anthropic-adaptive") {
			params.thinking = { type: "adaptive" };
			if (effort) {
				params.output_config = { effort };
			}
		} else {
			params.thinking = {
				type: "enabled",
				budget_tokens: options.thinkingBudgetTokens || 1024,
			};
			if (mode === "anthropic-budget-effort" && effort) {
				params.output_config = { effort };
			}
		}
	}

	const metadataUserId = resolveAnthropicMetadataUserId(options?.metadata?.user_id, isOAuthToken);
	if (metadataUserId) {
		params.metadata = { user_id: metadataUserId };
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else if (isOAuthToken && options.toolChoice.name) {
			params.tool_choice = { ...options.toolChoice, name: applyClaudeToolPrefix(options.toolChoice.name) };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	const shouldInjectClaudeCodeInstruction = isOAuthToken && !model.id.startsWith("claude-3-5-haiku");
	const billingPayload = shouldInjectClaudeCodeInstruction
		? {
				...params,
				...(context.systemPrompt ? { system: context.systemPrompt.toWellFormed() } : {}),
			}
		: undefined;
	const systemBlocks = buildAnthropicSystemBlocks(context.systemPrompt, {
		includeClaudeCodeInstruction: shouldInjectClaudeCodeInstruction,
		billingPayload,
	});
	if (systemBlocks) {
		params.system = systemBlocks;
	}
	disableThinkingIfToolChoiceForced(params);
	ensureMaxTokensForThinking(params, model);
	applyPromptCaching(params, cacheControl);
	enforceCacheControlLimit(params, 4);
	normalizeCacheControlTtlOrdering(params);

	return params;
}

export function convertAnthropicMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	isOAuthToken: boolean,
): MessageParam[] {
	const params: MessageParam[] = [];

	const transformedMessages = transformMessages(messages, model, normalizeToolCallId);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user" || msg.role === "developer") {
			if (!msg.content) continue;

			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({
						role: "user",
						content: msg.content.toWellFormed(),
					});
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map(item => {
					if (item.type === "text") {
						return {
							type: "text",
							text: item.text.toWellFormed(),
						};
					}
					return {
						type: "image",
						source: {
							type: "base64",
							media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
							data: item.data,
						},
					};
				});
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter(b => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter(b => {
					if (b.type === "text") {
						return b.text.trim().length > 0;
					}
					return true;
				});
				if (filteredBlocks.length === 0) continue;
				params.push({
					role: "user",
					content: filteredBlocks,
				});
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];
			const hasSignedThinking = msg.content.some(
				block =>
					block.type === "thinking" && !!block.thinkingSignature && block.thinkingSignature.trim().length > 0,
			);

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({
						type: "text",
						text: block.text.toWellFormed(),
					});
				} else if (block.type === "thinking") {
					if (hasSignedThinking) {
						if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
							if (block.thinking.trim().length === 0) continue;
							blocks.push({
								type: "text",
								text: block.thinking.toWellFormed(),
							});
							continue;
						}
						blocks.push({
							type: "thinking",
							thinking: block.thinking,
							signature: block.thinkingSignature,
						});
						continue;
					}
					if (block.thinking.trim().length === 0) continue;
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({
							type: "text",
							text: block.thinking.toWellFormed(),
						});
					} else {
						blocks.push({
							type: "thinking",
							thinking: block.thinking.toWellFormed(),
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "redactedThinking") {
					if (block.data.trim().length === 0) continue;
					blocks.push({
						type: "redacted_thinking",
						data: block.data,
					});
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: isOAuthToken ? applyClaudeToolPrefix(block.name) : block.name,
						input: block.arguments ?? {},
					});
				}
			}
			if (blocks.length === 0) continue;
			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			// Collect all consecutive toolResult messages, needed for z.ai Anthropic endpoint
			const toolResults: ContentBlockParam[] = [];

			// Add the current tool result
			toolResults.push({
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			// Look ahead for consecutive toolResult messages
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage; // We know it's a toolResult
				toolResults.push({
					type: "tool_result",
					tool_use_id: nextMsg.toolCallId,
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			// Skip the messages we've already processed
			i = j - 1;

			// Add a single user message with all tool results
			params.push({
				role: "user",
				content: toolResults,
			});
		}
	}

	if (params.length > 0 && params[params.length - 1]?.role === "assistant") {
		params.push({ role: "user", content: "Continue." });
	}

	return params;
}

function convertTools(tools: Tool[], isOAuthToken: boolean): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map(tool => {
		const jsonSchema = tool.parameters as any; // TypeBox already generates JSON Schema

		return {
			name: isOAuthToken ? applyClaudeToolPrefix(tool.name) : tool.name,
			description: tool.description || "",
			input_schema: {
				type: "object" as const,
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

function mapStopReason(reason: Anthropic.Messages.StopReason | string): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		case "pause_turn": // Stop is good enough -> resubmit
			return "stop";
		case "stop_sequence":
			return "stop"; // We don't supply stop sequences, so this should never happen
		case "sensitive": // Content flagged by safety filters (not yet in SDK types)
			return "error";
		default:
			// Handle unknown stop reasons gracefully (API may add new values)
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}

```


## GITHUB-COPILOT

### Authentication Implementation (`github-copilot.ts`)

```typescript
/**
 * GitHub Copilot OAuth flow
 */
import { abortableSleep } from "@oh-my-pi/pi-utils";
import { getBundledModels } from "../../models";
import type { OAuthCredentials } from "./types";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("SXYxLmI1MDdhMDhjODdlY2ZlOTg=");

const COPILOT_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.107.0",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "vscode-chat",
} as const;

const INITIAL_POLL_INTERVAL_MULTIPLIER = 1.2;
const SLOW_DOWN_POLL_INTERVAL_MULTIPLIER = 1.4;
type DeviceCodeResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	interval: number;
	expires_in: number;
};

type DeviceTokenSuccessResponse = {
	access_token: string;
	token_type?: string;
	scope?: string;
};

type DeviceTokenErrorResponse = {
	error: string;
	error_description?: string;
	interval?: number;
};

export function normalizeDomain(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	try {
		const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
		return url.hostname;
	} catch {
		return null;
	}
}

function getUrls(domain: string): {
	deviceCodeUrl: string;
	accessTokenUrl: string;
	copilotTokenUrl: string;
} {
	return {
		deviceCodeUrl: `https://${domain}/login/device/code`,
		accessTokenUrl: `https://${domain}/login/oauth/access_token`,
		copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
	};
}

/**
 * Parse the proxy-ep from a Copilot token and convert to API base URL.
 * Token format: tid=...;exp=...;proxy-ep=proxy.individual.githubcopilot.com;...
 * Returns API URL like https://api.individual.githubcopilot.com
 */
function getBaseUrlFromToken(token: string): string | null {
	const match = token.match(/proxy-ep=([^;]+)/);
	if (!match) return null;
	const proxyHost = match[1];
	// Convert proxy.xxx to api.xxx
	const apiHost = proxyHost.replace(/^proxy\./, "api.");
	return `https://${apiHost}`;
}

export function getGitHubCopilotBaseUrl(token?: string, enterpriseDomain?: string): string {
	// If we have a token, extract the base URL from proxy-ep
	if (token) {
		const urlFromToken = getBaseUrlFromToken(token);
		if (urlFromToken) return urlFromToken;
	}
	// Fallback for enterprise or if token parsing fails
	if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;
	return "https://api.individual.githubcopilot.com";
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(url, init);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${response.status} ${response.statusText}: ${text}`);
	}
	return response.json();
}

async function startDeviceFlow(domain: string): Promise<DeviceCodeResponse> {
	const urls = getUrls(domain);
	const data = await fetchJson(urls.deviceCodeUrl, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			"User-Agent": "GitHubCopilotChat/0.35.0",
		},
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			scope: "read:user",
		}),
	});

	if (!data || typeof data !== "object") {
		throw new Error("Invalid device code response");
	}

	const deviceCode = (data as Record<string, unknown>).device_code;
	const userCode = (data as Record<string, unknown>).user_code;
	const verificationUri = (data as Record<string, unknown>).verification_uri;
	const interval = (data as Record<string, unknown>).interval;
	const expiresIn = (data as Record<string, unknown>).expires_in;

	if (
		typeof deviceCode !== "string" ||
		typeof userCode !== "string" ||
		typeof verificationUri !== "string" ||
		typeof interval !== "number" ||
		typeof expiresIn !== "number"
	) {
		throw new Error("Invalid device code response fields");
	}

	return {
		device_code: deviceCode,
		user_code: userCode,
		verification_uri: verificationUri,
		interval,
		expires_in: expiresIn,
	};
}

async function sleepForGitHubAccessTokenPoll(ms: number, signal?: AbortSignal): Promise<void> {
	try {
		await abortableSleep(ms, signal);
	} catch {
		throw new Error("Login cancelled");
	}
}

async function pollForGitHubAccessToken(
	domain: string,
	deviceCode: string,
	intervalSeconds: number,
	expiresIn: number,
	signal?: AbortSignal,
) {
	const urls = getUrls(domain);
	const deadline = Date.now() + expiresIn * 1000;
	let intervalMs = Math.max(1000, Math.floor(intervalSeconds * 1000));
	let intervalMultiplier = INITIAL_POLL_INTERVAL_MULTIPLIER;
	let slowDownResponses = 0;

	while (Date.now() < deadline) {
		if (signal?.aborted) {
			throw new Error("Login cancelled");
		}

		const remainingMs = deadline - Date.now();
		const waitMs = Math.min(Math.ceil(intervalMs * intervalMultiplier), remainingMs);
		await sleepForGitHubAccessTokenPoll(waitMs, signal);

		const raw = await fetchJson(urls.accessTokenUrl, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": "GitHubCopilotChat/0.35.0",
			},
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				device_code: deviceCode,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});

		if (raw && typeof raw === "object" && typeof (raw as DeviceTokenSuccessResponse).access_token === "string") {
			return (raw as DeviceTokenSuccessResponse).access_token;
		}

		if (raw && typeof raw === "object" && typeof (raw as DeviceTokenErrorResponse).error === "string") {
			const { error, error_description: description, interval } = raw as DeviceTokenErrorResponse;
			if (error === "authorization_pending") {
				continue;
			}

			if (error === "slow_down") {
				slowDownResponses += 1;
				intervalMs =
					typeof interval === "number" && interval > 0 ? interval * 1000 : Math.max(1000, intervalMs + 5000);
				intervalMultiplier = SLOW_DOWN_POLL_INTERVAL_MULTIPLIER;
				continue;
			}

			const descriptionSuffix = description ? `: ${description}` : "";
			throw new Error(`Device flow failed: ${error}${descriptionSuffix}`);
		}
	}

	if (slowDownResponses > 0) {
		throw new Error(
			"Device flow timed out after one or more slow_down responses. This is often caused by clock drift in WSL or VM environments. Please sync or restart the VM clock and try again.",
		);
	}

	throw new Error("Device flow timed out");
}

/**
 * Refresh GitHub Copilot token
 */
export async function refreshGitHubCopilotToken(
	refreshToken: string,
	enterpriseDomain?: string,
): Promise<OAuthCredentials> {
	const domain = enterpriseDomain || "github.com";
	const urls = getUrls(domain);

	const raw = await fetchJson(urls.copilotTokenUrl, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${refreshToken}`,
			...COPILOT_HEADERS,
		},
	});

	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid Copilot token response");
	}

	const token = (raw as Record<string, unknown>).token;
	const expiresAt = (raw as Record<string, unknown>).expires_at;

	if (typeof token !== "string" || typeof expiresAt !== "number") {
		throw new Error("Invalid Copilot token response fields");
	}

	return {
		refresh: refreshToken,
		access: token,
		expires: expiresAt * 1000 - 5 * 60 * 1000,
		enterpriseUrl: enterpriseDomain,
	};
}

/**
 * Enable a model for the user's GitHub Copilot account.
 * This is required for some models (like Claude, Grok) before they can be used.
 */
async function enableGitHubCopilotModel(token: string, modelId: string, enterpriseDomain?: string): Promise<boolean> {
	const baseUrl = getGitHubCopilotBaseUrl(token, enterpriseDomain);
	const url = `${baseUrl}/models/${modelId}/policy`;

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...COPILOT_HEADERS,
				"openai-intent": "chat-policy",
				"x-interaction-type": "chat-policy",
			},
			body: JSON.stringify({ state: "enabled" }),
		});
		return response.ok;
	} catch {
		return false;
	}
}

/**
 * Enable all known GitHub Copilot models that may require policy acceptance.
 * Called after successful login to ensure all models are available.
 */
async function enableAllGitHubCopilotModels(
	token: string,
	enterpriseDomain?: string,
	onProgress?: (model: string, success: boolean) => void,
): Promise<void> {
	const models = getBundledModels("github-copilot");
	await Promise.all(
		models.map(async model => {
			const success = await enableGitHubCopilotModel(token, model.id, enterpriseDomain);
			onProgress?.(model.id, success);
		}),
	);
}

/**
 * Login with GitHub Copilot OAuth (device code flow)
 *
 * @param options.onAuth - Callback with URL and optional instructions (user code)
 * @param options.onPrompt - Callback to prompt user for input
 * @param options.onProgress - Optional progress callback
 * @param options.signal - Optional AbortSignal for cancellation
 */
export async function loginGitHubCopilot(options: {
	onAuth: (url: string, instructions?: string) => void;
	onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
	onProgress?: (message: string) => void;
	signal?: AbortSignal;
}): Promise<OAuthCredentials> {
	const input = await options.onPrompt({
		message: "GitHub Enterprise URL/domain (blank for github.com)",
		placeholder: "company.ghe.com",
		allowEmpty: true,
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = input.trim();
	const enterpriseDomain = normalizeDomain(input);
	if (trimmed && !enterpriseDomain) {
		throw new Error("Invalid GitHub Enterprise URL/domain");
	}
	const domain = enterpriseDomain || "github.com";

	const device = await startDeviceFlow(domain);
	options.onAuth(device.verification_uri, `Enter code: ${device.user_code}`);

	const githubAccessToken = await pollForGitHubAccessToken(
		domain,
		device.device_code,
		device.interval,
		device.expires_in,
		options.signal,
	);
	const credentials = await refreshGitHubCopilotToken(githubAccessToken, enterpriseDomain ?? undefined);

	// Enable all models after successful login
	options.onProgress?.("Enabling models...");
	await enableAllGitHubCopilotModels(credentials.access, enterpriseDomain ?? undefined);
	return credentials;
}

```


## KIMI

### Authentication Implementation (`kimi.ts`)

```typescript
/**
 * Kimi Code OAuth flow (device authorization grant)
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $env, abortableSleep, getAgentDir, isEnoent } from "@oh-my-pi/pi-utils";
import packageJson from "../../../package.json" with { type: "json" };
import type { OAuthController, OAuthCredentials } from "./types";

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";
const DEVICE_ID_FILENAME = "kimi-device-id";
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_DEVICE_FLOW_TTL_MS = 15 * 60 * 1000;

interface DeviceAuthorizationResponse {
	user_code?: string;
	device_code?: string;
	verification_uri?: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	token_type?: string;
	error?: string;
	error_description?: string;
	interval?: number;
}

function resolveOAuthHost(): string {
	return $env.KIMI_CODE_OAUTH_HOST || $env.KIMI_OAUTH_HOST || DEFAULT_OAUTH_HOST;
}

function formatDeviceModel(system: string, release: string, arch: string): string {
	return [system, release, arch].filter(Boolean).join(" ").trim();
}

function getDeviceModel(): string {
	const platform = os.platform();
	const release = os.release();
	const arch = os.arch();
	if (platform === "darwin") return formatDeviceModel("macOS", release, arch);
	if (platform === "win32") return formatDeviceModel("Windows", release, arch);
	const label = platform === "linux" ? "Linux" : platform;
	return formatDeviceModel(label, release, arch);
}

async function getDeviceId(): Promise<string> {
	const deviceIdPath = path.join(getAgentDir(), DEVICE_ID_FILENAME);
	try {
		const existing = await Bun.file(deviceIdPath).text();
		const trimmed = existing.trim();
		if (trimmed) return trimmed;
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}

	const deviceId = crypto.randomUUID().replace(/-/g, "");
	await Bun.write(deviceIdPath, `${deviceId}\n`);
	await fs.chmod(deviceIdPath, 0o600).catch(() => undefined);
	return deviceId;
}

async function buildCommonHeaders(): Promise<Record<string, string>> {
	return {
		"User-Agent": `KimiCLI/${packageJson.version}`,
		"X-Msh-Platform": "kimi_cli",
		"X-Msh-Version": packageJson.version,
		"X-Msh-Device-Name": os.hostname(),
		"X-Msh-Device-Model": getDeviceModel(),
		"X-Msh-Os-Version": os.version(),
		"X-Msh-Device-Id": await getDeviceId(),
	};
}

export async function getKimiCommonHeaders(): Promise<Record<string, string>> {
	return buildCommonHeaders();
}

async function requestDeviceAuthorization(): Promise<{
	userCode: string;
	deviceCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresInMs: number;
	intervalMs: number;
}> {
	const response = await fetch(`${resolveOAuthHost()}/api/oauth/device_authorization`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			...(await buildCommonHeaders()),
		},
		body: new URLSearchParams({ client_id: CLIENT_ID }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Kimi device authorization failed: ${response.status} ${text}`);
	}

	const payload = (await response.json()) as DeviceAuthorizationResponse;
	const userCode = payload.user_code;
	const deviceCode = payload.device_code;
	const verificationUri = payload.verification_uri;
	const verificationUriComplete = payload.verification_uri_complete;

	if (!userCode || !deviceCode || !verificationUri) {
		throw new Error("Kimi device authorization response missing required fields");
	}

	const expiresInMs = typeof payload.expires_in === "number" ? payload.expires_in * 1000 : DEFAULT_DEVICE_FLOW_TTL_MS;
	const intervalMs =
		typeof payload.interval === "number" && payload.interval > 0 ? payload.interval * 1000 : DEFAULT_POLL_INTERVAL_MS;

	return {
		userCode,
		deviceCode,
		verificationUri,
		verificationUriComplete: verificationUriComplete || verificationUri,
		expiresInMs,
		intervalMs,
	};
}

function parseTokenPayload(payload: TokenResponse, refreshTokenFallback?: string): OAuthCredentials {
	if (!payload.access_token || typeof payload.expires_in !== "number") {
		throw new Error("Kimi token response missing required fields");
	}

	const refresh = payload.refresh_token ?? refreshTokenFallback;
	if (!refresh) {
		throw new Error("Kimi token response missing refresh token");
	}

	return {
		access: payload.access_token,
		refresh,
		expires: Date.now() + payload.expires_in * 1000,
	};
}

async function pollForToken(
	deviceCode: string,
	intervalMs: number,
	expiresInMs: number,
	signal?: AbortSignal,
): Promise<OAuthCredentials> {
	const deadline = Date.now() + expiresInMs;
	let waitMs = Math.max(1000, intervalMs);

	while (Date.now() < deadline) {
		if (signal?.aborted) {
			throw new Error("Login cancelled");
		}

		const response = await fetch(`${resolveOAuthHost()}/api/oauth/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				...(await buildCommonHeaders()),
			},
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				device_code: deviceCode,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});

		const payload = (await response.json()) as TokenResponse;
		if (response.ok && payload.access_token) {
			return parseTokenPayload(payload);
		}

		const error = payload.error;
		if (error === "authorization_pending") {
			await abortableSleep(waitMs, signal);
			continue;
		}

		if (error === "slow_down") {
			waitMs += 5000;
			const retryAfter = typeof payload.interval === "number" ? payload.interval * 1000 : undefined;
			if (retryAfter && retryAfter > waitMs) waitMs = retryAfter;
			await abortableSleep(waitMs, signal);
			continue;
		}

		if (error === "expired_token") {
			throw new Error("Kimi device authorization expired");
		}

		if (error === "access_denied") {
			throw new Error("Kimi device authorization denied");
		}

		const description = payload.error_description ? `: ${payload.error_description}` : "";
		throw new Error(`Kimi device flow failed: ${error ?? response.status}${description}`);
	}

	throw new Error("Kimi device flow timed out");
}

/**
 * Login with Kimi Code OAuth (device code flow).
 */
export async function loginKimi(options: OAuthController): Promise<OAuthCredentials> {
	const device = await requestDeviceAuthorization();
	options.onAuth?.({
		url: device.verificationUriComplete,
		instructions: `Enter code: ${device.userCode}`,
	});

	return pollForToken(device.deviceCode, device.intervalMs, device.expiresInMs, options.signal);
}

/**
 * Refresh Kimi OAuth token.
 */
export async function refreshKimiToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(`${resolveOAuthHost()}/api/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			...(await buildCommonHeaders()),
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});

	if (!response.ok) {
		const payload = (await response.json().catch(() => undefined)) as TokenResponse | undefined;
		const description = payload?.error_description ? `: ${payload.error_description}` : "";
		throw new Error(`Kimi token refresh failed: ${response.status}${description}`);
	}

	const payload = (await response.json()) as TokenResponse;
	return parseTokenPayload(payload, refreshToken);
}

```

### Provider API Implementation (`kimi.ts`)

```typescript
/**
 * Kimi Code provider - wraps OpenAI or Anthropic API based on format setting.
 *
 * Kimi offers both OpenAI-compatible and Anthropic-compatible APIs:
 * - OpenAI: https://api.kimi.com/coding/v1/chat/completions
 * - Anthropic: https://api.kimi.com/coding/v1/messages
 *
 * The Anthropic API is generally more stable and recommended.
 * Note: Kimi calculates TPM rate limits based on max_tokens, not actual output.
 */

import { ANTHROPIC_THINKING } from "../stream";
import type { Api, Context, Model, SimpleStreamOptions } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { getKimiCommonHeaders } from "../utils/oauth/kimi";
import { streamAnthropic } from "./anthropic";
import { streamOpenAICompletions } from "./openai-completions";

export type KimiApiFormat = "openai" | "anthropic";

// Note: Anthropic SDK appends /v1/messages, so base URL should not include /v1
const KIMI_ANTHROPIC_BASE_URL = "https://api.kimi.com/coding";

export interface KimiOptions extends SimpleStreamOptions {
	/** API format: "openai" or "anthropic". Default: "anthropic" */
	format?: KimiApiFormat;
}

/**
 * Stream from Kimi Code, routing to either OpenAI or Anthropic API based on format.
 * Returns synchronously like other providers - async header fetching happens internally.
 */
export function streamKimi(
	model: Model<"openai-completions">,
	context: Context,
	options?: KimiOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const format = options?.format ?? "anthropic";

	// Async IIFE to handle header fetching and stream piping
	(async () => {
		try {
			const kimiHeaders = await getKimiCommonHeaders();
			const mergedHeaders = { ...kimiHeaders, ...options?.headers };

			if (format === "anthropic") {
				// Create a synthetic Anthropic model pointing to Kimi's endpoint
				const anthropicModel: Model<"anthropic-messages"> = {
					id: model.id,
					name: model.name,
					api: "anthropic-messages",
					provider: model.provider,
					baseUrl: KIMI_ANTHROPIC_BASE_URL,
					headers: mergedHeaders,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
				};

				// Calculate thinking budget from reasoning level
				const reasoning = options?.reasoning;
				const reasoningEffort = reasoning;
				const thinkingEnabled = !!reasoningEffort && model.reasoning;
				const thinkingBudget = reasoningEffort
					? (options?.thinkingBudgets?.[reasoningEffort] ?? ANTHROPIC_THINKING[reasoningEffort])
					: undefined;

				const innerStream = streamAnthropic(anthropicModel, context, {
					apiKey: options?.apiKey,
					temperature: options?.temperature,
					topP: options?.topP,
					topK: options?.topK,
					minP: options?.minP,
					presencePenalty: options?.presencePenalty,
					repetitionPenalty: options?.repetitionPenalty,
					maxTokens: options?.maxTokens ?? Math.min(model.maxTokens, 32000),
					signal: options?.signal,
					headers: mergedHeaders,
					sessionId: options?.sessionId,
					onPayload: options?.onPayload,
					thinkingEnabled,
					thinkingBudgetTokens: thinkingBudget,
				});

				for await (const event of innerStream) {
					stream.push(event);
				}
			} else {
				// OpenAI format - use original model with Kimi headers
				const reasoningEffort = options?.reasoning;
				const innerStream = streamOpenAICompletions(model, context, {
					apiKey: options?.apiKey,
					temperature: options?.temperature,
					topP: options?.topP,
					topK: options?.topK,
					minP: options?.minP,
					presencePenalty: options?.presencePenalty,
					repetitionPenalty: options?.repetitionPenalty,
					maxTokens: options?.maxTokens ?? model.maxTokens,
					signal: options?.signal,
					headers: mergedHeaders,
					sessionId: options?.sessionId,
					onPayload: options?.onPayload,
					reasoning: reasoningEffort,
				});

				for await (const event of innerStream) {
					stream.push(event);
				}
			}
		} catch (err) {
			stream.push({
				type: "error",
				reason: "error",
				error: createErrorMessage(model, err),
			});
		}
	})();

	return stream;
}

function createErrorMessage(model: Model<Api>, err: unknown) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error" as const,
		timestamp: Date.now(),
	};
}

/**
 * Check if a model is a Kimi Code model.
 */
export function isKimiModel(model: Model<Api>): boolean {
	return model.provider === "kimi-code";
}

```


## CEREBRAS

### Authentication Implementation (`cerebras.ts`)

```typescript
/**
 * Cerebras login flow.
 *
 * Cerebras provides OpenAI-compatible models via https://api.cerebras.ai/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Cerebras API key settings
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://cloud.cerebras.ai/platform/";
const API_BASE_URL = "https://api.cerebras.ai/v1";
const VALIDATION_MODEL = "gpt-oss-120b";

/**
 * Login to Cerebras.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginCerebras(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Cerebras login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Cerebras dashboard",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Cerebras API key",
		placeholder: "csk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Cerebras",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## GOOGLE-ANTIGRAVITY

### Authentication Implementation (`google-antigravity.ts`)

```typescript
/**
 * Antigravity OAuth flow (Gemini 3, Claude, GPT-OSS via Google Cloud)
 * Uses different OAuth credentials than google-gemini-cli for access to additional models.
 */
import { getAntigravityAuthHeaders } from "../../providers/google-gemini-cli";
import { OAuthCallbackFlow } from "./callback-server";
import type { OAuthController, OAuthCredentials } from "./types";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode(
	"MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const CLIENT_SECRET = decode("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";

const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_CODE_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const TIER_LEGACY = "legacy-tier";
const PROJECT_ONBOARD_MAX_ATTEMPTS = 5;
const PROJECT_ONBOARD_INTERVAL_MS = 2000;

interface LoadCodeAssistPayload {
	cloudaicompanionProject?: string | { id?: string };
	currentTier?: { id?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

interface LongRunningOperationResponse {
	done?: boolean;
	response?: {
		cloudaicompanionProject?: string | { id?: string };
	};
}

export const ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA = Object.freeze({
	ideType: "ANTIGRAVITY",
	platform: "PLATFORM_UNSPECIFIED",
	pluginType: "GEMINI",
});

function readProjectId(value: string | { id?: string } | undefined): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0) {
		return value.id;
	}
	return undefined;
}

function getDefaultTierId(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): string {
	if (!allowedTiers || allowedTiers.length === 0) {
		return TIER_LEGACY;
	}
	const defaultTier = allowedTiers.find(tier => tier.isDefault && typeof tier.id === "string" && tier.id.length > 0);
	if (defaultTier?.id) {
		return defaultTier.id;
	}
	return TIER_LEGACY;
}

async function onboardProjectWithRetries(
	endpoint: string,
	headers: Record<string, string>,
	onboardBody: { tierId: string; metadata: typeof ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
	onProgress?: (message: string) => void,
): Promise<string> {
	for (let attempt = 1; attempt <= PROJECT_ONBOARD_MAX_ATTEMPTS; attempt += 1) {
		if (attempt > 1) {
			onProgress?.(`Waiting for project provisioning (attempt ${attempt}/${PROJECT_ONBOARD_MAX_ATTEMPTS})...`);
			await Bun.sleep(PROJECT_ONBOARD_INTERVAL_MS);
		}

		const onboardResponse = await fetch(`${endpoint}/v1internal:onboardUser`, {
			method: "POST",
			headers,
			body: JSON.stringify(onboardBody),
		});

		if (!onboardResponse.ok) {
			const errorText = await onboardResponse.text();
			throw new Error(`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${errorText}`);
		}

		const operation = (await onboardResponse.json()) as LongRunningOperationResponse;
		if (!operation.done) {
			continue;
		}

		const projectId = readProjectId(operation.response?.cloudaicompanionProject);
		if (projectId) {
			return projectId;
		}
	}

	throw new Error(
		`onboardUser did not return a provisioned project id after ${PROJECT_ONBOARD_MAX_ATTEMPTS} attempts`,
	);
}

async function discoverProject(accessToken: string, onProgress?: (message: string) => void): Promise<string> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		...getAntigravityAuthHeaders(),
	};

	onProgress?.("Checking for existing project...");
	const endpoint = CLOUD_CODE_ENDPOINT;
	try {
		const loadResponse = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
			}),
		});

		if (!loadResponse.ok) {
			const errorText = await loadResponse.text();
			throw new Error(`loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${errorText}`);
		}

		const loadPayload = (await loadResponse.json()) as LoadCodeAssistPayload;
		const existingProject = readProjectId(loadPayload.cloudaicompanionProject);
		if (existingProject) {
			return existingProject;
		}

		const tierId = getDefaultTierId(loadPayload.allowedTiers);
		onProgress?.("Provisioning project...");
		const onboardBody = {
			tierId,
			metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
		};
		const provisionedProject = await onboardProjectWithRetries(endpoint, headers, onboardBody, onProgress);
		return provisionedProject;
	} catch (error) {
		throw new Error(
			`Could not discover or provision an Antigravity project. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
	try {
		const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (response.ok) {
			const data = (await response.json()) as { email?: string };
			return data.email;
		}
	} catch {
		// Ignore errors, email is optional
	}
	return undefined;
}

class AntigravityOAuthFlow extends OAuthCallbackFlow {
	constructor(ctrl: OAuthController) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES.join(" "),
			state,
			access_type: "offline",
			prompt: "consent",
		});

		const url = `${AUTH_URL}?${authParams.toString()}`;
		return { url, instructions: "Complete the sign-in in your browser." };
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		this.ctrl.onProgress?.("Exchanging authorization code for tokens...");

		const tokenResponse = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			throw new Error(`Token exchange failed: ${error}`);
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		if (!tokenData.refresh_token) {
			throw new Error("No refresh token received. Please try again.");
		}

		this.ctrl.onProgress?.("Getting user info...");
		const email = await getUserEmail(tokenData.access_token);
		const projectId = await discoverProject(tokenData.access_token, this.ctrl.onProgress);

		return {
			refresh: tokenData.refresh_token,
			access: tokenData.access_token,
			expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
			projectId,
			email,
		};
	}
}

/**
 * Login with Antigravity OAuth
 */
export async function loginAntigravity(ctrl: OAuthController): Promise<OAuthCredentials> {
	const flow = new AntigravityOAuthFlow(ctrl);
	return flow.login();
}

/**
 * Refresh Antigravity token
 */
export async function refreshAntigravityToken(refreshToken: string, projectId: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Antigravity token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	return {
		refresh: data.refresh_token || refreshToken,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
		projectId,
	};
}

```


## HUGGINGFACE

### Authentication Implementation (`huggingface.ts`)

```typescript
/**
 * Hugging Face Inference login flow.
 *
 * Hugging Face Inference Providers expose an OpenAI-compatible endpoint via
 * https://router.huggingface.co/v1.
 *
 * This is an API key flow:
 * 1. Open browser to Hugging Face token settings
 * 2. User creates/copies a token with Inference Providers permission
 * 3. User pastes the token into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL =
	"https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained";
const API_BASE_URL = "https://router.huggingface.co/v1";
const VALIDATION_MODEL = "openai/gpt-oss-120b";

/**
 * Login to Hugging Face Inference Providers.
 *
 * Opens browser to token settings, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginHuggingface(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Hugging Face login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions:
			"Create/copy a token with Make calls to Inference Providers permission (usable as HUGGINGFACE_HUB_TOKEN or HF_TOKEN)",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Hugging Face token (HUGGINGFACE_HUB_TOKEN / HF_TOKEN)",
		placeholder: "hf_...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "Hugging Face",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## GITLAB-DUO

### Authentication Implementation (`gitlab-duo.ts`)

```typescript
import { clearGitLabDuoDirectAccessCache } from "../../providers/gitlab-duo";
import { OAuthCallbackFlow } from "./callback-server";
import { generatePKCE } from "./pkce";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";

const GITLAB_COM_URL = "https://gitlab.com";
const BUNDLED_CLIENT_ID = "da4edff2e6ebd2bc3208611e2768bc1c1dd7be791dc5ff26ca34ca9ee44f7d4b";
const OAUTH_SCOPES = ["api"];
const CALLBACK_PORT = 8080;
const CALLBACK_PATH = "/callback";

interface PKCEPair {
	verifier: string;
	challenge: string;
}

function mapTokenResponse(payload: {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	created_at?: number;
}): OAuthCredentials {
	if (!payload.access_token || !payload.refresh_token || typeof payload.expires_in !== "number") {
		throw new Error("GitLab OAuth token response missing required fields");
	}

	const createdAtMs =
		typeof payload.created_at === "number" && Number.isFinite(payload.created_at)
			? payload.created_at * 1000
			: Date.now();

	return {
		access: payload.access_token,
		refresh: payload.refresh_token,
		expires: createdAtMs + payload.expires_in * 1000 - 5 * 60 * 1000,
	};
}

class GitLabDuoOAuthFlow extends OAuthCallbackFlow {
	#pkce: PKCEPair;

	constructor(ctrl: OAuthLoginCallbacks, pkce: PKCEPair) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
		this.#pkce = pkce;
	}

	override async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const authParams = new URLSearchParams({
			client_id: BUNDLED_CLIENT_ID,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: OAUTH_SCOPES.join(" "),
			code_challenge: this.#pkce.challenge,
			code_challenge_method: "S256",
			state,
		});

		return {
			url: `${GITLAB_COM_URL}/oauth/authorize?${authParams.toString()}`,
			instructions: "Complete GitLab login in browser. Authentication will finish automatically.",
		};
	}

	override async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		const response = await fetch(`${GITLAB_COM_URL}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: BUNDLED_CLIENT_ID,
				grant_type: "authorization_code",
				code,
				code_verifier: this.#pkce.verifier,
				redirect_uri: redirectUri,
			}).toString(),
		});

		if (!response.ok) {
			throw new Error(`GitLab OAuth token exchange failed: ${response.status} ${await response.text()}`);
		}

		clearGitLabDuoDirectAccessCache();
		return mapTokenResponse(
			(await response.json()) as {
				access_token?: string;
				refresh_token?: string;
				expires_in?: number;
				created_at?: number;
			},
		);
	}
}

export async function loginGitLabDuo(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const pkce = await generatePKCE();
	const flow = new GitLabDuoOAuthFlow(callbacks, pkce);
	return flow.login();
}

export async function refreshGitLabDuoToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const response = await fetch(`${GITLAB_COM_URL}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: BUNDLED_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: credentials.refresh,
		}).toString(),
	});

	if (!response.ok) {
		throw new Error(`GitLab OAuth refresh failed: ${response.status} ${await response.text()}`);
	}

	clearGitLabDuoDirectAccessCache();
	return mapTokenResponse(
		(await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
			created_at?: number;
		},
	);
}

```

### Provider API Implementation (`gitlab-duo.ts`)

```typescript
import { ANTHROPIC_THINKING, mapAnthropicToolChoice } from "../stream";
import type { Api, Context, Model, SimpleStreamOptions } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { streamAnthropic } from "./anthropic";
import type { OpenAICompletionsOptions } from "./openai-completions";
import { streamOpenAICompletions } from "./openai-completions";
import type { OpenAIResponsesOptions } from "./openai-responses";
import { streamOpenAIResponses } from "./openai-responses";

const GITLAB_COM_URL = "https://gitlab.com";
const AI_GATEWAY_URL = "https://cloud.gitlab.com";
const ANTHROPIC_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/anthropic/`;
const OPENAI_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/openai/v1`;
const DIRECT_ACCESS_TTL_MS = 25 * 60 * 1000;

type GitLabProvider = "anthropic" | "openai";
type GitLabOpenAIApiType = "chat" | "responses";

export type GitLabModelMapping = {
	provider: GitLabProvider;
	model: string;
	openaiApiType?: GitLabOpenAIApiType;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
};

export const MODEL_MAPPINGS: Record<string, GitLabModelMapping> = {
	"duo-chat-opus-4-6": {
		provider: "anthropic",
		model: "claude-opus-4-6",
		name: "Duo Chat Opus 4.6",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	"duo-chat-sonnet-4-6": {
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		name: "Duo Chat Sonnet 4.6",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	"duo-chat-opus-4-5": {
		provider: "anthropic",
		model: "claude-opus-4-5-20251101",
		name: "Duo Chat Opus 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	"duo-chat-sonnet-4-5": {
		provider: "anthropic",
		model: "claude-sonnet-4-5-20250929",
		name: "Duo Chat Sonnet 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	"duo-chat-haiku-4-5": {
		provider: "anthropic",
		model: "claude-haiku-4-5-20251001",
		name: "Duo Chat Haiku 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	"duo-chat-gpt-5-1": {
		provider: "openai",
		model: "gpt-5.1-2025-11-13",
		openaiApiType: "chat",
		name: "Duo Chat GPT-5.1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	"duo-chat-gpt-5-2": {
		provider: "openai",
		model: "gpt-5.2-2025-12-11",
		openaiApiType: "chat",
		name: "Duo Chat GPT-5.2",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	"duo-chat-gpt-5-mini": {
		provider: "openai",
		model: "gpt-5-mini-2025-08-07",
		openaiApiType: "chat",
		name: "Duo Chat GPT-5 Mini",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	"duo-chat-gpt-5-codex": {
		provider: "openai",
		model: "gpt-5-codex",
		openaiApiType: "responses",
		name: "Duo Chat GPT-5 Codex",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 128000,
	},
	"duo-chat-gpt-5-2-codex": {
		provider: "openai",
		model: "gpt-5.2-codex",
		openaiApiType: "responses",
		name: "Duo Chat GPT-5.2 Codex",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 128000,
	},
};

export function getModelMapping(modelId: string): GitLabModelMapping | undefined {
	const direct = MODEL_MAPPINGS[modelId];
	if (direct) return direct;

	// Support canonical model IDs (e.g. "gpt-5-codex", "claude-sonnet-4-5-20250929")
	// in addition to Duo aliases (e.g. "duo-chat-gpt-5-codex").
	return Object.values(MODEL_MAPPINGS).find(mapping => mapping.model === modelId);
}

export function getGitLabDuoModels(): Model<Api>[] {
	return Object.entries(MODEL_MAPPINGS).map(([id, mapping]) => ({
		id,
		name: mapping.name,
		api:
			mapping.provider === "anthropic"
				? "anthropic-messages"
				: mapping.openaiApiType === "responses"
					? "openai-responses"
					: "openai-completions",
		provider: "gitlab-duo",
		baseUrl: mapping.provider === "anthropic" ? ANTHROPIC_PROXY_URL : OPENAI_PROXY_URL,
		reasoning: mapping.reasoning,
		input: [...mapping.input],
		cost: { ...mapping.cost },
		contextWindow: mapping.contextWindow,
		maxTokens: mapping.maxTokens,
	}));
}

interface DirectAccessToken {
	token: string;
	headers: Record<string, string>;
	expiresAt: number;
}

const directAccessCache = new Map<string, DirectAccessToken>();

async function getDirectAccessToken(gitlabAccessToken: string): Promise<DirectAccessToken> {
	const cached = directAccessCache.get(gitlabAccessToken);
	if (cached && cached.expiresAt > Date.now()) {
		return cached;
	}

	const response = await fetch(`${GITLAB_COM_URL}/api/v4/ai/third_party_agents/direct_access`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${gitlabAccessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			feature_flags: { DuoAgentPlatformNext: true },
		}),
	});

	if (!response.ok) {
		const detail = await response.text();
		if (response.status === 403) {
			throw new Error(`GitLab Duo access denied. Ensure Duo is enabled for this account. ${detail}`);
		}
		throw new Error(`Failed to get GitLab Duo direct access token: ${response.status} ${detail}`);
	}

	const payload = (await response.json()) as { token?: string; headers?: Record<string, string> };
	if (!payload.token || typeof payload.token !== "string") {
		throw new Error("GitLab Duo direct access response missing token");
	}
	if (!payload.headers || typeof payload.headers !== "object") {
		throw new Error("GitLab Duo direct access response missing headers");
	}

	const token: DirectAccessToken = {
		token: payload.token,
		headers: payload.headers,
		expiresAt: Date.now() + DIRECT_ACCESS_TTL_MS,
	};
	directAccessCache.set(gitlabAccessToken, token);
	return token;
}

function getErrorMessage(model: Model<Api>, err: unknown) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error" as const,
		timestamp: Date.now(),
	};
}

export function clearGitLabDuoDirectAccessCache(): void {
	directAccessCache.clear();
}

export function isGitLabDuoModel(model: Model<Api>): boolean {
	return model.provider === "gitlab-duo";
}

export function streamGitLabDuo(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();

	(async () => {
		try {
			if (!options?.apiKey) {
				throw new Error("Missing GitLab access token. Run /login gitlab-duo or set GITLAB_TOKEN.");
			}

			const mapping = getModelMapping(model.id);
			if (!mapping) {
				throw new Error(`Unsupported GitLab Duo model: ${model.id}`);
			}

			const directAccess = await getDirectAccessToken(options.apiKey);
			const headers = {
				...directAccess.headers,
				...options.headers,
			};

			const reasoningEffort = options.reasoning;

			const inner =
				mapping.provider === "anthropic"
					? streamAnthropic(
							{
								...model,
								id: mapping.model,
								api: "anthropic-messages",
								baseUrl: ANTHROPIC_PROXY_URL,
							} as Model<"anthropic-messages">,
							context,
							{
								apiKey: directAccess.token,
								isOAuth: true,
								temperature: options.temperature,
								topP: options.topP,
								topK: options.topK,
								minP: options.minP,
								presencePenalty: options.presencePenalty,
								repetitionPenalty: options.repetitionPenalty,
								maxTokens: options.maxTokens ?? Math.min(model.maxTokens, 32000),
								signal: options.signal,
								cacheRetention: options.cacheRetention,
								headers,
								maxRetryDelayMs: options.maxRetryDelayMs,
								metadata: options.metadata,
								sessionId: options.sessionId,
								providerSessionState: options.providerSessionState,
								onPayload: options.onPayload,
								thinkingEnabled: Boolean(reasoningEffort) && model.reasoning,
								thinkingBudgetTokens: reasoningEffort
									? (options.thinkingBudgets?.[reasoningEffort] ?? ANTHROPIC_THINKING[reasoningEffort])
									: undefined,
								reasoning: reasoningEffort,
								toolChoice: mapAnthropicToolChoice(options.toolChoice),
							},
						)
					: mapping.openaiApiType === "responses"
						? streamOpenAIResponses(
								{
									...model,
									id: mapping.model,
									api: "openai-responses",
									baseUrl: OPENAI_PROXY_URL,
								} as Model<"openai-responses">,
								context,
								{
									apiKey: directAccess.token,
									temperature: options.temperature,
									topP: options.topP,
									topK: options.topK,
									minP: options.minP,
									presencePenalty: options.presencePenalty,
									repetitionPenalty: options.repetitionPenalty,
									maxTokens: options.maxTokens ?? model.maxTokens,
									signal: options.signal,
									cacheRetention: options.cacheRetention,
									headers,
									maxRetryDelayMs: options.maxRetryDelayMs,
									metadata: options.metadata,
									sessionId: options.sessionId,
									providerSessionState: options.providerSessionState,
									onPayload: options.onPayload,
									reasoning: reasoningEffort,
									toolChoice: options.toolChoice,
								} satisfies OpenAIResponsesOptions,
							)
						: streamOpenAICompletions(
								{
									...model,
									id: mapping.model,
									api: "openai-completions",
									baseUrl: OPENAI_PROXY_URL,
								} as Model<"openai-completions">,
								context,
								{
									apiKey: directAccess.token,
									temperature: options.temperature,
									topP: options.topP,
									topK: options.topK,
									minP: options.minP,
									presencePenalty: options.presencePenalty,
									repetitionPenalty: options.repetitionPenalty,
									maxTokens: options.maxTokens ?? model.maxTokens,
									signal: options.signal,
									cacheRetention: options.cacheRetention,
									headers,
									maxRetryDelayMs: options.maxRetryDelayMs,
									metadata: options.metadata,
									sessionId: options.sessionId,
									providerSessionState: options.providerSessionState,
									onPayload: options.onPayload,
									reasoning: reasoningEffort,
									toolChoice: options.toolChoice,
								} satisfies OpenAICompletionsOptions,
							);

			for await (const event of inner) {
				stream.push(event);
			}
		} catch (err) {
			stream.push({
				type: "error",
				reason: "error",
				error: getErrorMessage(model, err),
			});
		}
	})();

	return stream;
}

```


## VLLM

### Authentication Implementation (`vllm.ts`)

```typescript
/**
 * vLLM login flow.
 *
 * vLLM is commonly self-hosted with an OpenAI-compatible API at a local base URL.
 * Some deployments require a bearer token, others allow unauthenticated access.
 *
 * This flow stores an API-key-style credential used by `/login` and auth storage.
 */

import type { OAuthController, OAuthProvider } from "./types";

const PROVIDER_ID: OAuthProvider = "vllm";
const AUTH_URL = "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8000/v1";
const DEFAULT_LOCAL_TOKEN = "vllm-local";
/**
 * Login to vLLM.
 *
 * Opens vLLM OpenAI-compatible auth docs, prompts for an optional token,
 * and returns a stored key value.
 */
export async function loginVllm(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error(`${PROVIDER_ID} login requires onPrompt callback`);
	}
	options.onAuth?.({
		url: AUTH_URL,
		instructions: `Paste your vLLM API key if your server requires auth. Leave empty for local no-auth mode (default base URL: ${DEFAULT_LOCAL_BASE_URL}).`,
	});
	const apiKey = await options.onPrompt({
		message: "Paste your vLLM API key (optional for local no-auth)",
		placeholder: DEFAULT_LOCAL_TOKEN,
		allowEmpty: true,
	});
	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}
	const trimmed = apiKey.trim();
	return trimmed || DEFAULT_LOCAL_TOKEN;
}

```


## TOGETHER

### Authentication Implementation (`together.ts`)

```typescript
/**
 * Together login flow.
 *
 * Together provides OpenAI-compatible models via https://api.together.xyz/v1.
 *
 * This is not OAuth - it's a simple API key flow:
 * 1. Open browser to Together API keys page
 * 2. User copies their API key
 * 3. User pastes the API key into the CLI
 */

import { validateOpenAICompatibleApiKey } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://api.together.xyz/settings/api-keys";
const API_BASE_URL = "https://api.together.xyz/v1";
const VALIDATION_MODEL = "moonshotai/Kimi-K2.5";

/**
 * Login to Together.
 *
 * Opens browser to API keys page, prompts user to paste their API key.
 * Returns the API key directly (not OAuthCredentials - this isn't OAuth).
 */
export async function loginTogether(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("Together login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Copy your API key from the Together dashboard",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your Together API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateOpenAICompatibleApiKey({
		provider: "together",
		apiKey: trimmed,
		baseUrl: API_BASE_URL,
		model: VALIDATION_MODEL,
		signal: options.signal,
	});

	return trimmed;
}

```


## NANOGPT

### Authentication Implementation (`nanogpt.ts`)

```typescript
/**
 * NanoGPT login flow.
 *
 * NanoGPT provides OpenAI-compatible access to multiple upstream text models.
 * This is an API key flow:
 * 1. Open NanoGPT API page
 * 2. Copy API key (sk-...)
 * 3. Paste key into CLI
 */

import { validateApiKeyAgainstModelsEndpoint } from "./api-key-validation";
import type { OAuthController } from "./types";

const AUTH_URL = "https://nano-gpt.com/api";
const API_BASE_URL = "https://nano-gpt.com/api/v1";
const MODELS_URL = `${API_BASE_URL}/models`;

export async function loginNanoGPT(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("NanoGPT login requires onPrompt callback");
	}

	options.onAuth?.({
		url: AUTH_URL,
		instructions: "Create or copy your NanoGPT API key",
	});

	const apiKey = await options.onPrompt({
		message: "Paste your NanoGPT API key",
		placeholder: "sk-...",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("API key is required");
	}

	options.onProgress?.("Validating API key...");
	await validateApiKeyAgainstModelsEndpoint({
		provider: "NanoGPT",
		apiKey: trimmed,
		modelsUrl: MODELS_URL,
		signal: options.signal,
	});

	return trimmed;
}

```
