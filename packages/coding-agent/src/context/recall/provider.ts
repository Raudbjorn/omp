import type { Settings } from "../../config/settings";
import { embed as embedWithMemexLicense, resolveMemexLicense } from "./embed";
import { EMBEDDING_DIM } from "./types";

const MEMEX_PROVIDER_KIND = "memex";
const OPENAI_COMPATIBLE_PROVIDER_KIND = "openai-compatible";
const MEMEX_EMBED_URL = "https://memex-embed.ohlabs.ai/v1/embeddings";
const MEMEX_MODEL = "qwen3-embedding-4b";
const DEFAULT_EMBEDDING_API_KEY_ENV_VAR = "EMBEDDINGS_API_KEY";

interface EmbedResponseItem {
	embedding: number[];
}

interface EmbedResponse {
	data: EmbedResponseItem[];
}

export interface EmbeddingProvider {
	kind: typeof MEMEX_PROVIDER_KIND | typeof OPENAI_COMPATIBLE_PROVIDER_KIND;
	name: string;
	endpoint: string;
	model: string;
	dimension: number;
	fingerprint: string;
	embed(texts: string[]): Promise<Float32Array[]>;
}

export interface OpenAICompatibleEmbeddingProviderOptions {
	name?: string;
	endpoint: string;
	model: string;
	dimension: number;
	apiKey?: string;
}

export async function resolveEmbeddingProvider(settings: Settings): Promise<EmbeddingProvider | null> {
	const kind = settings.get("providers.embeddings");
	if (kind === "disabled") return null;
	if (kind === "memex") {
		const license = await resolveMemexLicense();
		return createMemexEmbeddingProvider(license);
	}

	const endpoint = settings.get("providers.embeddingUrl")?.trim();
	if (!endpoint) {
		throw new Error("Embedding provider requires providers.embeddingUrl when providers.embeddings=openai-compatible");
	}

	const model = settings.get("providers.embeddingModel")?.trim();
	if (!model) {
		throw new Error(
			"Embedding provider requires providers.embeddingModel when providers.embeddings=openai-compatible",
		);
	}

	const dimension = Number(settings.get("providers.embeddingDimension") ?? EMBEDDING_DIM);
	if (!Number.isInteger(dimension) || dimension <= 0) {
		throw new Error(`Embedding provider dimension must be a positive integer, got ${dimension}`);
	}

	const apiKeyEnvVar = settings.get("providers.embeddingApiKeyEnvVar")?.trim() || DEFAULT_EMBEDDING_API_KEY_ENV_VAR;
	const apiKey = apiKeyEnvVar ? process.env[apiKeyEnvVar]?.trim() : undefined;

	return createOpenAICompatibleEmbeddingProvider({ endpoint, model, dimension, apiKey });
}

export function createMemexEmbeddingProvider(license: string): EmbeddingProvider {
	return {
		kind: MEMEX_PROVIDER_KIND,
		name: "Memex",
		endpoint: MEMEX_EMBED_URL,
		model: MEMEX_MODEL,
		dimension: EMBEDDING_DIM,
		fingerprint: `${MEMEX_PROVIDER_KIND}:${MEMEX_MODEL}:${EMBEDDING_DIM}`,
		embed: texts => embedWithMemexLicense(texts, license),
	};
}

export function createOpenAICompatibleEmbeddingProvider(
	options: OpenAICompatibleEmbeddingProviderOptions,
): EmbeddingProvider {
	const endpoint = options.endpoint.trim();
	const model = options.model.trim();
	const fingerprint = buildFingerprint(OPENAI_COMPATIBLE_PROVIDER_KIND, endpoint, model, options.dimension);

	return {
		kind: OPENAI_COMPATIBLE_PROVIDER_KIND,
		name: options.name?.trim() || "OpenAI-Compatible Embeddings",
		endpoint,
		model,
		dimension: options.dimension,
		fingerprint,
		embed: texts =>
			embedWithOpenAICompatibleServer(texts, {
				endpoint,
				model,
				dimension: options.dimension,
				apiKey: options.apiKey,
			}),
	};
}

async function embedWithOpenAICompatibleServer(
	texts: string[],
	options: { endpoint: string; model: string; dimension: number; apiKey?: string },
): Promise<Float32Array[]> {
	if (texts.length === 0) return [];

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
	};
	const response = await fetch(options.endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify({ input: texts, model: options.model }),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "<unreadable>");
		throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 200)}`);
	}

	const json = (await response.json()) as EmbedResponse;
	if (!json.data || !Array.isArray(json.data)) {
		throw new Error("Embedding response missing 'data' array");
	}
	if (json.data.length !== texts.length) {
		throw new Error(`Embedding provider returned ${json.data.length} embeddings, expected ${texts.length}`);
	}

	return json.data.map((item, index) => {
		if (item.embedding.length !== options.dimension) {
			throw new Error(`Embedding ${index} has dimension ${item.embedding.length}, expected ${options.dimension}`);
		}
		return new Float32Array(item.embedding);
	});
}

function buildFingerprint(kind: string, endpoint: string, model: string, dimension: number): string {
	return `${kind}:${Bun.hash([endpoint, model, String(dimension)].join("\n")).toString(36)}`;
}
