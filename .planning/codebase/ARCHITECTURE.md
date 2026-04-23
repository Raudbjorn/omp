# Architecture

**Analysis Date:** 2026-03-19

## Overview

oh-oh-my-pi (a fork of oh-omp, branded "Oh My Pi") is a terminal-native AI coding agent built as a **Bun/TypeScript monorepo** with a Rust native-addon crate. The architecture follows a **layered plugin-oriented design**:

- A thin **CLI shell** (`packages/coding-agent`) wires together an **agent runtime** (`packages/agent`), an **LLM provider abstraction** (`packages/ai`), a **TUI** (`packages/tui`), and **native bindings** (`packages/natives` + `crates/pi-natives`).
- The fork's primary architectural addition is a **context assembly pipeline** that transforms and compresses conversation history to fit within LLM context windows, driven by a memory contract and tool-result bridge (ADR 0004).
- An **extensibility system** loads capabilities (extensions, skills, rules, MCP servers, slash commands, custom tools) from filesystem providers at multiple scopes (project, user, global).

**Key ADRs:**
- `docs/adr/0001-constrained-fork-strategy.md` — Fork strategy: minimize upstream diff, add features via new files, prefer composition over modification.
- `docs/adr/0002-rpc-compatibility-contract.md` — RPC compatibility with upstream protocol for IDE/TUI clients.
- `docs/adr/0003-tiered-memory-locator-map.md` — Memory locator map design: working, short-term, and long-term tiers.
- `docs/adr/0004-tool-result-assembly-bridge.md` — Tool result bridge that observes tool executions and populates memory contract for context assembly.

## Package Dependency Graph

```
                     coding-agent (CLI + orchestration)
                    /      |       \        \
                   /       |        \        \
               agent      ai       tui     stats
                |          |
              (core      (LLM
              runtime)   providers)
                \        /
                 \      /
                  utils
                    |
                  natives (Bun FFI → pi-natives Rust crate)
```

**Dependency direction (imports flow down):**

| Package | Depends On | Depended On By |
|---------|-----------|----------------|
| `@oh-my-pi/pi-coding-agent` | agent, ai, tui, stats, utils, natives | (CLI binary) |
| `@oh-my-pi/pi-agent-core` | ai, utils | coding-agent |
| `@oh-my-pi/pi-ai` | utils | coding-agent, agent |
| `@oh-my-pi/pi-tui` | utils | coding-agent |
| `@oh-my-pi/pi-stats` | utils | coding-agent |
| `@oh-my-pi/pi-utils` | natives | all packages |
| `@oh-my-pi/pi-natives` | (Rust FFI) | utils |

## Core Abstractions

### Agent Runtime (`packages/agent/`)

**`Agent`** (`packages/agent/src/agent.ts`):
Core orchestrator class. Accepts an `AgentConfig` with provider, tools, system prompt, and event handlers. Exposes `processMessages(messages, options)` which triggers the agent loop.

**`agentLoop()`** (`packages/agent/src/agent-loop.ts`):
The inner loop that sends messages to the LLM, processes tool calls from the response, executes tools, and iterates until the model stops requesting tool use. Each iteration:
1. Calls the AI provider with current messages + tools
2. Streams the response, collecting content blocks and tool_use requests
3. For each tool_use block, calls the registered tool handler
4. Appends tool_result messages and loops back to step 1

**`AgentMessage`** (`packages/agent/src/types.ts`):
Union type representing all message roles in the conversation: `user`, `assistant`, `toolResult`. Each has a `content` field (text, tool_use blocks, tool_result blocks).

**`ToolDefinition`** (`packages/agent/src/types.ts`):
Describes a tool the agent can call: `name`, `description`, `inputSchema` (JSON Schema), and optional metadata like `isReadOnly`.

### Session Management (`packages/coding-agent/src/session/`)

**`AgentSession`** (`packages/coding-agent/src/session/agent-session.ts`):
High-level session wrapper. Manages conversation state, context assembly, tool registration, MCP connections, and the event loop for a single user session. Orchestrates the interplay between the agent runtime, context manager, and UI.

**`SessionManager`** (`packages/coding-agent/src/session/session-manager.ts`):
Handles session persistence (save/resume), session file I/O, and session listing.

### AI Provider Abstraction (`packages/ai/`)

**Provider interface** (`packages/ai/src/types.ts`):
Defines `createStream(params)` for streaming LLM completions. Each provider implements this for its API (Anthropic, OpenAI, Google, Azure, etc.).

**Supported providers** (each in `packages/ai/src/providers/`):
- `anthropic.ts` — Claude models via Anthropic API
- `openai-responses.ts`, `openai-completions.ts` — OpenAI models
- `google.ts`, `google-vertex.ts`, `google-gemini-cli.ts` — Google Gemini models
- `azure-openai-responses.ts` — Azure OpenAI
- `cursor.ts` — Cursor integration
- `gitlab-duo.ts` — GitLab Duo
- `kimi.ts` — Kimi/Moonshot
- `synthetic.ts` — Deterministic provider for testing

**Model management** (`packages/ai/src/model-manager.ts`, `packages/ai/src/models.ts`):
Model registry, context window sizes, pricing, capability metadata.

### Capability/Discovery System (`packages/coding-agent/src/capability/`, `packages/coding-agent/src/discovery/`)

**Capability Registry** (`packages/coding-agent/src/capability/index.ts`):
Central registry pattern. Capabilities are named categories of loadable items (e.g., `"extension"`, `"skill"`, `"rule"`, `"mcp-server"`). Providers are filesystem-based scanners scoped to project, user, or global directories. The registry:
1. Defines capabilities (what to look for)
2. Registers providers (where to find it)
3. Loads items for a capability across all providers

**Provider scopes:**
- **Project** — `.oh-omp/` or `.pi/` in the project root
- **User** — `~/.oh-omp/` or `~/.config/oh-omp/`
- **Global** — System-wide defaults

**Discovery** (`packages/coding-agent/src/discovery/index.ts`):
Re-exports all capability types and the registry API. Acts as the public interface for the capability system.

### Context Assembly Pipeline (fork addition)

**Context Manager** (`packages/coding-agent/src/context-manager/`):
Determines the mode of context processing. The "single context manager mode" (ADR 0003) uses one unified pipeline rather than multiple competing context strategies.

**Memory Contract** (`packages/coding-agent/src/context/memory-contract.ts`):
Defines `MemoryContractV1` — a structured document with three tiers:
- **Working memory** — Current turn state (subgoal, hypotheses, active paths)
- **Short-term memory** — Session-scoped records (touched paths, symbols, unresolved loops)
- **Long-term memory** — Persistent knowledge (not yet heavily populated)
- **Locator map** — Array of `MemoryLocatorEntry` pointing to tool results by key, with retrieval methods and freshness metadata

**Tool Result Bridge** (`packages/coding-agent/src/context/bridge/bridge.ts`):
`ToolResultBridge` class (ADR 0004). Observes `AgentSessionEvent` stream and:
1. Classifies each tool result (read, grep, write, bash, etc.) into categories
2. Generates `MemoryLocatorEntry` records in the memory contract
3. Tracks touched paths and symbols in short-term memory
4. Invalidates stale entries when file edits occur
5. Provides composite retriever for the assembler

**Message Transform** (`packages/coding-agent/src/context/assembler/message-transform.ts`):
Core of context compression. Implements:
- **Turn segmentation** — Groups flat message arrays into logical turns
- **Hot window** — Recent N turns (default 3) are kept verbatim
- **Stub replacement** — Older tool_result content is replaced with compact `[ref:toolName:target]` stubs
- **Budget bounding** — Drops oldest turns to fit within token budget
- **Decision metadata** — Returns `TurnDecision[]` for observability

**Assembler** (`packages/coding-agent/src/context/assembler/index.ts`):
Orchestrates the full assembly pipeline: budget derivation, message transformation, stub resolution.

## Data Flow

### User Input to LLM Response

```
User types message (stdin or RPC)
  → Mode handler (interactive-mode.ts / rpc/)
    → AgentSession.processUserMessage()
      → Context assembly (if context-manager active):
        1. ToolResultBridge.rebuildWorkingMemory()
        2. deriveBudget() computes token allocations
        3. transformMessages() stubs old tool results
      → Agent.processMessages(assembledMessages, tools)
        → agentLoop():
          → AI provider.createStream(messages, tools)
          → Stream response blocks
          → For each tool_use: execute tool handler
          → Append tool_result messages
          → Loop until no more tool_use
      → Stream events back to UI
```

### Tool Execution Flow

```
LLM emits tool_use block { name, input }
  → Agent dispatches to registered tool handler
    → Tool implementation (packages/coding-agent/src/tools/*.ts)
      → Read/Write/Bash/Grep/etc.
      → Returns ToolResult { content, isError }
    → ToolResultBridge observes result:
      → Classifies result category
      → Creates MemoryLocatorEntry
      → Updates short-term memory (touched paths/symbols)
  → tool_result message appended to conversation
  → Agent loops back to LLM with updated history
```

### Context Assembly Flow (per turn)

```
Before sending to LLM:
  1. Compute fixed costs (system prompt tokens + tool definition tokens)
  2. deriveBudget() → allocatable tokens for messages
  3. segmentTurns() → group messages into logical turns
  4. Apply hot window (keep last N turns verbatim)
  5. For older turns:
     a. Replace tool_result content with stub pointers
     b. Resolve stub text via bridge.getToolResultStubPointer()
  6. Drop oldest turns if still over budget
  7. Return transformed messages + TurnDecision[] metadata
```

## Extension System

### Architecture

The extensibility system (`packages/coding-agent/src/extensibility/`) loads and manages user-defined extensions:

**Extension Types** (`packages/coding-agent/src/extensibility/extensions/types.ts`):
An `Extension` has a manifest (name, version, description) and can provide:
- Custom tools
- Slash commands
- System prompt additions
- MCP server configurations
- Hooks (lifecycle callbacks)

**Extension Loader** (`packages/coding-agent/src/extensibility/extensions/loader.ts`):
Discovers and loads extensions from the capability registry (project/user/global scopes).

**Extension Runner** (`packages/coding-agent/src/extensibility/extensions/runner.ts`):
Executes extension lifecycle hooks and manages extension state during a session.

### Capability Items

| Item Type | Source File | Description |
|-----------|-----------|-------------|
| Extension | `packages/coding-agent/src/capability/extension.ts` | Full extension bundles |
| Skill | `packages/coding-agent/src/capability/skill.ts` | Markdown knowledge packs with frontmatter |
| Rule | `packages/coding-agent/src/capability/rule.ts` | Constraints/guidelines injected into system prompt |
| MCP Server | `packages/coding-agent/src/capability/mcp.ts` | Model Context Protocol server configs |
| Slash Command | `packages/coding-agent/src/capability/slash-command.ts` | User-invokable `/commands` |
| Custom Tool | `packages/coding-agent/src/capability/tool.ts` | Additional tools for the agent |
| Context File | `packages/coding-agent/src/capability/context-file.ts` | Files loaded into system prompt context |
| System Prompt | `packages/coding-agent/src/capability/system-prompt.ts` | System prompt fragments |
| Hook | `packages/coding-agent/src/capability/hook.ts` | Lifecycle event handlers |

### Hooks System (`packages/coding-agent/src/extensibility/hooks/`)

Provides lifecycle hooks for extensions to tap into:
- Session start/end
- Turn start/end
- Tool execution pre/post

### Custom Commands (`packages/coding-agent/src/extensibility/custom-commands/`)

User-defined commands loaded from the capability system.

### Custom Tools (`packages/coding-agent/src/extensibility/custom-tools/`)

User-defined tools loaded as extensions to the built-in tool set.

## Event Protocol

### RPC Mode (`packages/coding-agent/src/modes/rpc/`)

The agent supports an RPC protocol for IDE integration:
- **Compatibility Contract** (`packages/coding-agent/src/modes/rpc/compatibility-contract.ts`): Ensures wire-protocol compatibility with upstream oh-omp for IDE clients (ADR 0002).
- Messages are JSON-RPC over stdin/stdout.
- Events stream from agent to client in real-time.

### Session Events

`AgentSession` emits events consumed by both the TUI and the context bridge:
- Tool execution results (consumed by `ToolResultBridge`)
- Assistant message chunks (streamed to UI)
- Error events
- Status updates (thinking, executing, idle)

### Interactive Mode (`packages/coding-agent/src/modes/interactive-mode.ts`)

Terminal REPL mode:
1. Reads user input from TUI
2. Handles slash commands (`/help`, `/clear`, `/compact`, etc.)
3. Delegates to `AgentSession` for LLM interaction
4. Renders streaming responses via TUI

### Print Mode (`packages/coding-agent/src/modes/print-mode.ts`)

Non-interactive mode for piped/scripted usage. Processes a single prompt and outputs the result.

## Context Management (fork-specific)

### Internal URL System (`packages/coding-agent/src/internal-urls/`)

Custom protocol URLs (`skill://`, `rule://`, `memory://`, `pi://`, `agent://`, `artifact://`, `local://`, `jobs://`) that resolve to internal resources:

**URL Router** (`packages/coding-agent/src/internal-urls/router.ts`):
Routes protocol URLs to appropriate handlers. Used by tools (read, bash) to resolve virtual paths to actual content.

### MCP Integration (`packages/coding-agent/src/mcp/`)

Model Context Protocol client implementation:
- Discovers MCP servers from capability registry
- Launches server processes (stdio transport)
- Bridges MCP tools into agent tool namespace with prefixed names (`serverName/toolName`)
- Manages server lifecycle (connect, disconnect, reconnect)

### Recall System (`packages/coding-agent/src/context/recall/`)

Cross-session memory retrieval. Searches past session history for relevant context, decisions, and file reads.

### System Prompt Assembly (`packages/coding-agent/src/system-prompt.ts`)

Constructs the full system prompt from:
1. Base system prompt template
2. Context files (from capability registry)
3. Rules (loaded rules injected as constraints)
4. Skills (markdown knowledge packs)
5. Extension-provided prompt fragments
6. Dynamic context (working directory, date, platform info)

## Entry Points

**CLI Binary:**
- `packages/coding-agent/src/main.ts` — Process entry point. Bootstraps the CLI.
- `packages/coding-agent/src/cli.ts` — CLI argument parsing and command routing (using Commander or similar).
- `packages/coding-agent/src/cli/` — CLI subcommand implementations.

**SDK:**
- `packages/coding-agent/src/sdk.ts` — Programmatic API. Initializes the capability registry, loads providers, creates an `AgentSession`, and exposes `init()` / `start()` functions.

**Package Barrel:**
- `packages/coding-agent/src/index.ts` — Public API exports for the SDK.

**Modes (runtime entry points):**
- `packages/coding-agent/src/modes/interactive-mode.ts` — Terminal REPL
- `packages/coding-agent/src/modes/print-mode.ts` — Single-prompt execution
- `packages/coding-agent/src/modes/rpc/` — IDE/RPC protocol handler

---

*Architecture analysis: 2026-03-19*
