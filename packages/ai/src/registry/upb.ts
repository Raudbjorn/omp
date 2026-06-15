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
import { $env, getAgentDir, isRecord } from "@oh-my-pi/pi-utils";
import type { OAuthController, OAuthLoginCallbacks } from "./oauth/types";
import type { ProviderDefinition } from "./types";

const DEFAULT_PORTAL_URL = "https://ai-chat.uni-paderborn.de";
const DEFAULT_API_BASE_URL = `${DEFAULT_PORTAL_URL}/api/v1`;

function readConfiguredProvider(): { baseUrl?: string; proxyToken?: string } {
	const candidates = [path.join(getAgentDir(), "models.yml"), path.join(os.homedir(), ".omp", "agent", "models.yml")];
	for (const candidate of candidates) {
		try {
			const content = fs.readFileSync(candidate, "utf8");
			const lines = content.split("\n");
			const providers = lines.find(l => l.trim().startsWith("providers:"))
				? JSON.parse(`{${lines.filter(l => l.trim().startsWith("-")).join(",")}}`)
				: {};
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
		} catch {}
	}
	return {};
}

/**
 * Login to the UPB AI-Chat portal via LDAP.
 *
 * Opens browser to the UPB AI-Chat portal, prompts user for LDAP credentials,
 * authenticates against the portal's LDAP endpoint, and returns the JWT token.
 */
export async function loginUPB(options: OAuthController): Promise<string> {
	if (!options.onPrompt) {
		throw new Error("UPB login requires onPrompt callback");
	}

	const configuredProvider = readConfiguredProvider();
	const rawBaseUrl = configuredProvider.baseUrl?.trim();
	const apiBaseUrl = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, "") : DEFAULT_API_BASE_URL;
	const portalUrl = apiBaseUrl.endsWith("/api/v1") ? apiBaseUrl.slice(0, -"/api/v1".length) : apiBaseUrl;

	options.onAuth?.({
		url: `${portalUrl}/login`,
		instructions: "Log in with your UPB LDAP credentials",
	});

	const username = await options.onPrompt({
		message: "UPB LDAP username",
		placeholder: "username",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	const password = await options.onPrompt({
		message: "UPB LDAP password",
		placeholder: "••••••••",
	});

	if (options.signal?.aborted) {
		throw new Error("Login cancelled");
	}

	options.onProgress?.("Authenticating...");

	const proxyToken = $env.UPB_PROXY_TOKEN?.trim() || configuredProvider.proxyToken?.trim();
	const response = await fetch(`${apiBaseUrl}/auths/ldap`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(proxyToken && { "X-OMP-Proxy-Token": proxyToken }),
		},
		body: JSON.stringify({
			user: username,
			password,
		}),
		signal: options.signal,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`LDAP authentication failed (${response.status}): ${text}`);
	}

	const data = (await response.json()) as { token?: string };
	if (!data.token) {
		throw new Error("No token in LDAP response");
	}

	return data.token;
}

export const upbProvider = {
	id: "upb",
	name: "UPB AI-Chat",
	envKeys: "UPB_API_KEY",
	login: (cb: OAuthLoginCallbacks) => loginUPB(cb),
} as const satisfies ProviderDefinition;
