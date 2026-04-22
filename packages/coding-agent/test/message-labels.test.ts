import { beforeAll, describe, expect, it } from "bun:test";
import { formatCustomMessageSummary, getCustomMessageLabel } from "../src/modes/components/message-labels";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("message label helpers", () => {
	it("formats skill prompts using authored command identity", () => {
		const message = {
			customType: "skill-prompt",
			content: "Skill body",
			details: { name: "demo", args: "--fast", path: "/tmp/demo.md", lineCount: 1 },
		};

		expect(getCustomMessageLabel(message)).toBe("/skill:demo --fast");
		expect(formatCustomMessageSummary(message)).toBe("/skill:demo --fast");
	});

	it("formats multi-block text as authored message previews", () => {
		const message = {
			customType: "multi-block-text",
			content: "Line one\nLine two",
		};

		expect(getCustomMessageLabel(message)).toBe("message");
		expect(formatCustomMessageSummary(message)).toBe("message: Line one Line two");
	});
});
