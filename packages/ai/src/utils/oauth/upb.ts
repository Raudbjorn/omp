/**
 * UPB AI-Chat portal login flow.
 *
 * The UPB (Universität Paderborn) AI-Chat portal at
 * https://ai-chat.uni-paderborn.de is an Open WebUI instance that proxies
 * requests through centrally-funded server-side keys, avoiding per-user
 * budget limits on the raw LiteLLM gateway.
 *
 * Authentication is via LDAP against the university directory.
 * The portal exposes POST /api/v1/auths/ldap which accepts
 * { user, password } and returns a JWT Bearer token.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $env, getAgentDir, isEnoent, isRecord } from "@oh-my-pi/pi-utils";
import type { OAuthController } from "./types";

const DEFAULT_PORTAL_URL = "https://ai-chat.uni-paderborn.de";
const DEFAULT_API_BASE_URL = `${DEFAULT_PORTAL_URL}/api/v1`;

function normalizeApiBaseUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return trimmed.replace(/\/+$/, "");
}

function portalUrlFromApiBaseUrl(apiBaseUrl: string): string {
	return apiBaseUrl.endsWith("/api/v1") ? apiBaseUrl.slice(0, -"/api/v1".length) : apiBaseUrl;
}

function readConfiguredProvider(): { baseUrl?: string; proxyToken?: string } {
	const candidates = [path.join(getAgentDir(), "models.yml"), path.join(os.homedir(), ".omp", "agent", "models.yml")];
	for (const candidate of candidates) {
		try {
			const content = fs.readFileSync(candidate, "utf8");
			const parsed = Bun.YAML.parse(content);
			if (!isRecord(parsed)) continue;
			const providers = parsed.providers;
			if (!isRecord(providers)) continue;
			const upb = providers.upb;
			if (!isRecord(upb)) continue;
			const baseUrl = typeof upb.baseUrl === "string" ? upb.baseUrl : undefined;
			const headers = upb.headers;
			const proxyToken =
				isRecord(headers) && typeof headers["X-OMP-Proxy-Token"] === "string"
					? headers["X-OMP-Proxy-Token"]
					: undefined;
			return { baseUrl, proxyToken };
		} catch (error) {
			if (isEnoent(error)) continue;
		}
	}
	return {};
}

function resolveApiBaseUrl(configuredProvider: { baseUrl?: string }): string {
	return (
		normalizeApiBaseUrl($env.UPB_BASE_URL) ?? normalizeApiBaseUrl(configuredProvider.baseUrl) ?? DEFAULT_API_BASE_URL
	);
}

function resolveProxyToken(configuredProvider: { proxyToken?: string }): string | undefined {
	return $env.UPB_PROXY_TOKEN?.trim() || configuredProvider.proxyToken?.trim();
}

/**
 * Login to the UPB AI-Chat portal via LDAP.
 *
 * Prompts for username and password, authenticates against the portal's
 * LDAP endpoint, and returns the JWT access token.
 */
export async function loginUPB(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("UPB login requires onPrompt callback");
	}

	const configuredProvider = readConfiguredProvider();
	const apiBaseUrl = resolveApiBaseUrl(configuredProvider);
	const proxyToken = resolveProxyToken(configuredProvider);
	const portalUrl = portalUrlFromApiBaseUrl(apiBaseUrl);
	const ldapAuthEndpoint = `${apiBaseUrl}/auths/ldap`;

	options.onAuth?.({
		url: portalUrl,
		instructions: `Log in with your UPB (Universität Paderborn) LDAP account — the same credentials you use at ${new URL(portalUrl).host}`,
	});

	const username = await options.onPrompt({
		message: "UPB username",
		placeholder: "elikoga",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const password = await options.onPrompt({
		message: "UPB password",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const trimmedUser = username.trim() || "elikoga";
	const trimmedPw = password.trim();
	if (!trimmedPw) {
		throw new Error("Password is required");
	}

	options.onProgress?.(`Authenticating with UPB LDAP via ${ldapAuthEndpoint} (portal ${portalUrl})...`);

	const response = await fetch(ldapAuthEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: `${portalUrl}/auth`,
			Origin: portalUrl,
			...(proxyToken ? { "X-OMP-Proxy-Token": proxyToken } : {}),
		},
		body: JSON.stringify({ user: trimmedUser, password: trimmedPw }),
	});

	options.onProgress?.(`UPB LDAP response: ${response.status} ${response.statusText || ""}`.trim());

	if (!response.ok) {
		const body = await response.text();
		options.onProgress?.(`UPB LDAP failure body: ${body.slice(0, 500)}`);
		throw new Error(`UPB LDAP authentication failed (${response.status}): ${body}`);
	}

	const data = (await response.json()) as { token: string; name?: string };
	if (!data.token) {
		throw new Error("UPB LDAP response did not include a token");
	}

	options.onProgress?.(`Authenticated as ${data.name ?? trimmedUser}`);

	return data.token;
}
