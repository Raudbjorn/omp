import { describe, expect, it } from "bun:test";
import type { ToolResultMessage } from "@oh-my-pi/pi-ai";
import { findLastTextToolResultForCopy } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";

describe("findLastTextToolResultForCopy", () => {
	it("returns exact multiline tool text without rendered whitespace or terminal controls", () => {
		const result = findLastTextToolResultForCopy([
			{
				role: "toolResult",
				toolCallId: "older",
				toolName: "read",
				content: [{ type: "text", text: "old" }],
				isError: false,
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "latest",
				toolName: "read",
				content: [
					{
						type: "text",
						text: "const value = `line one\\nline two`;\n\treturn value;\n\x1b]133;A\x07kept literal payload",
					},
				],
				isError: false,
				timestamp: 2,
			},
		] satisfies ToolResultMessage[]);

		expect(result).toEqual({
			toolName: "read",
			text: "const value = `line one\\nline two`;\n\treturn value;\n\x1b]133;A\x07kept literal payload",
		});
	});

	it("skips image-only tool results", () => {
		const result = findLastTextToolResultForCopy([
			{
				role: "toolResult",
				toolCallId: "text",
				toolName: "bash",
				content: [{ type: "text", text: "stdout\nstderr" }],
				isError: false,
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "image",
				toolName: "inspect_image",
				content: [{ type: "image", data: "abc", mimeType: "image/png" }],
				isError: false,
				timestamp: 2,
			},
		] satisfies ToolResultMessage[]);

		expect(result).toEqual({ toolName: "bash", text: "stdout\nstderr" });
	});
});
