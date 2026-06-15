import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	completeSimple,
	type ImageContent,
	type RedactedThinkingContent,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
} from "@oh-my-pi/pi-ai";
import { logger, prompt } from "@oh-my-pi/pi-utils";
import { MULTI_BLOCK_TEXT_MESSAGE_TYPE } from "../../session/messages";
import type { BuiltinSlashCommandRuntime, BuiltinSlashCommandSpec } from "../../slash-commands/builtin-registry";
import { toReasoningEffort } from "../../thinking";
import { getTitleModel } from "../../utils/title-generator";
import titleSystemPrompt from "./title-system.md" with { type: "text" };

const GENTITLE_SYSTEM_PROMPT = prompt.render(titleSystemPrompt);
const MAX_CONTEXT_CHARS = 8000;
const MAX_TITLE_TOKENS = 40;

type ContextSlice = {
	context: string;
	approxTokens: number;
	usedChars: number;
	entries: Array<{
		kind: string;
		index: number;
		chars: number;
		truncated: boolean;
	}>;
};

type SupportedContent = TextContent | ImageContent | ThinkingContent | RedactedThinkingContent | ToolCall;

function extractTextContent(content: string | SupportedContent[]): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				typeof block === "object" &&
				block !== null &&
				"type" in block &&
				block.type === "text" &&
				"text" in block &&
				typeof block.text === "string",
		)
		.map(block => block.text)
		.join("\n")
		.trim();
}

function truncateFromEnd(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	if (maxChars <= 1) return text.slice(-maxChars);
	return `…${text.slice(-(maxChars - 1))}`;
}

function collectContextSlice(messages: AgentMessage[]): ContextSlice {
	const collected: Array<{
		kind: string;
		index: number;
		text: string;
		truncated: boolean;
	}> = [];
	let usedChars = 0;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		let kind: string | undefined;
		let text = "";

		switch (message.role) {
			case "user":
				kind = "user-message";
				text = extractTextContent(message.content);
				break;
			case "assistant":
				kind = "assistant-text";
				text = extractTextContent(message.content);
				break;
			case "branchSummary":
				kind = "branch-summary";
				text = message.summary.trim();
				break;
			case "compactionSummary":
				kind = "compaction-summary";
				text = (message.shortSummary ?? message.summary).trim();
				break;
			case "custom":
				if (message.customType !== MULTI_BLOCK_TEXT_MESSAGE_TYPE) {
					continue;
				}
				kind = "multi-block-text";
				text = extractTextContent(message.content);
				break;
			default:
				continue;
		}

		if (!text) continue;

		const remainingChars = MAX_CONTEXT_CHARS - usedChars;
		if (remainingChars <= 0) break;

		const truncatedText = truncateFromEnd(text, remainingChars);
		if (!truncatedText) break;

		collected.push({
			kind,
			index,
			text: truncatedText,
			truncated: truncatedText.length !== text.length,
		});
		usedChars += truncatedText.length;

		if (truncatedText.length !== text.length) break;
	}

	collected.reverse();
	const context = collected.map(entry => `<${entry.kind}>\n${entry.text}\n</${entry.kind}>`).join("\n\n");
	return {
		context,
		usedChars,
		approxTokens: Math.ceil(usedChars / 4),
		entries: collected.map(entry => ({
			kind: entry.kind,
			index: entry.index,
			chars: entry.text.length,
			truncated: entry.truncated,
		})),
	};
}

async function generateSuggestedTitle(
	runtime: BuiltinSlashCommandRuntime,
): Promise<string | null | "NO_MODEL" | "NO_API_KEY"> {
	const contextSlice = collectContextSlice(runtime.ctx.session.messages);
	logger.debug("gentitle: extracted context", {
		entryCount: contextSlice.entries.length,
		usedChars: contextSlice.usedChars,
		approxTokens: contextSlice.approxTokens,
		entries: contextSlice.entries,
		context: contextSlice.context,
	});
	if (!contextSlice.context.trim()) {
		return null;
	}

	const registry = runtime.ctx.session.modelRegistry;
	const currentModel = runtime.ctx.session.model;
	const candidate = getTitleModel(registry, runtime.ctx.settings, currentModel);
	if (!candidate) {
		logger.debug("gentitle: no title model found");
		return "NO_MODEL";
	}

	const apiKey = await registry.getApiKey(candidate.model, runtime.ctx.session.sessionId);
	if (!apiKey) {
		logger.debug("gentitle: no API key for title model", {
			provider: candidate.model.provider,
			id: candidate.model.id,
		});
		return "NO_API_KEY";
	}

	const request = {
		model: `${candidate.model.provider}/${candidate.model.id}`,
		systemPrompt: GENTITLE_SYSTEM_PROMPT,
		approxTokens: contextSlice.approxTokens,
		userMessage: `<session-context>\n${contextSlice.context}\n</session-context>`,
		maxTokens: MAX_TITLE_TOKENS,
	};
	logger.debug("gentitle: request", request);

	const response = await completeSimple(
		candidate.model,
		{
			systemPrompt: [request.systemPrompt],
			messages: [{ role: "user", content: request.userMessage, timestamp: Date.now() }],
		},
		{
			apiKey,
			maxTokens: MAX_TITLE_TOKENS,
			reasoning: toReasoningEffort(candidate.thinkingLevel),
		},
	);

	if (response.stopReason === "error") {
		logger.debug("gentitle: response error", {
			model: request.model,
			stopReason: response.stopReason,
			errorMessage: response.errorMessage,
		});
		throw new Error(response.errorMessage || "Title generation failed");
	}

	const title = response.content
		.flatMap(content => (content.type === "text" ? [content.text] : []))
		.join("")
		.trim()
		.replace(/^["']|["']$/g, "")
		.replace(/[.!?]$/, "");

	logger.debug("gentitle: response", {
		model: request.model,
		title,
		usage: response.usage,
		stopReason: response.stopReason,
	});

	return title || null;
}

export const gentitleSlashCommand: BuiltinSlashCommandSpec = {
	name: "gentitle",
	description: "Suggest a short session title",
	handle: async (_command, runtime) => {
		runtime.ctx.clearEditor();

		try {
			const suggestion = await generateSuggestedTitle(runtime);
			if (suggestion === "NO_MODEL") {
				runtime.ctx.showStatus("No title model available");
				return;
			}
			if (suggestion === "NO_API_KEY") {
				runtime.ctx.showStatus("No title API key available");
				return;
			}
			if (!suggestion) {
				runtime.ctx.showStatus("No recent title context");
				return;
			}

			runtime.ctx.showStatus(suggestion);
		} catch (error) {
			logger.debug("gentitle: error", {
				error: error instanceof Error ? error.message : String(error),
			});
			runtime.ctx.showWarning("Failed to suggest title");
		}
	},
};
