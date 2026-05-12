/**
 * ExtensionDashboard - Tabbed layout for the Extension Control Center.
 *
 * Layout:
 * - Top: Horizontal tab bar for provider selection
 * - Body: 2-column grid (inventory list | preview panel)
 *
 * Navigation:
 * - TAB/Shift+TAB: Cycle through provider tabs
 * - Up/Down/j/k: Navigate list
 * - Space: Toggle selected item (or master switch)
 * - Esc: Close dashboard (clears search first if active)
 */
import * as os from "node:os";
import {
	type Component,
	Container,
	matchesKey,
	padding,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { setDisabledExtensions, setRestrictedExtensions } from "../../../capability";
import { Settings } from "../../../config/settings";
import { DynamicBorder } from "../../../modes/components/dynamic-border";
import { theme } from "../../../modes/theme/theme";
import { matchesAppInterrupt } from "../../../modes/utils/keybinding-matchers";
import {
	type ActionResult,
	deleteExtension,
	getMoveTargets,
	type MoveTarget,
	moveExtension,
	renameExtension,
} from "./extension-actions";
import { ExtensionList } from "./extension-list";
import { InspectorPanel } from "./inspector-panel";
import {
	applyDisabledExtensionsToState,
	applyFilter,
	createInitialState,
	filterByProvider,
	refreshState,
	toggleProvider,
} from "./state-manager";
import type { DashboardState } from "./types";

export class ExtensionDashboard extends Container {
	#state!: DashboardState;
	#mainList!: ExtensionList;
	#inspector!: InspectorPanel;
	#refreshToken = 0;
	#actionMode: any = null;
	#layoutMode: "vertical" | "horizontal" = "vertical";
	#lastScrollTime = 0;
	#lastScrollDirection: any = "";
	#scrollStartTime: any = 0;

	onClose?: () => void;
	onRequestRender?: () => void;

	private constructor(
		private readonly cwd: string,
		private readonly settings: Settings | null,
		private readonly terminalHeight: number,
		private readonly mcpManager?: {
			getConnection(name: string): { instructions?: string; tools?: { name: string }[] } | undefined;
		},
	) {
		super();
	}

	static async create(
		cwd: string,
		settings: Settings | null = null,
		terminalHeight?: number,
		mcpManager?: { getConnection(name: string): { instructions?: string; tools?: { name: string }[] } | undefined },
	): Promise<ExtensionDashboard> {
		const dashboard = new ExtensionDashboard(cwd, settings, terminalHeight ?? process.stdout.rows ?? 24, mcpManager);
		await dashboard.#init();
		return dashboard;
	}

	async #init(): Promise<void> {
		const sm = this.settings ?? (await Settings.init());
		const disabledIds = sm ? ((sm.get("disabledExtensions") as string[]) ?? []) : [];
		const projectDisabledIds = sm ? ((sm.getProject("projectDisabledExtensions") as string[] | undefined) ?? []) : [];
		this.#state = await createInitialState(this.cwd, disabledIds, projectDisabledIds, this.mcpManager);

		// Calculate max visible items based on terminal height
		// Reserve ~10 lines for header, tabs, help text, borders
		const maxVisible = Math.max(5, Math.floor((this.terminalHeight - 10) / 2));

		// Create main list - always focused
		this.#mainList = new ExtensionList(
			this.#state.searchFiltered,
			{
				onSelectionChange: ext => {
					this.#state.selected = ext;
					this.#inspector.setExtension(ext);
				},
				onToggle: (ext, enabled) => {
					this.#handleSmartToggle(ext, enabled);
				},
				onMasterToggle: providerId => {
					this.#handleProviderToggle(providerId);
				},
				masterSwitchProvider: this.#getActiveProviderId(),
				onCategoryToggle: extensions => {
					this.#handleCategoryToggle(extensions);
				},
			},
			maxVisible,
		);
		this.#mainList.setFocused(true);

		// Create inspector
		this.#inspector = new InspectorPanel();
		this.#inspector.setProjectPath(this.cwd);
		if (this.#state.selected) {
			this.#inspector.setExtension(this.#state.selected);
		}

		this.#layoutMode = (process.stdout.columns ?? 100) >= 120 ? "vertical" : "horizontal";

		this.#buildLayout();
	}

	#getActiveProviderId(): string | null {
		const tab = this.#state.tabs[this.#state.activeTabIndex];
		return tab && tab.id !== "all" ? tab.id : null;
	}

	#buildLayout(): void {
		this.clear();

		// Top border
		this.addChild(new DynamicBorder());

		// Title
		this.addChild(new Text(theme.bold(theme.fg("accent", " Extension Control Center")), 0, 0));

		// Tab bar
		this.addChild(new Text(this.#renderTabBar(), 0, 0));
		this.addChild(new Spacer(1));

		// Layout body: vertical split or horizontal stack
		const bodyMaxHeight = Math.max(5, this.terminalHeight - 8);
		if (this.#layoutMode === "horizontal") {
			this.addChild(new SplitBody(this.#mainList, this.#inspector, bodyMaxHeight));
		} else {
			// Vertical layout: list uses full height (minus search bar + scroll indicator overhead)
			const maxVisible = Math.max(5, bodyMaxHeight - 2);
			this.#mainList.setMaxVisible(maxVisible);
			this.#inspector.setMaxHeight(bodyMaxHeight);
			this.addChild(new TwoColumnBody(this.#mainList, this.#inspector, bodyMaxHeight));
		}

		this.addChild(new Spacer(1));
		this.addChild(new Text(this.#renderHelpBar(), 0, 0));

		// Bottom border
		this.addChild(new DynamicBorder());
	}

	#renderHelpBar(): string {
		if (this.#actionMode) {
			switch (this.#actionMode.type) {
				case "confirm":
					return theme.fg("warning", ` \u26a0 ${this.#actionMode.message}  y: confirm  any key: cancel`);
				case "picker": {
					const mode = this.#actionMode;
					const lines: string[] = [];
					lines.push(theme.fg("accent", ` Move "${mode.ext.displayName}" to:`));
					for (let i = 0; i < mode.options.length; i++) {
						const opt = mode.options[i];
						if (opt.current) {
							lines.push(theme.fg("dim", `   ${opt.label} (current)`));
						} else {
							const marker = i === mode.selectedIndex ? "\u25b8" : " ";
							const text = ` ${marker} ${opt.label}`;
							lines.push(i === mode.selectedIndex ? theme.fg("accent", text) : theme.fg("muted", text));
						}
					}
					lines.push(theme.fg("dim", " \u2191/\u2193: select  Enter: confirm  Esc: cancel"));
					return lines.join("\n");
				}
				case "input": {
					const label = this.#actionMode.action === "rename" ? "Rename" : "Move to";
					return theme.fg("accent", ` ${label}: ${this.#actionMode.buffer}\u2588  Enter: confirm  Esc: cancel`);
				}
			}
		}
		const w = process.stdout.columns ?? 100;
		if (w < 80) {
			return theme.fg("dim", " ↑↓ nav  ←→ cat  Space:cycle  R:restrict  V:layout  Esc");
		}
		return theme.fg("dim", " ↑↓ navigate  ←→ category  Space:cycle  R:restrict  V:layout  Tab  Esc");
	}

	#renderTabBar(): string {
		const parts: string[] = [" "];

		for (let i = 0; i < this.#state.tabs.length; i++) {
			const tab = this.#state.tabs[i];
			const isActive = i === this.#state.activeTabIndex;
			const isEmpty = tab.count === 0 && tab.id !== "all";
			const isDisabled = !tab.enabled && tab.id !== "all";

			// Build label with count
			let label = tab.label;
			if (tab.count > 0) {
				label += ` (${tab.count})`;
			}

			const displayLabel = isDisabled ? `${theme.status.disabled} ${label}` : label;

			if (isActive) {
				// Active tab: background highlight
				parts.push(theme.bg("selectedBg", ` ${displayLabel} `));
			} else if (isDisabled) {
				// Disabled provider: dim
				parts.push(theme.fg("dim", ` ${displayLabel} `));
			} else if (isEmpty) {
				// Empty enabled provider: very dim, unselectable
				parts.push(theme.fg("dim", ` ${label} `));
			} else {
				// Normal enabled provider
				parts.push(theme.fg("muted", ` ${label} `));
			}
		}

		return parts.join("");
	}

	#handleCategoryToggle(_extensions: any[]): void {
		void this.#refreshFromState();
	}

	#handleRestrictionToggle(_ext: any): void {
		void this.#refreshFromState();
	}

	onOpenFile?: (path: string) => void;

	#handleProviderToggle(providerId: string): void {
		toggleProvider(providerId);
		void this.#refreshFromState();
	}

	/**
	 * Three-state cycle on Space: Disabled globally → Active → Disabled for project → repeat.
	 * When both scopes are disabled, treats as "globally disabled" and cycles to Active.
	 */
	#handleSmartToggle(ext: Extension, _enabled: boolean): void {
		const sm = this.settings ?? Settings.instance;
		if (!sm) return;

		const globalDisabled = ((sm.get("disabledExtensions") as string[]) ?? []).slice();
		const projectDisabled = ((sm.getProject("projectDisabledExtensions") as string[] | undefined) ?? []).slice();

		if (ext.isGlobalDisabled) {
			// Disabled globally → Active (clear both scopes)
			const gi = globalDisabled.indexOf(ext.id);
			if (gi !== -1) globalDisabled.splice(gi, 1);
			const pi = projectDisabled.indexOf(ext.id);
			if (pi !== -1) projectDisabled.splice(pi, 1);
		} else if (!ext.isProjectDisabled) {
			// Active → Disabled for this project
			if (!projectDisabled.includes(ext.id)) {
				projectDisabled.push(ext.id);
			}
		} else {
			// Disabled for project → Disabled globally (swap scopes)
			const pi = projectDisabled.indexOf(ext.id);
			if (pi !== -1) projectDisabled.splice(pi, 1);
			if (!globalDisabled.includes(ext.id)) {
				globalDisabled.push(ext.id);
			}
		}

		this.#applyDisabledExtensions(disabled);
		void this.#refreshFromState();
	}

	async #refreshFromState(): Promise<void> {
		const refreshToken = ++this.#refreshToken;
		// Remember current tab ID before refresh
		const currentTabId = this.#state.tabs[this.#state.activeTabIndex]?.id;

		const sm = this.settings ?? Settings.instance;
		const disabledIds = sm ? ((sm.get("disabledExtensions") as string[]) ?? []) : [];
		const nextState = await refreshState(this.#state, this.cwd, disabledIds);
		if (refreshToken !== this.#refreshToken) return;
		this.#state = nextState;

		// Find the same tab in the new (re-sorted) list
		if (currentTabId) {
			const newIndex = this.#state.tabs.findIndex(t => t.id === currentTabId);
			if (newIndex >= 0) {
				this.#state.activeTabIndex = newIndex;
			}
		}

		this.#mainList.setExtensions(this.#state.searchFiltered);
		this.#mainList.setMasterSwitchProvider(this.#getActiveProviderId());

		if (this.#state.selected) {
			this.#inspector.setExtension(this.#state.selected);
		}

		this.#buildLayout();
		this.onRequestRender?.();
	}

	#applyDisabledExtensions(disabledIds: string[]): void {
		this.#state = applyDisabledExtensionsToState(this.#state, disabledIds);
		this.#mainList.setExtensions(this.#state.searchFiltered);
		if (this.#state.selected) {
			this.#inspector.setExtension(this.#state.selected);
		}
		this.#buildLayout();
		this.onRequestRender?.();
	}

	#switchTab(direction: 1 | -1): void {
		const numTabs = this.#state.tabs.length;
		if (numTabs === 0) return;

		// Find next selectable tab (skip empty+enabled providers)
		let nextIndex = this.#state.activeTabIndex;
		for (let i = 0; i < numTabs; i++) {
			nextIndex = (nextIndex + direction + numTabs) % numTabs;
			const tab = this.#state.tabs[nextIndex];
			const isEmptyEnabled = tab.count === 0 && tab.enabled && tab.id !== "all";
			if (!isEmptyEnabled) break;
		}
		this.#state.activeTabIndex = nextIndex;

		// Re-filter for new tab
		const tab = this.#state.tabs[this.#state.activeTabIndex];
		this.#state.tabFiltered = filterByProvider(this.#state.extensions, tab.id);
		this.#state.searchFiltered = applyFilter(this.#state.tabFiltered, this.#state.searchQuery);
		this.#state.listIndex = 0;
		this.#state.scrollOffset = 0;
		this.#state.selected = this.#state.searchFiltered[0] ?? null;

		// Update list
		this.#mainList.setExtensions(this.#state.searchFiltered);
		this.#mainList.setMasterSwitchProvider(this.#getActiveProviderId());
		this.#mainList.resetSelection();

		if (this.#state.selected) {
			this.#inspector.setExtension(this.#state.selected);
		}

		this.#buildLayout();
	}

	#handleActionModeInput(data: string): void {
		if (!this.#actionMode) return;

		switch (this.#actionMode.type) {
			case "confirm":
				if (data === "y" || data === "Y") {
					void this.#executeAction();
				} else {
					this.#actionMode = null;
					this.#buildLayout();
					this.onRequestRender?.();
				}
				break;
			case "picker": {
				const mode = this.#actionMode;
				if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
					this.#actionMode = null;
					this.#buildLayout();
					this.onRequestRender?.();
				} else if (matchesKey(data, "up") || data === "k") {
					let next = mode.selectedIndex;
					do {
						next = (next - 1 + mode.options.length) % mode.options.length;
					} while (mode.options[next].current && next !== mode.selectedIndex);
					mode.selectedIndex = next;
					this.#buildLayout();
					this.onRequestRender?.();
				} else if (matchesKey(data, "down") || data === "j") {
					let next = mode.selectedIndex;
					do {
						next = (next + 1) % mode.options.length;
					} while (mode.options[next].current && next !== mode.selectedIndex);
					mode.selectedIndex = next;
					this.#buildLayout();
					this.onRequestRender?.();
				} else if (matchesKey(data, "return")) {
					const selected = mode.options[mode.selectedIndex];
					if (selected && selected.label === "Custom path...") {
						this.#actionMode = {
							type: "input",
							action: "custom-path",
							ext: mode.ext,
							buffer: "",
							placeholder: "Enter target directory path",
						};
						this.#buildLayout();
						this.onRequestRender?.();
					} else if (selected && !selected.current) {
						void this.#executeAction();
					}
				}
				break;
			}
			case "input": {
				const mode = this.#actionMode;
				if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
					this.#actionMode = null;
					this.#buildLayout();
					this.onRequestRender?.();
				} else if (matchesKey(data, "return")) {
					if (mode.buffer.length > 0) {
						void this.#executeAction();
					}
				} else if (matchesKey(data, "backspace")) {
					mode.buffer = mode.buffer.slice(0, -1);
					this.#buildLayout();
					this.onRequestRender?.();
				} else if (data.length === 1 && data.charCodeAt(0) >= 32) {
					mode.buffer += data;
					this.#buildLayout();
					this.onRequestRender?.();
				}
				break;
			}
		}
	}

	async #executeAction(): Promise<void> {
		if (!this.#actionMode) return;

		let result: ActionResult | null = null;

		switch (this.#actionMode.action) {
			case "delete":
				result = await deleteExtension(this.#actionMode.ext);
				break;
			case "move": {
				const mode = this.#actionMode as {
					type: "picker";
					options: MoveTarget[];
					selectedIndex: number;
					ext: Extension;
				};
				const selected = mode.options[mode.selectedIndex];
				if (selected?.targetDir) {
					result = await moveExtension(mode.ext, selected.targetDir);
				}
				break;
			}
			case "custom-path": {
				const mode = this.#actionMode as { type: "input"; ext: Extension; buffer: string };
				if (mode.buffer) {
					result = await moveExtension(mode.ext, mode.buffer);
				}
				break;
			}
			case "rename": {
				const mode = this.#actionMode as { type: "input"; ext: Extension; buffer: string };
				if (mode.buffer && mode.buffer !== mode.ext.name) {
					result = await renameExtension(mode.ext, mode.buffer);
				}
				break;
			}
		}

		this.#actionMode = null;

		if (result && !result.ok) {
			// Show error briefly in help bar, then clear
			// For now, just rebuild — the item will be gone on success
		}

		await this.#refreshFromState();
	}

	handleInput(data: string): void {
		// Action mode intercepts all input
		if (this.#actionMode) {
			this.#handleActionModeInput(data);
			return;
		}

		// Ctrl+C - close immediately
		if (matchesKey(data, "ctrl+c")) {
			this.onClose?.();
			return;
		}

		// Escape - exit search mode, clear committed filter, or close
		if (matchesAppInterrupt(data)) {
			if (this.#mainList.isSearchActive() || this.#state.searchQuery.length > 0) {
				this.#mainList.deactivateSearch();
				this.#state.searchQuery = "";
				this.#state.searchFiltered = this.#state.tabFiltered;
				this.#mainList.setExtensions(this.#state.searchFiltered);
				this.#buildLayout();
				return;
			}
			this.onClose?.();
			return;
		}

		// Tab/Shift+Tab: Cycle through tabs
		if (matchesKey(data, "tab")) {
			this.#switchTab(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.#switchTab(-1);
			return;
		}

		// PgUp/PgDn: Scroll inspector preview (accelerates from 1–5 over 5s)
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
			const direction = matchesKey(data, "pageUp") ? -1 : 1;
			const now = Date.now();
			if (now - this.#lastScrollTime > 300 || direction !== this.#lastScrollDirection) {
				this.#scrollStartTime = now;
			}
			this.#lastScrollTime = now;
			this.#lastScrollDirection = direction;
			const speed = Math.min(5, 1 + Math.floor((now - this.#scrollStartTime) / 1000));
			this.#inspector.scrollPreview(direction * speed);
			this.#buildLayout();
			return;
		}

		// Left/Right: Jump to prev/next category header (ALL view only)
		if (matchesKey(data, "left")) {
			this.#mainList.jumpToPrevCategory();
			this.#buildLayout();
			return;
		}
		if (matchesKey(data, "right")) {
			this.#mainList.jumpToNextCategory();
			this.#buildLayout();
			return;
		}

		// When search is active, single-letter keys are search input, not commands
		if (this.#mainList.isSearchActive()) {
			this.#mainList.handleInput(data);
			const query = this.#mainList.getSearchQuery();
			if (query !== this.#state.searchQuery) {
				this.#state.searchQuery = query;
				this.#state.searchFiltered = applyFilter(this.#state.tabFiltered, query);
			}
			return;
		}

		// R: Toggle project restriction
		if (data === "r" || data === "R") {
			const ext = this.#mainList.getSelectedExtension();
			if (ext) this.#handleRestrictionToggle(ext);
			return;
		}

		// D: Delete extension
		if (data === "d" || data === "D") {
			const ext = this.#mainList.getSelectedExtension();
			if (ext && ext.source.level !== "native") {
				this.#actionMode = {
					type: "confirm",
					action: "delete",
					ext,
					message: `Delete ${ext.kind} "${ext.displayName}"?`,
				};
				this.#buildLayout();
			}
			return;
		}

		// M: Move/relocate extension
		if (data === "m" || data === "M") {
			const ext = this.#mainList.getSelectedExtension();
			if (ext && ext.source.level !== "native") {
				const targets = getMoveTargets(ext, this.cwd, os.homedir());
				if (targets.length > 0) {
					// Add "Custom path..." sentinel
					const options: MoveTarget[] = [
						...targets,
						{ label: "Custom path...", provider: "", scope: "project", targetDir: "" },
					];
					this.#actionMode = {
						type: "picker",
						action: "move",
						ext,
						options,
						selectedIndex: options.findIndex(o => !o.current),
					};
					this.#buildLayout();
				}
			}
			return;
		}

		// E: Open in editor
		if (data === "e" || data === "E") {
			const ext = this.#mainList.getSelectedExtension();
			if (ext) {
				this.onOpenFile?.(ext.path);
			}
			return;
		}

		// N: Rename extension
		if (data === "n" || data === "N") {
			const ext = this.#mainList.getSelectedExtension();
			if (ext && ext.source.level !== "native" && ext.kind !== "context-file") {
				this.#actionMode = {
					type: "input",
					action: "rename",
					ext,
					buffer: ext.name,
				};
				this.#buildLayout();
			}
			return;
		}

		// V: Toggle layout (vertical split ↔ horizontal stack)
		if (data === "v" || data === "V") {
			this.#layoutMode = this.#layoutMode === "vertical" ? "horizontal" : "vertical";
			this.#buildLayout();
			this.onRequestRender?.();
			return;
		}

		// All other input goes to the list
		this.#mainList.handleInput(data);

		// Sync search query back to state
		const query = this.#mainList.getSearchQuery();
		if (query !== this.#state.searchQuery) {
			this.#state.searchQuery = query;
			this.#state.searchFiltered = applyFilter(this.#state.tabFiltered, query);
		}
	}
}

/**
 * Two-column body component for side-by-side rendering.
 */
class TwoColumnBody implements Component {
	constructor(
		private readonly leftPane: ExtensionList,
		private readonly rightPane: InspectorPanel,
		private readonly maxHeight: number,
	) {}

	render(width: number): string[] {
		const leftWidth = Math.floor(width * 0.5);
		const rightWidth = Math.max(0, width - leftWidth - 3);

		const leftLines = this.leftPane.render(leftWidth);
		const rightLines = this.rightPane.render(rightWidth);

		// Limit to maxHeight lines
		const numLines = Math.min(this.maxHeight, Math.max(leftLines.length, rightLines.length));
		const combined: string[] = [];
		const separator = theme.fg("dim", ` ${theme.boxSharp.vertical} `);

		for (let i = 0; i < numLines; i++) {
			const left = truncateToWidth(leftLines[i] ?? "", leftWidth);
			const leftPadded = left + padding(Math.max(0, leftWidth - visibleWidth(left)));
			const right = truncateToWidth(rightLines[i] ?? "", rightWidth);
			combined.push(leftPadded + separator + right);
		}

		return combined;
	}

	invalidate(): void {
		this.leftPane.invalidate?.();
		this.rightPane.invalidate?.();
	}
}

/**
 * Split body: two-column top section (list | inspector header),
 * full-width inspector content below. Used on narrow terminals
 * so preview/instruction text gets the full terminal width.
 */
class SplitBody implements Component {
	constructor(
		private readonly list: ExtensionList,
		private readonly inspector: InspectorPanel,
		private readonly maxHeight: number,
	) {}

	render(width: number): string[] {
		const leftWidth = Math.floor(width * 0.5);
		const rightWidth = Math.max(0, width - leftWidth - 3);

		// Fixed top-section height derived from maxHeight only — must not depend on
		// headerLines.length, which varies per item and causes the list to resize on selection change.
		const headerLines = this.inspector.renderHeader(rightWidth);
		const topHeight = Math.max(8, Math.floor(this.maxHeight * 0.45));

		// Size list to fit top section (2 lines for search bar, 1 for scroll indicator)
		this.list.setMaxVisible(Math.max(3, topHeight - 3));
		const listLines = this.list.render(leftWidth);

		const colSep = theme.fg("dim", ` ${theme.boxSharp.vertical} `);
		const result: string[] = [];

		for (let i = 0; i < topHeight; i++) {
			const left = truncateToWidth(listLines[i] ?? "", leftWidth);
			const leftPadded = left + padding(Math.max(0, leftWidth - visibleWidth(left)));
			const right = truncateToWidth(headerLines[i] ?? "", rightWidth);
			result.push(leftPadded + colSep + right);
		}

		// Horizontal divider
		result.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(width)));

		// Full-width content below
		const contentBudget = Math.max(0, this.maxHeight - topHeight - 1);
		const contentLines = this.inspector.renderContent(width, contentBudget);
		for (const line of contentLines) {
			result.push(truncateToWidth(line, width));
		}

		return result;
	}

	invalidate(): void {
		this.list.invalidate?.();
		this.inspector.invalidate?.();
	}
}
