import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Tool, ToolCall } from "@oh-my-pi/pi-ai/types";
import { validateToolArguments } from "@oh-my-pi/pi-ai/utils/validation";
import { hookFetch } from "@oh-my-pi/pi-utils";
import type { CustomToolContext } from "../../src/extensibility/custom-tools/types";
import { geminiImageSchema, geminiImageTool, setPreferredImageProvider } from "../../src/tools/gemini-image";

const originalFetch = global.fetch;
const originalOpenRouterKey = Bun.env.OPENROUTER_API_KEY;

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function getHeaderValue(headers: RequestInit["headers"] | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) {
		return headers.get(name) ?? headers.get(name.toLowerCase()) ?? headers.get(name.toUpperCase()) ?? undefined;
	}
	if (Array.isArray(headers)) {
		for (const [key, value] of headers) {
			if (key.toLowerCase() === name.toLowerCase()) {
				return value;
			}
		}
		return undefined;
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name.toLowerCase()) {
			if (typeof value === "string") {
				return value;
			}
			return value.join(",");
		}
	}
	return undefined;
}

function createContext(cwd: string): CustomToolContext {
	return {
		sessionManager: {
			getCwd: () => cwd,
		} as unknown as CustomToolContext["sessionManager"],
		modelRegistry: {
			getApiKeyForProvider: async () => undefined,
		} as unknown as CustomToolContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		hasQueuedMessages: () => false,
		abort: () => {},
		settings: undefined,
	};
}

describe("geminiImageTool", () => {
	let testDir: string | undefined;

	afterEach(() => {
		global.fetch = originalFetch;
		if (originalOpenRouterKey === undefined) {
			delete Bun.env.OPENROUTER_API_KEY;
		} else {
			Bun.env.OPENROUTER_API_KEY = originalOpenRouterKey;
		}
		if (testDir) {
			fs.rmSync(testDir, { recursive: true, force: true });
			testDir = undefined;
		}
		delete Bun.env.GEMINI_API_KEY;
		setPreferredImageProvider("auto");
	});

	it("sets X-Title when routing image generation through OpenRouter", async () => {
		let requestHeaders: RequestInit["headers"] | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestHeaders = init?.headers;
			return new Response(
				JSON.stringify({
					choices: [{ message: { role: "assistant", content: "" } }],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;

		const ctx = createContext("/tmp");

		const result = await geminiImageTool.execute("call-1", { subject: "a cat" }, undefined, ctx);
		expect(result.content[0].type).toBe("text");
		expect(getHeaderValue(requestHeaders, "X-Title")).toBe("Oh-My-Pi");
	});

	it("accepts only backend-valid aspect ratios and image sizes", () => {
		const tool: Tool = {
			name: geminiImageTool.name,
			description: geminiImageTool.description,
			parameters: geminiImageSchema,
		};

		const validWide: ToolCall = {
			type: "toolCall",
			id: "call-valid-wide",
			name: geminiImageTool.name,
			arguments: { subject: "Poster", aspect_ratio: "21:9", image_size: "4K" },
		};
		const validTall: ToolCall = {
			type: "toolCall",
			id: "call-valid-tall",
			name: geminiImageTool.name,
			arguments: { subject: "Poster", aspect_ratio: "1:4", image_size: "512" },
		};
		const invalidRatio: ToolCall = {
			type: "toolCall",
			id: "call-invalid-ratio",
			name: geminiImageTool.name,
			arguments: { subject: "Poster", aspect_ratio: "1:2", image_size: "4K" },
		};
		const invalidSize: ToolCall = {
			type: "toolCall",
			id: "call-invalid-size",
			name: geminiImageTool.name,
			arguments: {
				subject: "Poster",
				aspect_ratio: "21:9",
				image_size: "1024x1024",
			},
		};

		expect(validateToolArguments(tool, validWide)).toEqual(validWide.arguments);
		expect(validateToolArguments(tool, validTall)).toEqual(validTall.arguments);
		expect(() => validateToolArguments(tool, invalidRatio)).toThrow("Validation failed");
		expect(() => validateToolArguments(tool, invalidSize)).toThrow("Validation failed");
	});

	it("sends corrected image config values to the gemini request body", async () => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-gemini-image-"));
		Bun.env.GEMINI_API_KEY = "test-key";
		setPreferredImageProvider("gemini");

		let requestBody: Record<string, unknown> | undefined;
		using _hook = hookFetch(async (input, init, next) => {
			const url = String(input);
			if (!url.includes("generativelanguage.googleapis.com")) {
				return next(input, init);
			}

			requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								parts: [
									{
										inlineData: {
											mimeType: "image/png",
											data: TINY_PNG_BASE64,
										},
									},
								],
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});

		const result = await geminiImageTool.execute(
			"call-1",
			{ subject: "Wide panorama", aspect_ratio: "21:9", image_size: "4K" },
			undefined,
			createContext(testDir),
		);

		expect(result.details?.imageCount).toBe(1);
		expect(requestBody).toBeDefined();
		expect(requestBody?.generationConfig).toEqual({
			responseModalities: ["IMAGE"],
			imageConfig: {
				aspectRatio: "21:9",
				imageSize: "4K",
			},
		});
	});
});
