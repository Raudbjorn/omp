import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir, isEnoent, logger } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import type {
	PolicyDecision,
	PolicyIssue,
	SecurityCapability,
	WorkspaceTrustGrant,
	WorkspaceTrustLoadResult,
	WorkspaceTrustMatchMode,
	WorkspaceTrustRecord,
	WorkspaceTrustStoreDocument,
} from "./types";
import { SECURITY_CAPABILITIES } from "./types";

const WORKSPACE_TRUST_FILE = "workspace-trust.yml";

export interface WorkspaceTrustIdentityInput {
	readonly workspacePath: string;
	readonly repoRoot?: string | null;
	readonly match?: WorkspaceTrustMatchMode;
}

export interface WorkspaceTrustStoreOptions {
	readonly agentDir?: string;
	readonly filePath?: string;
}

export interface WorkspaceTrustGrantInput {
	readonly capability: SecurityCapability;
	readonly decision?: Extract<PolicyDecision, "allow" | "confirm">;
	readonly note?: string;
}

export class WorkspaceTrustStore {
	readonly #filePath: string;

	constructor(options: WorkspaceTrustStoreOptions = {}) {
		this.#filePath = options.filePath ?? path.join(options.agentDir ?? getAgentDir(), WORKSPACE_TRUST_FILE);
	}

	get filePath(): string {
		return this.#filePath;
	}

	async load(): Promise<WorkspaceTrustLoadResult> {
		return loadWorkspaceTrustFile(this.#filePath);
	}

	async get(identity: WorkspaceTrustIdentityInput): Promise<WorkspaceTrustRecord | null> {
		const result = await this.load();
		if (result.status === "error") return null;
		const targetKey = createWorkspaceTrustKey(identity);
		return result.records.find(record => record.workspaceKey === targetKey) ?? null;
	}

	async grant(identity: WorkspaceTrustIdentityInput, grant: WorkspaceTrustGrantInput): Promise<WorkspaceTrustRecord> {
		const now = new Date().toISOString();
		const result = await this.load();
		assertWritableTrustState(result);
		const records = [...result.records];
		const workspaceKey = createWorkspaceTrustKey(identity);
		const match = identity.match ?? "repo-root-hash";
		const index = records.findIndex(record => record.workspaceKey === workspaceKey);
		const nextGrant: WorkspaceTrustGrant = {
			capability: grant.capability,
			decision: grant.decision ?? "allow",
			grantedAt: now,
			note: grant.note,
		};
		const current = index >= 0 ? records[index] : null;
		const grants = [
			...(current?.grants.filter(existing => existing.capability !== grant.capability) ?? []),
			nextGrant,
		];
		const record: WorkspaceTrustRecord = {
			workspaceKey,
			workspacePath: normalizeWorkspacePath(identity.workspacePath),
			repoRoot: identity.repoRoot ? normalizeWorkspacePath(identity.repoRoot) : undefined,
			match,
			grants,
			updatedAt: now,
		};
		if (index >= 0) records[index] = record;
		else records.push(record);
		await writeWorkspaceTrustFile(this.#filePath, { version: 1, records });
		return record;
	}

	async revoke(
		identity: WorkspaceTrustIdentityInput,
		capability: SecurityCapability,
	): Promise<WorkspaceTrustRecord | null> {
		const result = await this.load();
		assertWritableTrustState(result);
		const records = [...result.records];
		const workspaceKey = createWorkspaceTrustKey(identity);
		const index = records.findIndex(record => record.workspaceKey === workspaceKey);
		if (index < 0) return null;
		const current = records[index];
		const grants = current.grants.filter(grant => grant.capability !== capability);
		if (grants.length === 0) {
			records.splice(index, 1);
			await writeWorkspaceTrustFile(this.#filePath, { version: 1, records });
			return null;
		}
		const updated: WorkspaceTrustRecord = {
			...current,
			grants,
			updatedAt: new Date().toISOString(),
		};
		records[index] = updated;
		await writeWorkspaceTrustFile(this.#filePath, { version: 1, records });
		return updated;
	}
}

export function createWorkspaceTrustKey(identity: WorkspaceTrustIdentityInput): string {
	const match = identity.match ?? "repo-root-hash";
	if (match === "workspace-path") {
		return `workspace:${normalizeWorkspacePath(identity.workspacePath)}`;
	}
	const repoRoot = normalizeWorkspacePath(identity.repoRoot ?? identity.workspacePath);
	return `repo:${Bun.hash(repoRoot).toString(16)}`;
}

export async function loadWorkspaceTrustFile(filePath: string): Promise<WorkspaceTrustLoadResult> {
	try {
		const text = await Bun.file(filePath).text();
		const parsed = YAML.parse(text) as unknown;
		const validation = validateWorkspaceTrustDocument(parsed, filePath);
		if (validation.issues.length > 0 || validation.document === null) {
			return {
				status: "error",
				path: filePath,
				records: [],
				issues: validation.issues,
			};
		}
		return {
			status: "loaded",
			path: filePath,
			records: validation.document.records,
			issues: [],
		};
	} catch (error) {
		if (isEnoent(error)) {
			return {
				status: "not-found",
				path: filePath,
				records: [],
				issues: [],
			};
		}
		logger.warn("Failed to load workspace trust file", { path: filePath, error: String(error) });
		return {
			status: "error",
			path: filePath,
			records: [],
			issues: [
				{ code: "read-error", message: `Failed to load workspace trust file: ${String(error)}`, path: filePath },
			],
		};
	}
}

async function writeWorkspaceTrustFile(filePath: string, document: WorkspaceTrustStoreDocument): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await Bun.write(filePath, YAML.stringify(document));
}

function validateWorkspaceTrustDocument(
	value: unknown,
	filePath: string,
): {
	readonly document: WorkspaceTrustStoreDocument | null;
	readonly issues: readonly PolicyIssue[];
} {
	if (!isRecord(value)) {
		return {
			document: null,
			issues: [{ code: "invalid-document", message: "Workspace trust file must be a YAML object", path: filePath }],
		};
	}
	if (value.version !== 1) {
		return {
			document: null,
			issues: [{ code: "invalid-field", message: "Workspace trust file version must be 1", path: filePath }],
		};
	}
	if (!Array.isArray(value.records)) {
		return {
			document: null,
			issues: [{ code: "invalid-field", message: "Workspace trust file records must be an array", path: filePath }],
		};
	}
	const issues: PolicyIssue[] = [];
	const records: WorkspaceTrustRecord[] = [];
	for (const [index, entry] of value.records.entries()) {
		const parsed = parseWorkspaceTrustRecord(entry, filePath, index, issues);
		if (parsed) records.push(parsed);
	}
	if (issues.length > 0) return { document: null, issues };
	return { document: { version: 1, records }, issues: [] };
}

function parseWorkspaceTrustRecord(
	value: unknown,
	filePath: string,
	index: number,
	issues: PolicyIssue[],
): WorkspaceTrustRecord | null {
	if (!isRecord(value)) {
		issues.push({ code: "invalid-field", message: `records[${index}] must be an object`, path: filePath });
		return null;
	}
	if (typeof value.workspaceKey !== "string" || value.workspaceKey.length === 0) {
		issues.push({
			code: "invalid-field",
			message: `records[${index}].workspaceKey must be a non-empty string`,
			path: filePath,
		});
		return null;
	}
	if (typeof value.workspacePath !== "string" || value.workspacePath.length === 0) {
		issues.push({
			code: "invalid-field",
			message: `records[${index}].workspacePath must be a non-empty string`,
			path: filePath,
		});
		return null;
	}
	if (value.match !== "repo-root-hash" && value.match !== "workspace-path") {
		issues.push({
			code: "invalid-field",
			message: `records[${index}].match must be repo-root-hash or workspace-path`,
			path: filePath,
		});
		return null;
	}
	if (!Array.isArray(value.grants)) {
		issues.push({ code: "invalid-field", message: `records[${index}].grants must be an array`, path: filePath });
		return null;
	}
	const grants: WorkspaceTrustGrant[] = [];
	for (const [grantIndex, grantValue] of value.grants.entries()) {
		const grant = parseWorkspaceTrustGrant(grantValue, filePath, index, grantIndex, issues);
		if (grant) grants.push(grant);
	}
	if (typeof value.updatedAt !== "string" || value.updatedAt.length === 0) {
		issues.push({
			code: "invalid-field",
			message: `records[${index}].updatedAt must be a timestamp string`,
			path: filePath,
		});
		return null;
	}
	return {
		workspaceKey: value.workspaceKey,
		workspacePath: value.workspacePath,
		repoRoot: typeof value.repoRoot === "string" && value.repoRoot.length > 0 ? value.repoRoot : undefined,
		match: value.match,
		grants,
		updatedAt: value.updatedAt,
	};
}

function parseWorkspaceTrustGrant(
	value: unknown,
	filePath: string,
	recordIndex: number,
	grantIndex: number,
	issues: PolicyIssue[],
): WorkspaceTrustGrant | null {
	if (!isRecord(value)) {
		issues.push({
			code: "invalid-field",
			message: `records[${recordIndex}].grants[${grantIndex}] must be an object`,
			path: filePath,
		});
		return null;
	}
	if (!isSecurityCapability(value.capability)) {
		issues.push({
			code: "invalid-field",
			message: `records[${recordIndex}].grants[${grantIndex}].capability is invalid`,
			path: filePath,
		});
		return null;
	}
	if (value.decision !== "allow" && value.decision !== "confirm") {
		issues.push({
			code: "invalid-field",
			message: `records[${recordIndex}].grants[${grantIndex}].decision must be allow or confirm`,
			path: filePath,
		});
		return null;
	}
	if (typeof value.grantedAt !== "string" || value.grantedAt.length === 0) {
		issues.push({
			code: "invalid-field",
			message: `records[${recordIndex}].grants[${grantIndex}].grantedAt must be a timestamp string`,
			path: filePath,
		});
		return null;
	}
	return {
		capability: value.capability,
		decision: value.decision,
		grantedAt: value.grantedAt,
		note: typeof value.note === "string" && value.note.length > 0 ? value.note : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSecurityCapability(value: unknown): value is SecurityCapability {
	return typeof value === "string" && SECURITY_CAPABILITIES.includes(value as SecurityCapability);
}

function normalizeWorkspacePath(value: string): string {
	const normalized = path.normalize(path.resolve(value));
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertWritableTrustState(result: WorkspaceTrustLoadResult): void {
	if (result.status !== "error") return;
	const detail = result.issues.map(issue => issue.message).join("; ") || "workspace trust file could not be loaded";
	throw new Error(`Workspace trust store is not writable until it is fixed: ${detail}`);
}
