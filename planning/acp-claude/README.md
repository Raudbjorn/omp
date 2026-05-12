# ACP-Claude Provider — Planning (Phase 2, after Gemini MVP)

Branch: `acp-integration`

**Goal:** drive Claude Code from omp as an ACP client, reusing the
shared `packages/ai/src/providers/acp/` core that Gemini lands first.

## TL;DR — we do NOT reimplement a bridge

Claude Code does **not** speak ACP natively. Anthropic's `claude`
binary speaks its own `stream-json` event dialect over stdio.
Translating that into ACP on the fly is a non-trivial engineering
task.

**Zed has already solved this.** The
[`agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)
project is an Apache-2.0-licensed standalone binary that spawns
`claude --output-format=stream-json`, parses its events, and re-emits
them as ACP. It ships prebuilt binaries for common platforms and is
the same tool Zed uses in production.

**Our plan is to spawn that bridge binary.** From `providers/acp/`'s
point of view, `claude-agent-acp` is just another ACP-speaking child
process — same orchestrator, same codec, same fs-proxy, same
permission policy. Only the adapter (`cli/claude-code.ts`) changes:
it has a different `binary`, different `installHint`, different
`probeAuth`.

We do **not** reimplement the stream-json → ACP translation inside
pi-ai. That would duplicate Zed's work with a permanent maintenance
burden as Anthropic's `stream-json` format evolves.

## Prerequisites

- Gemini MVP has landed (see [`../acp-gemini/`](../acp-gemini/)) —
  specifically `providers/acp/{stream,process,client,event-mapping,
  stop-reason,fs-proxy,permissions,auth-probe,cli/types}.ts`.
- `"acp-agent"` Api type is registered.

## What this plan adds

- A new adapter at `packages/ai/src/providers/acp/cli/claude-code.ts`.
- A new model entry in `models.json` for `claude-code-acp` with
  `"api": "acp-agent"`, `"provider": "claude-code-acp"`.
- `/login` and `/usage` rows pointing at the Claude Code install +
  login commands.
- Packaging: how the `claude-agent-acp` binary gets onto the user's
  machine (install hint, optional `omp doctor` check).

## Scope (this plan only)

**In:**

- Adapter module that spawns `claude-agent-acp` with the appropriate
  args and env.
- Probe `~/.claude/config.json` and `claude --version` for auth
  state.
- `/login` integration that surfaces `claude setup-token` when
  logged out.
- Doc note: if the user hasn't installed `claude-agent-acp` we show
  the install hint and stop.

**Out:**

- Writing any stream-json → ACP translation. We use
  `claude-agent-acp` as-is.
- Vendoring `claude-agent-acp` binaries. Users install the binary
  themselves (doc + hint); packaging it with omp is a future
  decision.
- Changes to `providers/acp/` core — if something needs to change
  there, it's a Gemini-MVP backport, not a Claude-specific patch.

## Artifacts

1. [`design.md`](./design.md) — adapter shape, install/auth flow,
   bridge invocation, risks (bridge version drift, network hops).
2. [`tasks.md`](./tasks.md) — the short task list (4–6 tasks, about
   1–2 days of work post-Gemini).

No separate `requirements.md` / `research.md` / `wire-trace.md` —
the Gemini plan already establishes the protocol surface; this is an
adapter delta.

## One-line success criterion

Selecting `claude-sonnet-4.5` (or similar) in omp streams a full
turn through `claude-agent-acp` and back, with at least one
`fs/read_text_file` tool call honored by the shared fs-proxy.

## Open questions (not blocking MVP)

- Bundle vs require-install: do we ship `claude-agent-acp` as a
  Homebrew cask companion or just point at `npm i -g`? Tentatively
  require-install; revisit after usage data.
- Token scoping: `claude setup-token` stores credentials at
  `~/.claude/config.json`. Do we want omp to detect expiry? Probably
  no — the bridge will fail with a clear error and we surface that.
