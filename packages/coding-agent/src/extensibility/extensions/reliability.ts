import { hasVerificationEvidence } from "../../utils/evidence";
import { detectToolLoop, stableStringify, type ToolCallEntry } from "../../utils/loop-detection";
import type { ExtensionAPI, ExtensionContext } from "./types";

/**
 * Reliability Extension
 *
 * Implements core safety protocols for p247:
 * 1. Verification Gate: Ensures evidence check after code mutations.
 * 2. Anti-Loop Protocol: Detects and breaks tool-call cycles.
 *
 * Note: Context compaction is handled by AgentSession's auto-compaction system,
 * which runs post-turn with proper retry, multi-model fallback, and pruning.
 * Running compaction in turn_start (as the old Context Guard did) blocked the
 * agent mid-turn and caused disruptive interruptions.
 */
const LOOP_HISTORY_MAX = 100;

export default function (pi: ExtensionAPI) {
	const loopHistory: ToolCallEntry[] = [];
	let _loopCount = 0;
	const _MAX_INTERVENTIONS = 4;
	let _hasUnverifiedMutations = false;
	const MUTATING_TOOLS = new Set(["edit", "write", "ast_edit"]);

	// Track tool calls for loop detection AND mutation tracking
	pi.on("tool_execution_start", async event => {
		const args = event.args ?? {};
		let key: string;
		if (typeof args === "string") {
			key = args;
		} else if (args && typeof args === "object") {
			key = stableStringify(args);
		} else {
			key = String(args);
		}
		loopHistory.push({ tool: event.toolName, key });
		// Cap history so long sessions can't grow it without bound; detectToolLoop
		// only inspects a small sliding window, so older entries are unused weight.
		if (loopHistory.length > LOOP_HISTORY_MAX) {
			loopHistory.splice(0, loopHistory.length - LOOP_HISTORY_MAX);
		}
		if (MUTATING_TOOLS.has(event.toolName)) {
			_hasUnverifiedMutations = true;
			pi.logger.debug("Verification Gate: Mutation detected via %s. Flagging as unverified.", event.toolName);
		}
	});

	// Anti-Loop & Verification Gate (Post-turn check)
	pi.on("turn_end", async (event, _ctx: ExtensionContext) => {
		const { message } = event;
		if (message.role !== "assistant") return;
		const assistantText =
			message.content
				?.filter(c => c.type === "text")
				.map(c => (c as { text: string }).text)
				.join("") ?? "";

		// --- Anti-Loop Logic ---
		const loopDetection = detectToolLoop(loopHistory);
		if (loopDetection.isLoop && _loopCount < _MAX_INTERVENTIONS) {
			_loopCount++;
			if (/\b(ESCALATING|ESCALANDO)\b/i.test(assistantText)) return;
			const strategies = [
				"[SYSTEM: You are repeating the same tool. Change your strategy IMMEDIATELY. Try a completely different approach.]",
				"[SYSTEM: You are still in a loop. This is your LAST chance for self-correction. If you cannot resolve it, say ESCALATING and explain the problem.]",
			];
			pi.sendMessage(
				{
					customType: "system_intervention",
					content: [{ type: "text", text: strategies[Math.min(_loopCount - 1, strategies.length - 1)] }],
					display: false,
				},
				{ triggerTurn: true },
			);
			return;
		}

		// --- Verification Gate Logic ---
		// Only activate after code mutations — skip pure read-only turns entirely
		if (!_hasUnverifiedMutations) return;
		// Check for real verification evidence in this turn (test output, diff, build)
		if (hasVerificationEvidence(assistantText)) {
			_hasUnverifiedMutations = false;
			pi.logger.debug("Verification Gate: Evidence detected. Clearing mutation flag.");
			return;
		}

		const isVerified = /\b(VERIFIED|VERIFICADO)\b/i.test(assistantText);
		const isNoVerified = /\b(NOT_VERIFIED|NO_VERIFICADO)\b/i.test(assistantText);

		// Explicit VERIFIED — but where's the evidence?
		if (isVerified) {
			pi.sendMessage(
				{
					customType: "system_intervention",
					content: [
						{
							type: "text",
							text: "[SYSTEM: You declared VERIFIED but there is no verification evidence (test/diff/build output). Run the corresponding command and show the REAL output.]",
						},
					],
					display: false,
				},
				{ triggerTurn: true },
			);
			return;
		}

		// Honest NOT_VERIFIED — let it pass but keep flag active
		if (isNoVerified) {
			pi.logger.debug("Verification Gate: NOT_VERIFIED declared. Flag remains active.");
			return;
		}

		// Completion claim after mutation — this is the critical catch
		const hasCompletionClaim =
			/\b(done|completed|finished|fixed|solved|resolved)\b/i.test(assistantText) ||
			/\b(all\s+done|task\s+complete|is\s+(?:now\s+)?(?:fixed|working|complete))\b/i.test(assistantText) ||
			/\b(verificad[ao]s?|listo|terminado|resuelto)\b/i.test(assistantText);
		if (hasCompletionClaim) {
			pi.sendMessage(
				{
					customType: "system_intervention",
					content: [
						{
							type: "text",
							text: "[SYSTEM: You modified files and declared completion without real verification. Run bun test / bun check / git diff and show the REAL output, or declare NOT_VERIFIED if you did not verify.]",
						},
					],
					display: false,
				},
				{ triggerTurn: true },
			);
			return;
		}

		// Mutation happened but agent is still working — no intervention, just log
		pi.logger.debug("Verification Gate: Unverified mutations pending. Agent still working, no intervention.");
	});

	// Reset all state on new agent start
	pi.on("agent_start", () => {
		loopHistory.length = 0;
		_loopCount = 0;
		_hasUnverifiedMutations = false;
	});
}
