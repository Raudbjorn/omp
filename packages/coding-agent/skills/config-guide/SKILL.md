---
name: config-guide
description: Complete reference for Oh My Pi configuration, settings, and config file formats.
---

# Oh My Pi Configuration Guide

This guide covers every config surface in Oh My Pi: the settings schema, CLI commands, MCP servers, LSP setup, keybindings, and config file hierarchy.

## Config File Hierarchy

Config files are resolved in priority order (highest first). Later values override earlier ones.

**User-level directories:**
1. `~/.omp/agent/` (highest)
2. `~/.claude/`
3. `~/.codex/`
4. `~/.gemini/`

**Project-level directories:**
1. `.omp/` (highest)
2. `.claude/`
3. `.codex/`
4. `.gemini/`

**Important rules:**
- The active config directory is determined by the nearest config dir walking up from `cwd`.
- Project-level configs override user-level configs.
- `.omp` takes precedence over `.claude`, `.codex`, and `.gemini`.
- Settings are stored in `config.yml` (or `config.yaml` / `config.json` with auto-migration from JSON to YAML).

## Settings (config.yml)

Settings are the single source of truth for agent behavior. Use `omp config set <key> <value>` to change values — never edit `config.yml` manually while the agent is running.

### Appearance

- **theme.dark** (string, default: `"titanium"`)
  - *Dark Theme* — Theme used when terminal has dark background

- **theme.light** (string, default: `"light"`)
  - *Light Theme* — Theme used when terminal has light background

- **symbolPreset** (enum, default: `"unicode"`)
  - *Symbol Preset* — Icon/symbol style

- **colorBlindMode** (boolean, default: `false`)
  - *Color-Blind Mode* — Use blue instead of green for diff additions

- **statusLine.preset** (enum, default: `"default"`)
  - *Status Line Preset* — Pre-built status line configurations

- **statusLine.separator** (enum, default: `"powerline-thin"`)
  - *Status Line Separator* — Style of separators between segments

- **statusLine.sessionAccent** (boolean, default: `true`)
  - *Session Accent* — Use the session name color for the editor border and status line gap

- **statusLine.showHookStatus** (boolean, default: `true`)
  - *Show Hook Status* — Display hook status messages below status line

- **terminal.showImages** (boolean, default: `true`)
  - *Show Inline Images* — Render images inline in terminal

- **images.autoResize** (boolean, default: `true`)
  - *Auto-Resize Images* — Resize large images to 2000x2000 max for better model compatibility

- **images.blockImages** (boolean, default: `false`)
  - *Block Images* — Prevent images from being sent to LLM providers

- **display.showTokenUsage** (boolean, default: `false`)
  - *Show Token Usage* — Show per-turn token usage on assistant messages

- **showHardwareCursor** (boolean, default: `true`)
  - *Show Hardware Cursor* — Show terminal cursor for IME support

- **clearOnShrink** (boolean, default: `false`)
  - *Clear on Shrink* — Clear empty rows when content shrinks (may cause flicker)

### Model

- **defaultThinkingLevel** (enum, default: `"high"`)
  - *Thinking Level* — Reasoning depth for thinking-capable models

- **hideThinkingBlock** (boolean, default: `false`)
  - *Hide Thinking Blocks* — Hide thinking blocks in assistant responses

- **repeatToolDescriptions** (boolean, default: `false`)
  - *Repeat Tool Descriptions* — Render full tool descriptions in the system prompt instead of a tool name list

- **temperature** (number, default: `-1`)
  - *Temperature* — Sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)

- **topP** (number, default: `-1`)
  - *Top P* — Nucleus sampling cutoff (0-1, -1 = provider default)

- **topK** (number, default: `-1`)
  - *Top K* — Sample from top-K tokens (-1 = provider default)

- **minP** (number, default: `-1`)
  - *Min P* — Minimum probability threshold (0-1, -1 = provider default)

- **presencePenalty** (number, default: `-1`)
  - *Presence Penalty* — Penalty for introducing already-present tokens (-1 = provider default)

- **repetitionPenalty** (number, default: `-1`)
  - *Repetition Penalty* — Penalty for repeated tokens (-1 = provider default)

- **serviceTier** (enum, default: `"none"`)
  - *Service Tier* — OpenAI processing priority (none = omit parameter)

- **retry.maxRetries** (number, default: `3`)
  - *Retry Attempts* — Maximum retry attempts on API errors

- **retry.fallbackRevertPolicy** (enum, default: `"cooldown-expiry"`)
  - *Fallback Revert Policy* — When to return to the primary model after a fallback

### Interaction

- **autoResume** (boolean, default: `false`)
  - *Auto Resume* — Automatically resume the most recent session in the current directory

- **steeringMode** (enum, default: `"one-at-a-time"`)
  - *Steering Mode* — How to process queued messages while agent is working

- **followUpMode** (enum, default: `"one-at-a-time"`)
  - *Follow-Up Mode* — How to drain follow-up messages after a turn completes

- **interruptMode** (enum, default: `"immediate"`)
  - *Interrupt Mode* — When steering messages interrupt tool execution

- **loop.mode** (enum, default: `"prompt"`)
  - *Loop Mode* — What happens between /loop iterations before re-submitting the prompt

- **doubleEscapeAction** (enum, default: `"tree"`)
  - *Double-Escape Action* — Action when pressing Escape twice with empty editor

- **treeFilterMode** (enum, default: `"default"`)
  - *Session Tree Filter* — Default filter mode when opening the session tree

- **autocompleteMaxVisible** (number, default: `5`)
  - *Autocomplete Items* — Max visible items in autocomplete dropdown (3-20)

- **startup.quiet** (boolean, default: `false`)
  - *Quiet Startup* — Skip welcome screen and startup status messages

- **startup.checkUpdate** (boolean, default: `true`)
  - *Check for Updates* — If false, skip update check

- **collapseChangelog** (boolean, default: `false`)
  - *Collapse Changelog* — Show condensed changelog after updates

- **completion.notify** (enum, default: `"on"`)
  - *Completion Notification* — Notify when the agent completes

- **ask.timeout** (number, default: `30`)
  - *Ask Timeout* — Auto-select recommended option after timeout (0 to disable)

- **ask.notify** (enum, default: `"on"`)
  - *Ask Notification* — Notify when ask tool is waiting for input

- **stt.enabled** (boolean, default: `false`)
  - *Speech-to-Text* — Enable speech-to-text input via microphone

- **stt.modelName** (enum, default: `"base.en"`)
  - *Speech Model* — Whisper model size (larger = more accurate but slower)

### Context

- **contextPromotion.enabled** (boolean, default: `true`)
  - *Auto-Promote Context* — Promote to a larger-context model on context overflow instead of compacting

- **compaction.enabled** (boolean, default: `true`)
  - *Auto-Compact* — Automatically compact context when it gets too large

- **compaction.strategy** (enum, default: `"context-full"`)
  - *Compaction Strategy* — Choose in-place context-full maintenance, auto-handoff, or disable auto maintenance (off)

- **compaction.thresholdPercent** (number, default: `-1`)
  - *Compaction Threshold* — Percent threshold for context maintenance; set to Default to use legacy reserve-based behavior

- **compaction.thresholdTokens** (number, default: `-1`)
  - *Compaction Token Limit* — Fixed token limit for context maintenance; overrides percentage if set

- **compaction.handoffSaveToDisk** (boolean, default: `false`)
  - *Save Handoff Docs* — Save generated handoff documents to markdown files for the auto-handoff flow

- **compaction.remoteEnabled** (boolean, default: `true`)
  - *Remote Compaction* — Use remote compaction endpoints when available instead of local summarization

- **compaction.idleEnabled** (boolean, default: `false`)
  - *Idle Compaction* — Compact context while idle when token count exceeds threshold

- **compaction.idleThresholdTokens** (number, default: `200000`)
  - *Idle Compaction Threshold* — Token count above which idle compaction triggers

- **compaction.idleTimeoutSeconds** (number, default: `300`)
  - *Idle Compaction Delay* — Seconds to wait while idle before compacting

- **branchSummary.enabled** (boolean, default: `false`)
  - *Branch Summaries* — Prompt to summarize when leaving a branch

- **ttsr.enabled** (boolean, default: `true`)
  - *TTSR* — Time Traveling Stream Rules: interrupt agent when output matches patterns

- **ttsr.contextMode** (enum, default: `"discard"`)
  - *TTSR Context Mode* — What to do with partial output when TTSR triggers

- **ttsr.interruptMode** (enum, default: `"always"`)
  - *TTSR Interrupt Mode* — When to interrupt mid-stream vs inject warning after completion

- **ttsr.repeatMode** (enum, default: `"once"`)
  - *TTSR Repeat Mode* — How rules can repeat: once per session or after a message gap

- **ttsr.repeatGap** (number, default: `10`)
  - *TTSR Repeat Gap* — Messages before a rule can trigger again

### Memory

- **memory.backend** (enum, default: `"off"`)
  - *Memory Backend* — Off, local memory pipeline, or Hindsight remote memory

- **hindsight.apiUrl** (string, default: `"http://localhost:8888"`)
  - *Hindsight API URL* — Hindsight server URL (Cloud or self-hosted)

- **hindsight.bankId** (string, default: `undefined`)
  - *Hindsight Bank ID* — Memory bank identifier (default: project name)

- **hindsight.bankIdPrefix** (string, default: `undefined }`)
  - *Hindsight Scoping* — global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = shared bank with project tags so global + project memories merge on recall

- **hindsight.autoRecall** (boolean, default: `true`)
  - *Hindsight Auto Recall* — Recall memories on the first turn of each session

- **hindsight.autoRetain** (boolean, default: `true`)
  - *Hindsight Auto Retain* — Retain transcript every N turns and at session boundaries

- **hindsight.retainMode** (enum, default: `"full-session"`)
  - *Hindsight Retain Mode* — full-session = upsert one document per session, last-turn = chunked

- **hindsight.mentalModelsEnabled** (boolean, default: `true`)
  - *Hindsight Mental Models* — Read curated reflect summaries (mental models) into developer instructions at boot. Loads existing models on the bank — does not write. Pair with hindsight.mentalModelAutoSeed to also auto-create the built-in seed set.

- **hindsight.mentalModelAutoSeed** (boolean, default: `true`)
  - *Hindsight Mental Model Auto-Seed* — At session start, create any built-in mental models (project-conventions, project-decisions, user-preferences) that do not yet exist on the bank.

### Editing

- **edit.mode** (enum, default: `"hashline"`)
  - *Edit Mode* — Select the edit tool variant (replace, patch, hashline, vim, or apply_patch)

- **edit.fuzzyMatch** (boolean, default: `true`)
  - *Fuzzy Match* — Accept high-confidence fuzzy matches for whitespace differences

- **edit.fuzzyThreshold** (number, default: `0.95`)
  - *Fuzzy Match Threshold* — Similarity threshold for fuzzy matches

- **edit.streamingAbort** (boolean, default: `false`)
  - *Abort on Failed Preview* — Abort streaming edit tool calls when patch preview fails

- **edit.blockAutoGenerated** (boolean, default: `true`)
  - *Block Auto-Generated Files* — Prevent editing of files that appear to be auto-generated (protoc, sqlc, swagger, etc.)

- **readLineNumbers** (boolean, default: `false`)
  - *Line Numbers* — Prepend line numbers to read tool output by default

- **readHashLines** (boolean, default: `true`)
  - *Hash Lines* — Include line hashes in read output for hashline edit mode (LINE+ID|content)

- **read.defaultLimit** (number, default: `500`)
  - *Default Read Limit* — Default number of lines returned when agent calls read without a limit

- **read.toolResultPreview** (boolean, default: `false`)
  - *Inline Read Previews* — Render read tool results inline in the transcript instead of summary rows

- **lsp.enabled** (boolean, default: `true`)
  - *LSP* — Enable the lsp tool for language server protocol

- **lsp.formatOnWrite** (boolean, default: `false`)
  - *Format on Write* — Automatically format code files using LSP after writing

- **lsp.diagnosticsOnWrite** (boolean, default: `true`)
  - *Diagnostics on Write* — Return LSP diagnostics after writing code files

- **lsp.diagnosticsOnEdit** (boolean, default: `false`)
  - *Diagnostics on Edit* — Return LSP diagnostics after editing code files

- **bashInterceptor.enabled** (boolean, default: `false`)
  - *Bash Interceptor* — Block shell commands that have dedicated tools

- **shellMinimizer.enabled** (boolean, default: `true`)
  - *Shell Minimizer* — Compress verbose shell output (git, npm, cargo, etc.) before returning it to the agent

- **eval.py** (boolean, default: `true`)
  - *Eval: Python backend* — Allow the eval tool to dispatch to the IPython kernel

- **eval.js** (boolean, default: `true`)
  - *Eval: JavaScript backend* — Allow the eval tool to dispatch to the in-process JavaScript runtime

- **python.kernelMode** (enum, default: `"session"`)
  - *Python Kernel Mode* — Whether to keep IPython kernel alive across calls

- **python.sharedGateway** (boolean, default: `true`)
  - *Shared Python Gateway* — Share IPython kernel gateway across pi instances

### Tools

- **marketplace.autoUpdate** (enum, default: `"notify"`)
  - *Marketplace Auto-Update* — Check for plugin updates on startup (off/notify/auto)

- **tools.artifactSpillThreshold** (number, default: `50`)
  - *Artifact spill threshold (KB)* — Tool output above this size is saved as an artifact; tail is kept inline

- **tools.artifactTailBytes** (number, default: `20`)
  - *Artifact tail size (KB)* — Amount of tail content kept inline when output spills to artifact

- **tools.artifactTailLines** (number, default: `500`)
  - *Artifact tail lines* — Maximum lines of tail content kept inline when output spills to artifact

- **todo.enabled** (boolean, default: `true`)
  - *Todos* — Enable the todo_write tool for task tracking

- **todo.reminders** (boolean, default: `true`)
  - *Todo Reminders* — Remind agent to complete todos before stopping

- **todo.reminders.max** (number, default: `3`)
  - *Todo Reminder Limit* — Maximum reminders to complete todos before giving up

- **todo.eager** (boolean, default: `false`)
  - *Create Todos Automatically* — Automatically create a comprehensive todo list after the first message

- **find.enabled** (boolean, default: `true`)
  - *Find* — Enable the find tool for file searching

- **search.enabled** (boolean, default: `true`)
  - *Search* — Enable the search tool for content searching

- **search.contextBefore** (number, default: `1`)
  - *Search Context Before* — Lines of context before each search match

- **search.contextAfter** (number, default: `3`)
  - *Search Context After* — Lines of context after each search match

- **astGrep.enabled** (boolean, default: `true`)
  - *AST Grep* — Enable the ast_grep tool for structural AST search

- **astEdit.enabled** (boolean, default: `true`)
  - *AST Edit* — Enable the ast_edit tool for structural AST rewrites

- **irc.enabled** (boolean, default: `true`)
  - *IRC* — Enable agent-to-agent IRC messaging via the irc tool

- **notebook.enabled** (boolean, default: `true`)
  - *Notebook* — Enable the notebook tool for notebook editing

- **renderMermaid.enabled** (boolean, default: `false`)
  - *Render Mermaid* — Enable the render_mermaid tool for Mermaid-to-ASCII rendering

- **debug.enabled** (boolean, default: `true`)
  - *Debug* — Enable the debug tool for DAP-based debugging

- **calc.enabled** (boolean, default: `false`)
  - *Calculator* — Enable the calculator tool for basic calculations

- **recipe.enabled** (boolean, default: `true`)
  - *Recipe* — Enable the recipe tool when a justfile / package.json / Cargo.toml / Makefile / Taskfile is present

- **inspect_image.enabled** (boolean, default: `false`)
  - *Inspect Image* — Enable the inspect_image tool, delegating image understanding to a vision-capable model

- **checkpoint.enabled** (boolean, default: `false`)
  - *Checkpoint/Rewind* — Enable the checkpoint and rewind tools for context checkpointing

- **fetch.enabled** (boolean, default: `true`)
  - *Read URLs* — Allow the read tool to fetch and process URLs

- **github.enabled** (boolean, default: `false`)
  - *GitHub CLI* — Enable the github tool (op-based dispatch for repository, issue, pull request, diff, search, checkout, push, and Actions watch workflows)

- **web_search.enabled** (boolean, default: `true`)
  - *Web Search* — Enable the web_search tool for web searching

- **browser.enabled** (boolean, default: `true`)
  - *Browser* — Enable the browser tool (Ulixee Hero)

- **browser.headless** (boolean, default: `true`)
  - *Headless Browser* — Launch browser in headless mode (disable to show browser UI)

- **browser.screenshotDir** (string, default: `undefined`)
  - *Screenshot directory* — Directory to save screenshots. If unset, screenshots go to a temp file. Supports ~. Examples: ~/Downloads, ~/Desktop, /sdcard/Download (Android)

- **tools.intentTracing** (boolean, default: `true`)
  - *Intent Tracing* — Ask the agent to describe the intent of each tool call before executing it

- **tools.maxTimeout** (number, default: `0`)
  - *Max Tool Timeout* — Maximum timeout in seconds the agent can set for any tool (0 = no limit)

- **async.enabled** (boolean, default: `false`)
  - *Async Execution* — Enable async bash commands and background task execution

- **async.pollWaitDuration** (enum, default: `"30s"`)
  - *Poll Wait Duration* — How long the poll tool waits for background job updates before returning the current state

- **bash.autoBackground.enabled** (boolean, default: `false`)
  - *Bash Auto-Background* — Automatically background long-running bash commands and deliver the result later

- **mcp.enableProjectConfig** (boolean, default: `true`)
  - *MCP Project Config* — Load .mcp.json/mcp.json from project root

- **mcp.discoveryMode** (boolean, default: `false`)
  - *MCP Tool Discovery* — Hide MCP tools by default and expose them through a tool discovery tool

- **mcp.discoveryDefaultServers** (array, default: `[] as string[]`)
  - *MCP Discovery Default Servers* — Keep MCP tools from these servers visible while discovery mode hides other MCP tools

- **mcp.notifications** (boolean, default: `false`)
  - *MCP Update Injection* — Inject MCP resource updates into the agent conversation

- **mcp.notificationDebounceMs** (number, default: `500`)
  - *MCP Notification Debounce* — Debounce window for MCP resource update notifications before injecting into conversation

- **dev.autoqa** (boolean, default: `false`)
  - *Auto QA* — Enable automated tool issue reporting (report_tool_issue) for all agents

### Tasks

- **task.isolation.mode** (enum, default: `"none"`)
  - *Isolation Mode* — Isolation mode for subagents (none, git worktree, fuse-overlayfs on Unix, or ProjFS on Windows via fuse-projfs; unsupported modes fall back to worktree)

- **task.isolation.merge** (enum, default: `"patch"`)
  - *Isolation Merge Strategy* — How isolated task changes are integrated (patch apply or branch merge)

- **task.isolation.commits** (enum, default: `"generic"`)
  - *Isolation Commit Style* — Commit message style for nested repo changes (generic or AI-generated)

- **task.eager** (boolean, default: `false`)
  - *Prefer Task Delegation* — Encourage the agent to delegate work to subagents unless changes are trivial

- **task.simple** (enum, default: `"default"`)
  - *Task Input Mode* — How much shared structure the task tool accepts (default, schema-free, or independent)

- **task.maxConcurrency** (number, default: `32`)
  - *Max Concurrent Tasks* — Concurrent limit for subagents

- **task.maxRecursionDepth** (number, default: `2`)
  - *Max Task Recursion* — How many levels deep subagents can spawn their own subagents

- **tasks.todoClearDelay** (number, default: `60`)
  - *Todo auto-clear delay* — How long to wait before removing completed/abandoned tasks from the list

- **skills.enableSkillCommands** (boolean, default: `true`)
  - *Skill Commands* — Register skills as /skill:name commands

- **commands.enableClaudeUser** (boolean, default: `true`)
  - *Claude User Commands* — Load commands from ~/.claude/commands/

- **commands.enableClaudeProject** (boolean, default: `true`)
  - *Claude Project Commands* — Load commands from .claude/commands/

- **commands.enableOpencodeUser** (boolean, default: `true`)
  - *OpenCode User Commands* — Load commands from ~/.config/opencode/commands/

- **commands.enableOpencodeProject** (boolean, default: `true`)
  - *OpenCode Project Commands* — Load commands from .opencode/commands/

### Providers

- **secrets.enabled** (boolean, default: `false`)
  - *Hide Secrets* — Obfuscate secrets before sending to AI providers

- **providers.webSearch** (enum, default: `"auto"`)
  - *Web Search Provider* — Provider for web search tool

- **providers.image** (enum, default: `"auto"`)
  - *Image Provider* — Provider for image generation tool

- **providers.kimiApiFormat** (enum, default: `"anthropic"`)
  - *Kimi API Format* — API format for Kimi Code provider

- **providers.openaiWebsockets** (enum, default: `"auto"`)
  - *OpenAI WebSockets* — Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)

- **providers.parallelFetch** (boolean, default: `true`)
  - *Parallel Fetch* — Use Parallel extract API for URL fetching when credentials are available

- **exa.enabled** (boolean, default: `true`)
  - *Exa* — Master toggle for all Exa search tools

- **exa.enableSearch** (boolean, default: `true`)
  - *Exa Search* — Basic search, deep search, code search, crawl

- **exa.enableResearcher** (boolean, default: `false`)
  - *Exa Researcher* — AI-powered deep research tasks

- **exa.enableWebsets** (boolean, default: `false`)
  - *Exa Websets* — Webset management and enrichment tools

- **searxng.endpoint** (string, default: `undefined`)
  - *SearXNG Endpoint* — Self-hosted search base URL



## CLI Commands

```
omp config list              # List all settings with current values
omp config get <key>         # Get a specific setting value
omp config set <key> <value> # Set a setting value
omp config reset <key>       # Reset a setting to its default
omp config path              # Print the config directory path
omp config init-xdg          # Initialize XDG Base Directory structure
```

**Boolean values:** `true`, `false`, `yes`, `no`, `on`, `off`, `1`, `0`

**Array values:** Pass as JSON array string, e.g., `omp config set extensions '["ext1", "ext2"]'`

**Record values:** Pass as JSON object string.

## MCP Servers Config (`.mcp.json`)

MCP servers are configured via `.mcp.json` (or `mcp.json`) at the project root or in user config dirs.

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "command-name",
      "args": ["--arg1"],
      "env": {"KEY": "value"},
      "cwd": "/path/to/cwd",
      "enabled": true,
      "timeout": 30000,
      "auth": {
        "type": "oauth",
        "credentialId": "my-cred"
      }
    },
    "http-server": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {"Authorization": "Bearer token"}
    }
  },
  "disabledServers": ["server-name"]
}
```

**Fields:**
- `type`: `"stdio"` (default), `"http"`, or `"sse"`
- `command`: Executable path (required for stdio)
- `args`: Array of command arguments
- `env`: Environment variables map
- `cwd`: Working directory for the server process
- `enabled`: Boolean, defaults to `true`
- `timeout`: Connection timeout in milliseconds, defaults to `30000`
- `auth`: Authentication config with `type` (`"oauth"` or `"apikey"`) and optional credential fields
- `oauth`: OAuth-specific client credentials

## LSP Config (`lsp.json` / `.lsp.json` / `lsp.yml`)

LSP servers are configured via `lsp.json`, `.lsp.json`, `lsp.yml`, or `.lsp.yml` in the project root, config dirs, or user home.

```json
{
  "servers": {
    "typescript-language-server": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileTypes": [".ts", ".tsx", ".js", ".jsx"],
      "rootMarkers": ["package.json", "tsconfig.json"]
    }
  },
  "idleTimeoutMs": 300000
}
```

**Fields per server:**
- `command`: Executable name or path
- `args`: Array of arguments
- `fileTypes`: Array of file extensions this server handles
- `rootMarkers`: Files/directories that indicate a project root for this server
- `disabled`: Boolean to disable this server

**Priority (highest to lowest):**
1. Project root files
2. Project config dirs (`.omp/`, `.claude/`, etc.)
3. User config dirs (`~/.omp/agent/`, etc.)
4. User home root (`~/lsp.json`)
5. Auto-detect from project markers + available binaries

## Keybindings Config (`keybindings.json`)

Keybindings are stored in `~/.omp/agent/keybindings.json`.

```json
{
  "app.interrupt": "escape",
  "app.exit": "ctrl+d",
  "app.thinking.cycle": "shift+tab",
  "app.model.cycleForward": "ctrl+p",
  "app.tools.expand": "ctrl+o"
}
```

**Key IDs use the format:** `app.<action>` or `tui.<action>`

**Key syntax:** `ctrl+x`, `alt+x`, `shift+x`, `ctrl+shift+x`, or arrays for multiple bindings: `["ctrl+left", "alt+left"]`

**Important app keybindings:**
- `app.interrupt` — Interrupt current operation (default: `escape`)
- `app.clear` — Clear screen or cancel (default: `ctrl+c`)
- `app.exit` — Exit application (default: `ctrl+d`)
- `app.thinking.cycle` — Cycle thinking level (default: `shift+tab`)
- `app.thinking.toggle` — Toggle thinking mode (default: `ctrl+t`)
- `app.model.cycleForward` — Cycle to next model (default: `ctrl+p`)
- `app.model.select` — Select model (default: `ctrl+l`)
- `app.tools.expand` — Expand tools (default: `ctrl+o`)
- `app.editor.external` — Open external editor (default: `ctrl+g`)
- `app.message.followUp` — Send follow-up message (default: `ctrl+enter`)
- `app.session.observe` — Observe subagent sessions (default: `ctrl+s`)
- `app.plan.toggle` — Toggle plan mode (default: `alt+shift+p`)
- `app.history.search` — Search history (default: `ctrl+r`)

Legacy keybinding names are automatically migrated to the new namespaced format on load.

## Important Constraints

1. **Always use `omp config set`** to modify settings. Editing `config.yml` manually while the agent is running will not take effect and may be overwritten.
2. **YAML format** is preferred for `config.yml`. JSON configs are auto-migrated to YAML on first load.
3. **Config priority:** Project-level configs override user-level. `.omp` overrides `.claude`.
4. **MCP server changes** require a restart to take effect.
5. **LSP server discovery** is automatic based on project markers and available binaries. Explicit config overrides auto-detection.
6. **Keybindings** are loaded once at startup. Use the in-app command to reload without restarting.
