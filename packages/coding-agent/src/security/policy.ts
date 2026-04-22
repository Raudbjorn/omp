import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { getManagedPolicyPathCandidates } from "./policy-paths";
import { verifyManagedPolicySignature } from "./policy-signature";
import {
	BUILTIN_CAPABILITY_DEFAULTS,
	type EffectiveCapabilityDecision,
	type ManagedPolicy,
	type ManagedPolicyDocument,
	type ManagedPolicyFileSource,
	type ManagedPolicyLoadResult,
	POLICY_DECISIONS,
	POLICY_ENFORCEMENT_MODES,
	type PolicyDecision,
	type PolicyEnforcementMode,
	type PolicyIssue,
	SECURITY_CAPABILITIES,
	type SecurityCapability,
	WORKSPACE_TRUST_MATCH_MODES,
	type WorkspaceTrustRecord,
} from "./types";

const POLICY_DECISION_RANK: Record<PolicyDecision, number> = {
	deny: 0,
	confirm: 1,
	allow: 2,
};

export async function loadManagedPolicy(): Promise<ManagedPolicyLoadResult> {
	const candidates = getManagedPolicyPathCandidates();
	let fallbackPath: string | null = null;
	for (const candidate of candidates) {
		fallbackPath = candidate.path;
		const result = await loadManagedPolicyFile(candidate.path, candidate.source);
		if (result.status !== "not-found") return result;
	}
	return {
		status: "not-found",
		path: fallbackPath,
		policy: null,
		issues: [],
	};
}

export function resolvePolicyEnforcementMode(policy?: ManagedPolicy | null): PolicyEnforcementMode {
	return policy?.document.mode ?? "off";
}

export async function loadManagedPolicyFile(
	filePath: string,
	source: ManagedPolicyFileSource = "explicit",
): Promise<ManagedPolicyLoadResult> {
	try {
		const text = await Bun.file(filePath).text();
		const signatureResult = await verifyManagedPolicySignature({ filePath, source, text });
		if (signatureResult.issues.length > 0) {
			return {
				status: "error",
				path: filePath,
				policy: null,
				issues: signatureResult.issues,
			};
		}
		const parsed = YAML.parse(text) as unknown;
		const validation = validateManagedPolicyDocument(parsed, filePath);
		if (validation.issues.length > 0 || validation.document === null) {
			return {
				status: "error",
				path: filePath,
				policy: null,
				issues: validation.issues,
			};
		}
		if (
			validation.document.integrity?.requireSignedManagedPolicy === true &&
			signatureResult.verification.status !== "verified"
		) {
			return {
				status: "error",
				path: filePath,
				policy: null,
				issues: [
					createPolicyIssue(
						signatureResult.verification.status === "public-key-missing" ||
							signatureResult.verification.status === "public-key-invalid"
							? signatureResult.verification.status
							: "signature-missing",
						signatureResult.verification.message ??
							"Managed policy requires a verified detached signature before it can be loaded",
						filePath,
					),
				],
			};
		}
		return {
			status: "loaded",
			path: filePath,
			policy: {
				path: filePath,
				source,
				document: validation.document,
				verification: signatureResult.verification,
			},
			issues: [],
		};
	} catch (error) {
		if (isEnoent(error)) {
			return {
				status: "not-found",
				path: filePath,
				policy: null,
				issues: [],
			};
		}
		const issue = createPolicyIssue("parse-error", `Failed to load managed policy: ${String(error)}`, filePath);
		logger.warn("Failed to load managed policy", { path: filePath, error: String(error) });
		return {
			status: "error",
			path: filePath,
			policy: null,
			issues: [issue],
		};
	}
}

export function resolveCapabilityDecision(options: {
	readonly capability: SecurityCapability;
	readonly policy?: ManagedPolicy | null;
	readonly workspaceTrust?: WorkspaceTrustRecord | null;
}): EffectiveCapabilityDecision {
	const defaultDecision = BUILTIN_CAPABILITY_DEFAULTS[options.capability];
	const enforcementMode = resolvePolicyEnforcementMode(options.policy);
	const managedDecision = options.policy?.document.capabilities?.[options.capability] ?? null;
	const localTrustEnabled = options.policy?.document.workspaceTrust?.allowLocalTrustGrants !== false;
	const workspaceTrustDecision = localTrustEnabled
		? findWorkspaceTrustDecision(options.workspaceTrust, options.capability)
		: null;

	if (managedDecision === "deny") {
		return {
			capability: options.capability,
			decision: "deny",
			source: "managed",
			enforcementMode,
			defaultDecision,
			managedDecision,
			workspaceTrustDecision,
			localTrustEnabled,
			localTrustConsidered: workspaceTrustDecision !== null,
		};
	}

	if (workspaceTrustDecision !== null) {
		const decision = managedDecision
			? clampDecision(workspaceTrustDecision, managedDecision)
			: workspaceTrustDecision;
		return {
			capability: options.capability,
			decision,
			source: "workspace-trust",
			enforcementMode,
			defaultDecision,
			managedDecision,
			workspaceTrustDecision,
			localTrustEnabled,
			localTrustConsidered: true,
		};
	}

	if (managedDecision !== null) {
		return {
			capability: options.capability,
			decision: managedDecision,
			source: "managed",
			enforcementMode,
			defaultDecision,
			managedDecision,
			workspaceTrustDecision: null,
			localTrustEnabled,
			localTrustConsidered: false,
		};
	}

	return {
		capability: options.capability,
		decision: defaultDecision,
		source: "default",
		enforcementMode,
		defaultDecision,
		managedDecision: null,
		workspaceTrustDecision: null,
		localTrustEnabled,
		localTrustConsidered: false,
	};
}

function clampDecision(requested: PolicyDecision, upperBound: PolicyDecision): PolicyDecision {
	return POLICY_DECISION_RANK[requested] <= POLICY_DECISION_RANK[upperBound] ? requested : upperBound;
}

function findWorkspaceTrustDecision(
	record: WorkspaceTrustRecord | null | undefined,
	capability: SecurityCapability,
): PolicyDecision | null {
	return record?.grants.find(grant => grant.capability === capability)?.decision ?? null;
}

function validateManagedPolicyDocument(
	value: unknown,
	filePath: string,
): {
	readonly document: ManagedPolicyDocument | null;
	readonly issues: readonly PolicyIssue[];
} {
	if (!isRecord(value)) {
		return {
			document: null,
			issues: [createPolicyIssue("invalid-document", "Managed policy must be a YAML object", filePath)],
		};
	}

	const issues: PolicyIssue[] = [];
	const version = value.version;
	if (version !== 1) {
		issues.push(createPolicyIssue("invalid-field", "Managed policy version must be 1", filePath));
	}

	const mode = coerceStringEnum(value.mode, POLICY_ENFORCEMENT_MODES, "mode", filePath, issues);
	const capabilities = validateCapabilityMap(value.capabilities, filePath, issues);
	const workspaceTrust = validateWorkspaceTrust(value.workspaceTrust, filePath, issues);
	const integrity = validateBooleanRecord(value.integrity, filePath, issues, [
		"requirePluginSha",
		"requireSignedManagedPolicy",
		"disableUnsignedUserCodeLoad",
	]);
	const removals = validateBooleanRecord(value.removals, filePath, issues, [
		"implicitDesktopAuth",
		"cliApiKeyArg",
		"wildcardStatsCors",
	]);

	if (issues.length > 0) {
		return { document: null, issues };
	}

	return {
		document: {
			version: 1,
			mode: mode ?? "off",
			capabilities,
			workspaceTrust,
			integrity,
			removals,
		},
		issues,
	};
}

function validateCapabilityMap(
	value: unknown,
	filePath: string,
	issues: PolicyIssue[],
): Partial<Record<SecurityCapability, PolicyDecision>> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		issues.push(createPolicyIssue("invalid-field", "capabilities must be an object", filePath));
		return undefined;
	}
	const result: Partial<Record<SecurityCapability, PolicyDecision>> = {};
	for (const [key, decision] of Object.entries(value)) {
		if (!isSecurityCapability(key)) {
			issues.push(createPolicyIssue("invalid-field", `Unknown capability "${key}"`, filePath));
			continue;
		}
		const parsedDecision = coerceStringEnum(decision, POLICY_DECISIONS, `capabilities.${key}`, filePath, issues);
		if (parsedDecision) result[key] = parsedDecision;
	}
	return result;
}

function validateWorkspaceTrust(
	value: unknown,
	filePath: string,
	issues: PolicyIssue[],
): ManagedPolicyDocument["workspaceTrust"] | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		issues.push(createPolicyIssue("invalid-field", "workspaceTrust must be an object", filePath));
		return undefined;
	}
	const allowLocalTrustGrants = coerceOptionalBoolean(
		value.allowLocalTrustGrants,
		"workspaceTrust.allowLocalTrustGrants",
		filePath,
		issues,
	);
	const match = coerceStringEnum(value.match, WORKSPACE_TRUST_MATCH_MODES, "workspaceTrust.match", filePath, issues);
	return {
		allowLocalTrustGrants,
		match,
	};
}

function validateBooleanRecord<T extends string>(
	value: unknown,
	filePath: string,
	issues: PolicyIssue[],
	keys: readonly T[],
): Partial<Record<T, boolean>> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		issues.push(createPolicyIssue("invalid-field", "Expected an object", filePath));
		return undefined;
	}
	const result: Partial<Record<T, boolean>> = {};
	for (const key of keys) {
		const parsed = coerceOptionalBoolean(value[key], `${key}`, filePath, issues);
		if (parsed !== undefined) result[key] = parsed;
	}
	for (const key of Object.keys(value)) {
		if (!keys.includes(key as T)) {
			issues.push(createPolicyIssue("invalid-field", `Unknown field "${key}"`, filePath));
		}
	}
	return result;
}

function coerceStringEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	field: string,
	filePath: string,
	issues: PolicyIssue[],
): T | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		issues.push(createPolicyIssue("invalid-value", `${field} must be one of: ${allowed.join(", ")}`, filePath));
		return undefined;
	}
	return value as T;
}

function coerceOptionalBoolean(
	value: unknown,
	field: string,
	filePath: string,
	issues: PolicyIssue[],
): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		issues.push(createPolicyIssue("invalid-value", `${field} must be a boolean`, filePath));
		return undefined;
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSecurityCapability(value: string): value is SecurityCapability {
	return SECURITY_CAPABILITIES.includes(value as SecurityCapability);
}

function createPolicyIssue(code: PolicyIssue["code"], message: string, filePath: string): PolicyIssue {
	return {
		code,
		message,
		path: filePath,
	};
}
