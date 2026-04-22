export const SECURITY_CAPABILITIES = [
	"shell-exec",
	"project-process-spawn",
	"project-code-load",
	"user-code-load",
	"remote-instructions",
	"session-http-export",
	"plugin-install",
	"credential-ingest",
] as const;

export type SecurityCapability = (typeof SECURITY_CAPABILITIES)[number];

export const POLICY_DECISIONS = ["deny", "confirm", "allow"] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const POLICY_ENFORCEMENT_MODES = ["off", "enforce", "report-only"] as const;

export type PolicyEnforcementMode = (typeof POLICY_ENFORCEMENT_MODES)[number];

export const WORKSPACE_TRUST_MATCH_MODES = ["repo-root-hash", "workspace-path"] as const;

export type WorkspaceTrustMatchMode = (typeof WORKSPACE_TRUST_MATCH_MODES)[number];

export const BUILTIN_CAPABILITY_DEFAULTS: Record<SecurityCapability, PolicyDecision> = {
	"shell-exec": "deny",
	"project-process-spawn": "deny",
	"project-code-load": "deny",
	"user-code-load": "deny",
	"remote-instructions": "deny",
	"session-http-export": "deny",
	"plugin-install": "deny",
	"credential-ingest": "deny",
};

export interface ManagedPolicyWorkspaceTrust {
	/**
	 * Local trust grants are persisted outside mutable user settings and MAY only narrow
	 * or activate behavior that managed policy already permits. They MUST NOT override
	 * an explicit managed deny.
	 */
	allowLocalTrustGrants?: boolean;
	match?: WorkspaceTrustMatchMode;
}

export interface ManagedPolicyIntegrity {
	requirePluginSha?: boolean;
	requireSignedManagedPolicy?: boolean;
	disableUnsignedUserCodeLoad?: boolean;
}

export interface ManagedPolicyRemovals {
	implicitDesktopAuth?: boolean;
	cliApiKeyArg?: boolean;
	wildcardStatsCors?: boolean;
}

export interface ManagedPolicyDocument {
	version: 1;
	mode?: PolicyEnforcementMode;
	capabilities?: Partial<Record<SecurityCapability, PolicyDecision>>;
	workspaceTrust?: ManagedPolicyWorkspaceTrust;
	integrity?: ManagedPolicyIntegrity;
	removals?: ManagedPolicyRemovals;
}

export type ManagedPolicyFileSource = "system" | "override" | "explicit";

export type ManagedPolicyVerificationStatus =
	| "verified"
	| "not-required"
	| "signature-missing"
	| "signature-invalid"
	| "public-key-missing"
	| "public-key-invalid";

export interface ManagedPolicyVerification {
	readonly status: ManagedPolicyVerificationStatus;
	readonly signaturePath: string;
	readonly publicKeyPath: string;
	readonly message?: string;
}

export interface ManagedPolicy {
	readonly path: string;
	readonly source: ManagedPolicyFileSource;
	readonly document: ManagedPolicyDocument;
	readonly verification: ManagedPolicyVerification;
}

export type PolicySource = "default" | "managed" | "workspace-trust";

export type PolicyLoadStatus = "loaded" | "not-found" | "error";
export interface PolicyIssue {
	readonly code:
		| "invalid-document"
		| "invalid-field"
		| "invalid-value"
		| "parse-error"
		| "read-error"
		| "signature-missing"
		| "signature-invalid"
		| "public-key-missing"
		| "public-key-invalid";
	readonly message: string;
	readonly path?: string;
}

export interface ManagedPolicyLoadResult {
	readonly status: PolicyLoadStatus;
	readonly path: string | null;
	readonly policy: ManagedPolicy | null;
	readonly issues: readonly PolicyIssue[];
}

export interface EffectiveCapabilityDecision {
	readonly capability: SecurityCapability;
	readonly decision: PolicyDecision;
	readonly source: PolicySource;
	readonly enforcementMode: PolicyEnforcementMode;
	readonly defaultDecision: PolicyDecision;
	readonly managedDecision: PolicyDecision | null;
	readonly workspaceTrustDecision: PolicyDecision | null;
	readonly localTrustEnabled: boolean;
	readonly localTrustConsidered: boolean;
}

export interface WorkspaceTrustGrant {
	readonly capability: SecurityCapability;
	readonly decision: Extract<PolicyDecision, "allow" | "confirm">;
	readonly grantedAt: string;
	readonly note?: string;
}

export interface WorkspaceTrustRecord {
	readonly workspaceKey: string;
	readonly workspacePath: string;
	readonly repoRoot?: string;
	readonly match: WorkspaceTrustMatchMode;
	readonly grants: readonly WorkspaceTrustGrant[];
	readonly updatedAt: string;
}

export interface WorkspaceTrustStoreDocument {
	version: 1;
	records: WorkspaceTrustRecord[];
}

export interface WorkspaceTrustLoadResult {
	readonly status: PolicyLoadStatus;
	readonly path: string;
	readonly records: readonly WorkspaceTrustRecord[];
	readonly issues: readonly PolicyIssue[];
}
