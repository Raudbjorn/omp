import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Model } from "../../types";

const execFileAsync = promisify(execFile);

/** Static fallback list per-adapter when dynamic discovery fails. */
const STATIC_FALLBACK: Record<string, readonly string[]> = {
	"gemini-cli-acp": ["gemini-2.5-pro", "gemini-2.5-flash"],
};

/** 24h in ms. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
	ids: readonly string[];
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface AcpDiscoveryOptions {
	/** Adapter id (provider key), e.g. "gemini-cli-acp". */
	adapterId: string;
	/** Binary name to invoke for listing (e.g. "gemini"). */
	binary: string;
	/** Args that invoke model listing (e.g. ["model", "list"]). */
	listArgs?: readonly string[];
	/** Timeout in ms for the `binary --list` invocation. */
	timeoutMs?: number;
	/** Skip cache (force refresh). */
	refresh?: boolean;
	/** Cache TTL override. */
	ttlMs?: number;
}

/**
 * Discover model ids for an ACP CLI adapter.
 *
 * Tries `<binary> <listArgs>` with a short timeout and parses JSON or
 * newline-delimited output; on any error, returns the adapter's static
 * fallback list. Results are cached for 24h (keyed by adapter id).
 */
export async function discoverAcpModels(opts: AcpDiscoveryOptions): Promise<readonly string[]> {
	const fallback = STATIC_FALLBACK[opts.adapterId] ?? [];
	const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
	const now = Date.now();
	if (!opts.refresh) {
		const cached = cache.get(opts.adapterId);
		if (cached && cached.expiresAt > now) return cached.ids;
	}

	const listArgs = opts.listArgs ?? ["model", "list"];
	const timeout = opts.timeoutMs ?? 5_000;
	try {
		const { stdout } = await execFileAsync(opts.binary, [...listArgs], { timeout });
		const parsed = parseListOutput(stdout);
		const ids = parsed.length > 0 ? parsed : fallback;
		cache.set(opts.adapterId, { ids, expiresAt: now + ttl });
		return ids;
	} catch {
		cache.set(opts.adapterId, { ids: fallback, expiresAt: now + ttl });
		return fallback;
	}
}

function parseListOutput(out: string): readonly string[] {
	const trimmed = out.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.filter((x): x is string => typeof x === "string");
			}
			if (parsed && typeof parsed === "object" && "models" in parsed) {
				const models = (parsed as { models?: unknown }).models;
				if (Array.isArray(models)) {
					const ids: string[] = [];
					for (const m of models) {
						if (typeof m === "string") ids.push(m);
						else if (m && typeof m === "object" && "id" in m && typeof (m as { id?: unknown }).id === "string") {
							ids.push((m as { id: string }).id);
						}
					}
					return ids;
				}
			}
		} catch {
			// fall through to line parsing
		}
	}
	return trimmed
		.split("\n")
		.map(l => l.trim())
		.filter(l => l && !l.startsWith("#"));
}

/** Clear the discovery cache (for tests or explicit refresh). */
export function clearAcpDiscoveryCache(): void {
	cache.clear();
}

/** Build `Model<"acp-agent">` records from a discovery result. */
export function buildAcpModelRecords(providerId: string, ids: readonly string[]): Model<"acp-agent">[] {
	return ids.map(id => ({
		id,
		name: id,
		api: "acp-agent",
		provider: providerId,
		reasoning: false,
		input: ["text"] as const,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	})) as unknown as Model<"acp-agent">[];
}
