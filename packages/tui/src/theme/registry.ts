/**
 * Semantic color tokens that TUI primitives can resolve without coupling to a
 * host application's full theme object. Consumers register a theme once, then
 * reach for {@link resolveTheme} or {@link getActiveTheme} wherever they need
 * a color.
 *
 * The shape is intentionally narrow — application themes can extend it, but
 * TUI-package components only need these semantic slots.
 */
export interface Theme {
	readonly id: string;
	readonly description?: string;
	readonly palette: ThemePalette;
}

export interface ThemePalette {
	readonly accent: string;
	readonly muted: string;
	readonly success: string;
	readonly warning: string;
	readonly error: string;
	readonly info: string;
	readonly border: string;
}

export type ThemeColorKey = keyof ThemePalette;

const registry = new Map<string, Theme>();
let activeThemeId: string | null = null;

/**
 * Register a theme in the process-wide registry. Re-registering an existing
 * id replaces the previous entry (useful for hot-reload).
 */
export function registerTheme(theme: Theme): void {
	registry.set(theme.id, theme);
	if (activeThemeId === null) activeThemeId = theme.id;
}

export function resolveTheme(id: string): Theme | undefined {
	return registry.get(id);
}

export function getActiveTheme(): Theme | undefined {
	return activeThemeId ? registry.get(activeThemeId) : undefined;
}

export function setActiveTheme(id: string): void {
	if (!registry.has(id)) throw new Error(`Theme not registered: ${id}`);
	activeThemeId = id;
}

export function listThemes(): readonly Theme[] {
	return Array.from(registry.values());
}

/**
 * Test-only reset. Clears both the registry and the active theme selection.
 */
export function __resetThemeRegistryForTests(): void {
	registry.clear();
	activeThemeId = null;
}

export function resolveColor(key: ThemeColorKey, fallback: string): string {
	const theme = getActiveTheme();
	return theme?.palette[key] ?? fallback;
}
