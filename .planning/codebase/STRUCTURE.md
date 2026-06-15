# Project Structure

**Analysis Date:** 2026-03-19

## Root Layout

```
oh-oh-my-pi/
├── AGENTS.md                    # Project context for AI assistants (fork's context assembly guide)
├── package.json                 # Workspace root (Bun monorepo)
├── bun.lock                     # Bun lockfile
├── tsconfig.json                # Root TypeScript config
├── biome.json                   # Biome formatter/linter config
├── Cargo.toml                   # Rust workspace root
├── Cargo.lock                   # Rust dependency lockfile
├── docs/
│   └── adr/                     # Architecture Decision Records
│       ├── 0001-constrained-fork-strategy.md
│       ├── 0002-rpc-compatibility-contract.md
│       ├── 0003-tiered-memory-locator-map.md
│       └── 0004-tool-result-assembly-bridge.md
├── packages/                    # TypeScript packages (Bun workspace)
│   ├── coding-agent/            # Primary CLI package
│   ├── agent/                   # Agent runtime core
│   ├── ai/                      # LLM provider abstraction
│   ├── tui/                     # Terminal UI components
│   ├── stats/                   # Usage statistics & telemetry
│   ├── utils/                   # Shared utilities
│   └── natives/                 # Bun FFI bridge to Rust crate
├── crates/
│   └── pi-natives/              # Rust native addon (performance-critical ops)
├── .planning/                   # Planning and analysis documents
└── .oh-omp/                     # Local project config (gitignored)
```

## Package: coding-agent (primary)

**Path:** `packages/coding-agent/`
**Package name:** `@oh-my-pi/pi-coding-agent`

This is the main package containing the CLI, session orchestration, tool implementations, context assembly, and all extensibility systems.

```
packages/coding-agent/src/
├── main.ts                      # Process entry point (bootstraps CLI)
├── cli.ts                       # CLI argument parsing & command routing
├── sdk.ts                       # Programmatic SDK: init(), start(), capability wiring
├── index.ts                     # Barrel export for SDK consumers
├── system-prompt.ts             # System prompt assembly from all sources
├── config.ts                    # Configuration management
├── config/                      # Configuration subsystem
├── cli/                         # CLI subcommand implementations
├── commands/                    # Built-in command handlers
├── modes/                       # Runtime modes
│   ├── index.ts                 # Mode selection
│   ├── interactive-mode.ts      # Terminal REPL mode
│   ├── print-mode.ts            # Single-prompt non-interactive mode
│   └── rpc/                     # RPC/IDE protocol mode
│       └── compatibility-contract.ts  # Upstream wire-protocol compat (ADR 0002)
├── session/                     # Session management
│   ├── agent-session.ts         # AgentSession class (main orchestrator)
│   └── session-manager.ts       # Session persistence (save/resume/list)
├── tools/                       # Built-in tool implementations
│   └── index.ts                 # Tool registration barrel
├── context/                     # Context assembly pipeline (fork addition)
│   ├── memory-contract.ts       # MemoryContractV1 types (3-tier memory model)
│   ├── assembler/               # Context assembly kernel
│   │   ├── index.ts             # Assembler orchestration
│   │   ├── types.ts             # Assembly types & budgets
│   │   └── message-transform.ts # Turn segmentation, hot window, stub replacement
│   ├── bridge/                  # Tool-result-to-memory bridge
│   │   ├── bridge.ts            # ToolResultBridge class (ADR 0004)
│   │   ├── classify.ts          # Tool result classification
│   │   └── types.ts             # Bridge configuration types
│   └── recall/                  # Cross-session memory retrieval
│       └── index.ts             # Recall search API
├── context-manager/             # Context manager mode selection (ADR 0003)
│   └── index.ts                 # Single context manager mode
├── capability/                  # Capability registry pattern
│   └── index.ts                 # Registry + provider types + loader
├── discovery/                   # Capability discovery (public API)
│   └── index.ts                 # Re-exports capability system
├── extensibility/               # Extension system
│   ├── extensions/              # Extension loading & execution
│   │   ├── types.ts             # Extension manifest & interfaces
│   │   ├── loader.ts            # Extension discovery & loading
│   │   └── runner.ts            # Extension lifecycle management
│   ├── hooks/                   # Lifecycle hook system
│   ├── custom-tools/            # User-defined tool loading
│   ├── custom-commands/         # User-defined command loading
│   └── plugins/                 # Plugin subsystem
├── mcp/                         # Model Context Protocol integration
│   └── tool-bridge.ts           # MCP tool namespace bridging
├── internal-urls/               # Custom protocol URL system
│   └── router.ts                # URL protocol routing (skill://, rule://, etc.)
├── slash-commands/              # Built-in slash command implementations
├── plan-mode/                   # Plan mode (structured planning)
├── task/                        # Task execution subsystem
├── tasks/                       # Task definitions
├── exec/                        # Command execution helpers
├── export/                      # Session/conversation export
├── lsp/                         # Language Server Protocol integration
├── patch/                       # Patch/diff application
├── commit/                      # Git commit helpers
├── prompts/                     # Prompt templates
├── memories/                    # Memory persistence
├── debug/                       # Debug/diagnostic utilities
├── secrets/                     # Secret detection
├── ssh/                         # SSH connection support
├── stt/                         # Speech-to-text
├── web/                         # Web search integration
├── exa/                         # Exa search integration
├── ipy/                         # Interactive Python
├── tui/                         # TUI rendering helpers (coding-agent specific)
├── async/                       # Async utilities
├── utils/                       # Package-specific utilities
├── thinking.ts                  # Thinking/reasoning display
├── cursor.ts                    # Cursor management
├── release-metadata.ts          # Version/release info
├── priority.json                # Tool priority configuration
└── bun-imports.d.ts             # Bun-specific type declarations
```

## Package: agent

**Path:** `packages/agent/`
**Package name:** `@oh-my-pi/pi-agent-core`

Core agent runtime. Contains the LLM interaction loop with no knowledge of tools, UI, or extensions.

```
packages/agent/src/
├── index.ts          # Barrel export
├── agent.ts          # Agent class: processMessages(), configuration
├── agent-loop.ts     # Inner loop: LLM call → tool dispatch → iterate
└── types.ts          # AgentMessage, ToolDefinition, AgentConfig, ToolResult
```

**Key exports:**
- `Agent` class
- `AgentMessage` union type (`UserMessage | AssistantMessage | ToolResultMessage`)
- `ToolDefinition` interface
- `AgentConfig` interface

## Package: ai

**Path:** `packages/ai/`
**Package name:** `@oh-my-pi/pi-ai`

LLM provider abstraction layer. Handles streaming, auth, model discovery, rate limiting.

```
packages/ai/src/
├── index.ts                  # Barrel export (re-exports everything)
├── types.ts                  # Core types: stream params, content blocks, messages
├── stream.ts                 # Streaming response handling
├── models.ts                 # Model registry (names, context windows, pricing)
├── model-manager.ts          # Model selection & configuration
├── model-cache.ts            # Model metadata caching
├── model-thinking.ts         # Extended thinking configuration
├── api-registry.ts           # API endpoint registry
├── auth-storage.ts           # API key/token storage
├── provider-details.ts       # Provider metadata
├── provider-models.ts        # Per-provider model listings
├── rate-limit-utils.ts       # Rate limit handling
├── providers/                # Provider implementations
│   ├── anthropic.ts          # Claude (Anthropic API)
│   ├── openai-responses.ts   # OpenAI Responses API
│   ├── openai-completions.ts # OpenAI Completions API
│   ├── google.ts             # Google Gemini
│   ├── google-vertex.ts      # Google Vertex AI
│   ├── google-gemini-cli.ts  # Gemini CLI integration
│   ├── azure-openai-responses.ts  # Azure OpenAI
│   ├── cursor.ts             # Cursor
│   ├── gitlab-duo.ts         # GitLab Duo
│   ├── kimi.ts               # Kimi/Moonshot
│   └── synthetic.ts          # Deterministic test provider
├── usage/                    # Token usage tracking per provider
│   ├── claude.ts
│   ├── gemini.ts
│   ├── github-copilot.ts
│   ├── google-antigravity.ts
│   ├── kimi.ts
│   ├── minimax-code.ts
│   ├── openai-codex.ts
│   └── zai.ts
└── utils/                    # Provider utilities
    ├── anthropic-auth.ts     # Anthropic auth helpers
    ├── discovery.ts          # Provider discovery
    ├── event-stream.ts       # SSE parsing
    ├── oauth.ts              # OAuth flow
    ├── overflow.ts           # Context overflow handling
    ├── retry.ts              # Retry logic
    ├── schema.ts             # JSON Schema utilities
    └── validation.ts         # Input validation
```

## Package: tui

**Path:** `packages/tui/`
**Package name:** `@oh-my-pi/pi-tui`

Terminal UI framework. Handles raw stdin/stdout, key bindings, autocomplete, terminal capabilities.

```
packages/tui/src/
├── index.ts                  # Barrel export
├── tui.ts                    # Main TUI class
├── terminal.ts               # Terminal abstraction (raw mode, dimensions)
├── terminal-capabilities.ts  # Terminal feature detection
├── keybindings.ts            # Key binding definitions
├── keys.ts                   # Key code parsing
├── autocomplete.ts           # Autocomplete engine
├── bracketed-paste.ts        # Bracketed paste handling
├── fuzzy.ts                  # Fuzzy matching
├── kill-ring.ts              # Kill ring (clipboard history)
├── stdin-buffer.ts           # Raw stdin buffering
├── ttyid.ts                  # TTY identification
├── editor-component.ts       # Inline editor widget
├── symbols.ts                # Unicode symbol constants
├── utils.ts                  # TUI utilities
└── components/               # UI components (spinners, prompts, etc.)
```

## Package: natives / pi-natives

**TypeScript bridge:** `packages/natives/`
**Package name:** `@oh-my-pi/pi-natives`

**Rust crate:** `crates/pi-natives/`

Native performance-critical operations via Bun FFI. The TypeScript package provides a JS interface to the compiled Rust shared library.

```
packages/natives/
├── src/
│   └── index.ts              # FFI bindings to Rust crate
└── package.json

crates/pi-natives/
├── Cargo.toml
└── src/
    ├── lib.rs                # Crate root (FFI exports)
    └── ...                   # Native implementations
```

**Use cases:** File I/O acceleration, glob matching, or other hot-path operations that benefit from native speed.

## Package: utils

**Path:** `packages/utils/`
**Package name:** `@oh-my-pi/pi-utils`

Shared utility functions used by all other packages.

```
packages/utils/src/
├── index.ts              # Barrel export
├── logger.ts             # Logger singleton (used across all packages)
├── ...                   # String utils, path helpers, async helpers, etc.
```

## Package: stats

**Path:** `packages/stats/`
**Package name:** `@oh-my-pi/pi-stats`

Usage statistics collection and reporting. Runs an embedded client/server model for aggregating session metrics.

```
packages/stats/src/
├── index.ts                          # Barrel export
├── types.ts                          # Stat event types
├── aggregator.ts                     # Metric aggregation
├── parser.ts                         # Stat data parsing
├── db.ts                             # Persistent storage
├── server.ts                         # Stats collection server
├── client/                           # Stats client SDK
└── embedded-client.generated.txt     # Generated client code
```

## Key File Locations

### Entry Points
- `packages/coding-agent/src/main.ts` — Process entry, CLI bootstrap
- `packages/coding-agent/src/cli.ts` — CLI argument parsing
- `packages/coding-agent/src/sdk.ts` — Programmatic SDK init
- `packages/coding-agent/src/index.ts` — Public API barrel

### Configuration
- `package.json` — Workspace root
- `tsconfig.json` — TypeScript config
- `biome.json` — Linter/formatter
- `Cargo.toml` — Rust workspace
- `packages/coding-agent/src/config.ts` — Runtime config
- `packages/coding-agent/src/config/` — Config subsystem
- `packages/coding-agent/src/priority.json` — Tool priority ordering

### Core Logic
- `packages/agent/src/agent.ts` — Agent runtime
- `packages/agent/src/agent-loop.ts` — LLM interaction loop
- `packages/coding-agent/src/session/agent-session.ts` — Session orchestrator
- `packages/coding-agent/src/system-prompt.ts` — Prompt assembly
- `packages/coding-agent/src/context/assembler/message-transform.ts` — Context compression
- `packages/coding-agent/src/context/bridge/bridge.ts` — Memory bridge

### Tool Implementations
- `packages/coding-agent/src/tools/` — All built-in tools (read, write, bash, grep, etc.)

### Extension System
- `packages/coding-agent/src/extensibility/extensions/types.ts` — Extension interfaces
- `packages/coding-agent/src/extensibility/extensions/loader.ts` — Extension loading
- `packages/coding-agent/src/capability/index.ts` — Capability registry

### Architecture Docs
- `AGENTS.md` — Project context and conventions
- `docs/adr/` — Architecture decision records

## Naming Conventions

### Files

| Pattern | Example | Usage |
|---------|---------|-------|
| `kebab-case.ts` | `agent-loop.ts`, `memory-contract.ts` | All source files |
| `index.ts` | `packages/agent/src/index.ts` | Barrel exports per directory/package |
| `types.ts` | `packages/agent/src/types.ts` | Type definitions (co-located with implementation) |
| `*.test.ts` | `message-transform.test.ts` | Test files (co-located with source) |
| `*.generated.txt` | `embedded-client.generated.txt` | Generated artifacts |

### Directories

| Pattern | Example | Usage |
|---------|---------|-------|
| `kebab-case/` | `context-manager/`, `internal-urls/` | Feature/subsystem directories |
| `src/` | `packages/*/src/` | Source root in every package |
| `providers/` | `packages/ai/src/providers/` | Implementation variants |
| `utils/` | `packages/ai/src/utils/` | Per-package utility modules |
| `components/` | `packages/tui/src/components/` | UI component modules |

### Packages

| Convention | Example |
|-----------|---------|
| `@oh-my-pi/pi-*` | `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-ai` |
| Directory name matches npm name suffix | `packages/agent/` → `@oh-my-pi/pi-agent-core` |

### Barrel Exports

Every package has an `index.ts` barrel at `packages/*/src/index.ts`. Subdirectories within `coding-agent` also use `index.ts` barrels for clean imports.

**Import pattern:**
```typescript
import { Agent, AgentMessage } from "@oh-my-pi/pi-agent-core";
import { logger } from "@oh-my-pi/pi-utils";
import type { MemoryContractV1 } from "../context/memory-contract";
```

Internal imports within `coding-agent` use relative paths. Cross-package imports use the `@oh-my-pi/pi-*` package names.

## Where to Add New Code

**New tool:**
- Implementation: `packages/coding-agent/src/tools/`
- Register in tool barrel: `packages/coding-agent/src/tools/index.ts`

**New LLM provider:**
- Implementation: `packages/ai/src/providers/`
- Usage tracker: `packages/ai/src/usage/`
- Register in barrel: `packages/ai/src/index.ts`

**New extension capability:**
- Type: `packages/coding-agent/src/extensibility/extensions/types.ts`
- Capability definition: `packages/coding-agent/src/capability/`
- Loader: `packages/coding-agent/src/extensibility/`

**New CLI command:**
- Implementation: `packages/coding-agent/src/cli/` or `packages/coding-agent/src/commands/`

**New context feature:**
- Memory contract types: `packages/coding-agent/src/context/memory-contract.ts`
- Assembly logic: `packages/coding-agent/src/context/assembler/`
- Bridge logic: `packages/coding-agent/src/context/bridge/`

**New slash command:**
- Implementation: `packages/coding-agent/src/slash-commands/`

**Shared utility:**
- Cross-package: `packages/utils/src/`
- Package-specific: `packages/<pkg>/src/utils/`

---

*Structure analysis: 2026-03-19*
