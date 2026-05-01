/**
 * Pure utility functions extracted from AgentSession for session formatting and stats.
 *
 * These functions are stateless — all dependencies are passed as parameters.
 */

import type { AgentMessage, AgentState, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Model, Usage, UsageReport } from "@oh-my-pi/pi-ai";
import type { CompactionSummaryMessage, FileMentionMessage } from "./messages";
import { calculateContextTokens, estimateTokens, calculatePromptTokens } from "./compaction";
import { getLatestCompactionEntry } from "./session-manager";
import { formatSessionDumpText, type SessionDumpToolInfo } from "./session-dump-format";
import type { SessionManager, SessionEntry } from "./session-manager";
import type { ContextUsage } from "../extensibility/extensions/types";
import type { SessionStats } from "./types";
import { getCurrentThemeName } from "../modes/theme/theme";
import { exportSessionToHtml } from "../export/html";

/**
 * Get session statistics from agent state.
 */
export function getSessionStats(
	state: AgentState,
	sessionFile: string | undefined,
	sessionId: string,
): SessionStats {
	const userMessages = state.messages.filter(m => m.role === "user").length;
	const assistantMessages = state.messages.filter(m => m.role === "assistant").length;
	const toolResults = state.messages.filter(m => m.role === "toolResult").length;

	let toolCalls = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	let totalPremiumRequests = 0;

	const getTaskToolUsage = (details: unknown): Usage | undefined => {
		if (!details || typeof details !== "object") return undefined;
		const record = details as Record<string, unknown>;
		const usage = record.usage;
		if (!usage || typeof usage !== "object") return undefined;
		return usage as Usage;
	};

	for (const message of state.messages) {
		if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;
			toolCalls += assistantMsg.content.filter(c => c.type === "toolCall").length;
			totalInput += assistantMsg.usage.input;
			totalOutput += assistantMsg.usage.output;
			totalCacheRead += assistantMsg.usage.cacheRead;
			totalCacheWrite += assistantMsg.usage.cacheWrite;
			totalPremiumRequests += assistantMsg.usage.premiumRequests ?? 0;
			totalCost += assistantMsg.usage.cost.total;
		}

		if (message.role === "toolResult" && message.toolName === "task") {
			const usage = getTaskToolUsage(message.details);
			if (usage) {
				totalInput += usage.input;
				totalOutput += usage.output;
				totalCacheRead += usage.cacheRead;
				totalCacheWrite += usage.cacheWrite;
				totalPremiumRequests += usage.premiumRequests ?? 0;
				totalCost += usage.cost.total;
			}
		}
	}

	return {
		sessionFile,
		sessionId,
		userMessages,
		assistantMessages,
		toolCalls,
		toolResults,
		totalMessages: state.messages.length,
		tokens: {
			input: totalInput,
			output: totalOutput,
			cacheRead: totalCacheRead,
			cacheWrite: totalCacheWrite,
			total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
		},
		cost: totalCost,
		premiumRequests: totalPremiumRequests,
	};
}

/**
 * Get current context usage statistics.
 * Uses the last assistant message's usage data when available,
 * otherwise estimates tokens for all messages.
 */
export function getContextUsage(
	model: Model | undefined,
	messages: AgentMessage[],
	branchEntries: SessionEntry[],
): ContextUsage | undefined {
	if (!model) return undefined;

	const contextWindow = model.contextWindow ?? 0;
	if (contextWindow <= 0) return undefined;

	// After compaction, the last assistant usage reflects pre-compaction context size.
	// We can only trust usage from an assistant that responded after the latest compaction.
	// If no such assistant exists, context token count is unknown until the next LLM response.
	const latestCompaction = getLatestCompactionEntry(branchEntries);

	if (latestCompaction) {
		// Check if there's a valid assistant usage after the compaction boundary
		const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
		let hasPostCompactionUsage = false;
		for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
			const entry = branchEntries[i];
			if (entry.type === "message" && entry.message.role === "assistant") {
				const assistant = entry.message;
				if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
					const contextTokens = calculateContextTokens(assistant.usage);
					if (contextTokens > 0) {
						hasPostCompactionUsage = true;
					}
					break;
				}
			}
		}

		if (!hasPostCompactionUsage) {
			return { tokens: null, contextWindow, percent: null };
		}
	}

	// Estimate context tokens from messages, using the last assistant usage when available
	let lastUsageIndex: number | null = null;
	let lastUsage: Usage | undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			if (assistantMsg.usage) {
				lastUsage = assistantMsg.usage;
				lastUsageIndex = i;
				break;
			}
		}
	}

	let estimatedTokens: number;
	if (!lastUsage || lastUsageIndex === null) {
		// No usage data — estimate all messages
		estimatedTokens = 0;
		for (const message of messages) {
			estimatedTokens += estimateTokens(message);
		}
	} else {
		const usageTokens = calculatePromptTokens(lastUsage);
		let trailingTokens = 0;
		for (let i = lastUsageIndex + 1; i < messages.length; i++) {
			trailingTokens += estimateTokens(messages[i]);
		}
		estimatedTokens = usageTokens + trailingTokens;
	}

	const percent = (estimatedTokens / contextWindow) * 100;

	return {
		tokens: estimatedTokens,
		contextWindow,
		percent,
	};
}

/**
 * Fetch usage reports from the model registry's auth storage.
 */
export async function fetchUsageReports(
	modelRegistry: {
		authStorage: {
			fetchUsageReports?: (opts: {
				baseUrlResolver?: (provider: string) => string | undefined;
			}) => Promise<UsageReport[] | null>;
		};
		getProviderBaseUrl?: (provider: string) => string | undefined;
	},
): Promise<UsageReport[] | null> {
	const authStorage = modelRegistry.authStorage;
	if (!authStorage.fetchUsageReports) return null;
	return authStorage.fetchUsageReports({
		baseUrlResolver: provider => modelRegistry.getProviderBaseUrl?.(provider),
	});
}

/**
 * Export session to HTML.
 * @param outputPath Optional output path (defaults to session directory)
 * @returns Path to exported file
 */
export async function exportToHtml(
	sessionManager: SessionManager,
	state: AgentState,
	outputPath?: string,
): Promise<string> {
	const themeName = getCurrentThemeName();
	return exportSessionToHtml(sessionManager, state, { outputPath, themeName });
}

/**
 * Get text content of last assistant message.
 * Useful for /copy command.
 * @returns Text content, or undefined if no assistant message exists
 */
export function getLastAssistantText(messages: AgentMessage[]): string | undefined {
	const lastAssistant = messages
		.slice()
		.reverse()
		.find(m => {
			if (m.role !== "assistant") return false;
			const msg = m as AssistantMessage;
			// Skip aborted messages with no content
			if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
			return true;
		});

	if (!lastAssistant) return undefined;

	let text = "";
	for (const content of (lastAssistant as AssistantMessage).content) {
		if (content.type === "text") {
			text += content.text;
		}
	}

	return text.trim() || undefined;
}

/**
 * Format the entire session as plain text for clipboard export.
 * Includes user messages, assistant text, thinking blocks, tool calls, and tool results.
 */
export function formatSessionAsText(
	messages: AgentMessage[],
	systemPrompt: string | null | undefined,
	model: Model | null | undefined,
	thinkingLevel: ThinkingLevel | string | null | undefined,
	tools: readonly SessionDumpToolInfo[] | null | undefined,
): string {
	return formatSessionDumpText({
		messages,
		systemPrompt,
		model,
		thinkingLevel,
		tools: tools ?? undefined,
	});
}

/**
 * Format the conversation as compact context for subagents.
 * Includes only user messages and assistant text responses.
 * Excludes: system prompt, tool definitions, tool calls/results, thinking blocks.
 */
export function formatCompactContext(messages: AgentMessage[]): string {
	const lines: string[] = [];
	lines.push("# Conversation Context");
	lines.push("");
	lines.push(
		"This is a summary of the parent conversation. Read this if you need additional context about what was discussed or decided.",
	);
	lines.push("");

	for (const msg of messages) {
		if (msg.role === "user" || msg.role === "developer") {
			lines.push(msg.role === "developer" ? "## Developer" : "## User");
			lines.push("");
			if (typeof msg.content === "string") {
				lines.push(msg.content);
			} else {
				for (const c of msg.content) {
					if (c.type === "text") {
						lines.push(c.text);
					} else if (c.type === "image") {
						lines.push("[Image attached]");
					}
				}
			}
			lines.push("");
		} else if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			// Only include text content, skip tool calls and thinking
			const textParts: string[] = [];
			for (const c of assistantMsg.content) {
				if (c.type === "text" && c.text.trim()) {
					textParts.push(c.text);
				}
			}
			if (textParts.length > 0) {
				lines.push("## Assistant");
				lines.push("");
				lines.push(textParts.join("\n\n"));
				lines.push("");
			}
		} else if (msg.role === "fileMention") {
			const fileMsg = msg as FileMentionMessage;
			const paths = fileMsg.files.map(f => f.path).join(", ");
			lines.push(`[Files referenced: ${paths}]`);
			lines.push("");
		} else if (msg.role === "compactionSummary") {
			const compactMsg = msg as CompactionSummaryMessage;
			lines.push("## Earlier Context (Summarized)");
			lines.push("");
			lines.push(compactMsg.summary);
			lines.push("");
		}
		// Skip: toolResult, bashExecution, pythonExecution, branchSummary, custom, hookMessage
	}

	return lines.join("\n").trim();
}
