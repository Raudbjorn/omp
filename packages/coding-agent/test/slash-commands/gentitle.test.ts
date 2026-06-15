import { afterEach, describe, expect, it, vi } from "bun:test";
import * as ai from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { MULTI_BLOCK_TEXT_MESSAGE_TYPE } from "../../src/session/messages";
import {
	BUILTIN_SLASH_COMMAND_DEFS,
	executeBuiltinSlashCommand,
	isBuiltinSlashCommandName,
} from "../../src/slash-commands/builtin-registry";

function getModelOrThrow(id: string) {
	const model = getBundledModel("anthropic", id);
	if (!model) throw new Error(`Expected model ${id}`);
	return model;
}

function createSettings(modelRoles: Record<string, string>) {
	return {
		getModelRole(role: string) {
			return modelRoles[role];
		},
		getStorage() {
			return undefined;
		},
	} as never;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("/gentitle slash command", () => {
	it("is registered as a builtin slash command", () => {
		expect(isBuiltinSlashCommandName("gentitle")).toBe(true);
		expect(BUILTIN_SLASH_COMMAND_DEFS).toContainEqual(
			expect.objectContaining({
				name: "gentitle",
				description: "Suggest a short session title",
			}),
		);
	});

	it("suggests a non-mutating title from recent titleish context", async () => {
		const model = getModelOrThrow("claude-sonnet-4-5");
		const completeSimpleMock = vi.spyOn(ai, "completeSimple").mockResolvedValue({
			stopReason: "end_turn",
			content: [{ type: "text", text: "Wire gentitle command" }],
		} as never);
		const showStatus = vi.fn();
		const showWarning = vi.fn();
		const clearEditor = vi.fn();
		const setSessionName = vi.fn();
		const getApiKey = vi.fn(async () => "test-key");

		const handled = await executeBuiltinSlashCommand("/gentitle", {
			ctx: {
				showStatus,
				showWarning,
				clearEditor,
				settings: createSettings({
					default: `${model.provider}/${model.id}:high`,
					smol: "pi/default:low",
				}),
				session: {
					model,
					sessionId: "session-123",
					modelRegistry: {
						getAvailable: () => [model],
						getApiKey,
					},
					messages: [
						{ role: "user", content: "Need a native /gentitle slash command" },
						{
							role: "assistant",
							content: [
								{ type: "thinking", thinking: "private reasoning should be ignored" },
								{ type: "text", text: "Implement a fork-local command without mutating metadata." },
								{ type: "toolCall", toolName: "read", arguments: { path: "x" }, toolCallId: "1" },
							],
						},
						{ role: "branchSummary", summary: "Branch explores builtin slash-command seams." },
						{
							role: "compactionSummary",
							summary: "Long summary that should be ignored in favor of the short one.",
							shortSummary: "Keep output transient in the status area.",
						},
						{
							role: "custom",
							customType: MULTI_BLOCK_TEXT_MESSAGE_TYPE,
							content: [{ type: "text", text: "Verify builtin autocomplete/help recognition." }],
							display: true,
							timestamp: Date.now(),
						},
						{
							role: "custom",
							customType: "multi-block-command",
							content: [{ type: "text", text: "This custom command text should be ignored." }],
							display: true,
							timestamp: Date.now(),
						},
					],
					sessionManager: { setSessionName },
				},
			} as never,
			handleBackgroundCommand: () => {},
		});

		expect(handled).toBe(true);
		expect(clearEditor).toHaveBeenCalledTimes(1);
		expect(showStatus).toHaveBeenCalledWith("Wire gentitle command");
		expect(showWarning).not.toHaveBeenCalled();
		expect(setSessionName).not.toHaveBeenCalled();
		expect(getApiKey).toHaveBeenCalledWith(model, "session-123");

		const request = completeSimpleMock.mock.calls[0]?.[1];
		expect(request?.messages[0]?.content).toContain("Need a native /gentitle slash command");
		expect(request?.messages[0]?.content).toContain("Implement a fork-local command without mutating metadata.");
		expect(request?.messages[0]?.content).toContain("Branch explores builtin slash-command seams.");
		expect(request?.messages[0]?.content).toContain("Keep output transient in the status area.");
		expect(request?.messages[0]?.content).toContain("Verify builtin autocomplete/help recognition.");
		expect(request?.messages[0]?.content).not.toContain("private reasoning should be ignored");
		expect(request?.messages[0]?.content).not.toContain("This custom command text should be ignored.");
	});

	it("shows a fallback status when no titleish context exists", async () => {
		const completeSimpleMock = vi.spyOn(ai, "completeSimple");
		const showStatus = vi.fn();
		const showWarning = vi.fn();
		const clearEditor = vi.fn();

		const handled = await executeBuiltinSlashCommand("/gentitle", {
			ctx: {
				showStatus,
				showWarning,
				clearEditor,
				settings: createSettings({}),
				session: {
					model: undefined,
					sessionId: "session-456",
					modelRegistry: {
						getAvailable: () => [],
						getApiKey: async () => undefined,
					},
					messages: [{ role: "custom", customType: "multi-block-command", content: "ignored", display: true }],
				},
			} as never,
			handleBackgroundCommand: () => {},
		});

		expect(handled).toBe(true);
		expect(clearEditor).toHaveBeenCalledTimes(1);
		expect(showStatus).toHaveBeenCalledWith("No recent title context");
		expect(showWarning).not.toHaveBeenCalled();
		expect(completeSimpleMock).not.toHaveBeenCalled();
	});
});
