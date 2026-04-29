import { getOAuthProviders } from "@oh-my-pi/pi-ai";
import { Container, Input, matchesKey, Spacer, TruncatedText } from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";
import { matchesSelectCancel } from "../../modes/utils/keybinding-matchers";
import type { AuthStorage } from "../../session/auth-storage";
import { DynamicBorder } from "./dynamic-border";

const MAX_VISIBLE = 10;

type ProviderType = "oauth" | "apiKey";

interface ProviderItem {
	id: string;
	name: string;
	type: ProviderType;
	available: boolean;
	envVarHint?: string;
}

/**
 * Component that renders an OAuth/API-key provider selector.
 */
export class OAuthSelectorComponent extends Container {
	#listContainer: Container;
	#searchInput: Input;
	#allProviders: ProviderItem[] = [];
	#filteredProviders: ProviderItem[] = [];
	#selectedIndex: number = 0;
	#mode: "login" | "logout";
	#authStorage: AuthStorage;
	#onSelectCallback: (providerId: string) => void;
	#onApiKeySelectCallback: (providerId: string) => void;
	#onCancelCallback: () => void;
	#statusMessage: string | undefined;
	#validateAuthCallback?: (providerId: string) => Promise<boolean>;
	#apiKeyStatusCallback?: (providerId: string) => Promise<boolean>;
	#requestRenderCallback?: () => void;
	#authState: Map<string, "checking" | "valid" | "invalid"> = new Map();
	#apiKeyState: Map<string, boolean> = new Map();
	#spinnerFrame: number = 0;
	#spinnerInterval?: NodeJS.Timeout;
	#validationGeneration: number = 0;
	constructor(
		mode: "login" | "logout",
		authStorage: AuthStorage,
		onSelect: (providerId: string) => void,
		onCancel: () => void,
		options?: {
			apiKeyProviders?: Array<{ id: string; name: string; envVarHint?: string }>;
			onApiKeySelect?: (providerId: string) => void;
			validateAuth?: (providerId: string) => Promise<boolean>;
			apiKeyStatus?: (providerId: string) => Promise<boolean>;
			requestRender?: () => void;
		},
	) {
		super();
		this.#mode = mode;
		this.#authStorage = authStorage;
		this.#onSelectCallback = onSelect;
		this.#onApiKeySelectCallback = options?.onApiKeySelect ?? onSelect;
		this.#onCancelCallback = onCancel;
		this.#validateAuthCallback = options?.validateAuth;
		this.#apiKeyStatusCallback = options?.apiKeyStatus;
		this.#requestRenderCallback = options?.requestRender;
		// Load all providers
		this.#loadProviders(options?.apiKeyProviders ?? []);
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		// Add title
		const title = mode === "login" ? "Select provider to login:" : "Select provider to logout:";
		this.addChild(new TruncatedText(theme.bold(title)));
		this.addChild(new Spacer(1));
		// Create search input
		this.#searchInput = new Input();
		this.addChild(this.#searchInput);
		this.addChild(new Spacer(1));
		// Create list container
		this.#listContainer = new Container();
		this.addChild(this.#listContainer);
		this.addChild(new Spacer(1));
		// Add bottom border
		this.addChild(new DynamicBorder());
		// Initial render
		this.#updateList();
		this.#startValidation();
	}

	stopValidation(): void {
		this.#validationGeneration += 1;
		this.#stopSpinner();
	}
	#loadProviders(apiKeyProviders: Array<{ id: string; name: string; envVarHint?: string }>): void {
		const oauthItems: ProviderItem[] = getOAuthProviders().map(p => ({
			...p,
			type: "oauth" as const,
		}));
		const apiKeyItems: ProviderItem[] = apiKeyProviders.map(p => ({
			...p,
			type: "apiKey" as const,
			available: true,
		}));
		this.#allProviders = [...oauthItems, ...apiKeyItems];
		this.#filteredProviders = this.#allProviders;
	}

	#startValidation(): void {
		const generation = this.#validationGeneration + 1;
		this.#validationGeneration = generation;

		let pending = 0;
		for (const provider of this.#allProviders) {
			if (provider.type === "oauth") {
				if (!this.#authStorage.hasAuth(provider.id)) {
					this.#authState.delete(provider.id);
					continue;
				}
				this.#authState.set(provider.id, "checking");
				pending += 1;
				void this.#validateProvider(provider.id, generation);
			} else if (provider.type === "apiKey" && this.#apiKeyStatusCallback) {
				pending += 1;
				void this.#checkApiKeyStatus(provider.id, generation);
			}
		}

		if (pending > 0) {
			this.#startSpinner();
			this.#updateList();
			this.#requestRenderCallback?.();
		}
	}

	async #validateProvider(providerId: string, generation: number): Promise<void> {
		if (!this.#validateAuthCallback) return;
		let isValid = false;
		try {
			isValid = await this.#validateAuthCallback(providerId);
		} catch {
			isValid = false;
		}

		if (generation !== this.#validationGeneration) return;
		this.#authState.set(providerId, isValid ? "valid" : "invalid");
		if (![...this.#authState.values()].includes("checking")) {
			this.#stopSpinner();
		}
		this.#updateList();
		this.#requestRenderCallback?.();
	}

	async #checkApiKeyStatus(providerId: string, generation: number): Promise<void> {
		if (!this.#apiKeyStatusCallback) return;
		let hasKey = false;
		try {
			hasKey = await this.#apiKeyStatusCallback(providerId);
		} catch {
			hasKey = false;
		}
		if (generation !== this.#validationGeneration) return;
		this.#apiKeyState.set(providerId, hasKey);
		if (![...this.#authState.values()].includes("checking")) {
			this.#stopSpinner();
		}
		this.#updateList();
		this.#requestRenderCallback?.();
	}

	#startSpinner(): void {
		if (this.#spinnerInterval) return;
		this.#spinnerInterval = setInterval(() => {
			const frameCount = theme.spinnerFrames.length;
			if (frameCount > 0) {
				this.#spinnerFrame = (this.#spinnerFrame + 1) % frameCount;
			}
			this.#updateList();
			this.#requestRenderCallback?.();
		}, 80);
	}

	#stopSpinner(): void {
		if (this.#spinnerInterval) {
			clearInterval(this.#spinnerInterval);
			this.#spinnerInterval = undefined;
		}
	}

	#getStatusIndicator(provider: ProviderItem): string {
		if (provider.type === "apiKey") {
			const hasKey = this.#apiKeyState.get(provider.id);
			if (hasKey) {
				return theme.fg("success", ` ${theme.status.success} API key set`);
			}
			return "";
		}
		const state = this.#authState.get(provider.id);
		if (state === "checking") {
			const frameCount = theme.spinnerFrames.length;
			const spinner = frameCount > 0 ? theme.spinnerFrames[this.#spinnerFrame % frameCount] : theme.status.pending;
			return theme.fg("warning", ` ${spinner} checking`);
		}
		if (state === "invalid") {
			return theme.fg("error", ` ${theme.status.error} invalid`);
		}
		if (state === "valid") {
			return theme.fg("success", ` ${theme.status.success} logged in`);
		}
		return this.#authStorage.hasAuth(provider.id) ? theme.fg("success", ` ${theme.status.success} logged in`) : "";
	}
	#getTypeLabel(provider: ProviderItem): string {
		if (provider.type === "apiKey") {
			return theme.fg("dim", " [API Key]");
		}
		return theme.fg("dim", " [OAuth]");
	}
	#updateList(): void {
		this.#listContainer.clear();

		const visibleItems = this.#filteredProviders;
		const startIndex = Math.max(
			0,
			Math.min(this.#selectedIndex - Math.floor(MAX_VISIBLE / 2), visibleItems.length - MAX_VISIBLE),
		);
		const endIndex = Math.min(startIndex + MAX_VISIBLE, visibleItems.length);

		// Show visible slice of filtered providers
		for (let i = startIndex; i < endIndex; i++) {
			const provider = visibleItems[i];
			if (!provider) continue;
			const isSelected = i === this.#selectedIndex;
			const isAvailable = provider.available;
			const statusIndicator = this.#getStatusIndicator(provider);
			const typeLabel = this.#getTypeLabel(provider);

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("accent", `${theme.nav.cursor} `);
				const text = isAvailable ? theme.fg("accent", provider.name) : theme.fg("dim", provider.name);
				line = prefix + text + typeLabel + statusIndicator;
			} else {
				const text = isAvailable ? `  ${provider.name}` : theme.fg("dim", `  ${provider.name}`);
				line = text + typeLabel + statusIndicator;
			}
			this.#listContainer.addChild(new TruncatedText(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < visibleItems.length) {
			const scrollInfo = theme.fg("muted", `  (${this.#selectedIndex + 1}/${visibleItems.length})`);
			this.#listContainer.addChild(new TruncatedText(scrollInfo, 0, 0));
		}

		// Show "no providers" or "no matches" if empty
		if (visibleItems.length === 0) {
			const searchQuery = this.#searchInput.getValue();
			let message: string;
			if (searchQuery) {
				message = `No providers match "${searchQuery}"`;
			} else if (this.#mode === "login") {
				message = "No providers available";
			} else {
				message = "No providers logged in. Use /login first.";
			}
			this.#listContainer.addChild(new TruncatedText(theme.fg("muted", `  ${message}`), 0, 0));
		}
		if (this.#statusMessage) {
			this.#listContainer.addChild(new Spacer(1));
			this.#listContainer.addChild(new TruncatedText(theme.fg("warning", `  ${this.#statusMessage}`), 0, 0));
		}
	}

	#filterProviders(query: string): void {
		const normalized = query.toLowerCase().trim();
		if (!normalized) {
			this.#filteredProviders = this.#allProviders;
		} else {
			this.#filteredProviders = this.#allProviders.filter(
				provider =>
					provider.name.toLowerCase().includes(normalized) || provider.id.toLowerCase().includes(normalized),
			);
		}
		// Reset selection when filter changes
		this.#selectedIndex = 0;
		this.#updateList();
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (matchesKey(keyData, "up")) {
			if (this.#filteredProviders.length > 0) {
				this.#selectedIndex =
					this.#selectedIndex === 0 ? this.#filteredProviders.length - 1 : this.#selectedIndex - 1;
			}
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Down arrow
		else if (matchesKey(keyData, "down")) {
			if (this.#filteredProviders.length > 0) {
				this.#selectedIndex =
					this.#selectedIndex === this.#filteredProviders.length - 1 ? 0 : this.#selectedIndex + 1;
			}
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Enter
		else if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selectedProvider = this.#filteredProviders[this.#selectedIndex];
			if (selectedProvider?.available) {
				this.#statusMessage = undefined;
				this.stopValidation();
				if (selectedProvider.type === "apiKey") {
					this.#onApiKeySelectCallback(selectedProvider.id);
				} else {
					this.#onSelectCallback(selectedProvider.id);
				}
			} else if (selectedProvider) {
				this.#statusMessage = "Provider unavailable in this environment.";
				this.#updateList();
			}
		}
		// Escape or Ctrl+C
		else if (matchesSelectCancel(keyData)) {
			this.stopValidation();
			this.#onCancelCallback();
		}
		// Pass everything else to search input
		else {
			this.#searchInput.handleInput(keyData);
			this.#filterProviders(this.#searchInput.getValue());
		}
	}
}
