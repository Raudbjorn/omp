import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	getContextManagerMode,
	getContextManagerState,
	isAssemblerActive,
	validateContextManagerConfig,
} from "@oh-my-pi/pi-coding-agent/context-manager";

describe("context-manager", () => {
	// ─────────────────────────────────────────────────────────────────────────
	// Mode defaults
	// ─────────────────────────────────────────────────────────────────────────

	describe("defaults", () => {
		it("defaults to assembler mode", () => {
			const settings = Settings.isolated();
			expect(getContextManagerMode(settings)).toBe("assembler");
		});

		it("validates without error on default config", () => {
			const settings = Settings.isolated();
			expect(() => validateContextManagerConfig(settings)).not.toThrow();
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// Validation accepts all schema-declared modes
	//
	// The schema declares three modes (legacy/shadow/assembler) and sdk.ts's
	// transformContext branches on all three. The validator must accept them
	// all — rejecting legacy/shadow here would prevent users from selecting
	// modes the rest of the system explicitly supports.
	// ─────────────────────────────────────────────────────────────────────────

	describe("mode validation", () => {
		it("accepts assembler mode", () => {
			const settings = Settings.isolated({ "contextManager.mode": "assembler" });
			expect(() => validateContextManagerConfig(settings)).not.toThrow();
		});

		it("accepts legacy mode", () => {
			const settings = Settings.isolated({ "contextManager.mode": "legacy" });
			expect(() => validateContextManagerConfig(settings)).not.toThrow();
		});

		it("accepts shadow mode", () => {
			const settings = Settings.isolated({ "contextManager.mode": "shadow" });
			expect(() => validateContextManagerConfig(settings)).not.toThrow();
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// Accessor helpers
	// ─────────────────────────────────────────────────────────────────────────

	describe("accessors", () => {
		it("isAssemblerActive returns true for assembler mode", () => {
			const settings = Settings.isolated({ "contextManager.mode": "assembler" });
			expect(isAssemblerActive(settings)).toBe(true);
		});

		it("isAssemblerActive returns false for non-assembler mode", () => {
			const settings = Settings.isolated({ "contextManager.mode": "legacy" });
			expect(isAssemblerActive(settings)).toBe(false);
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// Introspection state
	// ─────────────────────────────────────────────────────────────────────────

	describe("introspection state", () => {
		it("returns correct state for assembler mode", () => {
			const state = getContextManagerState(Settings.isolated({ "contextManager.mode": "assembler" }));
			expect(state).toEqual({
				mode: "assembler",
				legacyActive: false,
				assemblerActive: true,
				shadowObserving: false,
			});
		});

		it("returns correct state for legacy mode", () => {
			const state = getContextManagerState(Settings.isolated({ "contextManager.mode": "legacy" }));
			expect(state).toEqual({
				mode: "legacy",
				legacyActive: true,
				assemblerActive: false,
				shadowObserving: false,
			});
		});

		it("returns correct state for shadow mode", () => {
			const state = getContextManagerState(Settings.isolated({ "contextManager.mode": "shadow" }));
			expect(state).toEqual({
				mode: "shadow",
				legacyActive: false,
				assemblerActive: false,
				shadowObserving: true,
			});
		});
	});
});
