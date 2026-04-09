import { describe, expect, it } from "bun:test";
import type { ToolResultMessage } from "@oh-my-pi/pi-ai";
import { DEFAULT_PRUNE_CONFIG, pruneToolOutputs } from "../src/session/compaction/pruning";

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
	it("allows read tool outputs to be pruned while keeping skill outputs protected", () => {
		const largeOutput = "x".repeat(220_000);
		const readEntry = createToolResultEntry("read-entry", "read", largeOutput, 1);
		const skillEntry = createToolResultEntry("skill-entry", "skill", largeOutput, 2);
		const entries = [readEntry, skillEntry];

		const result = pruneToolOutputs(entries as Parameters<typeof pruneToolOutputs>[0], DEFAULT_PRUNE_CONFIG);
		const prunedReadMessage = readEntry.message as ToolResultMessage;
		const protectedSkillMessage = skillEntry.message as ToolResultMessage;

		expect(result.prunedCount).toBe(1);
		expect(result.tokensSaved).toBeGreaterThan(0);
		expect(prunedReadMessage.content).toEqual([{ type: "text", text: `[Output truncated - 55000 tokens]` }]);
		expect(protectedSkillMessage.content).toEqual([{ type: "text", text: largeOutput }]);
	});
});
