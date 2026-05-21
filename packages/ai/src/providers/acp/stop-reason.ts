import type * as schema from "@agentclientprotocol/sdk";
import type { StopReason as AcpStopReason } from "@agentclientprotocol/sdk";
import type { StopReason } from "../../types";

// Re-export for ergonomics.
export type { StopReason as AcpStopReason } from "@agentclientprotocol/sdk";
export type _SchemaPing = schema.SessionNotification | undefined;

/**
 * Translate an ACP `StopReason` into omp's internal `StopReason`.
 * All known variants are mapped; unknown future variants fall back to "stop".
 */
export function mapStopReason(reason: AcpStopReason): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "max_turn_requests":
			return "length";
		case "cancelled":
			return "aborted";
		case "refusal":
			return "error";
		default: {
			// Exhaustiveness marker — unknown variants become generic stop.
			const _exhaustive: never = reason as never;
			void _exhaustive;
			return "stop";
		}
	}
}
