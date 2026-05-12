import type * as schema from "@agentclientprotocol/sdk";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Api,
	Provider,
	TextContent,
	ThinkingContent,
	ToolCall as OmpToolCall,
} from "../../types";

type Span = "none" | "text" | "thinking" | "tool";

export interface EventMappingState {
	api: Api;
	provider: Provider;
	model: string;
}

/**
 * Convert ACP `session/update` notifications into omp `AssistantMessageEvent`s.
 *
 * ACP streams interleaved text/thought/tool chunks. omp's event stream expects
 * well-nested spans (`*_start` → `*_delta*` → `*_end`), so we maintain a tiny
 * state machine that auto-closes the previous span whenever the discriminator
 * changes.
 *
 * The caller feeds one `SessionUpdate` at a time via `push(update)` and
 * receives zero or more omp events back. At end-of-turn, `finish()` closes any
 * still-open span.
 */
export class EventMapper {
	readonly #message: AssistantMessage;
	#currentSpan: Span = "none";
	#toolCalls = new Map<string, { index: number }>();

	constructor(state: EventMappingState) {
		this.#message = {
			role: "assistant",
			content: [],
			api: state.api,
			provider: state.provider,
			model: state.model,
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
	}

	get message(): AssistantMessage {
		return this.#message;
	}

	startEvents(): AssistantMessageEvent[] {
		return [{ type: "start", partial: this.#message }];
	}

	push(update: schema.SessionUpdate): AssistantMessageEvent[] {
		const events: AssistantMessageEvent[] = [];
		switch (update.sessionUpdate) {
			case "user_message_chunk":
				// Dropped — we don't replay the user's own prompt.
				return events;

			case "agent_message_chunk": {
				const text = extractText(update.content);
				if (!text) return events;
				this.#ensureSpan("text", events);
				const idx = this.#lastTextIndex();
				if (idx < 0) return events;
				const block = this.#message.content[idx] as TextContent;
				block.text += text;
				events.push({ type: "text_delta", contentIndex: idx, delta: text, partial: this.#message });
				return events;
			}

			case "agent_thought_chunk": {
				const text = extractText(update.content);
				if (!text) return events;
				this.#ensureSpan("thinking", events);
				const idx = this.#lastThinkingIndex();
				if (idx < 0) return events;
				const block = this.#message.content[idx] as ThinkingContent;
				block.thinking += text;
				events.push({ type: "thinking_delta", contentIndex: idx, delta: text, partial: this.#message });
				return events;
			}

			case "tool_call": {
				// Starting a new tool call closes any open text/thinking span.
				this.#closeSpan(events);
				const omp: OmpToolCall = {
					type: "toolCall",
					id: update.toolCallId,
					name: update.title ?? update.kind ?? update.toolCallId,
					arguments: (update.rawInput as Record<string, unknown> | undefined) ?? {},
				};
				const idx = this.#message.content.length;
				this.#message.content.push(omp);
				this.#toolCalls.set(update.toolCallId, { index: idx });
				this.#currentSpan = "tool";
				events.push({ type: "toolcall_start", contentIndex: idx, partial: this.#message });
				// Emit toolcall_end immediately if the update already has terminal status;
				// otherwise we'll wait for tool_call_update.
				if (update.status === "completed" || update.status === "failed") {
					events.push({ type: "toolcall_end", contentIndex: idx, toolCall: omp, partial: this.#message });
					this.#currentSpan = "none";
				}
				return events;
			}

			case "tool_call_update": {
				const entry = this.#toolCalls.get(update.toolCallId);
				if (!entry) return events; // unknown tool call id — skip
				const block = this.#message.content[entry.index] as OmpToolCall;
				if (update.title) block.name = update.title;
				if (update.rawInput !== undefined) {
					block.arguments = (update.rawInput as Record<string, unknown> | undefined) ?? {};
				}
				if (update.status === "completed" || update.status === "failed") {
					events.push({
						type: "toolcall_end",
						contentIndex: entry.index,
						toolCall: block,
						partial: this.#message,
					});
					if (this.#currentSpan === "tool") this.#currentSpan = "none";
				}
				return events;
			}

			// Informational — metadata only. We don't emit dedicated events.
			case "plan":
			case "available_commands_update":
			case "current_mode_update":
			case "config_option_update":
			case "session_info_update":
			case "usage_update":
				return events;

			default: {
				// Unknown future variants — ignore rather than crash.
				return events;
			}
		}
	}

	/** Close any open span; returns the close events. */
	finish(): AssistantMessageEvent[] {
		const events: AssistantMessageEvent[] = [];
		this.#closeSpan(events);
		return events;
	}

	#ensureSpan(target: "text" | "thinking", out: AssistantMessageEvent[]): void {
		if (this.#currentSpan === target) return;
		this.#closeSpan(out);
		if (target === "text") {
			const block: TextContent = { type: "text", text: "" };
			const idx = this.#message.content.length;
			this.#message.content.push(block);
			this.#currentSpan = "text";
			out.push({ type: "text_start", contentIndex: idx, partial: this.#message });
		} else {
			const block: ThinkingContent = { type: "thinking", thinking: "" };
			const idx = this.#message.content.length;
			this.#message.content.push(block);
			this.#currentSpan = "thinking";
			out.push({ type: "thinking_start", contentIndex: idx, partial: this.#message });
		}
	}

	#closeSpan(out: AssistantMessageEvent[]): void {
		if (this.#currentSpan === "text") {
			const idx = this.#lastTextIndex();
			if (idx >= 0) {
				const block = this.#message.content[idx] as TextContent;
				out.push({ type: "text_end", contentIndex: idx, content: block.text, partial: this.#message });
			}
		} else if (this.#currentSpan === "thinking") {
			const idx = this.#lastThinkingIndex();
			if (idx >= 0) {
				const block = this.#message.content[idx] as ThinkingContent;
				out.push({ type: "thinking_end", contentIndex: idx, content: block.thinking, partial: this.#message });
			}
		}
		this.#currentSpan = "none";
	}

	#lastTextIndex(): number {
		for (let i = this.#message.content.length - 1; i >= 0; i--) {
			const b = this.#message.content[i];
			if (b && b.type === "text") return i;
		}
		return -1;
	}

	#lastThinkingIndex(): number {
		for (let i = this.#message.content.length - 1; i >= 0; i--) {
			const b = this.#message.content[i];
			if (b && b.type === "thinking") return i;
		}
		return -1;
	}
}

function extractText(content: schema.ContentBlock): string {
	if (content.type === "text") return content.text;
	return "";
}
