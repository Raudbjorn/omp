import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import type { CustomTool } from "../src/extensibility/custom-tools/types";
import { applyToolProxy } from "../src/extensibility/tool-proxy";
import { customToolToDefinition } from "../src/sdk";
import { webSearchCustomTool } from "../src/web/search";

function makeCustomTool(overrides: Partial<CustomTool> = {}): CustomTool {
	return {
		name: "demo_tool",
		label: "Demo Tool",
		description: "Demo",
		parameters: Type.Object({}),
		async execute() {
			return { content: [] };
		},
		...overrides,
	} as CustomTool;
}

describe("mergeCallAndResult propagation", () => {
	it("customToolToDefinition forwards mergeCallAndResult to the ToolDefinition", () => {
		const tool = makeCustomTool({ mergeCallAndResult: true });
		const definition = customToolToDefinition(tool);
		expect(definition.mergeCallAndResult).toBe(true);
	});

	it("customToolToDefinition passes through undefined when the flag is omitted", () => {
		const tool = makeCustomTool();
		const definition = customToolToDefinition(tool);
		expect(definition.mergeCallAndResult).toBeUndefined();
	});

	it("applyToolProxy exposes mergeCallAndResult on the wrapper for structural reads", () => {
		const definition = customToolToDefinition(makeCustomTool({ mergeCallAndResult: true }));
		const wrapper = {};
		applyToolProxy(definition, wrapper);
		expect((wrapper as { mergeCallAndResult?: boolean }).mergeCallAndResult).toBe(true);
	});

	it("webSearchCustomTool declares mergeCallAndResult: true", () => {
		expect(webSearchCustomTool.mergeCallAndResult).toBe(true);
	});

	it("webSearchCustomTool survives the full CustomTool -> ToolDefinition -> proxy chain", () => {
		const definition = customToolToDefinition(webSearchCustomTool as unknown as CustomTool);
		expect(definition.mergeCallAndResult).toBe(true);

		const wrapper = {};
		applyToolProxy(definition, wrapper);
		expect((wrapper as { mergeCallAndResult?: boolean }).mergeCallAndResult).toBe(true);
	});
});
