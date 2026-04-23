/**
 * Context-manager runtime mode and activation guard.
 *
 * Enforces the single-active-context-manager invariant (ADR-0003):
 * exactly one context management strategy is active at runtime.
 * Only assembler mode is supported.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { Settings } from "../config/settings";
import type { ContextManagerMode } from "../config/settings-schema";

export type { ContextManagerMode } from "../config/settings-schema";

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

export class ContextManagerConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContextManagerConfigError";
	}
}

const SUPPORTED_MODES: readonly ContextManagerMode[] = ["legacy", "shadow", "assembler"];

/**
 * Validate context-manager configuration at startup.
 *
 * Accepts any mode declared in the settings schema: `legacy` (compaction-only,
 * assembler off), `shadow` (assembler observes without mutating), `assembler`
 * (assembler-managed). Rejects only genuinely invalid values that somehow made
 * it past the typed settings getter.
 *
 * @throws {ContextManagerConfigError} on invalid mode
 */
export function validateContextManagerConfig(settings: Settings): void {
	const mode = getContextManagerMode(settings);
	if (!SUPPORTED_MODES.includes(mode)) {
		throw new ContextManagerConfigError(
			`Context manager mode '${mode as string}' is not supported. Expected one of: ${SUPPORTED_MODES.join(", ")}.`,
		);
	}
	logger.debug("Context manager validated", { mode });
}

// ═══════════════════════════════════════════════════════════════════════════
// Accessors
// ═══════════════════════════════════════════════════════════════════════════

/** Read the current context-manager mode from settings. */
export function getContextManagerMode(settings: Settings): ContextManagerMode {
	return settings.get("contextManager.mode");
}

/** True when the assembler is driving context. */
export function isAssemblerActive(settings: Settings): boolean {
	return getContextManagerMode(settings) === "assembler";
}

// ═══════════════════════════════════════════════════════════════════════════
// Introspection
// ═══════════════════════════════════════════════════════════════════════════

export interface ContextManagerState {
	mode: ContextManagerMode;
	legacyActive: boolean;
	assemblerActive: boolean;
	shadowObserving: boolean;
}

/** Snapshot of current context-manager state for introspection / diagnostics. */
export function getContextManagerState(settings: Settings): ContextManagerState {
	const mode = getContextManagerMode(settings);
	return {
		mode,
		legacyActive: mode === "legacy",
		assemblerActive: mode === "assembler",
		shadowObserving: mode === "shadow",
	};
}
