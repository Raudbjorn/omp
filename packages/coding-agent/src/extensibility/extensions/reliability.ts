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
			if (/ESCALANDO/i.test(assistantText)) return;
			const strategies = [
				"[SISTEMA: Estas repitiendo la misma herramienta. Cambia de estrategia IMMEDIATAMENTE. Prueba otro enfoque completamente diferente.]",
				"[SISTEMA: Sigue en loop. Es tu ULTIMA oportunidad de auto-correccion. Si no puedes resolverlo, di ESCALANDO y explica el problema.]",
			];
			pi.sendMessage(
				{
					customType: "system_intervention",
					content: [{ type: "text", text: strategies[Math.min(_loopCount - 1, strategies.length - 1)] }],
					display: "none",
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

		const isVerified = /\bVERIFICADO\b/.test(assistantText);
		const isNoVerified = /\bNO_VERIFICADO\b/.test(assistantText);

		// Explicit VERIFICADO — but where's the evidence?
		if (isVerified) {
			pi.sendMessage(
				{
					customType: "system_intervention",
					content: [
						{
							type: "text",
							text: "[SISTEMA: Declaraste VERIFICADO pero no hay evidencia de verificacion (output de test/diff/build). Ejecuta el comando correspondiente y muestra el output REAL.]",
						},
					],
					display: "none",
				},
				{ triggerTurn: true },
			);
			return;
		}

		// Honest NO_VERIFICADO — let it pass but keep flag active
		if (isNoVerified) {
			pi.logger.debug("Verification Gate: NO_VERIFICADO declared. Flag remains active.");
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
							text: "[SISTEMA: Modificaste archivos y declaraste completado sin verificacion real. Ejecuta bun test / bun check / git diff y muestra el output REAL, o declara NO_VERIFICADO si no verificaste.]",
						},
					],
					display: "none",
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
