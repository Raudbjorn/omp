import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";

export function resolveUsageReportMetadataValue(report: UsageReport, key: string): string | undefined {
	const value = report.metadata?.[key];
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

export function resolveUsageReportScopeAccountId(report: UsageReport): string | undefined {
	const accountIds = new Set(
		report.limits
			.map(limit => limit.scope.accountId?.trim())
			.filter((accountId): accountId is string => Boolean(accountId)),
	);
	if (accountIds.size !== 1) return undefined;
	return [...accountIds][0];
}

export function resolveUsageAccountKey(
	provider: UsageReport["provider"],
	report: UsageReport,
	limit?: UsageLimit,
): string | undefined {
	const email = resolveUsageReportMetadataValue(report, "email");
	if (email) return `${provider}:email:${email.toLowerCase()}`;

	const accountId =
		resolveUsageReportMetadataValue(report, "accountId") ??
		limit?.scope.accountId?.trim() ??
		resolveUsageReportScopeAccountId(report);
	if (accountId) return `${provider}:account:${accountId}`;

	return undefined;
}

export function buildUsageAccountOrder(provider: UsageReport["provider"], reports: UsageReport[]): Map<string, number> {
	const order = new Map<string, number>();
	for (const report of reports) {
		const accountKey = resolveUsageAccountKey(provider, report);
		if (!accountKey || order.has(accountKey)) continue;
		order.set(accountKey, order.size);
	}
	return order;
}
