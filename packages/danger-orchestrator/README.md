# Danger Orchestrator

A GUI client for [omp](https://github.com/Raudbjorn/omp) (OMP), built on top of the Agent Client Protocol (ACP). Designed for a single user (Scott) who runs 6-10 concurrent coding agent sessions and wants a better way to manage them.

## The Problem

Running many agent sessions in parallel terminals has three core pain points:

1. **Attention routing** -- Sessions sit idle most of the time. It's unclear which one needs input right now, and polling each terminal wastes time.
2. **Task identity** -- Every terminal looks the same. Context-switching is expensive because there's no visual signal connecting a session to its project or task.
3. **Reading experience** -- Terminals are monospace-only and fixed-size. Agent responses are long-form content that deserves proportional fonts, rich formatting, and proper typography.

A bonus goal: **Observability** -- seeing the full tree of agents and sub-agents, with ambient visual feedback (colored background flashes on tree nodes) as messages flow through the system.

## How It Connects to OMP

OMP implements the Agent Client Protocol -- a JSON-RPC protocol (stdio locally, HTTP/WebSocket remotely) that standardizes editor-to-agent communication. ACP provides:

- **Session lifecycle** -- create, list, resume, fork, close, delete
- **Prompt turns** -- structured request/response loop with typed content blocks
- **Tool calls and slash commands** -- as protocol-level message types
- **Notifications** -- push events like `session_info_update` for reactive UI

Sessions are discovered from `~/.local/share/omp/sessions/`. The typical flow is resuming existing sessions, not starting fresh. `@mentions` and `/commands` in the input field are OMP features surfaced through ACP.

## Workflow

- The user interacts with sessions in rapid succession, not one-at-a-time deep focus.
- During the design phase (where most of the work happens), sessions almost always block on user input. The primary job of the UI is to surface which sessions are waiting.
- Sessions are never explicitly "done." They fade into irrelevance through recency.
- Session ordering is FIFO for now.

### The "Next!" Flow

The core interaction pattern. Press a hotkey to warp to the next session that needs attention -- input is pre-selected, and a generated recap is shown (scaled to how long it's been since you last visited that session). This is the direct answer to the attention routing problem: don't make the user hunt for what needs them.

- **Recap position** -- The recap callout appears at the *bottom* of the chat stream (most recent element, right above the input). On first send it collapses/disappears -- once you're engaging, you don't need the reminder anymore.
- **Button color previews the destination** -- The Next! button takes on the accent color of the session it will warp to, so you can see which project is up before committing.
- **Send-and-next** (`Ctrl/Alt+Enter`) -- Send the current message and immediately warp to the next waiting session in one motion.
- **Wraparound, not removal** -- Next! cycles through the queue (A→B→C→A). Pressing Next doesn't remove the current session from the queue; only the session itself deciding it's done (or an explicit "done for now") takes it out.
- **Empty state** -- When nothing is waiting, the Next! affordance shows "Waiting..." rather than being hidden or disabled.

### Attention Queue

A colored queue sits above the session tree in the left sidebar, showing sessions that are waiting for user input. Provides an at-a-glance count and visual indicator without needing to scan the full tree.

- Rows use full accent-colored backgrounds (not subtle tints) so the project identity reads at a glance.
- **"Done for now"** -- On hover, each row reveals a check icon button that dismisses the session from the queue. This is ephemeral, not a persistent mute: if the user later clicks into that session from the tree and sends another message, it re-enters the queue on the next agent response. The goal is to say "I've seen this, stop pestering me" without losing the session's place.

## Agent Hierarchy

Each session has a **primary agent** -- the one the user talks to. Primaries can spawn sub-agents (workers, teammates, etc.) that appear as children in the outline tree.

- **Primary agents** -- interactive. The user reads and responds to these.
- **Sub-agents** -- observable but not interactive. Clicking one opens a read-only view of its message stream. Activity on sub-agent tree nodes is shown through ambient visual feedback (flashes, etc.).

## Accent Color System

To reduce context-switch cost, the UI's accent color changes between sessions. The shift is intentionally noticeable -- not subtle theming, but a clear visual signal that you're somewhere different now. Assignment mechanism TBD (per-session, per-project, content-hash-based, or some combination with persistence).

The accent palette has 12 named colors: love, gold, rose, pine, foam, iris, sage, peach, sapphire, coral, lavender, dawn.

## Session Start

When no session is selected, the main panel shows a session picker: a list of project directories discovered from `~/.local/share/omp/sessions/`, or a directory chooser for new ones. Clicking a session transitions directly to the chat interface.

## Keyboard Navigation

| Shortcut | Action |
|---|---|
| Next! hotkey (TBD) | Warp to next session needing attention |
| `Alt+1..5` | Jump to session by position |
| `Ctrl+-` | Back (history-based) |
| `Ctrl+Shift+-` | Forward (history-based) |
| `Ctrl+0` | Focus session tree |

More shortcuts will emerge through use.

## Input Affordances

`/commands` and `@file` references both trigger fuzzy-filtering autocomplete menus that appear inline at the cursor, similar to code editor completion (not a separate dialog or palette).

## Application Layout

Two-column layout with a top bar, plus an open question about using the full width:

```
+--Top Bar (project identity, global controls)---------------------------+
|              |                                                          |
|  Navigation  |        Primary Workspace                                |
|  / Tools     |                                                         |
|              |   +------------------------------------------------+   |
|  Outline     |   |     Chat stream                                |   |
|  tree:       |   |     (messages, tool calls, todos, thinking)    |   |
|  projects    |   |                                                |   |
|   branches   |   |     Scrollable independently of input          |   |
|    sessions  |   +------------------------------------------------+   |
|     agents   |   |     Input field (FIXED position)               |   |
|              |   +------------------------------------------------+   |
+--------------+--------------------------------------------------------+
|                        Stats Bar                                       |
+------------------------------------------------------------------------+
```

### Open Question: Using the Width

There is no second panel at the moment. The workspace is a single column, which leaves horizontal space on the table. Ideas for filling that space:
- **Diff viewer** -- side-by-side with the chat stream for reviewing agent-produced changes
- **Multi-select split view** -- shift/ctrl-click multiple agents in the tree, workspace splits to show a sliver of each (status, recent activity)

### Left Sidebar -- Navigation / Outline

A tree view showing the full agent hierarchy:

```
project (e.g. "danger-pi")
  branch (e.g. "feat/auth-rewrite")
    session/task (e.g. "Implement OAuth flow")      <- primary agent
      sub-agent (e.g. "search worker")              <- observable, read-only
      sub-agent (e.g. "test runner")
```

Each session row shows: title, activity status, and token count (e.g. "scaffolding token store . 1.2M"). Each project gets a unique accent color from the theme palette, so sessions are visually grouped by project at a glance.

Two density modes: standard (28px rows) and dense (22px rows).

### Center -- Primary Workspace

The main chat stream, rendered with rich formatting:

- **Agent messages** -- Proportional serif font for body text, with proper heading hierarchy (h1/h2/h3 with accent-colored left borders), inline code, code blocks with language headers, bullet lists, and tables.
- **User messages** -- Chat bubbles with file references (branch, path, metadata).
- **Tool calls** -- Inline between messages, showing tool name, duration, arguments, and results. Three states: running (spinner), success (checkmark), error (x).
- **Todo blocks** -- Task lists with checkmark/arrow/circle status icons.
- **Thinking indicator** -- Animated pulse dot with "Thinking..." label.

**Input field** is fixed-position at the bottom of the workspace. The chat stream scrolls independently -- typing does not auto-scroll to the bottom. This lets the user compose a response while reading back through the conversation. Supports `@mentions`, `/commands`, and multi-line expansion (up to 16 lines with scrollbar).

### Bottom -- Stats Bar

Per-session metadata: worktree/branch name, model, thinking level, token counts (in/out/cached), duration, and cost.

## Design System

Defined in the Pencil file at `~/Documents/Pencil/danger pi.pen`. See the Style Guide frame for the full reference.

Key decisions:

- **Dark theme** based on Rosé Pine palette
- **Three fonts with strict roles:**
  - Space Grotesk (`$--font-sans`) -- headings, section labels
  - Adelle (`$--font-serif`) -- long-form agent response body text only
  - JetBrains Mono (`$--font-mono`) -- all other UI text (panels, badges, buttons, data, metadata)
- **Per-project accent colors** from the 12-color palette
- **11 status badge states:** RUNNING, COMPLETE, WAITING, QUEUED, IDLE, SYNCED, PENDING, ACTIVE, ERROR, REVIEW, DRAFT

## Components

Reusable components defined in the Pencil file:

| Component | Purpose |
|---|---|
| Agent Message | Rich-formatted agent response (headings, code, tables, lists) |
| User Message | User chat bubble with file references |
| Tool Call (Success/Error/Running) | Inline tool execution display with three states |
| Stats Bar | Bottom bar with session metrics |
| Thinking Indicator | Animated "thinking" state |
| Todo Block | Task checklist with status icons |
| Input Field | Chat input (single-line, multi-line, and unfocused variants) |
| Outline View | Session tree with agent hierarchy (standard and dense variants) |

## Tech Stack

TBD -- built on OMP's Agent Client Protocol.
