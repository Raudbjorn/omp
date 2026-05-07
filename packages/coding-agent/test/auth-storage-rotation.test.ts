import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UsageProvider } from "@oh-my-pi/pi-ai";
import * as oauth from "@oh-my-pi/pi-ai/utils/oauth";
import type { OAuthCredentials } from "@oh-my-pi/pi-ai/utils/oauth/types";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("AuthStorage account rotation", () => {
	let tempDir: string;
	let authStorage: AuthStorage;
	let usageExhausted = false;

	const usageProvider: UsageProvider = {
		id: "openai-codex",
		async fetchUsage(params, _ctx): Promise<UsageReport> {
			const accountId = params.credential.accountId ?? "unknown";
			const now = Date.now();
			return {
				provider: "openai-codex",
				fetchedAt: now,
				limits: [
					{
						id: "openai-codex:primary",
						label: "1 Hour",
						scope: { provider: "openai-codex", accountId, windowId: "1h" },
						amount: { unit: "requests", used: usageExhausted ? 100 : 10, limit: 100 },
						status: usageExhausted ? "exhausted" : "ok",
						window: {
							id: "1h",
							label: "1 Hour",
							durationMs: 60 * 60 * 1000,
							resetsAt: now + 60 * 60 * 1000,
						},
					},
					{
						id: "openai-codex:secondary",
						label: "7 Day",
						scope: { provider: "openai-codex", accountId, windowId: "7d" },
						amount: { unit: "requests", used: usageExhausted ? 100 : 10, limit: 100 },
						status: usageExhausted ? "exhausted" : "ok",
						window: {
							id: "7d",
							label: "7 Day",
							durationMs: 7 * 24 * 60 * 60 * 1000,
							resetsAt: now + 7 * 24 * 60 * 60 * 1000,
						},
					},
				],
			};
		},
	};

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `pi-test-auth-rotation-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		usageExhausted = false;

		authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"), {
			usageProviderResolver: provider => (provider === "openai-codex" ? usageProvider : undefined),
		});

		vi.spyOn(oauth, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials["openai-codex"] as OAuthCredentials | undefined;
			if (!credential) return null;
			return {
				apiKey: `api-${credential.accountId ?? "unknown"}`,
				newCredentials: credential,
			};
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		authStorage.close();
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true });
		}
	});

	test("returns a fallback key when every OAuth account is usage-limited", async () => {
		await authStorage.set("openai-codex", [
			{
				type: "oauth",
				access: "access-1",
				refresh: "refresh-1",
				expires: Date.now() + 60_000,
				accountId: "acct-1",
			},
			{
				type: "oauth",
				access: "access-2",
				refresh: "refresh-2",
				expires: Date.now() + 60_000,
				accountId: "acct-2",
			},
		]);

		const sessionId = "issue-55-session";
		const firstKey = await authStorage.getApiKey("openai-codex", sessionId);
		expect(firstKey).toMatch(/^api-acct-/);

		usageExhausted = true;
		const switched = await authStorage.markUsageLimitReached("openai-codex", sessionId);
		expect(switched).toBe(true);

		const exhaustedFallbackKey = await authStorage.getApiKey("openai-codex", sessionId);
		expect(exhaustedFallbackKey).toMatch(/^api-acct-/);
	});
});
