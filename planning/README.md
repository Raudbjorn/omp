# ACP Integration — Planning Index

Branch: `acp-integration`

omp plays two roles with respect to the Agent Client Protocol (ACP):

1. **ACP server** (existing, unchanged here) — IDEs speak ACP to omp
   at `packages/coding-agent/src/modes/acp/`.
2. **ACP client** (this plan's focus) — omp spawns a local coding-agent
   CLI and drives it over stdio JSON-RPC, mapping ACP events into
   omp's existing `AssistantMessageEventStream`.

This folder is split per agent. The protocol plumbing is shared
(`packages/ai/src/providers/acp/`); each agent adds its own thin
`CliAdapter`.

## Layout

```
planning/
├── README.md                  ← you are here
├── acp-gemini/                ← MVP: the first native-ACP target
│   ├── README.md
│   ├── requirements.md
│   ├── design.md
│   ├── wire-trace.md          ← real JSON-RPC frames, annotated
│   ├── tasks.md               ← phased T1–T20, ~1.5 weeks
│   ├── research.md
│   └── prototypes.md
├── acp-claude/                ← Phase 2: via claude-agent-acp bridge
│   ├── README.md
│   ├── design.md
│   └── tasks.md
├── acp-copilot/               ← Placeholder (no upstream ACP yet)
│   └── README.md
└── acp-kiro/                  ← Placeholder (no upstream ACP yet)
    └── README.md
```

## Sequencing

```
[acp-gemini]  ─┐
               ├─▶ ships shared core in providers/acp/
               │   (stream, process, client, event-mapping,
               │    stop-reason, fs-proxy, permissions,
               │    auth-probe, cli/types)
               ▼
[acp-claude]   ─── reuses core + adds cli/claude-code.ts
                   spawns external claude-agent-acp bridge
                   (Apache-2.0, Zed-authored)
                   1–2 days on top of the Gemini MVP

[acp-copilot], [acp-kiro] ── future; wait for upstream ACP support
                             or a community bridge binary
```

## Why Gemini first

- Gemini is the only target that speaks ACP natively — no bridge,
  no stream-json translation. Building the shared core against it
  keeps "protocol plumbing" uncontaminated by bridge-specific
  workarounds.
- Gemini's quirks are well-documented (stdout pollution on
  `--experimental-acp`, `loadSession: false`, stdio-only MCP in
  `session/new`) and have clean, localized mitigations.
- Once the core is correct for Gemini, Claude Code is a ~30-line
  adapter pointed at `claude-agent-acp`.

## What's explicitly NOT in this plan set

- **No stream-json → ACP translator inside pi-ai.** We use Zed's
  [`claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)
  binary for Claude Code.
- **No SACP migration.** omp's ACP server side stays on the current
  `@agentclientprotocol/sdk` version until v1.0 ships for TS.
- **No MCP-over-ACP fan-in.** omp's MCP servers are not relayed to
  the agent's ACP session (Gemini issue #8672 makes even the read
  side fragile — `session/new` rejects non-stdio MCP entries).
- **No warm subprocess pool.** Single session per process for the
  MVP.
- **No "AI Context Protocol" / SACP conductor / A2A.** Those share
  the acronym but are different projects; see
  `acp-gemini/research.md §1` for the disambiguation.

## Reading order for reviewers

1. `acp-gemini/README.md` — scope and MVP success criterion.
2. `acp-gemini/wire-trace.md` — the protocol, concretely.
3. `acp-gemini/design.md` — module layout and the interesting bits
   (stdout filter, event-mapping state machine, fs-proxy symlink
   resolution, permission policy).
4. `acp-gemini/tasks.md` — the work breakdown.
5. `acp-claude/` — how little follow-on work is needed after the
   Gemini core lands.
