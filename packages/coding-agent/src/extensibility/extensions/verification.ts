import { hasVerificationEvidence } from "../../utils/evidence";
import type { ExtensionAPI, ExtensionContext } from "./types";

/**
 * Verification Extension
 *
 * Implements closed-loop verification for p247:
 * 1. Mutation Tracking: Detects file modifications via edit/write/ast_edit tools
 * 2. Verification Gate: Requires real test/build evidence after mutations
 * 3. Smart Intervention: Guides agent to proper verification when evidence missing
 *
 * This extends the reliability extension's verification concept with automatic
 * test execution and structured error guidance.
 */
export default function (pi: ExtensionAPI) {
	// Track which files have been mutated in this session
	const mutatedFiles = new Set<string>();
	let _verificationPending = false;
	// Tools that can mutate files
	const MUTATING_TOOLS = new Set(["edit", "write", "ast_edit"]);

	// Track tool calls for mutation detection
	pi.on("tool_execution_start", async event => {
		if (MUTATING_TOOLS.has(event.toolName)) {
			// Extract file paths from tool arguments
			const filePath = extractFilePath(event.toolName, event.args);
			if (filePath) {
				mutatedFiles.add(filePath);
				pi.logger.debug("Verification: Tracking mutation of %s", filePath);
			}
		}
	});

	// Anti-Loop & Verification Gate (Post-turn check)
	// Anti-Loop & Verification Gate (Post-turn check)

	pi.on("turn_end", async (event, _ctx: ExtensionContext) => {
		const { message } = event;

		if (message.role !== "assistant") return;

		const assistantText =
			message.content

				?.filter(c => c.type === "text")

				.map(c => (c as { text: string }).text)

				.join("") ?? "";
		message.content
			?.filter(c => c.type === "text")
			.map(c => (c as { text: string }).text)
			.join("") ?? "";

		// Skip if no files were mutated this turn
		if (mutatedFiles.size === 0) {
			_verificationPending = false;
			return;
		}

		// Check for real verification evidence in this turn
		const hasEvidence = hasVerificationEvidence(assistantText);

		// Check for explicit verification declarations
		const isVerified = /\bVERIFICADO\b/.test(assistantText);
		const isNoVerified = /\bNO_VERIFICADO\b/.test(assistantText);

		// Handle explicit declarations
		if (isVerified) {
			if (!hasEvidence) {
				pi.sendMessage(
					{
						customType: "system_intervention",
						content: [
							{
								type: "text",
								text: "[SISTEMA: Declaraste VERIFICADO pero no hay evidencia de verificacion. Ejecuta bun test o bun check y muestra el output REAL.]",
							},
						],
						display: "none",
					},
					{ triggerTurn: true },
				);
				return;
			}
		}

		// Honest NO_VERIFICADO — let it pass but reset tracking
		if (isNoVerified) {
			pi.logger.debug("Verification: NO_VERIFICADO declared. Resetting mutation tracking.");
			mutatedFiles.clear();
			_verificationPending = false;
			return;
		}

		// Completion claim after mutation — critical verification gate
		const hasCompletionClaim =
			/\b(done|completed|finished|fixed|solved|resolved)\b/i.test(assistantText) ||
			/\b(all\s+done|task\s+complete|is\s+(?:now\s+)?(?:fixed|working|complete))\b/i.test(assistantText) ||
			/\b(verificad[ao]s?|listo|terminado|resuelto)\b/i.test(assistantText);
		if (hasCompletionClaim) {
			if (!hasEvidence) {
				// No evidence - guide agent to verify
				pi.sendMessage(
					{
						customType: "system_intervention",
						content: [
							{
								type: "text",
								text: `[SISTEMA: Modificaste ${mutatedFiles.size} archivo(s) y declaraste completado sin verificacion real. Ejecuta uno de estos comandos y muestra el output: ${getVerificationSuggestion()}, o declara NO_VERIFICADO si no verificaste.]`,
							},
						],
						display: "none",
					},
					{ triggerTurn: true },
				);
				return;
			}
		}

		// Mutation happened but agent is still working — no intervention, just prepare for next turn
		pi.logger.debug("Verification: Mutations pending verification. Files: %o", Array.from(mutatedFiles));
		_verificationPending = true;
	});

	// Reset all state on new agent start
	pi.on("agent_start", () => {
		mutatedFiles.clear();
		_verificationPending = false;
	});

	// Helper: Extract file path from tool arguments
	function extractFilePath(toolName: string, args: unknown): string | undefined {
		if (!args || typeof args !== "object") return undefined;
		const typedArgs = args as Record<string, unknown>;
		switch (toolName) {
			case "edit":
			case "write":
				return typedArgs.path as string;
			case "ast_edit":
				return typedArgs.path as string;
			default:
				return undefined;
		}
	}

	// Helper: Suggest appropriate verification command based on project context
	function getVerificationSuggestion(): string {
		// Check for common test commands in package.json or project files
		// For now, return a general suggestion - could be enhanced to detect project type
		return "bun test || bun check || npm test || yarn test";
	}
}
