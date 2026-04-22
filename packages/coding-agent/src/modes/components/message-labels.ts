import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import {
	MULTI_BLOCK_COMMAND_MESSAGE_TYPE,
	MULTI_BLOCK_TEXT_MESSAGE_TYPE,
	SKILL_PROMPT_MESSAGE_TYPE,
	type SkillPromptDetails,
} from "../../session/messages";

export interface CustomMessageLike {
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: unknown;
}

function extractCustomMessageText(content: CustomMessageLike["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((part): part is TextContent => part.type === "text")
		.map(part => part.text)
		.join("\n");
}

function normalizePreview(text: string): string {
	return text.replace(/[\n\t]+/g, " ").trim();
}

function buildSkillCommand(details: SkillPromptDetails | undefined): string {
	const name = details?.name?.trim() || "unknown";
	const args = details?.args?.trim();
	return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}

export function getCustomMessageLabel(message: CustomMessageLike): string | undefined {
	switch (message.customType) {
		case SKILL_PROMPT_MESSAGE_TYPE:
			return buildSkillCommand(message.details as SkillPromptDetails | undefined);
		case MULTI_BLOCK_TEXT_MESSAGE_TYPE:
			return "message";
		case MULTI_BLOCK_COMMAND_MESSAGE_TYPE:
			return "command";
		default:
			return undefined;
	}
}

export function formatCustomMessageSummary(message: CustomMessageLike): string {
	const preview = normalizePreview(extractCustomMessageText(message.content));
	switch (message.customType) {
		case SKILL_PROMPT_MESSAGE_TYPE:
			return getCustomMessageLabel(message) ?? "skill";
		case MULTI_BLOCK_TEXT_MESSAGE_TYPE:
			return preview ? `message: ${preview}` : "message";
		case MULTI_BLOCK_COMMAND_MESSAGE_TYPE: {
			const command =
				typeof message.details === "object" &&
				message.details !== null &&
				"command" in message.details &&
				typeof message.details.command === "string"
					? message.details.command
					: preview;
			return command ? `command: ${command}` : "command";
		}
		default:
			return preview ? `[${message.customType}]: ${preview}` : `[${message.customType}]`;
	}
}
