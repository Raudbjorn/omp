import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { _resetSettingsForTest, Settings } from "../../src/config/settings";
import { getThemeByName, type Theme } from "../../src/modes/theme/theme";
import { renderSearchCall, renderSearchResult, type SearchRenderDetails } from "../../src/web/search/render";
import type { SearchResponse } from "../../src/web/search/types";

function makeSearchResponse(overrides?: Partial<SearchResponse>): SearchResponse {
	return {
		provider: "anthropic",
		answer: "Test answer text",
		sources: [
			{ title: "Source 1", url: "https://example.com/1" },
			{ title: "Source 2", url: "https://example.com/2" },
		],
		usage: { inputTokens: 100, outputTokens: 50, searchRequests: 1 },
		model: "claude-haiku-4-5",
		requestId: "msg_test",
		durationMs: 3200,
		...overrides,
	};
}

function makeResult(response: SearchResponse): {
	content: Array<{ type: string; text?: string }>;
	details: SearchRenderDetails;
} {
	return {
		content: [{ type: "text", text: response.answer ?? "" }],
		details: { response },
	};
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("web search render — compact mode (verbose=false)", () => {
	let theme: Theme | undefined;

	beforeEach(async () => {
		theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
	});

	describe("renderSearchCall", () => {
		it('outputs Web Search("query") format in compact mode', () => {
			const component = renderSearchCall(
				{ query: "FFIV stock price" },
				{ expanded: false, isPartial: false },
				theme!,
			);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain('Web Search("FFIV stock price")');
		});

		it("does not contain box border characters in compact mode", () => {
			const component = renderSearchCall({ query: "test query" }, { expanded: false, isPartial: false }, theme!);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).not.toContain("┌");
			expect(text).not.toContain("│");
			expect(text).not.toContain("└");
		});
	});

	describe("renderSearchResult", () => {
		it("outputs compact 'Did N search in Xs' format", () => {
			const response = makeSearchResponse({ durationMs: 3200 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain("Did 1 search in 3s");
		});

		it("uses theme.tree.last for the continuation marker (theme-aware, ASCII-safe)", () => {
			const response = makeSearchResponse();
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const lines = component.render(100);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain(theme!.tree.last);
		});

		it("pluralizes 'searches' when count > 1", () => {
			const response = makeSearchResponse({
				usage: { inputTokens: 100, outputTokens: 50, searchRequests: 3 },
				durationMs: 5000,
			});
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain("Did 3 searches in 5s");
		});

		it("formats sub-second durations in milliseconds", () => {
			const response = makeSearchResponse({ durationMs: 450 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain("Did 1 search in 450ms");
		});

		it("does not show sources, metadata, or bordered box in compact mode", () => {
			const response = makeSearchResponse();
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).not.toContain("Provider:");
			expect(text).not.toContain("Sources:");
			expect(text).not.toContain("example.com");
			expect(text).not.toContain("┌");
		});

		it("handles missing durationMs gracefully", () => {
			const response = makeSearchResponse({ durationMs: undefined });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain("Did 1 search");
			expect(text).not.toContain("in ");
		});

		it("includes Web Search call header in compact result", () => {
			const response = makeSearchResponse({ durationMs: 4000 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!, {
				query: "FFIV stock price",
			});
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain('Web Search("FFIV stock price")');
			expect(text).toContain("Did 1 search in 4s");
		});

		it("uses searchQueries for header when args.query is absent", () => {
			const response = makeSearchResponse({
				durationMs: 2000,
				searchQueries: ["FFIV F5 stock price today"],
			});
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
			const text = stripAnsi(component.render(100).join("\n"));
			expect(text).toContain('Web Search("FFIV F5 stock price today")');
		});

		it("renders header and summary on separate lines", () => {
			const response = makeSearchResponse({ durationMs: 3000 });
			const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!, {
				query: "test",
			});
			const lines = component.render(100);
			const stripped = lines.map(l => stripAnsi(l));
			const headerLine = stripped.find(l => l.includes("Web Search"));
			const summaryLine = stripped.find(l => l.includes("Did 1 search"));
			expect(headerLine).toBeDefined();
			expect(summaryLine).toBeDefined();
			expect(headerLine).not.toBe(summaryLine);
		});
	});
});

describe("web search render — verbose mode (verbose=true)", () => {
	let theme: Theme | undefined;

	beforeEach(async () => {
		theme = await getThemeByName("dark");
		_resetSettingsForTest();
		await Settings.init({ inMemory: true, overrides: { "web_search.verbose": true } });
	});

	afterEach(() => {
		_resetSettingsForTest();
	});

	it("renderSearchCall renders the bordered status line when verbose=true", () => {
		const component = renderSearchCall({ query: "FFIV stock price" }, { expanded: false, isPartial: false }, theme!);
		const text = stripAnsi(component.render(100).join("\n"));
		expect(text).not.toContain('Web Search("FFIV stock price")');
		expect(text).toContain("Web Search");
		expect(text).toContain("FFIV stock price");
	});

	it("renderSearchResult shows provider, sources, and metadata panels when verbose=true", () => {
		const response = makeSearchResponse({ durationMs: 3200 });
		const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!, {
			query: "FFIV stock price",
		});
		const text = stripAnsi(component.render(100).join("\n"));
		expect(text).toContain("Provider:");
		expect(text).toContain("Sources:");
		expect(text).toContain("Answer");
		expect(text).toContain("Metadata");
		expect(text).not.toContain("Did 1 search in 3s");
	});
});

describe("web search render — default behavior without Settings", () => {
	let theme: Theme | undefined;

	beforeEach(async () => {
		theme = await getThemeByName("dark");
	});

	it("defaults to compact mode when Settings is not initialized", () => {
		const response = makeSearchResponse({ durationMs: 2000 });
		const component = renderSearchResult(makeResult(response), { expanded: false, isPartial: false }, theme!);
		const text = stripAnsi(component.render(100).join("\n"));
		expect(text).toContain("Did 1 search in 2s");
		expect(text).not.toContain("Provider:");
	});

	it("renderSearchCall defaults to compact format without Settings", () => {
		const component = renderSearchCall({ query: "test query" }, { expanded: false, isPartial: false }, theme!);
		const text = stripAnsi(component.render(100).join("\n"));
		expect(text).toContain('Web Search("test query")');
	});
});
