import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Model, Tool, ToolCall } from "@oh-my-pi/pi-ai";
import { validateToolArguments } from "@oh-my-pi/pi-ai/utils/validation";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type { CustomToolContext } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { imageGenSchema, imageGenTool, setPreferredImageProvider } from "@oh-my-pi/pi-coding-agent/tools/image-gen";
import { hookFetch } from "@oh-my-pi/pi-utils";

const originalFetch = global.fetch;
const originalOpenRouterKey = Bun.env.OPENROUTER_API_KEY;
const generatedImagePaths: string[] = [];

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

afterEach(async () => {
	await Promise.all(generatedImagePaths.splice(0).map(imagePath => fs.rm(imagePath, { force: true })));
	global.fetch = originalFetch;
	if (originalOpenRouterKey === undefined) {
		delete Bun.env.OPENROUTER_API_KEY;
	} else {
		Bun.env.OPENROUTER_API_KEY = originalOpenRouterKey;
	}
	delete Bun.env.GEMINI_API_KEY;
	setPreferredImageProvider("auto");
});

function _getHeaderValue(headers: RequestInit["headers"] | undefined, name: string): string | undefined {
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

describe("imageGenTool", () => {
	it("sets X-OpenRouter-Title when routing image generation through OpenRouter", async () => {
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

		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-1", { subject: "a cat" }, undefined, ctx);
		expect(result.content[0].type).toBe("text");
		expect(_getHeaderValue(requestHeaders, "X-OpenRouter-Title")).toBe("Oh-My-Pi");
	});

	it("uses the configured OpenRouter image model and forwards image request settings", async () => {
		let requestBody: Record<string, unknown> | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								images: [{ image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } }],
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;

		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
			settings: {
				get: (key: string) => (key === "providers.imageOpenRouterModel" ? "openai/gpt-5.4-image-2" : undefined),
			} as unknown as NonNullable<CustomToolContext["settings"]>,
		};

		const result = await imageGenTool.execute(
			"call-1",
			{ subject: "a cat", aspect_ratio: "16:9", image_size: "2K" },
			undefined,
			ctx,
		);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestBody).toMatchObject({
			model: "openai/gpt-5.4-image-2",
			modalities: ["image", "text"],
			image_config: {
				aspect_ratio: "16:9",
				image_size: "2K",
			},
		});
		expect(result.details?.provider).toBe("openrouter");
		expect(result.details?.model).toBe("openai/gpt-5.4-image-2");
		expect(result.details?.imageCount).toBe(1);
		expect(result.details?.imagePaths).toHaveLength(1);
		const savedPath = result.details?.imagePaths[0];
		if (!savedPath) throw new Error("Expected generated image path");
		expect(savedPath.endsWith(".png")).toBe(true);
		expect(await Bun.file(savedPath).bytes()).toEqual(Buffer.from(TINY_PNG_BASE64, "base64"));
	});

	it("defaults OpenRouter image generation to ChatGPT Images 2 when not configured", async () => {
		let requestBody: Record<string, unknown> | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								images: [{ image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } }],
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;

		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-1", { subject: "a cat" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestBody).toMatchObject({
			model: "openai/gpt-5.4-image-2",
			modalities: ["image", "text"],
		});
		expect(result.details?.model).toBe("openai/gpt-5.4-image-2");
	});

	it("e2e writes OpenAI Responses image_generation WebP output to a temp file", async () => {
		let requestUrl: string | undefined;
		let requestBody: unknown;

		const fetchMock: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requestUrl = input.toString();
			requestBody = JSON.parse(String(init?.body));
			return new Response(
				JSON.stringify({
					output: [
						{
							type: "image_generation_call",
							result: Buffer.from("fake-webp").toString("base64"),
							revised_prompt: "A crisp tabby cat portrait.",
							status: "completed",
						},
					],
					usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;

		const model = {
			api: "openai-responses",
			provider: "openai",
			id: "gpt-5.5",
			name: "GPT 5.5",
			baseUrl: "https://api.openai.com/v1",
		} as Model;
		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => "test-openai-key",
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-1", { subject: "a cat", aspect_ratio: "16:9" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestUrl).toBe("https://api.openai.com/v1/responses");
		expect(requestBody).toMatchObject({
			model: "gpt-5.5",
			tools: [
				{
					type: "image_generation",
					output_format: "webp",
					size: "1280x720",
					action: "generate",
				},
			],
			tool_choice: { type: "image_generation" },
			store: false,
		});
		expect(result.details?.provider).toBe("openai");
		expect(result.details?.imageCount).toBe(1);
		expect(result.details?.images[0]?.mimeType).toBe("image/webp");
		expect(result.details?.revisedPrompt).toBe("A crisp tabby cat portrait.");
		expect(result.details?.imagePaths).toHaveLength(1);
		const savedPath = result.details?.imagePaths[0];
		if (!savedPath) throw new Error("Expected generated image path");
		expect(savedPath.endsWith(".webp")).toBe(true);
		expect(await Bun.file(savedPath).bytes()).toEqual(Buffer.from("fake-webp"));
	});

	it("derives OpenAI image_generation sizes from aliases and aspect ratios before sending the request", async () => {
		let requestBody: unknown;

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response(
				JSON.stringify({
					output: [
						{
							type: "image_generation_call",
							result: Buffer.from("fake-webp").toString("base64"),
							status: "completed",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;
		fetchMock.preconnect = originalFetch.preconnect;
		global.fetch = fetchMock;

		const model = {
			api: "openai-responses",
			provider: "openai",
			id: "gpt-5.5",
			name: "GPT 5.5",
			baseUrl: "https://api.openai.com/v1",
		} as Model;
		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => "test-openai-key",
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute(
			"call-1",
			{ subject: "a cat", aspect_ratio: "4:3", image_size: "4K" },
			undefined,
			ctx,
		);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestBody).toMatchObject({
			tools: [
				{
					type: "image_generation",
					size: "3264x2448",
				},
			],
		});
	});

	it("rejects the unsupported 512 OpenAI image_size alias", async () => {
		const model = {
			api: "openai-responses",
			provider: "openai",
			id: "gpt-5.5",
			name: "GPT 5.5",
			baseUrl: "https://api.openai.com/v1",
		} as Model;
		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => "test-openai-key",
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		await expect(
			imageGenTool.execute("call-1", { subject: "a cat", image_size: "512" }, undefined, ctx),
		).rejects.toThrow('OpenAI-hosted image generation does not support image_size "512". Use "1K" or larger.');
	});

	it("accepts only backend-valid aspect ratios and image sizes", () => {
		const tool: Tool = {
			name: imageGenTool.name,
			description: imageGenTool.description,
			parameters: imageGenSchema,
		};

		const validWide: ToolCall = {
			type: "toolCall",
			id: "call-valid-wide",
			name: imageGenTool.name,
			arguments: { subject: "Poster", aspect_ratio: "21:9", image_size: "4K" },
		};
		const validTall: ToolCall = {
			type: "toolCall",
			id: "call-valid-tall",
			name: imageGenTool.name,
			arguments: { subject: "Poster", aspect_ratio: "1:4", image_size: "512" },
		};
		const invalidRatio: ToolCall = {
			type: "toolCall",
			id: "call-invalid-ratio",
			name: imageGenTool.name,
			arguments: { subject: "Poster", aspect_ratio: "1:2", image_size: "4K" },
		};
		const invalidSize: ToolCall = {
			type: "toolCall",
			id: "call-invalid-size",
			name: imageGenTool.name,
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
		const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gemini-image-"));
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

		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => testDir,
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKeyForProvider: async () => undefined,
			} as unknown as ModelRegistry,
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute(
			"call-1",
			{ subject: "Wide panorama", aspect_ratio: "21:9", image_size: "4K" },
			undefined,
			ctx,
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

		await fs.rm(testDir, { recursive: true, force: true });
	});
});
