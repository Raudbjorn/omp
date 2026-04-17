import { calculateCost } from "../models";
import type { Api, AssistantMessage, Context, Model, StreamFunction, StreamOptions, TextContent } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { formatErrorMessageWithRetryAfter } from "../utils/retry-after";

export interface WarpOptions extends StreamOptions {}

type WarpRunState =
	| "SUCCEEDED"
	| "FAILED"
	| "ERROR"
	| "CANCELLED"
	| "BLOCKED"
	| "INPROGRESS"
	| "QUEUED"
	| "PENDING"
	| "CLAIMED";

interface WarpRunPoll {
	state?: WarpRunState;
	artifacts?: unknown[];
	status_message?: { message?: string };
}

export const streamWarp: StreamFunction<"warp-agent"> = (
	model: Model<"warp-agent">,
	context: Context,
	options?: WarpOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "warp-agent" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error("Warp API key is required");
			}

			const baseUrl = model.baseUrl || "https://app.warp.dev/api/v1";

			const prompt = context.messages
				.map(m => {
					let content = "";
					if (typeof m.content === "string") {
						content = m.content;
					} else {
						content = m.content
							.map(c => {
								if (c.type === "text") return c.text;
								return "";
							})
							.join("");
					}
					return `${m.role}: ${content}`;
				})
				.join("\n\n");

			const runRes = await fetch(`${baseUrl}/agent/run`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					prompt: context.systemPrompt ? `${context.systemPrompt}\n\n${prompt}` : prompt,
					config: { model_id: model.id },
					interactive: false,
				}),
				signal: options?.signal,
			});

			if (!runRes.ok) {
				const text = await runRes.text();
				throw new Error(`Warp API error (${runRes.status}): ${text}`);
			}

			const runData = (await runRes.json()) as { run_id: string };
			const runId = runData.run_id;

			stream.push({ type: "start", partial: output });

			const currentTextBlock: TextContent & { index: number } = {
				type: "text",
				text: "",
				index: 0,
			};
			output.content.push(currentTextBlock);
			stream.push({ type: "text_start", contentIndex: 0, partial: output });

			let isDone = false;
			let lastLength = 0;
			while (!isDone) {
				if (options?.signal?.aborted) {
					await fetch(`${baseUrl}/agent/runs/${runId}/cancel`, {
						method: "POST",
						headers: { Authorization: `Bearer ${apiKey}` },
					}).catch(() => {});
					throw new Error("Request was aborted");
				}

				const pollRes = await fetch(`${baseUrl}/agent/runs/${runId}`, {
					headers: { Authorization: `Bearer ${apiKey}` },
					signal: options?.signal,
				});

				if (!pollRes.ok) {
					const text = await pollRes.text();
					throw new Error(`Warp API error during polling (${pollRes.status}): ${text}`);
				}

				const pollData = (await pollRes.json()) as WarpRunPoll;

				let newText = "";

				if (pollData.state === "SUCCEEDED") {
					isDone = true;
					if (pollData.artifacts && pollData.artifacts.length > 0) {
						newText = JSON.stringify(pollData.artifacts, null, 2);
					} else {
						newText = "Run succeeded.";
					}
				} else if (pollData.state === "FAILED" || pollData.state === "ERROR") {
					isDone = true;
					output.stopReason = "error";
					newText = pollData.status_message?.message || "Run failed with an error.";
				} else if (pollData.state === "CANCELLED") {
					isDone = true;
					output.stopReason = "aborted";
					newText = "Run was cancelled.";
				} else if (pollData.state === "BLOCKED") {
					isDone = true;
					output.stopReason = "stop";
					newText = "Run is blocked (awaiting user input/approval).";
				} else {
					await new Promise(r => setTimeout(r, 2000));
					continue;
				}

				if (newText && newText.length > lastLength) {
					if (!firstTokenTime) firstTokenTime = Date.now();
					const delta = newText.slice(lastLength);
					currentTextBlock.text += delta;
					stream.push({ type: "text_delta", contentIndex: 0, delta, partial: output });
					lastLength = newText.length;
				}
			}

			stream.push({
				type: "text_end",
				contentIndex: 0,
				content: currentTextBlock.text,
				partial: output,
			});

			calculateCost(model, output.usage);

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			const stopReason = output.stopReason;
			if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse") {
				stream.push({
					type: "done",
					reason: stopReason,
					message: output,
				});
			} else {
				stream.push({ type: "error", reason: stopReason, error: output });
			}
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatErrorMessageWithRetryAfter(error);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};
