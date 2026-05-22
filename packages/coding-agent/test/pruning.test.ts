import { describe, expect, it } from "bun:test";
import { DEFAULT_PRUNE_CONFIG, pruneToolOutputs } from "@oh-my-pi/pi-agent-core/compaction/pruning";
import type { ToolResultMessage } from "@oh-my-pi/pi-ai";

type ToolResultEntry = {
	type: "message";
	id: string;
	parentId: null;
	timestamp: string;
	message: ToolResultMessage;
};

function createToolResultEntry(id: string, toolName: string, text: string, timestamp: number): ToolResultEntry {
	const message: ToolResultMessage = {
		role: "toolResult",
		toolCallId: `${id}-call`,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp,
	};

	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(timestamp).toISOString(),
		message,
	};
}

describe("DEFAULT_PRUNE_CONFIG", () => {
	it("protects read and skill outputs from pruning", () => {
		const output = "x".repeat(1_000);
		const readEntry = createToolResultEntry("read-entry", "read", output, 1);
		const skillEntry = createToolResultEntry("skill-entry", "skill", output, 2);
		const entries = [readEntry, skillEntry];

		const result = pruneToolOutputs(entries as Parameters<typeof pruneToolOutputs>[0], {
			...DEFAULT_PRUNE_CONFIG,
			protectTokens: 0,
			minimumSavings: 0,
		});
		const protectedReadMessage = readEntry.message as ToolResultMessage;
		const protectedSkillMessage = skillEntry.message as ToolResultMessage;

		expect(result.prunedCount).toBe(0);
		expect(result.tokensSaved).toBe(0);
		expect(protectedReadMessage.content).toEqual([{ type: "text", text: output }]);
		expect(protectedSkillMessage.content).toEqual([{ type: "text", text: output }]);
	});
});
