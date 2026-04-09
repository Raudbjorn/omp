import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { AuthCredentialStore, AuthStorage } from "../src/auth-storage";
import type { UsageLimit, UsageProvider, UsageReport } from "../src/usage";
import * as oauthUtils from "../src/utils/oauth";
import type { OAuthCredentials } from "../src/utils/oauth/types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const FIVE_HOUR_MS = 5 * HOUR_MS;

const CODEX_SWITCH_REASON_VALUES = [
	"usage_blocked",
	"definitive_auth_failure",
	"pin_missing_or_stale",
	"fallback_all_blocked",
] as const;

type UsageWindowSpec = {
	usedFraction: number;
	resetInMs: number;
};

type UsageWindowConfig = {
	windowId: string;
	windowLabel: string;
	durationMs: number;
};

function createLimit(args: {
	key: "primary" | "secondary";
	windowId: string;
	windowLabel: string;
	durationMs: number;
	usedFraction: number;
	resetInMs: number;
}): UsageLimit {
	const clamped = Math.min(Math.max(args.usedFraction, 0), 1);
	const used = clamped * 100;
	return {
		id: `openai-codex:${args.key}`,
		label: args.windowLabel,
		scope: {
			provider: "openai-codex",
			windowId: args.windowId,
			shared: true,
		},
		window: {
			id: args.windowId,
			label: args.windowLabel,
			durationMs: args.durationMs,
			resetsAt: Date.now() + args.resetInMs,
		},
		amount: {
			unit: "percent",
			used,
			limit: 100,
			remaining: 100 - used,
			usedFraction: clamped,
			remainingFraction: Math.max(0, 1 - clamped),
		},
		status: clamped >= 1 ? "exhausted" : clamped >= 0.9 ? "warning" : "ok",
	};
}

function createCodexUsageReport(args: {
	accountId: string;
	primary: UsageWindowSpec;
	secondary: UsageWindowSpec;
	primaryWindow?: UsageWindowConfig;
	secondaryWindow?: UsageWindowConfig;
}): UsageReport {
	const primaryWindow = args.primaryWindow ?? { windowId: "1h", windowLabel: "1 Hour", durationMs: HOUR_MS };
	const secondaryWindow = args.secondaryWindow ?? { windowId: "7d", windowLabel: "7 Day", durationMs: WEEK_MS };
	return {
		provider: "openai-codex",
		fetchedAt: Date.now(),
		limits: [
			createLimit({
				key: "primary",
				windowId: primaryWindow.windowId,
				windowLabel: primaryWindow.windowLabel,
				durationMs: primaryWindow.durationMs,
				usedFraction: args.primary.usedFraction,
				resetInMs: args.primary.resetInMs,
			}),
			createLimit({
				key: "secondary",
				windowId: secondaryWindow.windowId,
				windowLabel: secondaryWindow.windowLabel,
				durationMs: secondaryWindow.durationMs,
				usedFraction: args.secondary.usedFraction,
				resetInMs: args.secondary.resetInMs,
			}),
		],
		metadata: { accountId: args.accountId },
	};
}

function createCredential(accountId: string, email: string): OAuthCredentials {
	return {
		access: `access-${accountId}`,
		refresh: `refresh-${accountId}`,
		expires: Date.now() + HOUR_MS,
		accountId,
		email,
	};
}

describe("AuthStorage codex oauth ranking", () => {
	let tempDir = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;
	const usageByAccount = new Map<string, UsageReport>();

	const usageProvider: UsageProvider = {
		id: "openai-codex",
		async fetchUsage(params) {
			const accountId = params.credential.accountId;
			if (!accountId) return null;
			return usageByAccount.get(accountId) ?? null;
		},
	};

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-codex-selection-"));
		store = await AuthCredentialStore.open(path.join(tempDir, "agent.db"));
		authStorage = new AuthStorage(store, {
			usageProviderResolver: provider => (provider === "openai-codex" ? usageProvider : undefined),
		});
		usageByAccount.clear();
		vi.spyOn(oauthUtils, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials["openai-codex"] as OAuthCredentials | undefined;
			if (!credential?.accountId) return null;
			return {
				apiKey: `api-${credential.accountId}`,
				newCredentials: credential,
			};
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = null;
		authStorage = null;
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	test("prefers near-reset weekly account over lower-used far-reset account", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-near", "near@example.com") },
			{ type: "oauth", ...createCredential("acct-far", "far@example.com") },
		]);

		usageByAccount.set(
			"acct-near",
			createCodexUsageReport({
				accountId: "acct-near",
				primary: { usedFraction: 0.4, resetInMs: 10 * 60 * 1000 },
				secondary: { usedFraction: 0.92, resetInMs: 15 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-far",
			createCodexUsageReport({
				accountId: "acct-far",
				primary: { usedFraction: 0.3, resetInMs: 40 * 60 * 1000 },
				secondary: { usedFraction: 0.55, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-weekly-reset");
		expect(apiKey).toBe("api-acct-near");
	});

	test("prefers untouched 7d account before earlier weekly reset account", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-untouched", "untouched@example.com") },
			{ type: "oauth", ...createCredential("acct-near-reset", "near-reset@example.com") },
		]);

		usageByAccount.set(
			"acct-untouched",
			createCodexUsageReport({
				accountId: "acct-untouched",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-near-reset",
			createCodexUsageReport({
				accountId: "acct-near-reset",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.2, resetInMs: 15 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-untouched-weekly");
		expect(apiKey).toBe("api-acct-untouched");
	});

	test("keeps existing tie-breakers when multiple accounts have untouched 7d windows", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-earlier-reset", "earlier-reset@example.com") },
			{ type: "oauth", ...createCredential("acct-later-reset", "later-reset@example.com") },
		]);

		usageByAccount.set(
			"acct-earlier-reset",
			createCodexUsageReport({
				accountId: "acct-earlier-reset",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0, resetInMs: 15 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-later-reset",
			createCodexUsageReport({
				accountId: "acct-later-reset",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-untouched-tiebreak");
		expect(apiKey).toBe("api-acct-earlier-reset");
	});

	test("prioritizes fresh 5h ticker account at 0% usage", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-zero", "zero@example.com") },
			{ type: "oauth", ...createCredential("acct-progress", "progress@example.com") },
		]);

		const fiveHourWindow: UsageWindowConfig = {
			windowId: "5h",
			windowLabel: "5 Hours",
			durationMs: FIVE_HOUR_MS,
		};

		usageByAccount.set(
			"acct-zero",
			createCodexUsageReport({
				accountId: "acct-zero",
				primary: { usedFraction: 0, resetInMs: FIVE_HOUR_MS },
				secondary: { usedFraction: 0.8, resetInMs: 2 * HOUR_MS },
				primaryWindow: fiveHourWindow,
			}),
		);
		usageByAccount.set(
			"acct-progress",
			createCodexUsageReport({
				accountId: "acct-progress",
				primary: { usedFraction: 0.05, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.1, resetInMs: 6 * 24 * HOUR_MS },
				primaryWindow: fiveHourWindow,
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-five-hour-start");
		expect(apiKey).toBe("api-acct-zero");
	});
	test("skips exhausted weekly account even when reset is near", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-exhausted", "exhausted@example.com") },
			{ type: "oauth", ...createCredential("acct-healthy", "healthy@example.com") },
		]);

		usageByAccount.set(
			"acct-exhausted",
			createCodexUsageReport({
				accountId: "acct-exhausted",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-healthy",
			createCodexUsageReport({
				accountId: "acct-healthy",
				primary: { usedFraction: 0.5, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.4, resetInMs: 3 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-exhausted");
		expect(apiKey).toBe("api-acct-healthy");
	});

	test("falls back to earliest-unblocking account when all exhausted", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-soon", "soon@example.com") },
			{ type: "oauth", ...createCredential("acct-later", "later@example.com") },
		]);

		usageByAccount.set(
			"acct-soon",
			createCodexUsageReport({
				accountId: "acct-soon",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-later",
			createCodexUsageReport({
				accountId: "acct-later",
				primary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-all-exhausted");
		expect(apiKey).toBe("api-acct-soon");
	});

	test("works with single credential (no ranking)", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [{ type: "oauth", ...createCredential("acct-solo", "solo@example.com") }]);

		usageByAccount.set(
			"acct-solo",
			createCodexUsageReport({
				accountId: "acct-solo",
				primary: { usedFraction: 0.3, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.2, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-single");
		expect(apiKey).toBe("api-acct-solo");
	});

	test("prefers Pro accounts for codex spark models over Plus accounts", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-plus", "plus@example.com") },
			{ type: "oauth", ...createCredential("acct-pro", "pro@example.com") },
		]);

		const plusReport = createCodexUsageReport({
			accountId: "acct-plus",
			primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * 60 * 60 * 1000 },
		});
		plusReport.metadata = { ...plusReport.metadata, planType: "plus" };
		usageByAccount.set("acct-plus", plusReport);

		const proReport = createCodexUsageReport({
			accountId: "acct-pro",
			primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.2, resetInMs: 6 * 24 * 60 * 60 * 1000 },
		});
		proReport.metadata = { ...proReport.metadata, planType: "pro" };
		usageByAccount.set("acct-pro", proReport);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-spark-prefers-pro", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBe("api-acct-pro");
	});

	test("routes codex spark to a single Plus account when no Pro is connected", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [{ type: "oauth", ...createCredential("acct-plus", "plus@example.com") }]);

		const plusReport = createCodexUsageReport({
			accountId: "acct-plus",
			primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * 60 * 60 * 1000 },
		});
		plusReport.metadata = { ...plusReport.metadata, planType: "plus" };
		usageByAccount.set("acct-plus", plusReport);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-spark-single-plus", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBe("api-acct-plus");
	});

	test("falls back to Plus accounts for codex spark models when no Pro is connected", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-plus-a", "plus-a@example.com") },
			{ type: "oauth", ...createCredential("acct-plus-b", "plus-b@example.com") },
		]);

		for (const accountId of ["acct-plus-a", "acct-plus-b"]) {
			const plusReport = createCodexUsageReport({
				accountId,
				primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.05, resetInMs: 6 * 24 * 60 * 60 * 1000 },
			});
			plusReport.metadata = { ...plusReport.metadata, planType: "plus" };
			usageByAccount.set(accountId, plusReport);
		}

		const apiKey = await authStorage.getApiKey("openai-codex", "session-spark-all-plus", {
			modelId: "gpt-5.3-codex-spark",
		});
		expect(apiKey).toBeDefined();
		expect(apiKey?.startsWith("api-acct-plus-")).toBe(true);
	});

	test("times out slow usage ranking instead of blocking first account selection", async () => {
		if (!store) throw new Error("test setup failed");

		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const slowAuthStorage = new AuthStorage(store, {
			usageProviderResolver: provider =>
				provider === "openai-codex"
					? ({
							id: "openai-codex",
							async fetchUsage(params) {
								const { promise, resolve } = Promise.withResolvers<UsageReport | null>();
								params.signal?.addEventListener("abort", () => resolve(null), { once: true });
								return Promise.race([promise, Bun.sleep(200).then(() => null)]);
							},
						} satisfies UsageProvider)
					: undefined,
			usageRequestTimeoutMs: 10,
		});

		await slowAuthStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-first", "first@example.com") },
			{ type: "oauth", ...createCredential("acct-second", "second@example.com") },
		]);

		const startedAt = Date.now();
		await expect(slowAuthStorage.getApiKey("openai-codex")).resolves.toBeUndefined();
		const elapsedMs = Date.now() - startedAt;

		expect(elapsedMs).toBeLessThan(100);

		const omittedCalls = warnSpy.mock.calls.filter(
			call => call[0] === "AuthStorage codex credential omitted from ranking",
		);
		expect(omittedCalls).toHaveLength(2);
	});

	test("handles usage fetch failure gracefully (null report)", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-null", "null@example.com") },
			{ type: "oauth", ...createCredential("acct-known", "known@example.com") },
		]);

		// acct-null has no entry in usageByAccount — fetchUsage returns null
		usageByAccount.set(
			"acct-known",
			createCodexUsageReport({
				accountId: "acct-known",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("openai-codex", "session-null-usage");
		expect(apiKey).toBe("api-acct-known");
	});

	test("omits codex credential from multi-account ranking when usage report is missing", async () => {
		if (!authStorage) throw new Error("test setup failed");

		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-missing", "missing@example.com") },
			{ type: "oauth", ...createCredential("acct-known", "known@example.com") },
		]);

		usageByAccount.set(
			"acct-known",
			createCodexUsageReport({
				accountId: "acct-known",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		await expect(authStorage.getApiKey("openai-codex", "session-null-usage")).resolves.toBe("api-acct-known");

		const omittedCalls = warnSpy.mock.calls.filter(
			call => call[0] === "AuthStorage codex credential omitted from ranking",
		);
		expect(omittedCalls).toHaveLength(1);
		expect(omittedCalls[0]?.[1]).toMatchObject({
			event: "auth_storage.codex_credential_omitted_from_ranking",
			provider: "openai-codex",
			sessionId: "session-null-usage",
			reason: "missing_usage_report",
			credential: {
				index: 0,
				accountId: "acct-missing",
				email: "missing@example.com",
			},
		});
	});

	test("fails fast when codex multi-account ranking is missing a secondary window", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-no-secondary", "no-secondary@example.com") },
			{ type: "oauth", ...createCredential("acct-known", "known@example.com") },
		]);

		const missingSecondaryReport = createCodexUsageReport({
			accountId: "acct-no-secondary",
			primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
		});
		missingSecondaryReport.limits = missingSecondaryReport.limits.filter(
			limit => limit.id !== "openai-codex:secondary",
		);
		usageByAccount.set("acct-no-secondary", missingSecondaryReport);
		usageByAccount.set(
			"acct-known",
			createCodexUsageReport({
				accountId: "acct-known",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		await expect(authStorage.getApiKey("openai-codex", "session-missing-secondary")).rejects.toThrow(
			"Codex multi-account ranking requires a secondary usage window for every non-blocked account.",
		);
	});

	test("fails fast when codex multi-account ranking is missing secondary.window.resetsAt", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-no-reset", "no-reset@example.com") },
			{ type: "oauth", ...createCredential("acct-known", "known@example.com") },
		]);

		const missingResetReport = createCodexUsageReport({
			accountId: "acct-no-reset",
			primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
			secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
		});
		const secondaryLimit = missingResetReport.limits.find(limit => limit.id === "openai-codex:secondary");
		if (!secondaryLimit?.window) throw new Error("test setup failed");
		delete secondaryLimit.window.resetsAt;
		usageByAccount.set("acct-no-reset", missingResetReport);
		usageByAccount.set(
			"acct-known",
			createCodexUsageReport({
				accountId: "acct-known",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		await expect(authStorage.getApiKey("openai-codex", "session-missing-reset")).rejects.toThrow(
			"Codex multi-account ranking requires secondary.window.resetsAt for every non-blocked account.",
		);
	});

	test("keeps codex credential sticky within a session despite ranking pressure", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-sticky", "sticky@example.com") },
			{ type: "oauth", ...createCredential("acct-ranked", "ranked@example.com") },
		]);

		usageByAccount.set(
			"acct-sticky",
			createCodexUsageReport({
				accountId: "acct-sticky",
				primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 30 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-ranked",
			createCodexUsageReport({
				accountId: "acct-ranked",
				primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.05, resetInMs: 2 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-sticky")).toBe("api-acct-sticky");

		usageByAccount.delete("acct-ranked");
		usageByAccount.set(
			"acct-sticky",
			createCodexUsageReport({
				accountId: "acct-sticky",
				primary: { usedFraction: 0.95, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.95, resetInMs: 5 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-sticky")).toBe("api-acct-sticky");
		usageByAccount.set(
			"acct-ranked",
			createCodexUsageReport({
				accountId: "acct-ranked",
				primary: { usedFraction: 0.05, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.05, resetInMs: 2 * 24 * 60 * 60 * 1000 },
			}),
		);
	});

	test("switches codex account for same session after usage blocking", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-pinned", "pinned@example.com") },
			{ type: "oauth", ...createCredential("acct-fallback", "fallback@example.com") },
		]);

		usageByAccount.set(
			"acct-pinned",
			createCodexUsageReport({
				accountId: "acct-pinned",
				primary: { usedFraction: 0.2, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.25, resetInMs: 3 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-fallback",
			createCodexUsageReport({
				accountId: "acct-fallback",
				primary: { usedFraction: 0.35, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.4, resetInMs: 3 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-usage-switch")).toBe("api-acct-pinned");
		expect(await authStorage.markUsageLimitReached("openai-codex", "session-usage-switch")).toBe(true);
		expect(await authStorage.getApiKey("openai-codex", "session-usage-switch")).toBe("api-acct-fallback");
	});

	test("uses ranked fallback when the pinned codex identity becomes stale", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-old", "old@example.com") },
			{ type: "oauth", ...createCredential("acct-new", "new@example.com") },
		]);

		usageByAccount.set(
			"acct-old",
			createCodexUsageReport({
				accountId: "acct-old",
				primary: { usedFraction: 0.1, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.1, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-new",
			createCodexUsageReport({
				accountId: "acct-new",
				primary: { usedFraction: 0.4, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.4, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-stale-pin")).toBe("api-acct-old");

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-replacement", "replacement@example.com") },
			{ type: "oauth", ...createCredential("acct-new", "new@example.com") },
		]);

		usageByAccount.set(
			"acct-replacement",
			createCodexUsageReport({
				accountId: "acct-replacement",
				primary: { usedFraction: 0.9, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.9, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-new",
			createCodexUsageReport({
				accountId: "acct-new",
				primary: { usedFraction: 0.05, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.05, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-stale-pin")).toBe("api-acct-new");
	});

	test("logs exactly one codex switch event and keeps reason machine-readable", async () => {
		if (!authStorage) throw new Error("test setup failed");

		const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});

		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-primary", "primary@example.com") },
			{ type: "oauth", ...createCredential("acct-secondary", "secondary@example.com") },
		]);

		usageByAccount.set(
			"acct-primary",
			createCodexUsageReport({
				accountId: "acct-primary",
				primary: { usedFraction: 0.1, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.1, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-secondary",
			createCodexUsageReport({
				accountId: "acct-secondary",
				primary: { usedFraction: 0.2, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.2, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-log-switch")).toBe("api-acct-primary");

		usageByAccount.set(
			"acct-primary",
			createCodexUsageReport({
				accountId: "acct-primary",
				primary: { usedFraction: 0.95, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.95, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-secondary",
			createCodexUsageReport({
				accountId: "acct-secondary",
				primary: { usedFraction: 0.05, resetInMs: 20 * 60 * 1000 },
				secondary: { usedFraction: 0.05, resetInMs: 4 * 24 * 60 * 60 * 1000 },
			}),
		);

		expect(await authStorage.getApiKey("openai-codex", "session-log-switch")).toBe("api-acct-primary");
		expect(await authStorage.markUsageLimitReached("openai-codex", "session-log-switch")).toBe(true);
		expect(await authStorage.getApiKey("openai-codex", "session-log-switch")).toBe("api-acct-secondary");
		expect(await authStorage.getApiKey("openai-codex", "session-log-switch")).toBe("api-acct-secondary");

		const switchCalls = debugSpy.mock.calls.filter(call => call[0] === "AuthStorage codex credential switched");
		expect(switchCalls).toHaveLength(1);

		type CodexSwitchPayload = {
			event?: string;
			provider?: string;
			sessionId?: string;
			reason?: string;
			previousCredential?: {
				index?: number;
				accountId?: string;
				email?: string;
			};
			newCredential?: { index?: number; accountId?: string; email?: string };
		};

		const payload = switchCalls[0]?.[1] as CodexSwitchPayload | undefined;
		expect(payload?.event).toBe("auth_storage.codex_credential_switched");
		expect(payload?.provider).toBe("openai-codex");
		expect(payload?.sessionId).toBe("session-log-switch");
		expect(CODEX_SWITCH_REASON_VALUES).toContain(payload?.reason as (typeof CODEX_SWITCH_REASON_VALUES)[number]);
		expect(payload?.reason).toBe("usage_blocked");
		expect(payload?.previousCredential).toMatchObject({
			index: 0,
			accountId: "acct-primary",
			email: "primary@example.com",
		});
		expect(payload?.newCredential).toMatchObject({
			index: 1,
			accountId: "acct-secondary",
			email: "secondary@example.com",
		});
	});
	test("refreshes expired oauth candidates in parallel before selection", async () => {
		if (!authStorage) throw new Error("test setup failed");

		vi.spyOn(oauthUtils, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials["openai-codex"] as OAuthCredentials | undefined;
			if (!credential?.accountId) return null;

			let nextCredential = credential;
			if (Date.now() >= credential.expires) {
				nextCredential = await oauthUtils.refreshOAuthToken("openai-codex", credential);
			}

			if (nextCredential.accountId === "acct-first" || nextCredential.accountId === "acct-second") {
				return null;
			}

			return {
				apiKey: nextCredential.access,
				newCredentials: nextCredential,
			};
		});

		const refreshDelayMs = 75;
		let inFlight = 0;
		let maxConcurrent = 0;
		const refreshStarts: number[] = [];
		vi.spyOn(oauthUtils, "refreshOAuthToken").mockImplementation(async (_provider, credential) => {
			refreshStarts.push(Date.now());
			inFlight += 1;
			maxConcurrent = Math.max(maxConcurrent, inFlight);
			await Bun.sleep(refreshDelayMs);
			inFlight -= 1;
			return {
				...credential,
				access: `refreshed-${credential.accountId}`,
				expires: Date.now() + HOUR_MS,
			};
		});

		const expiredAt = Date.now() - HOUR_MS;
		await authStorage.set("openai-codex", [
			{ type: "oauth", ...createCredential("acct-first", "first@example.com"), expires: expiredAt },
			{ type: "oauth", ...createCredential("acct-second", "second@example.com"), expires: expiredAt },
			{ type: "oauth", ...createCredential("acct-third", "third@example.com"), expires: expiredAt },
		]);

		usageByAccount.set(
			"acct-first",
			createCodexUsageReport({
				accountId: "acct-first",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.4, resetInMs: 2 * 24 * 60 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-second",
			createCodexUsageReport({
				accountId: "acct-second",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.3, resetInMs: 90 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-third",
			createCodexUsageReport({
				accountId: "acct-third",
				primary: { usedFraction: 0.2, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 0.5, resetInMs: 45 * 60 * 1000 },
			}),
		);

		const startedAt = Date.now();
		const apiKey = await authStorage.getApiKey("openai-codex");
		const elapsedMs = Date.now() - startedAt;

		expect(apiKey).toBe("refreshed-acct-third");
		expect(refreshStarts).toHaveLength(3);
		expect(maxConcurrent).toBe(3);
		expect(elapsedMs).toBeLessThan(refreshDelayMs * 2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Claude (Anthropic) ranking tests
// ─────────────────────────────────────────────────────────────────────────────

function createClaudeLimit(args: {
	key: "5h" | "7d";
	durationMs: number;
	usedFraction: number;
	resetInMs: number;
}): UsageLimit {
	const clamped = Math.min(Math.max(args.usedFraction, 0), 1);
	const used = clamped * 100;
	const label = args.key === "5h" ? "Claude 5 Hour" : "Claude 7 Day";
	return {
		id: `anthropic:${args.key}`,
		label,
		scope: {
			provider: "anthropic",
			windowId: args.key,
			shared: true,
		},
		window: {
			id: args.key,
			label,
			durationMs: args.durationMs,
			resetsAt: Date.now() + args.resetInMs,
		},
		amount: {
			unit: "percent",
			used,
			limit: 100,
			remaining: 100 - used,
			usedFraction: clamped,
			remainingFraction: Math.max(0, 1 - clamped),
		},
		status: clamped >= 1 ? "exhausted" : clamped >= 0.9 ? "warning" : "ok",
	};
}

function createClaudeUsageReport(args: {
	accountId: string;
	primary: { usedFraction: number; resetInMs: number };
	secondary: { usedFraction: number; resetInMs: number };
}): UsageReport {
	return {
		provider: "anthropic",
		fetchedAt: Date.now(),
		limits: [
			createClaudeLimit({
				key: "5h",
				durationMs: FIVE_HOUR_MS,
				usedFraction: args.primary.usedFraction,
				resetInMs: args.primary.resetInMs,
			}),
			createClaudeLimit({
				key: "7d",
				durationMs: WEEK_MS,
				usedFraction: args.secondary.usedFraction,
				resetInMs: args.secondary.resetInMs,
			}),
		],
		metadata: { accountId: args.accountId },
	};
}

describe("AuthStorage claude oauth ranking", () => {
	let tempDir = "";
	let store: AuthCredentialStore | null = null;
	let authStorage: AuthStorage | null = null;
	const usageByAccount = new Map<string, UsageReport>();

	const usageProvider: UsageProvider = {
		id: "anthropic",
		async fetchUsage(params) {
			const accountId = params.credential.accountId;
			if (!accountId) return null;
			return usageByAccount.get(accountId) ?? null;
		},
	};

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-auth-claude-selection-"));
		store = await AuthCredentialStore.open(path.join(tempDir, "agent.db"));
		authStorage = new AuthStorage(store, {
			usageProviderResolver: provider => (provider === "anthropic" ? usageProvider : undefined),
		});
		usageByAccount.clear();
		vi.spyOn(oauthUtils, "getOAuthApiKey").mockImplementation(async (_provider, credentials) => {
			const credential = credentials.anthropic as OAuthCredentials | undefined;
			if (!credential?.accountId) return null;
			return {
				apiKey: `api-${credential.accountId}`,
				newCredentials: credential,
			};
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		store?.close();
		store = null;
		authStorage = null;
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	test("prefers lower secondary drain rate account", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-near", "near@example.com") },
			{ type: "oauth", ...createCredential("acct-far", "far@example.com") },
		]);

		usageByAccount.set(
			"acct-near",
			createClaudeUsageReport({
				accountId: "acct-near",
				primary: { usedFraction: 0.4, resetInMs: 2 * HOUR_MS },
				secondary: { usedFraction: 0.92, resetInMs: 15 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-far",
			createClaudeUsageReport({
				accountId: "acct-far",
				primary: { usedFraction: 0.3, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.55, resetInMs: 6 * 24 * HOUR_MS },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-drain");
		expect(apiKey).toBe("api-acct-near");
	});

	test("skips exhausted account and picks healthy", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-exhausted", "exhausted@example.com") },
			{ type: "oauth", ...createCredential("acct-healthy", "healthy@example.com") },
		]);

		usageByAccount.set(
			"acct-exhausted",
			createClaudeUsageReport({
				accountId: "acct-exhausted",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-healthy",
			createClaudeUsageReport({
				accountId: "acct-healthy",
				primary: { usedFraction: 0.5, resetInMs: 3 * HOUR_MS },
				secondary: { usedFraction: 0.4, resetInMs: 3 * 24 * HOUR_MS },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-exhausted");
		expect(apiKey).toBe("api-acct-healthy");
	});

	test("falls back to earliest-unblocking when all exhausted", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-soon", "soon@example.com") },
			{ type: "oauth", ...createCredential("acct-later", "later@example.com") },
		]);

		usageByAccount.set(
			"acct-soon",
			createClaudeUsageReport({
				accountId: "acct-soon",
				primary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 5 * 60 * 1000 },
			}),
		);
		usageByAccount.set(
			"acct-later",
			createClaudeUsageReport({
				accountId: "acct-later",
				primary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
				secondary: { usedFraction: 1, resetInMs: 30 * 60 * 1000 },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-all-exhausted");
		expect(apiKey).toBe("api-acct-soon");
	});

	test("sorts 3 accounts by secondary drain rate", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [
			{ type: "oauth", ...createCredential("acct-fast", "fast@example.com") },
			{ type: "oauth", ...createCredential("acct-medium", "medium@example.com") },
			{ type: "oauth", ...createCredential("acct-slow", "slow@example.com") },
		]);

		usageByAccount.set(
			"acct-slow",
			createClaudeUsageReport({
				accountId: "acct-slow",
				primary: { usedFraction: 0.2, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.1, resetInMs: 6 * 24 * HOUR_MS },
			}),
		);
		usageByAccount.set(
			"acct-medium",
			createClaudeUsageReport({
				accountId: "acct-medium",
				primary: { usedFraction: 0.2, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.3, resetInMs: 5 * 24 * HOUR_MS },
			}),
		);
		usageByAccount.set(
			"acct-fast",
			createClaudeUsageReport({
				accountId: "acct-fast",
				primary: { usedFraction: 0.2, resetInMs: 4 * HOUR_MS },
				secondary: { usedFraction: 0.7, resetInMs: 3 * 24 * HOUR_MS },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-three");
		expect(apiKey).toBe("api-acct-slow");
	});

	test("single credential works without ranking", async () => {
		if (!authStorage) throw new Error("test setup failed");

		await authStorage.set("anthropic", [{ type: "oauth", ...createCredential("acct-solo", "solo@example.com") }]);

		usageByAccount.set(
			"acct-solo",
			createClaudeUsageReport({
				accountId: "acct-solo",
				primary: { usedFraction: 0.3, resetInMs: 3 * HOUR_MS },
				secondary: { usedFraction: 0.2, resetInMs: 5 * 24 * HOUR_MS },
			}),
		);

		const apiKey = await authStorage.getApiKey("anthropic", "session-claude-single");
		expect(apiKey).toBe("api-acct-solo");
	});
});
