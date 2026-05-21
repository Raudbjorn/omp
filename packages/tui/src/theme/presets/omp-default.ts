import type { Theme } from "../registry";

/**
 * Minimal default palette mirroring the current hardcoded colors used by TUI
 * primitives. Values map to the semantic slots in `ThemePalette`. Host apps
 * (coding-agent) will typically register a richer theme and call
 * {@link registerTheme} with it — this preset exists so the TUI package is
 * usable standalone without a host theme.
 */
export const ompDefaultTheme: Theme = {
	id: "omp-default",
	description: "Minimal default palette for standalone TUI use",
	palette: {
		accent: "#5f9ea0",
		muted: "#808080",
		success: "#50c878",
		warning: "#ffbf00",
		error: "#e74c3c",
		info: "#4a9eff",
		border: "#6e6e6e",
	},
};
