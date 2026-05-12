/**
 * InspectorPanel - Detail view for selected extension.
 *
 * Shows name, description, origin, status, and kind-specific preview.
 */
import * as os from "node:os";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import { theme } from "../../../modes/theme/theme";
import { shortenPath } from "../../../tools/render-utils";
import type { Extension } from "./types";

export class InspectorPanel implements Component {
	#extension: Extension | null = null;
	#previewScrollOffset = 0;
	#maxHeight = 20;
	#previewBudget = 0;
	#fullPreviewLength = 0;
	#projectPath: string | null = null;

	setExtension(extension: Extension | null): void {
		this.#extension = extension;
		this.#previewScrollOffset = 0;
	}

	setMaxHeight(h: number): void {
		this.#maxHeight = h;
	}

	setProjectPath(path: string): void {
		this.#projectPath = path;
	}

	scrollPreview(delta: number): void {
		const hasOverflow = this.#fullPreviewLength > this.#previewBudget;
		const visibleCount = hasOverflow ? Math.max(0, this.#previewBudget - 1) : this.#previewBudget;
		const maxOff = Math.max(0, this.#fullPreviewLength - visibleCount);
		this.#previewScrollOffset = Math.max(0, Math.min(maxOff, this.#previewScrollOffset + delta));
	}

	invalidate(): void {}

	/** Header: name, status, action hints, description, origin. */
	renderHeader(width: number): string[] {
		if (!this.#extension) {
			return [theme.fg("muted", "Select an extension"), theme.fg("dim", "to view details")];
		}

		const ext = this.#extension;
		const headerLines: string[] = [];

		// Name
		headerLines.push(theme.bold(theme.fg("accent", ext.displayName)));

		// Inline kind + status (no labels)
		const kindBadge = this.#getKindBadge(ext.kind);
		const statusParts = this.#getStatusLines(ext);
		headerLines.push(`${kindBadge}  ${statusParts[0]}`);
		for (let i = 1; i < statusParts.length; i++) {
			headerLines.push(`  ${statusParts[i]}`);
		}

		// Action hints — always show descriptions, wrap to two lines if needed
		if (ext.source.level === "native") {
			headerLines.push(theme.fg("dim", "  (native \u2014 read-only)"));
		} else if (ext.kind === "context-file") {
			headerLines.push(theme.fg("dim", "  D: delete  M: move  E: edit"));
		} else if (width < 44) {
			headerLines.push(theme.fg("dim", "  D: delete  M: move"));
			headerLines.push(theme.fg("dim", "  N: rename  E: edit"));
		} else {
			headerLines.push(theme.fg("dim", "  D: delete  M: move  N: rename  E: edit"));
		}
		headerLines.push("");

		// Description
		const desc = ext.description;
		const isValidDescription = typeof desc === "string" && desc.length > 0;
		if (isValidDescription && width > 2) {
			const wrapped = wrapTextWithAnsi(desc, width - 2);
			for (const line of wrapped) {
				headerLines.push(truncateToWidth(line, width));
			}
			headerLines.push("");
		} else if (isValidDescription) {
			headerLines.push(truncateToWidth(desc, width));
			headerLines.push("");
		}

		// Origin
		headerLines.push(theme.fg("muted", "Origin:"));
		const levelLabel = ext.source.level === "user" ? "User" : ext.source.level === "project" ? "Project" : "Native";
		headerLines.push(`  ${theme.italic(`via ${ext.source.providerName} (${levelLabel})`)}`);
		const shortened = shortenPath(ext.path, os.homedir());
		const displayPath =
			shortened.length > 40 && shortened.split("/").length > 3
				? `.../${shortened.split("/").slice(-3).join("/")}`
				: shortened;
		headerLines.push(`  ${theme.fg("dim", displayPath)}`);
		headerLines.push("");

		return headerLines;
	}

	/** Scrollable preview/instruction content. */
	renderContent(width: number, maxLines: number): string[] {
		if (!this.#extension) return [];
		const ext = this.#extension;

		const previewLines = this.#renderPreview(ext, width);
		this.#fullPreviewLength = previewLines.length;
		this.#previewBudget = maxLines;

		const hasOverflow = previewLines.length > maxLines;
		const visibleCount = hasOverflow ? Math.max(0, maxLines - 1) : maxLines;

		// Clamp scroll offset
		const maxOff = Math.max(0, previewLines.length - visibleCount);
		this.#previewScrollOffset = Math.min(this.#previewScrollOffset, maxOff);

		const visiblePreview = previewLines.slice(this.#previewScrollOffset, this.#previewScrollOffset + visibleCount);

		const lines = [...visiblePreview];

		// Scroll hint
		if (hasOverflow && maxLines > 0) {
			lines.push(
				theme.fg("dim", `(PgUp/PgDn to scroll \u2014 ${this.#previewScrollOffset + 1}/${previewLines.length})`),
			);
		}

		return lines;
	}

	render(width: number): string[] {
		const header = this.renderHeader(width);
		const contentBudget = Math.max(0, this.#maxHeight - header.length);
		const content = this.renderContent(width, contentBudget);
		return [...header, ...content];
	}

	#renderPreview(ext: Extension, width: number): string[] {
		const lines: string[] = [];
		let content: string[] = [];

		switch (ext.kind) {
			case "context-file":
				content = this.#renderFilePreview(ext.raw, width);
				break;
			case "tool":
				content = this.#renderToolArgs(ext.raw, width);
				break;
			case "skill":
				content = this.#renderSkillContent(ext.raw, width);
				break;
			case "mcp":
				content = this.#renderMcpDetails(ext.raw, width);
				break;
			case "slash-command":
			case "prompt":
				content = this.#renderCommandContent(ext.raw, width);
				break;
			default:
				content = this.#renderDefaultPreview(ext, width);
				break;
		}

		if (content.length > 0) {
			lines.push(...content);
		}

		return lines;
	}

	#renderFilePreview(raw: unknown, width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("muted", "Preview:"));
		lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));

		const content = this.#getContextFileContent(raw);
		if (!content) {
			lines.push(theme.fg("dim", "  (no content)"));
			lines.push("");
			return lines;
		}

		const fileLines = content.split("\n");
		for (const line of fileLines) {
			const highlighted = this.#highlightMarkdown(line);
			lines.push(truncateToWidth(highlighted, width - 2));
		}

		lines.push("");
		return lines;
	}

	#getContextFileContent(raw: unknown): string | null {
		if (raw && typeof raw === "object" && "content" in raw) {
			const content = (raw as { content?: unknown }).content;
			return typeof content === "string" ? content : null;
		}
		return null;
	}

	#highlightMarkdown(line: string): string {
		// Basic markdown syntax highlighting
		let highlighted = line;

		// Headers
		if (/^#{1,6}\s/.test(highlighted)) {
			highlighted = theme.bold(theme.fg("accent", highlighted));
		}
		// Code blocks
		else if (/^```/.test(highlighted)) {
			highlighted = theme.fg("dim", highlighted);
		}
		// Lists
		else if (/^[\s]*[-*+]\s/.test(highlighted)) {
			highlighted = highlighted.replace(/^([\s]*[-*+]\s)/, theme.fg("accent", "$1"));
		}
		// Numbered lists
		else if (/^[\s]*\d+\.\s/.test(highlighted)) {
			highlighted = highlighted.replace(/^([\s]*\d+\.\s)/, theme.fg("accent", "$1"));
		}

		return highlighted;
	}

	#renderToolArgs(raw: unknown, width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("muted", "Arguments:"));
		lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));

		try {
			const tool = raw as any;
			const params = tool?.parameters?.properties || tool?.inputSchema?.properties || {};

			if (Object.keys(params).length === 0) {
				lines.push(theme.fg("dim", "  (no arguments)"));
			} else {
				const required = new Set(tool?.parameters?.required || tool?.inputSchema?.required || []);

				for (const [name, spec] of Object.entries(params)) {
					const param = spec as any;
					const type = param.type || "any";
					const isRequired = required.has(name);
					const defaultVal = param.default !== undefined ? `Default: ${param.default}` : null;

					const nameCol = theme.fg("accent", name.padEnd(12));
					const typeCol = theme.fg("muted", type.padEnd(10));
					const reqCol = isRequired
						? theme.fg("warning", "Required")
						: defaultVal
							? theme.fg("dim", defaultVal)
							: theme.fg("dim", "Optional");

					lines.push(`  ${nameCol} ${typeCol} ${reqCol}`);
				}
			}
		} catch {
			lines.push(theme.fg("dim", "  (unable to parse tool definition)"));
		}

		lines.push("");
		return lines;
	}

	#renderSkillContent(raw: unknown, width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("muted", "Instruction:"));
		lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));

		try {
			const skill = raw as any;
			const instruction = skill?.prompt || skill?.instruction || skill?.content || "";

			if (!instruction) {
				lines.push(theme.fg("dim", "  (no instruction text)"));
			} else {
				const instructionLines = instruction.split("\n");
				for (const line of instructionLines) {
					lines.push(truncateToWidth(line, width - 2));
				}
			}
		} catch {
			lines.push(theme.fg("dim", "  (unable to parse skill content)"));
		}

		lines.push("");
		return lines;
	}

	#renderCommandContent(raw: unknown, width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("muted", "Content:"));
		lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));

		const content =
			raw && typeof raw === "object" && "content" in raw ? (raw as { content?: string }).content : undefined;

		if (!content) {
			lines.push(theme.fg("dim", "  (no content)"));
			lines.push("");
			return lines;
		}

		const contentLines = content.split("\n");
		for (const line of contentLines) {
			const highlighted = this.#highlightMarkdown(line);
			lines.push(truncateToWidth(highlighted, width - 2));
		}

		lines.push("");
		return lines;
	}

	#renderMcpDetails(raw: unknown, width: number): string[] {
		const lines: string[] = [];
		lines.push(theme.fg("muted", "Connection:"));
		lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));

		try {
			const mcp = raw as any;
			const transport = mcp?.transport || mcp?.type || "unknown";
			const command = mcp?.command || mcp?.cmd || "";
			const args = mcp?.args || mcp?.arguments || [];

			lines.push(`  ${theme.fg("muted", "Transport:")}  ${theme.fg("accent", transport)}`);

			if (command) {
				lines.push(`  ${theme.fg("muted", "Command:")}    ${theme.fg("success", command)}`);
			}

			if (Array.isArray(args) && args.length > 0) {
				lines.push(`  ${theme.fg("muted", "Args:")}       ${theme.fg("dim", args.join(" "))}`);
			}

			if (mcp?.url) {
				lines.push(`  ${theme.fg("muted", "URL:")}        ${theme.fg("accent", mcp.url)}`);
			}

			if (mcp?.timeout != null) {
				const seconds = Math.round(mcp.timeout / 1000);
				lines.push(`  ${theme.fg("muted", "Timeout:")}    ${theme.fg("dim", `${seconds}s`)}`);
			}

			if (mcp?.auth?.type) {
				const authLabel = mcp.auth.type === "oauth" ? "OAuth" : "API Key";
				lines.push(`  ${theme.fg("muted", "Auth:")}       ${theme.fg("dim", authLabel)}`);
			}

			// Environment variables if present
			if (mcp?.env && typeof mcp.env === "object") {
				const envCount = Object.keys(mcp.env).length;
				if (envCount > 0) {
					lines.push(`  ${theme.fg("muted", "Env vars:")}   ${theme.fg("dim", `${envCount} defined`)}`);
				}
			}

			if (typeof mcp?._toolCount === "number") {
				lines.push(`  ${theme.fg("muted", "Tools:")}      ${theme.fg("dim", `${mcp._toolCount} registered`)}`);
			}

			// Server instructions (from MCP initialize response)
			if (typeof mcp?._instructions === "string" && mcp._instructions.trim()) {
				lines.push("");
				lines.push(theme.fg("muted", "Instructions:"));
				lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));
				for (const line of mcp._instructions.split("\n")) {
					const highlighted = this.#highlightMarkdown(line);
					lines.push(truncateToWidth(highlighted, width - 2));
				}
			}
		} catch {
			lines.push(theme.fg("dim", "  (unable to parse MCP configuration)"));
		}

		lines.push("");
		return lines;
	}

	#renderDefaultPreview(ext: Extension, width: number): string[] {
		const lines: string[] = [];

		// Show trigger pattern if present
		if (ext.trigger) {
			lines.push(theme.fg("muted", "Trigger:"));
			lines.push(theme.fg("dim", theme.boxSharp.horizontal.repeat(Math.min(width - 2, 40))));
			lines.push(`  ${theme.fg("accent", ext.trigger)}`);
			lines.push("");
		}

		return lines;
	}

	#getKindBadge(kind: string): string {
		const kindColors: Record<string, string> = {
			"extension-module": "accent",
			skill: "accent",
			rule: "success",
			tool: "warning",
			mcp: "accent",
			prompt: "muted",
			hook: "warning",
			"context-file": "dim",
			instruction: "muted",
			"slash-command": "accent",
		};

		const color = kindColors[kind] || "muted";
		return theme.fg(color as any, kind);
	}

	#getStatusLines(ext: Extension): string[] {
		if (ext.state === "shadowed") {
			return [
				theme.fg("warning", `${theme.status.shadowed} Shadowed${ext.shadowedBy ? ` by ${ext.shadowedBy}` : ""}`),
			];
		}

		const parts: string[] = [];

		if (ext.state === "active" && !ext.isGlobalDisabled && !ext.isProjectDisabled) {
			parts.push(theme.fg("success", `${theme.status.enabled} Active`));
		}
		if (ext.isGlobalDisabled) {
			parts.push(theme.fg("error", `${theme.status.disabled} Disabled globally`));
		}
		if (ext.isProjectDisabled) {
			parts.push(theme.fg("warning", `${theme.status.disabled} Disabled for this project`));
		}

		// Restriction status - always check regardless of disabled state
		if (ext.isRestricted && ext.restrictedToProject) {
			if (ext.restrictedToProject === this.#projectPath) {
				parts.push(theme.fg("warning", `${theme.status.restricted} Restricted to this project`));
			} else {
				const shortened = shortenPath(ext.restrictedToProject, os.homedir());
				parts.push(theme.fg("warning", `${theme.status.restricted} Restricted to: ${shortened}`));
			}
		}

		if (parts.length > 0) return parts;

		// Provider disabled or other
		if (ext.disabledReason === "provider-disabled") {
			return [theme.fg("dim", `${theme.status.disabled} Disabled (provider disabled)`)];
		}

		return [theme.fg("dim", `${theme.status.disabled} Disabled`)];
	}
}
