import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Effort } from "@oh-my-pi/pi-ai";
import {
	Container,
	Input,
	isKeyRelease,
	matchesKey,
	type SelectItem,
	SelectList,
	type SettingItem,
	SettingsList,
	Spacer,
	type Tab,
	TabBar,
	Text,
} from "@oh-my-pi/pi-tui";
import { type SettingPath, settings } from "../../config/settings";
import type {
	SettingTab,
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSeparatorStyle,
	WebTerminalBinding,
	WebTerminalControlKey,
} from "../../config/settings-schema";
import { SETTING_TABS, TAB_METADATA } from "../../config/settings-schema";
import { getCurrentThemeName, getSelectListTheme, getSettingsListTheme, theme } from "../../modes/theme/theme";
import { matchesAppInterrupt } from "../../modes/utils/keybinding-matchers";
import {
	getWebTerminalBindingOptions,
	reconcileWebTerminalBindings,
	type WebTerminalBindingOption,
} from "../../web-terminal/interfaces";
import { getTabBarTheme } from "../shared";
import { DynamicBorder } from "./dynamic-border";
import { handleInputOrEscape, PluginSettingsComponent } from "./plugin-settings";
import { getSettingsForTab, type SettingDef } from "./settings-defs";
import { getPreset } from "./status-line/presets";

/**
 * A submenu component for selecting from a list of options.
 */
/**
 * Submenu component for free-text string settings.
 * Mirrors the ConfigInputSubmenu pattern from plugin-settings.ts.
 */
class TextInputSubmenu extends Container {
	#input: Input;

	constructor(
		label: string,
		description: string,
		currentValue: string,
		private readonly onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
	) {
		super();

		this.addChild(new Text(theme.bold(theme.fg("accent", label)), 0, 0));
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}
		this.addChild(new Spacer(1));

		this.#input = new Input();
		if (currentValue) {
			this.#input.setValue(currentValue);
			// Move cursor to end of pre-filled value (ctrl+e = cursorLineEnd).
			this.#input.handleInput("\x05");
		}
		this.#input.onSubmit = value => {
			this.onSubmit(value); // empty string clears the setting
		};
		this.addChild(this.#input);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to save · Esc to cancel · Clear field to unset"), 0, 0));
	}

	handleInput(data: string): void {
		handleInputOrEscape(data, this.#input, this.onCancel);
	}
}

class SelectSubmenu extends Container {
	#selectList: SelectList;
	#previewText: Text | null = null;
	#previewUpdateRequestId: number = 0;

	constructor(
		title: string,
		description: string,
		options: ReadonlyArray<SelectItem>,
		currentValue: string,
		onSelect: (value: string) => void,
		onCancel: () => void,
		onSelectionChange?: (value: string) => void | Promise<void>,
		private readonly getPreview?: () => string,
	) {
		super();

		// Title
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));

		// Description
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}

		// Preview (if provided)
		if (getPreview) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", "Preview:"), 0, 0));
			this.#previewText = new Text(getPreview(), 0, 0);
			this.addChild(this.#previewText);
		}

		// Spacer
		this.addChild(new Spacer(1));

		// Select list
		this.#selectList = new SelectList(options, Math.min(options.length, 10), getSelectListTheme());

		// Pre-select current value
		const currentIndex = options.findIndex(o => o.value === currentValue);
		if (currentIndex !== -1) {
			this.#selectList.setSelectedIndex(currentIndex);
		}

		this.#selectList.onSelect = item => {
			onSelect(item.value);
		};

		this.#selectList.onCancel = onCancel;

		if (onSelectionChange) {
			this.#selectList.onSelectionChange = item => {
				const requestId = ++this.#previewUpdateRequestId;
				const result = onSelectionChange(item.value);
				if (result && typeof (result as Promise<void>).then === "function") {
					void (result as Promise<void>).finally(() => {
						if (requestId === this.#previewUpdateRequestId) {
							this.#updatePreview();
						}
					});
					return;
				}
				if (requestId === this.#previewUpdateRequestId) {
					this.#updatePreview();
				}
			};
		}

		this.addChild(this.#selectList);

		// Hint
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Enter to select · Esc to go back"), 0, 0));
	}

	#updatePreview(): void {
		if (this.#previewText && this.getPreview) {
			this.#previewText.setText(this.getPreview());
		}
	}

	handleInput(data: string): void {
		// Ignore key-release events to prevent focus-shift ghost input.
		if (isKeyRelease(data)) return;
		this.#selectList.handleInput(data);
	}
}

type MultiSelectOption<T> = { id: string; label: string; value: T };
type MultiSelectSaveHandler<T> = (selected: MultiSelectOption<T>[]) => void;

class MultiSelectSubmenu<T> extends Container {
	#selectList: SelectList;
	#summaryText: Text | null = null;
	#selectedIds: Set<string>;
	#items: SelectItem[];
	#options: MultiSelectOption<T>[];
	#optionMap: Map<string, MultiSelectOption<T>>;
	#onSave: MultiSelectSaveHandler<T>;

	constructor(
		title: string,
		description: string,
		options: MultiSelectOption<T>[],
		selectedIds: Set<string>,
		onSave: MultiSelectSaveHandler<T>,
		onCancel: () => void,
		warning?: string,
	) {
		super();
		this.#options = options;
		this.#selectedIds = new Set(selectedIds);
		this.#optionMap = new Map(options.map(option => [option.id, option]));
		this.#items = options.map(option => ({
			value: option.id,
			label: this.#formatLabel(option),
		}));
		this.#onSave = onSave;

		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
		if (description) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("muted", description), 0, 0));
		}
		if (warning) {
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("warning", warning), 0, 0));
		}

		this.addChild(new Spacer(1));
		this.#summaryText = new Text(this.#getSummaryText(), 0, 0);
		this.addChild(this.#summaryText);

		this.addChild(new Spacer(1));
		this.#selectList = new SelectList(this.#items, Math.min(this.#items.length, 10), getSelectListTheme());
		this.#selectList.onSelect = item => {
			this.#toggleSelection(item.value);
		};
		this.#selectList.onCancel = onCancel;
		this.addChild(this.#selectList);

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("dim", "  Space/Enter to toggle · S to save · Esc to cancel"), 0, 0));
	}

	#formatLabel(option: MultiSelectOption<T>): string {
		const checked = this.#selectedIds.has(option.id);
		const box = checked ? theme.checkbox.checked : theme.checkbox.unchecked;
		return `${box} ${option.label}`;
	}

	#getSummaryText(): string {
		const count = this.#selectedIds.size;
		const text = count === 1 ? "1 selected" : `${count} selected`;
		return theme.fg("muted", `Selected: ${text}`);
	}

	#getSelectedOptions(): MultiSelectOption<T>[] {
		return this.#options.filter(option => this.#selectedIds.has(option.id));
	}

	#toggleSelection(id: string): void {
		if (this.#selectedIds.has(id)) {
			this.#selectedIds.delete(id);
		} else {
			this.#selectedIds.add(id);
		}
		const item = this.#items.find(entry => entry.value === id);
		const option = this.#optionMap.get(id);
		if (item && option) {
			item.label = this.#formatLabel(option);
		}
		this.#summaryText?.setText(this.#getSummaryText());
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+s") || data.toLowerCase() === "s") {
			this.#onSave(this.#getSelectedOptions());
			return;
		}
		if (data === " ") {
			const selected = this.#selectList.getSelectedItem();
			if (selected) {
				this.#toggleSelection(selected.value);
			}
			return;
		}
		this.#selectList.handleInput(data);
	}
}

function getSettingsTabs(): Tab[] {
	return [
		...SETTING_TABS.map(id => {
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0]);
			return { id, label: `${icon} ${meta.label}` };
		}),
		{ id: "plugins", label: `${theme.icon.package} Plugins` },
	];
}

/**
 * Dynamic context for settings that need runtime data.
 * Some settings (like thinking level) are managed by the session, not Settings.
 */
export interface SettingsRuntimeContext {
	/** Available thinking levels (from session) */
	availableThinkingLevels: Effort[];
	/** Current thinking level (from session) */
	thinkingLevel: ThinkingLevel | undefined;
	/** Available themes */
	availableThemes: string[];
	/** Working directory for plugins tab */
	cwd: string;
}

/** Status line settings subset for preview */
export interface StatusLinePreviewSettings {
	preset?: StatusLinePreset;
	leftSegments?: StatusLineSegmentId[];
	rightSegments?: StatusLineSegmentId[];
	separator?: StatusLineSeparatorStyle;
	sessionAccent?: boolean;
}

export interface SettingsCallbacks {
	/** Called when any setting value changes */
	onChange: (path: SettingPath, newValue: unknown) => void;
	/** Called for theme preview while browsing */
	onThemePreview?: (theme: string) => void | Promise<void>;
	/** Called for status line preview while configuring */
	onStatusLinePreview?: (settings: StatusLinePreviewSettings) => void;
	/** Get current rendered status line for inline preview */
	getStatusLinePreview?: () => string;
	/** Called when plugins change */
	onPluginsChanged?: () => void;
	/** Called when settings panel is closed */
	onCancel: () => void;
}

/**
 * Main tabbed settings selector component.
 * Uses declarative settings definitions from settings-defs.ts.
 */
export class SettingsSelectorComponent extends Container {
	#tabBar: TabBar;
	#currentList: SettingsList | null = null;
	#currentSubmenu: Container | null = null;
	#pluginComponent: PluginSettingsComponent | null = null;
	#statusPreviewContainer: Container | null = null;
	#statusPreviewText: Text | null = null;
	#currentTabId: SettingTab | "plugins" = "appearance";
	#textInputActive = false;

	constructor(
		private readonly context: SettingsRuntimeContext,
		private readonly callbacks: SettingsCallbacks,
	) {
		super();

		// Add top border
		this.addChild(new DynamicBorder());

		// Tab bar
		this.#tabBar = new TabBar("Settings", getSettingsTabs(), getTabBarTheme());
		this.#tabBar.onTabChange = () => {
			this.#switchToTab(this.#tabBar.getActiveTab().id as SettingTab | "plugins");
		};
		this.addChild(this.#tabBar);

		// Spacer after tab bar
		this.addChild(new Spacer(1));

		// Initialize with first tab
		this.#switchToTab("appearance");

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	#switchToTab(tabId: SettingTab | "plugins"): void {
		this.#currentTabId = tabId;

		// Remove current content
		if (this.#currentList) {
			this.removeChild(this.#currentList);
			this.#currentList = null;
		}
		if (this.#pluginComponent) {
			this.removeChild(this.#pluginComponent);
			this.#pluginComponent = null;
		}
		if (this.#statusPreviewContainer) {
			this.removeChild(this.#statusPreviewContainer);
			this.#statusPreviewContainer = null;
			this.#statusPreviewText = null;
		}

		// Remove bottom border temporarily
		const bottomBorder = this.children[this.children.length - 1];
		this.removeChild(bottomBorder);

		if (tabId === "plugins") {
			this.#showPluginsTab();
		} else {
			this.#showSettingsTab(tabId);
		}

		// Re-add bottom border
		this.addChild(bottomBorder);
	}

	/**
	 * Convert a setting definition to a SettingItem for the UI.
	 */
	#defToItem(def: SettingDef): SettingItem | null {
		// Check condition: applies to every variant — booleans, enums, submenus, text inputs.
		if (def.condition && !def.condition()) {
			return null;
		}

		const currentValue = this.#getCurrentValue(def);

		switch (def.type) {
			case "boolean":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue ? "true" : "false",
					values: ["true", "false"],
				};

			case "enum":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue as string,
					values: [...def.values],
				};

			case "submenu":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: this.#getSubmenuCurrentValue(def.path, currentValue),
					submenu: (cv, done) => this.#createSubmenu(def, cv, done),
				};

			case "text":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: (currentValue as string) ?? "",
					submenu: (cv, done) => this.#createTextInput(def, cv, done),
				};
		}
	}

	/**
	 * Get the current value for a setting.
	 */
	#getCurrentValue(def: SettingDef): unknown {
		return settings.get(def.path);
	}

	#getSubmenuCurrentValue(path: SettingPath, value: unknown): string {
		const rawValue = String(value ?? "");
		if (path === "compaction.thresholdPercent" && (rawValue === "-1" || rawValue === "")) {
			return "default";
		}
		if (path === "compaction.thresholdTokens" && (rawValue === "-1" || rawValue === "")) {
			return "default";
		}
		return rawValue;
	}

	/**
	 * Create a submenu for a submenu-type setting.
	 */
	#createSubmenu(
		def: SettingDef & { type: "submenu" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		let options = def.options;

		// Special case: inject runtime options for thinking level
		if (def.path === "defaultThinkingLevel") {
			options = this.context.availableThinkingLevels.map(level => {
				const baseOpt = options.find(o => o.value === level);
				return baseOpt || { value: level, label: level };
			});
		} else if (def.path === "theme.dark" || def.path === "theme.light") {
			options = this.context.availableThemes.map(t => ({ value: t, label: t }));
		}

		// Preview handlers
		let onPreview: ((value: string) => void | Promise<void>) | undefined;
		let onPreviewCancel: (() => void) | undefined;

		const activeThemeBeforePreview = getCurrentThemeName() ?? currentValue;
		if (def.path === "theme.dark" || def.path === "theme.light") {
			onPreview = value => {
				return this.callbacks.onThemePreview?.(value);
			};
			onPreviewCancel = () => {
				this.callbacks.onThemePreview?.(activeThemeBeforePreview);
			};
		} else if (def.path === "statusLine.preset") {
			onPreview = value => {
				const presetDef = getPreset(
					value as "default" | "minimal" | "compact" | "full" | "nerd" | "ascii" | "custom",
				);
				this.callbacks.onStatusLinePreview?.({
					preset: value as StatusLinePreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
				this.#updateStatusPreview();
			};
			onPreviewCancel = () => {
				const currentPreset = settings.get("statusLine.preset");
				const presetDef = getPreset(currentPreset);
				this.callbacks.onStatusLinePreview?.({
					preset: currentPreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
				this.#updateStatusPreview();
			};
		} else if (def.path === "statusLine.separator") {
			onPreview = value => {
				this.callbacks.onStatusLinePreview?.({ separator: value as StatusLineSeparatorStyle });
				this.#updateStatusPreview();
			};
			onPreviewCancel = () => {
				const separator = settings.get("statusLine.separator");
				this.callbacks.onStatusLinePreview?.({ separator });
				this.#updateStatusPreview();
			};
		}

		// Provide status line preview for theme selection
		const isThemeSetting = def.path === "theme.dark" || def.path === "theme.light";
		const getPreview = isThemeSetting ? this.callbacks.getStatusLinePreview : undefined;

		return new SelectSubmenu(
			def.label,
			def.description,
			options,
			currentValue,
			value => {
				this.#setSettingValue(def.path, value);
				this.callbacks.onChange(def.path, value);
				done(value);
			},
			() => {
				onPreviewCancel?.();
				done();
			},
			onPreview,
			getPreview,
		);
	}

	/**
	 * Create a text input submenu for a plain string setting.
	 */
	#createTextInput(
		def: SettingDef & { type: "text" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		this.#textInputActive = true;
		const wrappedDone = (value?: string) => {
			this.#textInputActive = false;
			done(value);
		};
		return new TextInputSubmenu(
			def.label,
			def.description,
			currentValue,
			value => {
				// Empty string clears the setting; undefined-typed string settings
				// store "" which the browser.ts expandPath ignores (no-op fallback).
				this.#setSettingValue(def.path, value);
				this.callbacks.onChange(def.path, value);
				wrappedDone(value);
			},
			() => wrappedDone(),
		);
	}

	/**
	 * Set a setting value, handling type conversion.
	 */
	#setSettingValue(path: SettingPath, value: string): void {
		// Handle number conversions
		const currentValue = settings.get(path);
		if (path === "compaction.thresholdPercent" && value === "default") {
			settings.set(path, -1 as never);
		} else if (path === "compaction.thresholdTokens" && value === "default") {
			settings.set(path, -1 as never);
		} else if (typeof currentValue === "number") {
			settings.set(path, Number(value) as never);
		} else if (typeof currentValue === "boolean") {
			settings.set(path, (value === "true") as never);
		} else {
			settings.set(path, value as never);
		}
	}

	/**
	 * Show a settings tab using definitions.
	 */
	#showSettingsTab(tabId: SettingTab): void {
		const defs = getSettingsForTab(tabId);
		const items: SettingItem[] = [];

		for (const def of defs) {
			const item = this.#defToItem(def);
			if (item) {
				items.push(item);
			}
		}

		if (tabId === "webterm") {
			items.push(this.#createWebTerminalKeysItem());
			items.push(this.#createWebTerminalBindingsItem());
		}

		// Add status line preview for appearance tab
		if (tabId === "appearance") {
			this.#statusPreviewContainer = new Container();
			this.#statusPreviewContainer.addChild(new Spacer(1));
			this.#statusPreviewContainer.addChild(new Text(theme.fg("muted", "Preview:"), 0, 0));
			this.#statusPreviewText = new Text(this.#getStatusPreviewString(), 0, 0);
			this.#statusPreviewContainer.addChild(this.#statusPreviewText);
			this.#statusPreviewContainer.addChild(new Spacer(1));
			this.addChild(this.#statusPreviewContainer);
		}

		this.#currentList = new SettingsList(
			items,
			10,
			getSettingsListTheme(),
			(id, newValue) => {
				const def = defs.find(d => d.path === id);
				if (!def) return;

				const path = def.path;

				if (def.type === "boolean") {
					const boolValue = newValue === "true";
					settings.set(path, boolValue as never);
					this.callbacks.onChange(path, boolValue);

					if (tabId === "appearance") {
						this.#triggerStatusLinePreview();
					}
				} else if (def.type === "enum") {
					settings.set(path, newValue as never);
					this.callbacks.onChange(path, newValue);
				}
				// Submenu types are handled in createSubmenu
			},
			() => this.callbacks.onCancel(),
		);

		this.addChild(this.#currentList);
	}

	#createWebTerminalBindingsItem(): SettingItem {
		const options = getWebTerminalBindingOptions();
		const bindings = settings.get("webTerminal.bindings");
		const { active, missing } = reconcileWebTerminalBindings(bindings, options);
		const summary = this.#formatWebTerminalSummary(active, missing);
		const displayOptions = this.#getBindingOptionEntries(options);

		return {
			id: "webTerminal.bindings",
			label: "Bind interfaces",
			description: "Select which network interfaces the web terminal listens on",
			currentValue: summary,
			submenu: (_currentValue, done) => {
				const selectedIds = new Set(active.map(option => option.id));
				const warning =
					missing.length > 0
						? `${missing.length} saved binding${missing.length > 1 ? "s" : ""} unavailable.`
						: undefined;
				return new MultiSelectSubmenu(
					"Bind interfaces",
					"Choose which interfaces should accept web terminal connections.",
					displayOptions,
					selectedIds,
					selected => {
						const nextBindings = selected.map(option => ({
							interface: option.value.interface,
							ip: option.value.ip,
						}));
						settings.set("webTerminal.bindings", nextBindings);
						this.callbacks.onChange("webTerminal.bindings", nextBindings);
						const updated = reconcileWebTerminalBindings(nextBindings, options);
						done(this.#formatWebTerminalSummary(updated.active, updated.missing));
					},
					() => done(),
					warning,
				);
			},
		};
	}

	#createWebTerminalKeysItem(): SettingItem {
		const allKeys: WebTerminalControlKey[] = ["esc", "enter", "up", "down", "left", "right", "ctrl+c"];
		const currentKeys = settings.get("webTerminal.extraControlKeys") || [];
		const summary = this.#formatControlKeysSummary(currentKeys, allKeys.length);
		const keyLabels: Record<WebTerminalControlKey, string> = {
			esc: "ESC",
			enter: "⏎",
			up: "↑",
			down: "↓",
			left: "←",
			right: "→",
			"ctrl+c": "Ctrl+C",
		};
		const keyOptions = allKeys.map(key => ({
			id: key,
			label: keyLabels[key] ?? key.toUpperCase(),
			value: key,
		}));

		return {
			id: "webTerminal.extraControlKeys",
			label: "Visible extra keys",
			description: "Select keys to show in the extra controls bar",
			currentValue: summary,
			submenu: (_currentValue, done) => {
				const selectedIds = new Set(settings.get("webTerminal.extraControlKeys") || []);
				return new MultiSelectSubmenu(
					"Visible extra keys",
					"Select keys to show in the bottom control bar.",
					keyOptions,
					selectedIds,
					selected => {
						const newKeys = selected.map(option => option.value);
						settings.set("webTerminal.extraControlKeys", newKeys);
						this.callbacks.onChange("webTerminal.extraControlKeys", newKeys);
						done(this.#formatControlKeysSummary(newKeys, allKeys.length));
					},
					() => done(),
				);
			},
		};
	}

	#formatControlKeysSummary(keys: WebTerminalControlKey[], total: number): string {
		if (keys.length === 0) return "No keys";
		if (keys.length === total) return "All keys";
		return `${keys.length} selected`;
	}

	#getBindingOptionEntries(options: WebTerminalBindingOption[]): MultiSelectOption<WebTerminalBindingOption>[] {
		const ipWidth = this.#getBindingIpWidth(options);
		return options.map(option => ({
			id: option.id,
			label: this.#formatBindingLabel(option, ipWidth),
			value: option,
		}));
	}

	#formatBindingLabel(option: WebTerminalBindingOption, ipWidth: number): string {
		const { interfaceLabel, ipDisplay } = this.#getBindingInterfaceDisplay(option);
		const paddedIp = ipDisplay.padEnd(ipWidth, " ");
		const { label, isPublic } = this.#classifyBinding(option);
		const status = isPublic ? `${label} ${theme.fg("error", "(!)")}` : label;
		return `${interfaceLabel} - ${paddedIp} - ${status}`;
	}

	#getBindingInterfaceDisplay(option: WebTerminalBindingOption): { interfaceLabel: string; ipDisplay: string } {
		if (this.#isLocalhostIp(option.ip) || option.isLoopback) {
			const cleaned = option.interface
				.replace(/loopback/gi, "")
				.replace(/pseudo-?interface/gi, "")
				.trim();
			const suffix =
				cleaned.length > 0 ? cleaned : option.interface.toLowerCase().includes("loopback") ? "" : option.interface;
			const ipDisplay = suffix ? `${suffix}/${option.ip}` : option.ip;
			return { interfaceLabel: "Loopback", ipDisplay };
		}
		return { interfaceLabel: option.interface, ipDisplay: option.ip };
	}

	#getBindingIpWidth(options: WebTerminalBindingOption[]): number {
		let maxWidth = 0;
		for (const option of options) {
			const { ipDisplay } = this.#getBindingInterfaceDisplay(option);
			maxWidth = Math.max(maxWidth, ipDisplay.length);
		}
		return maxWidth;
	}

	#classifyBinding(option: WebTerminalBindingOption): { label: string; isPublic: boolean } {
		if (this.#isLocalhostIp(option.ip) || option.isLoopback) {
			return { label: "Localhost", isPublic: false };
		}
		if (this.#isPrivateIp(option.ip)) {
			return { label: "Private", isPublic: false };
		}
		return { label: "Public", isPublic: true };
	}

	#isLocalhostIp(ip: string): boolean {
		return ip === "0.0.0.0" || ip.startsWith("127.");
	}

	#isPrivateIp(ip: string): boolean {
		const parts = this.#parseIpv4(ip);
		if (!parts) return false;
		const [first, second] = parts;
		if (first === 10) return true;
		if (first === 172 && second >= 16 && second <= 31) return true;
		if (first === 192 && second === 168) return true;
		if (first === 169 && second === 254) return true;
		if (first === 100 && second >= 64 && second <= 127) return true;
		return false;
	}

	#parseIpv4(ip: string): [number, number, number, number] | null {
		const parts = ip.split(".");
		if (parts.length !== 4) return null;
		const numbers = parts.map(part => Number(part));
		if (numbers.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
			return null;
		}
		return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!];
	}

	#formatWebTerminalSummary(active: WebTerminalBindingOption[], missing: WebTerminalBinding[]): string {
		if (active.length === 0) {
			return "No interfaces";
		}
		let summary = "";
		if (active.length === 1 && active[0]?.isLoopback) {
			summary = "Loopback only";
		} else if (active.length === 1) {
			summary = active[0].label;
		} else {
			summary = `${active.length} selected`;
		}
		if (missing.length > 0) {
			summary += ` (${missing.length} unavailable)`;
		}
		return summary;
	}

	/**
	 * Get the status line preview string.
	 */
	#getStatusPreviewString(): string {
		if (this.callbacks.getStatusLinePreview) {
			return this.callbacks.getStatusLinePreview();
		}
		return theme.fg("dim", "(preview not available)");
	}

	/**
	 * Trigger status line preview with current settings.
	 */
	#triggerStatusLinePreview(): void {
		const statusLineSettings: StatusLinePreviewSettings = {
			preset: settings.get("statusLine.preset"),
			leftSegments: settings.get("statusLine.leftSegments"),
			rightSegments: settings.get("statusLine.rightSegments"),
			separator: settings.get("statusLine.separator"),
			sessionAccent: settings.get("statusLine.sessionAccent"),
		};
		this.callbacks.onStatusLinePreview?.(statusLineSettings);
		this.#updateStatusPreview();
	}

	/**
	 * Update the inline status preview text.
	 */
	#updateStatusPreview(): void {
		if (this.#statusPreviewText && this.#currentTabId === "appearance") {
			this.#statusPreviewText.setText(this.#getStatusPreviewString());
		}
	}

	#showPluginsTab(): void {
		this.#pluginComponent = new PluginSettingsComponent(this.context.cwd, {
			onClose: () => this.callbacks.onCancel(),
			onPluginChanged: () => this.callbacks.onPluginsChanged?.(),
		});
		this.addChild(this.#pluginComponent);
	}

	getFocusComponent(): SettingsList | PluginSettingsComponent {
		// Return the current focusable component - one of these will always be set
		return (this.#currentList || this.#pluginComponent)!;
	}

	handleInput(data: string): void {
		// Ignore key-release events to prevent focus-shift ghost input.
		if (isKeyRelease(data)) return;
		// Handle tab switching — but NOT when a text input is active, since
		// arrow keys must reach the cursor and Tab must not switch tabs.
		if (
			!this.#textInputActive &&
			(matchesKey(data, "tab") ||
				matchesKey(data, "shift+tab") ||
				matchesKey(data, "left") ||
				matchesKey(data, "right"))
		) {
			this.#tabBar.handleInput(data);
			return;
		}

		// Escape at top level cancels
		if (matchesAppInterrupt(data) && !this.#currentSubmenu) {
			this.callbacks.onCancel();
			return;
		}

		// Pass to current content
		if (this.#currentList) {
			this.#currentList.handleInput(data);
		} else if (this.#pluginComponent) {
			this.#pluginComponent.handleInput(data);
		}
	}
}
