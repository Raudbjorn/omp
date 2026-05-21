import { beforeEach, describe, expect, it } from "bun:test";
import {
	__resetThemeRegistryForTests,
	getActiveTheme,
	listThemes,
	registerTheme,
	resolveColor,
	resolveTheme,
	setActiveTheme,
	type Theme,
} from "../../src/theme/registry";
import { ompDefaultTheme } from "../../src/theme/presets/omp-default";

const alt: Theme = {
	id: "alt",
	palette: {
		accent: "#ff00ff",
		muted: "#333333",
		success: "#00ff00",
		warning: "#ffcc00",
		error: "#ff0000",
		info: "#0088ff",
		border: "#444444",
	},
};

beforeEach(() => {
	__resetThemeRegistryForTests();
});

describe("theme registry", () => {
	it("starts empty with no active theme", () => {
		expect(listThemes()).toEqual([]);
		expect(getActiveTheme()).toBeUndefined();
	});

	it("registers a theme and makes it active on first register", () => {
		registerTheme(ompDefaultTheme);
		expect(resolveTheme("omp-default")).toEqual(ompDefaultTheme);
		expect(getActiveTheme()?.id).toBe("omp-default");
	});

	it("does not change active theme when a second theme is registered", () => {
		registerTheme(ompDefaultTheme);
		registerTheme(alt);
		expect(getActiveTheme()?.id).toBe("omp-default");
	});

	it("allows explicit activation via setActiveTheme", () => {
		registerTheme(ompDefaultTheme);
		registerTheme(alt);
		setActiveTheme("alt");
		expect(getActiveTheme()?.id).toBe("alt");
	});

	it("throws when activating an unknown theme", () => {
		expect(() => setActiveTheme("missing")).toThrow(/Theme not registered/);
	});

	it("re-registering a theme id replaces the existing entry", () => {
		registerTheme(ompDefaultTheme);
		const replacement: Theme = { ...ompDefaultTheme, description: "replaced" };
		registerTheme(replacement);
		expect(resolveTheme("omp-default")?.description).toBe("replaced");
	});
});

describe("resolveColor", () => {
	it("returns the fallback when no theme is active", () => {
		expect(resolveColor("accent", "#fallback")).toBe("#fallback");
	});

	it("returns the active palette value for the given key", () => {
		registerTheme(alt);
		expect(resolveColor("accent", "#fallback")).toBe("#ff00ff");
		expect(resolveColor("error", "#fallback")).toBe("#ff0000");
	});
});

describe("ompDefaultTheme", () => {
	it("is shaped as a Theme with all palette keys", () => {
		const keys = Object.keys(ompDefaultTheme.palette).sort();
		expect(keys).toEqual(["accent", "border", "error", "info", "muted", "success", "warning"]);
	});
});
