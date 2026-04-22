import type * as schema from "@agentclientprotocol/sdk";
import { AcpError } from "./errors";

export type PermissionMode = "auto-allow" | "deny-destructive" | "delegate";

type PermissionPolicy = (req: schema.RequestPermissionRequest) => Promise<schema.RequestPermissionResponse>;

function findOption(
	options: readonly schema.PermissionOption[],
	kind: schema.PermissionOption["kind"],
): schema.PermissionOption | undefined {
	return options.find(o => o.kind === kind);
}

function pickOrFallback(options: readonly schema.PermissionOption[], preferred: schema.PermissionOption["kind"]) {
	const match = findOption(options, preferred);
	return match ?? options[0];
}

/**
 * Build an ACP permission policy handler.
 *
 * Modes:
 * - `auto-allow`: always choose `allow_once` (or the first option).
 *   Use for headless/CI runs. Opt-in only.
 * - `deny-destructive` (default): allow reads and `fs/write_text_file`,
 *   reject delete/execute/write-style tool calls. Matches our default UX
 *   posture of "don't let the subagent surprise-mutate state."
 * - `delegate`: phase 2 — will thread the request into omp's interactive
 *   approval UI. Throws for now so callers must opt in explicitly.
 */
export function makePermissionPolicy(mode: PermissionMode): PermissionPolicy {
	switch (mode) {
		case "auto-allow":
			return async req => {
				const choice = pickOrFallback(req.options, "allow_once");
				if (!choice) throw new AcpError("permission_denied", "No permission options offered by agent");
				return {
					outcome: { outcome: "selected", optionId: choice.optionId },
				} as schema.RequestPermissionResponse;
			};
		case "deny-destructive":
			return async req => {
				const toolKind = String(req.toolCall?.kind ?? "");
				const destructive = /delete|execute|write/i.test(toolKind);
				const writeOk = toolKind === "edit" || toolKind === "fs/write_text_file";
				const preferredKind: schema.PermissionOption["kind"] = !destructive || writeOk ? "allow_once" : "reject_once";
				const choice = pickOrFallback(req.options, preferredKind);
				if (!choice) throw new AcpError("permission_denied", "No permission options offered by agent");
				return {
					outcome: { outcome: "selected", optionId: choice.optionId },
				} as schema.RequestPermissionResponse;
			};
		case "delegate":
			return async () => {
				throw new AcpError("not_implemented", "delegate permission mode is phase 2");
			};
	}
}
