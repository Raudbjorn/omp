import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import { loadCommandChainFilesFromDir } from "../src/danger-pi/command-chain-files/load";
import { createPromptChainExecutor, type PromptChainTurnResult } from "../src/danger-pi/command-chain-files/runtime";

class PromptChainHostHarness {
	readonly onTurnComplete = vi.fn((handler: (result: PromptChainTurnResult) => Promise<void>) => {
		this.#turnCompleteHandlers.push(handler);
	});
	readonly prompt = vi.fn(
		async (
			text: string,
			options?: { streamingBehavior?: "followUp" | "steer"; images?: readonly ImageContent[] },
		) => {
			this.prompts.push({ text, options });
			if (this.nextPromptError) {
				const error = this.nextPromptError;
				this.nextPromptError = undefined;
				throw error;
			}
		},
	);
	readonly prompts: Array<{
		text: string;
		options?: { streamingBehavior?: "followUp" | "steer"; images?: readonly ImageContent[] };
	}> = [];
	nextPromptError?: Error;
	#turnCompleteHandlers: Array<(result: PromptChainTurnResult) => Promise<void>> = [];

	async fireTurnComplete(result: PromptChainTurnResult = { stopReason: "stop", success: true }): Promise<void> {
		for (const handler of this.#turnCompleteHandlers) {
			await handler(result);
		}
	}
}

async function makeCommandsDir(): Promise<string> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-command-chain-"));
	const commandsDir = path.join(cwd, ".omp", "commands");
	await fs.mkdir(commandsDir, { recursive: true });
	return cwd;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("command chain file loader", () => {
	it("loads valid .cmd.yaml files as prompt-chain slash commands", async () => {
		const cwd = await makeCommandsDir();
		try {
			const commandsDir = path.join(cwd, ".omp", "commands");
			await Bun.write(
				path.join(commandsDir, "review.cmd.yaml"),
				["description: Review change", "steps:", '  - "First: $ARGUMENTS"', '  - "Second"'].join("\n"),
			);

			const result = await loadCommandChainFilesFromDir(commandsDir, "native", "project");

			expect(result.warnings).toBeUndefined();
			expect(result.items).toEqual([
				expect.objectContaining({
					kind: "prompt-chain",
					name: "review",
					description: "Review change",
					stepTemplates: ["First: $ARGUMENTS", "Second"],
				}),
			]);
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("reports invalid YAML syntax under the filename-derived command name", async () => {
		const cwd = await makeCommandsDir();
		try {
			const commandsDir = path.join(cwd, ".omp", "commands");
			await Bun.write(path.join(commandsDir, "broken.cmd.yaml"), "description: nope\nsteps: [unterminated");

			const result = await loadCommandChainFilesFromDir(commandsDir, "native", "project");

			expect(result.items).toEqual([]);
			expect(result.warnings?.[0]).toContain("broken");
			expect(result.warnings?.[0]).toContain(path.join(commandsDir, "broken.cmd.yaml"));
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("reports raw-ish schema validation details for malformed command files", async () => {
		const cwd = await makeCommandsDir();
		try {
			const commandsDir = path.join(cwd, ".omp", "commands");
			await Bun.write(
				path.join(commandsDir, "schema.cmd.yaml"),
				["description: 123", "steps:", "  - ok", "  - 42"].join("\n"),
			);

			const result = await loadCommandChainFilesFromDir(commandsDir, "native", "project");

			expect(result.items).toEqual([]);
			expect(result.warnings?.[0]).toContain("schema");
			expect(result.warnings?.[0]).toContain("/description");
			expect(result.warnings?.[0]).toContain("/steps/1");
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});

	it("keeps same-directory .md files authoritative over .cmd.yaml siblings", async () => {
		const cwd = await makeCommandsDir();
		try {
			const commandsDir = path.join(cwd, ".omp", "commands");
			await Bun.write(path.join(commandsDir, "foo.md"), "---\ndescription: Markdown winner\n---\nWinner body");
			await Bun.write(
				path.join(commandsDir, "foo.cmd.yaml"),
				["description: YAML loser", "steps:", "  - first"].join("\n"),
			);

			const result = await loadCommandChainFilesFromDir(commandsDir, "native", "project");

			expect(result.items).toEqual([
				expect.objectContaining({
					kind: "template",
					name: "foo",
					content: expect.stringContaining("Winner body"),
				}),
			]);
			expect(result.warnings?.[0]).toContain("foo");
			expect(result.warnings?.[0]).toContain(path.join(commandsDir, "foo.md"));
			expect(result.warnings?.[0]).toContain(path.join(commandsDir, "foo.cmd.yaml"));
			expect(result.warnings?.[0]).toContain(`using ${path.join(commandsDir, "foo.md")}`);
		} finally {
			await fs.rm(cwd, { recursive: true, force: true });
		}
	});
});

describe("prompt chain runtime", () => {
	it("kicks off the first step immediately only when the queue is idle", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);

		await executor.execute("first", ["one $ARGUMENTS", "two"], "alpha beta");
		await executor.execute("second", ["three $ARGUMENTS", "four"], "gamma");

		expect(host.onTurnComplete).toHaveBeenCalledTimes(1);
		expect(host.prompts).toEqual([{ text: "one alpha beta", options: undefined }]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([
			{ text: "one alpha beta", options: undefined },
			{ text: "two", options: { streamingBehavior: "followUp" } },
		]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([
			{ text: "one alpha beta", options: undefined },
			{ text: "two", options: { streamingBehavior: "followUp" } },
			{ text: "three gamma", options: { streamingBehavior: "followUp" } },
		]);
	});

	it("clears the chain on errored turn completion", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);

		await executor.execute("retry", ["first", "second"], "");

		await host.fireTurnComplete({ stopReason: "error", success: false });
		expect(host.prompts).toEqual([{ text: "first", options: undefined }]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([{ text: "first", options: undefined }]);
	});

	it("clears the chain on aborted turn completion", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);

		await executor.execute("retry", ["first", "second"], "");

		await host.fireTurnComplete({ stopReason: "aborted", success: false });
		expect(host.prompts).toEqual([{ text: "first", options: undefined }]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([{ text: "first", options: undefined }]);
	});

	it("starts a later chain immediately after a failed turn clears runtime state", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);

		await executor.execute("first", ["only"], "");
		await host.fireTurnComplete({ stopReason: "error", success: false });
		await executor.execute("second", ["next"], "");

		expect(host.prompts).toEqual([
			{ text: "only", options: undefined },
			{ text: "next", options: undefined },
		]);
	});

	it("retries the failed head step on the next turn completion without advancing", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);

		await executor.execute("retry", ["first", "second"], "");
		host.nextPromptError = new Error("boom");

		await expect(host.fireTurnComplete()).rejects.toThrow("boom");
		expect(host.prompts).toEqual([
			{ text: "first", options: undefined },
			{ text: "second", options: { streamingBehavior: "followUp" } },
		]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([
			{ text: "first", options: undefined },
			{ text: "second", options: { streamingBehavior: "followUp" } },
			{ text: "second", options: { streamingBehavior: "followUp" } },
		]);
	});

	it("forwards the first-step streaming behavior to the initial dispatch", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);

		await executor.execute("queued", ["first", "second"], "", { streamingBehavior: "followUp" });

		expect(host.prompts).toEqual([{ text: "first", options: { streamingBehavior: "followUp" } }]);
	});

	it("attaches images only to the first dispatched step", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);
		const image: ImageContent = { type: "image", data: "abc", mimeType: "image/png" };

		await executor.execute("review", ["first", "second"], "", { images: [image] });
		expect(host.prompts).toEqual([{ text: "first", options: { images: [image] } }]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([
			{ text: "first", options: { images: [image] } },
			{ text: "second", options: { streamingBehavior: "followUp" } },
		]);
	});

	it("retains each queued chain's first-step images until it reaches the head", async () => {
		const host = new PromptChainHostHarness();
		const executor = createPromptChainExecutor(host);
		const firstImage: ImageContent = { type: "image", data: "first", mimeType: "image/png" };
		const secondImage: ImageContent = { type: "image", data: "second", mimeType: "image/png" };

		await executor.execute("first", ["only"], "", { images: [firstImage] });
		await executor.execute("second", ["next"], "", { images: [secondImage] });

		expect(host.prompts).toEqual([{ text: "only", options: { images: [firstImage] } }]);

		await host.fireTurnComplete();
		expect(host.prompts).toEqual([
			{ text: "only", options: { images: [firstImage] } },
			{ text: "next", options: { streamingBehavior: "followUp", images: [secondImage] } },
		]);
	});
});
