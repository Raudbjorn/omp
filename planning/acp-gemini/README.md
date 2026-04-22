# ACP-Gemini Provider — MVP Planning

Branch: `acp-integration`

**Goal (MVP):** make `gemini-cli` work as a first-class provider in omp
by driving it in Agent Client Protocol (ACP) mode — omp spawns
`gemini --experimental-acp`, speaks JSON-RPC 2.0 over stdio, and threads
the resulting `session/update` notifications into omp's existing
`AssistantMessageEventStream`.

## Why Gemini first

Three reasons Gemini is the right first target for ACP client work:

1. **Gemini speaks ACP natively.** No bridge, no wrapper binary, no
   translation layer. The CLI ships with `--experimental-acp` and
   implements the spec directly. Whatever we build here is reusable for
   any future native-ACP CLI (Zed's own agent, etc.) with only the
   command-line invocation changing.
2. **The wire is fully documented.** We have an end-to-end wire trace
   (`wire-trace.md`) showing the exact JSON-RPC frames exchanged during
   `initialize`, `authenticate`, `session/new`, `session/prompt`, and
   shutdown. Nothing has to be reverse-engineered.
3. **It pedagogically anchors the module.** Once the Gemini path works,
   the other CLIs slot in as adapters over the same core primitives
   (spawn, codec, event bridge, fs-proxy, permissions). If we start
   with Claude Code — which requires a bridge binary — we risk
   conflating "ACP plumbing" with "bridge-specific oddities."

The other three CLIs (Claude Code, Copilot, Kiro) get their own
planning dirs (`../acp-claude`, `../acp-copilot`, `../acp-kiro`) and
build on the infrastructure this plan lands.

## Artifacts

1. [`requirements.md`](./requirements.md) — EARS requirements scoped to Gemini.
2. [`design.md`](./design.md) — module layout under `packages/ai/src/providers/acp/`, event-mapping state machine, stop-reason table, shutdown ladder, fs-proxy/permissions policy.
3. [`wire-trace.md`](./wire-trace.md) — annotated JSON-RPC trace of a real Gemini `--experimental-acp` session (initialize → session/new → prompt → stop).
4. [`tasks.md`](./tasks.md) — phased task breakdown (1a–1f, ~1.5 weeks of focused work).
5. [`research.md`](./research.md) — Gemini-specific quirks: issue #22647 stdout pollution, issue #8672 MCP-stdio-only, `loadSession: false`, `oauth-personal` browser flow, TTY-less auth detection.
6. [`prototypes.md`](./prototypes.md) — what we learned from the two Rust prototypes; what we're keeping (adapter shape, tolerant reader, model cache) and what we're discarding (HTTP facade, process pool, file-based event log).

## Scope (this plan only)

**In:**

- New Api type `"acp-agent"` in `packages/ai/src/api-registry.ts` —
  shared across all future ACP providers (the *protocol* is the asset;
  the *CLIs* are adapters).
- `packages/ai/src/providers/acp/` module with `stream.ts`, `process.ts`,
  `client.ts`, `event-mapping.ts`, `stop-reason.ts`, `fs-proxy.ts`,
  `permissions.ts`, `auth-probe.ts`, `cli/gemini.ts`.
- Single-turn streaming through `gemini --experimental-acp` with text,
  thought, and tool-call spans emitted on the existing event stream.
- FS proxy (scoped to workspace root, symlink-resolved, 10 MB cap) and
  permissions policy (`auto-allow` / `deny-destructive` / `delegate`).
- Auth probe **before** spawn (`gemini --version` + check
  `~/.gemini/oauth_creds.json` or `GEMINI_API_KEY` env).
- `/login` and `/usage` surface: show Gemini CLI auth state and
  login-command hint.
- Integration test using a fake ACP server fixture driven over the real
  codec (no vendor binary in CI).

**Out (deferred — tracked in sibling plans or future work):**

- Claude Code via `agentclientprotocol/claude-agent-acp` bridge
  (→ `../acp-claude/`).
- Copilot / Kiro adapters (→ `../acp-copilot/`, `../acp-kiro/`).
- Warm subprocess pool / multi-session per process — single session
  per child for the MVP.
- `session/load` (Gemini doesn't support it anyway: `loadSession: false`).
- Plan / available_commands / current_mode as first-class omp events —
  mapped to metadata for now.
- MCP-over-ACP fan-in (relaying omp's MCP servers into the agent's
  ACP session).
- Moving omp's ACP **server** side to v1.0 / SACP — unrelated to this
  plan; stays on `@agentclientprotocol/sdk@0.18.2` or whatever
  `packages/ai` already depends on.

## One-line success criterion

Selecting a `gemini-2.5-pro` model inside an omp session streams a
full turn — including at least one tool call that invokes the fs-proxy
— to the user, and cleanly shuts down the child on session end.

## Debugging

When something in the ACP stack misbehaves, the fastest path to a
useful trace is to set both of these together:

```bash
GEMINI_CLI_ACP_TRACE=1 gemini --debug --experimental-acp
```

- `GEMINI_CLI_ACP_TRACE=1` — turns on verbose wire logging inside
  omp's `packages/ai/src/providers/acp` module. Outbound/inbound
  JSON-RPC frames, stop reasons, and child lifecycle transitions go
  to stderr at DEBUG level.
- `gemini --debug` — asks the Gemini CLI itself to emit extra
  diagnostics (tool-call dispatch, credential resolution, internal
  state). Pairs with `--experimental-acp` without interfering.

For a concrete reference of what a healthy session looks like on the
wire — including the exact `initialize` / `session/new` /
`session/prompt` / `session/update` / shutdown frames — read
[`wire-trace.md`](./wire-trace.md). Anyone extending this module
(adding another CLI adapter, mapping a new `session/update` variant,
debugging a hang) should start there.

Smoke test against a real, authenticated Gemini CLI:

```bash
cd packages/ai
GEMINI_SMOKE=1 bun scripts/smoke-gemini-acp.ts "Say hi."
# or with tracing on:
GEMINI_SMOKE=1 GEMINI_CLI_ACP_TRACE=1 bun scripts/smoke-gemini-acp.ts
```

The smoke script is gated by `GEMINI_SMOKE=1` so it never runs in
unattended CI.

## Lineage vs the old unified plan

The previous single `planning/` tree tried to cover all four CLIs at
once and included a `mcp-sacp-others/` subfolder that was a mix of
real deferred work and speculative fiction (SACP, ZTAS, AI Context
Protocol). That tree is being split per-agent so each provider's
quirks stay colocated with its docs, and the speculative material is
being dropped rather than carried forward.
