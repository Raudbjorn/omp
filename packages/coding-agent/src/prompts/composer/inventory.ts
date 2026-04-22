/**
 * Builds a structured environment inventory from the data already collected
 * by buildSystemPromptInternal. This is the "machine the harness runs on"
 * description that the compiler uses to understand available capabilities.
 */

export interface InventoryInput {
	/** Tool names and descriptions available this session */
	tools: Array<{ name: string; label: string; description: string }>;
	/** Active edit mode: hashline, patch, or replace */
	editMode: string;
	/** Installed skills with names and descriptions */
	skills: Array<{ name: string; description: string }>;
	/** Workstation environment (OS, terminal, arch, etc.) */
	environment: Array<{ label: string; value: string }>;
	/** Current working directory */
	cwd: string;
	/** Required intent field name for tool calls, when enabled in this session */
	intentField?: string;
}

export function buildInventory(input: InventoryInput): string {
	const sections: string[] = [];

	// Workstation
	sections.push("## Workstation");
	for (const { label, value } of input.environment) {
		sections.push(`- ${label}: ${value}`);
	}
	sections.push(`- Working directory: ${input.cwd}`);

	// Edit mode
	sections.push(`\n## Edit Mode\n\nActive: **${input.editMode}**`);
	sections.push("\n## Tool Call Contract");
	sections.push(
		"- Every response that uses tools MUST emit an array of tool calls, even if the array contains a single call.",
	);
	if (input.intentField) {
		sections.push(
			`- Every tool call MUST include the \`${input.intentField}\` parameter with one concise present-participle sentence.`,
		);
	}

	// Tools — grouped by type
	const builtinTools: typeof input.tools = [];
	const mcpTools: typeof input.tools = [];
	for (const tool of input.tools) {
		// MCP tools have slash-namespaced names or are prefixed with the server name
		if (tool.name.includes("/") || tool.name.startsWith("mcp_")) {
			mcpTools.push(tool);
		} else {
			builtinTools.push(tool);
		}
	}

	sections.push("\n## Built-in Tools");
	for (const tool of builtinTools) {
		sections.push(formatToolEntry(tool));
	}

	if (mcpTools.length > 0) {
		sections.push("\n## MCP Tools (from connected servers)");
		for (const tool of mcpTools) {
			sections.push(formatToolEntry(tool));
		}
	}

	// Skills
	if (input.skills.length > 0) {
		sections.push("\n## Installed Skills");
		for (const { name, description } of input.skills) {
			const desc = description ? ` — ${truncate(description, 100)}` : "";
			sections.push(`- **${name}**${desc}`);
		}
	}

	return sections.join("\n");
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}

function formatToolEntry(tool: { name: string; label: string; description: string }): string {
	const label = tool.label && tool.label !== tool.name ? `**${tool.label}** (\`${tool.name}\`)` : `**${tool.name}**`;
	const desc = tool.description ? ` — ${truncate(tool.description, 120)}` : "";
	return `- ${label}${desc}`;
}
