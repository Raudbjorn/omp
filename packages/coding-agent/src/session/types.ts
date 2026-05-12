import type {
	AgentEvent,
	AgentMessage,
	ThinkingLevel,
} from "@oh-my-pi/pi-agent-core";
import type {
	ImageContent,
	MessageAttribution,
	Model,
	ServiceTier,
	TextContent,
	ToolChoice,
} from "@oh-my-pi/pi-ai";
import type { AsyncJob } from "../async";
import type { Rule } from "../capability/rule";
import type { TodoItem } from "../tools/todo-write";
import type { CustomMessage } from "./messages";
import type { CompactionResult } from "./compaction";

// ============================================================================
// Shared session types
// ============================================================================

export const CURRENT_SESSION_VERSION = 3;

// -- Core Entries ------------------------------------------------------------

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	title?: string;
	titleSource?: "auto" | "user";
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface NewSessionOptions {
	parentSession?: string;
	drop?: boolean;
}

export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel?: string | null;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	model: string;
	role?: string;
}

export interface ServiceTierChangeEntry extends SessionEntryBase {
	type: "service_tier_change";
	serviceTier: ServiceTier | null;
}

export interface CompactionEntry<T = unknown> extends SessionEntryBase {
	type: "compaction";
	summary: string;
	shortSummary?: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	preserveData?: Record<string, unknown>;
	fromExtension?: boolean;
}

export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	details?: T;
	fromExtension?: boolean;
}

export interface CustomEntry<T = unknown> extends SessionEntryBase {
	type: "custom";
	customType: string;
	data?: T;
}

export interface LabelEntry extends SessionEntryBase {
	type: "label";
	targetId: string;
	label: string | undefined;
}

export interface TtsrInjectionEntry extends SessionEntryBase {
	type: "ttsr_injection";
	injectedRules: string[];
}

export interface MCPToolSelectionEntry extends SessionEntryBase {
	type: "mcp_tool_selection";
	selectedToolNames: string[];
}

export interface SessionInitEntry extends SessionEntryBase {
	type: "session_init";
	systemPrompt: string;
	task: string;
	tools: string[];
	outputSchema?: unknown;
}

export interface ModeChangeEntry extends SessionEntryBase {
	type: "mode_change";
	mode: string;
	data?: Record<string, unknown>;
}

export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: T;
	display: boolean;
	attribution?: MessageAttribution;
}

// -- Unions & Derived Types --------------------------------------------------

export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| ServiceTierChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| TtsrInjectionEntry
	| MCPToolSelectionEntry
	| SessionInitEntry
	| ModeChangeEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
	label?: string;
}

export interface SessionContext {
	messages: AgentMessage[];
	thinkingLevel?: string;
	serviceTier?: ServiceTier;
	models: Record<string, string>;
	injectedTtsrRules: string[];
	selectedMCPToolNames: string[];
	hasPersistedMCPToolSelection: boolean;
	mode: string;
	modeData?: Record<string, unknown>;
}

export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	title?: string;
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	size: number;
	firstMessage: string;
	allMessagesText: string;
}

export interface UsageStatistics {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	premiumRequests: number;
	cost: number;
}

export interface ResolvedSessionMatch {
	session: SessionInfo;
	scope: "local" | "global";
}

// -- AgentSession Types ------------------------------------------------------

export type AgentSessionEvent =
	| AgentEvent
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" | "idle"; action: "context-full" | "handoff" }
	| {
			type: "auto_compaction_end";
			action: "context-full" | "handoff";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
			skipped?: boolean;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "retry_fallback_applied"; from: string; to: string; role: string }
	| { type: "retry_fallback_succeeded"; model: string; role: string }
	| { type: "ttsr_triggered"; rules: Rule[] }
	| { type: "todo_reminder"; todos: TodoItem[]; attempt: number; maxAttempts: number }
	| { type: "todo_auto_clear" }
	| { type: "irc_message"; message: CustomMessage };

export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

export type AsyncJobSnapshotItem = Pick<AsyncJob, "id" | "type" | "status" | "label" | "startTime">;

export interface AsyncJobSnapshot {
	running: AsyncJobSnapshotItem[];
	recent: AsyncJobSnapshotItem[];
}

// -- Prompt & Model Results --------------------------------------------------

export interface PromptOptions {
	expandPromptTemplates?: boolean;
	images?: ImageContent[];
	streamingBehavior?: "steer" | "followUp";
	toolChoice?: ToolChoice;
	synthetic?: boolean;
	attribution?: MessageAttribution;
	skipCompactionCheck?: boolean;
}

export interface ModelCycleResult {
	model: Model;
	thinkingLevel: ThinkingLevel | undefined;
	isScoped: boolean;
}

export interface RoleModelCycleResult {
	model: Model;
	thinkingLevel: ThinkingLevel | undefined;
	role: string;
}

export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	premiumRequests: number;
	cost: number;
}

export interface HandoffResult {
	document: string;
	savedPath?: string;
}
