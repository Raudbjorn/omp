import type { TUI } from "@oh-my-pi/pi-tui";
import { ProcessTerminal } from "@oh-my-pi/pi-tui";
import {
	getSymbolOverrides,
	getSymbolPresetOverride,
	type SymbolKey,
	type SymbolPreset,
	setSymbolOverrides,
	setSymbolPreset,
} from "../modes/theme/theme";
import type { ClientCapabilities } from "./protocol";

export type WebTerminalOutputListener = (data: string) => void;

export interface WebTerminalBridge {
	onOutput(listener: WebTerminalOutputListener): () => void;
	injectInput(data: string): void;
	setSize(cols: number, rows: number): void;
	clearSize(): void;
	requestFullRender(options?: { clear?: boolean }): void;
	getSize(): { cols: number; rows: number };
	setClientCapabilities(capabilities: ClientCapabilities | null): void;
}

export class MirroredTerminal extends ProcessTerminal {
	#outputListeners = new Set<WebTerminalOutputListener>();
	#inputHandler?: (data: string) => void;
	#overrideSize: { cols: number; rows: number } | null = null;

	onOutput(listener: WebTerminalOutputListener): () => void {
		this.#outputListeners.add(listener);
		return () => {
			this.#outputListeners.delete(listener);
		};
	}

	injectInput(data: string): void {
		this.#inputHandler?.(data);
	}

	setSize(cols: number, rows: number): void {
		this.#overrideSize = { cols, rows };
	}

	clearSize(): void {
		this.#overrideSize = null;
	}

	override start(onInput: (data: string) => void, onResize: () => void): void {
		this.#inputHandler = onInput;
		super.start(onInput, onResize);
	}

	override write(data: string): void {
		super.write(data);
		for (const listener of this.#outputListeners) {
			listener(data);
		}
	}

	override get columns(): number {
		return this.#overrideSize?.cols ?? super.columns;
	}

	override get rows(): number {
		return this.#overrideSize?.rows ?? super.rows;
	}
}

let activeBridge: WebTerminalBridge | null = null;

export function createWebTerminalBridge(ui: TUI, terminal: MirroredTerminal): WebTerminalBridge {
	let activePresetOverride: SymbolPreset | null = null;
	let previousPresetOverride: SymbolPreset | null = null;
	let activeTokenOverride = false;
	let previousSymbolOverrides: Partial<Record<SymbolKey, string>> | undefined;
	let lastCapabilitiesKey: string | null = null;

	const applyPresetOverride = (preset: SymbolPreset | null): void => {
		if (preset === activePresetOverride) return;
		if (preset) {
			if (!activePresetOverride) {
				previousPresetOverride = getSymbolPresetOverride() ?? "unicode";
			}
			activePresetOverride = preset;
			void setSymbolPreset(preset).then(() => {
				ui.requestFullRender(true);
			});
			return;
		}
		if (activePresetOverride) {
			const restorePreset = previousPresetOverride ?? getSymbolPresetOverride() ?? "unicode";
			activePresetOverride = null;
			previousPresetOverride = null;
			void setSymbolPreset(restorePreset).then(() => {
				ui.requestFullRender(true);
			});
		}
	};

	const applyClientCapabilities = (capabilities: ClientCapabilities | null): void => {
		const key = capabilities ? JSON.stringify(capabilities) : null;
		if (key === lastCapabilitiesKey) return;
		lastCapabilitiesKey = key;
		if (!capabilities) {
			applyPresetOverride(null);
			if (activeTokenOverride) {
				activeTokenOverride = false;
				void setSymbolOverrides(previousSymbolOverrides ?? null).then(() => {
					ui.requestFullRender(true);
				});
				previousSymbolOverrides = undefined;
			}
			return;
		}
		if (capabilities.fontMatch !== "unknown" && !capabilities.supportsNerdSymbols) {
			if (!activePresetOverride) {
				const currentPreset = getSymbolPresetOverride() ?? "unicode";
				if (currentPreset === "nerd") {
					applyPresetOverride("unicode");
				}
			}
		} else if (capabilities.fontMatch !== "unknown") {
			applyPresetOverride(null);
		}
		if (!capabilities.supportsTokenEmoji) {
			if (!activeTokenOverride) {
				previousSymbolOverrides = getSymbolOverrides();
				const nextOverrides: Partial<Record<SymbolKey, string>> = {
					...(previousSymbolOverrides ?? {}),
					"icon.tokens": "¤",
				};
				activeTokenOverride = true;
				void setSymbolOverrides(nextOverrides).then(() => {
					ui.requestFullRender(true);
				});
			}
		} else if (activeTokenOverride) {
			activeTokenOverride = false;
			void setSymbolOverrides(previousSymbolOverrides ?? null).then(() => {
				ui.requestFullRender(true);
			});
			previousSymbolOverrides = undefined;
		}
	};

	return {
		onOutput: listener => terminal.onOutput(listener),
		injectInput: data => terminal.injectInput(data),
		setSize: (cols, rows) => terminal.setSize(cols, rows),
		clearSize: () => terminal.clearSize(),
		requestFullRender: options => ui.requestFullRender(options?.clear ?? false),
		getSize: () => ({ cols: terminal.columns, rows: terminal.rows }),
		setClientCapabilities: capabilities => applyClientCapabilities(capabilities),
	};
}

export function setActiveWebTerminalBridge(bridge: WebTerminalBridge | null): void {
	activeBridge = bridge;
}

export function getActiveWebTerminalBridge(): WebTerminalBridge | null {
	return activeBridge;
}
