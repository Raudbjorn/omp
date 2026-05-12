import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import type { SourceMeta } from "../capability/types";
import * as git from "../utils/git";
import { loadManagedPolicy, resolveCapabilityDecision } from "./policy";
import type {
	EffectiveCapabilityDecision,
	ManagedPolicy,
	SecurityCapability,
	WorkspaceTrustMatchMode,
	WorkspaceTrustRecord,
} from "./types";
import { WorkspaceTrustStore } from "./workspace-trust";

export interface SecurityApprovalUi {
	readonly select: (title: string, options: string[]) => Promise<string | undefined>;
	readonly confirm: (title: string, message: string) => Promise<boolean>;
}

export type CapabilityTrustBehavior = "none" | "trust-only" | "allow-once-or-trust";

export interface WorkspaceSecurityContext {
	readonly cwd: string;
	readonly repoRoot: string | null;
	readonly policy: ManagedPolicy | null;
	readonly workspaceTrust: WorkspaceTrustRecord | null;
}

export interface WorkspaceCapabilityRequest {
	readonly cwd: string;
	readonly capability: SecurityCapability;
	readonly action: string;
	readonly ui?: SecurityApprovalUi;
	readonly trustBehavior?: CapabilityTrustBehavior;
}

export interface CodeLoadCapabilityRequest {
	readonly cwd: string;
	readonly targetPath: string;
	readonly action: string;
	readonly sourceLevel?: SourceMeta["level"];
	readonly ui?: SecurityApprovalUi;
	readonly trustBehavior?: CapabilityTrustBehavior;
}

export async function loadWorkspaceSecurityContext(cwd: string): Promise<WorkspaceSecurityContext> {
	const repoRoot = await git.repo.root(cwd);
	const policyResult = await loadManagedPolicy();
	const policy = policyResult.status === "loaded" ? policyResult.policy : null;
	const trustStore = new WorkspaceTrustStore();
	const workspaceTrust = await trustStore.get({
		workspacePath: cwd,
		repoRoot: repoRoot ?? undefined,
		match: policy?.document.workspaceTrust?.match ?? "repo-root-hash",
	});
	return {
		cwd,
		repoRoot,
		policy,
		workspaceTrust,
	};
}

export async function resolveWorkspaceCapabilityDecision(request: {
	readonly cwd: string;
	readonly capability: SecurityCapability;
}): Promise<EffectiveCapabilityDecision> {
	const context = await loadWorkspaceSecurityContext(request.cwd);
	return resolveCapabilityDecision({
		capability: request.capability,
		policy: context.policy,
		workspaceTrust: context.workspaceTrust,
	});
}

export async function requestWorkspaceCapabilityAccess(
	request: WorkspaceCapabilityRequest,
): Promise<EffectiveCapabilityDecision> {
	const context = await loadWorkspaceSecurityContext(request.cwd);
	const decision = resolveCapabilityDecision({
		capability: request.capability,
		policy: context.policy,
		workspaceTrust: context.workspaceTrust,
	});
	if (decision.enforcementMode !== "enforce") return asRuntimeAllowedDecision(decision);
	if (decision.decision === "allow") return decision;

	if (decision.decision === "confirm") {
		const approved = await requestConfirmation(request, decision);
		if (!approved) {
			throw new Error(formatCapabilityBlockMessage(request.action, decision));
		}
		return asRuntimeAllowedDecision(decision);
	}

	const trustBehavior = request.trustBehavior ?? "none";
	if (trustBehavior !== "none" && canRequestWorkspaceTrust(decision)) {
		const trustChoice = await requestWorkspaceTrust(request, context, trustBehavior);
		if (trustChoice === "allow-once") return asRuntimeAllowedDecision(decision);
		if (trustChoice === "trust-workspace") {
			const trustStore = new WorkspaceTrustStore();
			const workspaceTrust = await trustStore.grant(buildWorkspaceTrustIdentity(context), {
				capability: request.capability,
				decision: "allow",
				note: `Granted while ${request.action}`,
			});
			return resolveCapabilityDecision({
				capability: request.capability,
				policy: context.policy,
				workspaceTrust,
			});
		}
	}

	throw new Error(formatCapabilityBlockMessage(request.action, decision));
}

export async function assertWorkspaceCapabilityAllowed(
	request: WorkspaceCapabilityRequest,
): Promise<EffectiveCapabilityDecision> {
	const decision = await resolveWorkspaceCapabilityDecision(request);
	if (decision.enforcementMode !== "enforce") {
		return asRuntimeAllowedDecision(decision);
	}
	if (decision.decision !== "allow") {
		throw new Error(formatCapabilityBlockMessage(request.action, decision));
	}
	return decision;
}

export async function requestCodeLoadAccess(request: CodeLoadCapabilityRequest): Promise<EffectiveCapabilityDecision> {
	const capability = classifyCodeLoadCapability(request);
	return requestWorkspaceCapabilityAccess({
		cwd: request.cwd,
		capability,
		action: request.action,
		ui: request.ui,
		trustBehavior: request.trustBehavior ?? "allow-once-or-trust",
	});
}

export async function assertCodeLoadAllowed(request: CodeLoadCapabilityRequest): Promise<EffectiveCapabilityDecision> {
	const capability = classifyCodeLoadCapability(request);
	return assertWorkspaceCapabilityAllowed({
		cwd: request.cwd,
		capability,
		action: request.action,
	});
}

export function classifyCodeLoadCapability(request: {
	readonly cwd: string;
	readonly targetPath: string;
	readonly repoRoot?: string | null;
	readonly sourceLevel?: SourceMeta["level"];
}): SecurityCapability {
	if (request.sourceLevel === "project") {
		return "project-code-load";
	}
	if (request.sourceLevel === "user") {
		return "user-code-load";
	}
	const workspaceRoot = request.repoRoot ?? request.cwd;
	return pathIsWithin(request.targetPath, workspaceRoot) ? "project-code-load" : "user-code-load";
}

export function formatCapabilityBlockMessage(action: string, decision: EffectiveCapabilityDecision): string {
	if (decision.decision === "confirm") {
		return `${action} requires explicit approval for capability \`${decision.capability}\`.`;
	}
	if (decision.source === "default" && decision.localTrustEnabled) {
		return `${action} is blocked until this workspace is trusted for capability \`${decision.capability}\`.`;
	}
	return `${action} is blocked by security policy for capability \`${decision.capability}\` (source: ${decision.source}).`;
}

async function requestConfirmation(
	request: WorkspaceCapabilityRequest,
	decision: EffectiveCapabilityDecision,
): Promise<boolean> {
	if (request.ui) {
		return request.ui.confirm(
			"Security approval required",
			`${request.action}\n\nCapability: ${decision.capability}\nDecision source: ${decision.source}`,
		);
	}
	const choice = await selectOption(
		request.ui,
		[
			"Security approval required",
			request.action,
			"",
			`Capability: ${decision.capability}`,
			`Decision source: ${decision.source}`,
		].join("\n"),
		["Allow once", "Cancel"],
	);
	return choice === "Allow once";
}

async function requestWorkspaceTrust(
	request: WorkspaceCapabilityRequest,
	context: WorkspaceSecurityContext,
	trustBehavior: CapabilityTrustBehavior,
): Promise<"allow-once" | "trust-workspace" | null> {
	const options =
		trustBehavior === "allow-once-or-trust"
			? ["Allow once", "Trust workspace", "Cancel"]
			: ["Trust workspace", "Cancel"];
	const choice = await selectOption(
		request.ui,
		[
			"Workspace trust required",
			request.action,
			"",
			`Capability: ${request.capability}`,
			`Workspace: ${context.repoRoot ?? context.cwd}`,
		].join("\n"),
		options,
	);
	if (choice === "Allow once") return "allow-once";
	if (choice === "Trust workspace") return "trust-workspace";
	return null;
}

function buildWorkspaceTrustIdentity(context: WorkspaceSecurityContext): {
	readonly workspacePath: string;
	readonly repoRoot?: string | null;
	readonly match?: WorkspaceTrustMatchMode;
} {
	return {
		workspacePath: context.cwd,
		repoRoot: context.repoRoot,
		match: context.policy?.document.workspaceTrust?.match,
	};
}

function canRequestWorkspaceTrust(decision: EffectiveCapabilityDecision): boolean {
	return decision.source === "default" && decision.localTrustEnabled;
}

async function selectOption(
	ui: SecurityApprovalUi | undefined,
	title: string,
	options: string[],
): Promise<string | undefined> {
	if (ui) return ui.select(title, options);
	if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(
			`${title}\n\n${options.map((option, index) => `${index + 1}. ${option}`).join("\n")}\n\nSelect an option: `,
		);
		const trimmed = answer.trim();
		const index = Number.parseInt(trimmed, 10);
		if (Number.isInteger(index) && index >= 1 && index <= options.length) {
			return options[index - 1];
		}
		return options.find(option => option.toLowerCase() === trimmed.toLowerCase());
	} finally {
		rl.close();
	}
}

function pathIsWithin(targetPath: string, rootPath: string): boolean {
	const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function asRuntimeAllowedDecision(decision: EffectiveCapabilityDecision): EffectiveCapabilityDecision {
	return {
		...decision,
		decision: "allow",
	};
}
