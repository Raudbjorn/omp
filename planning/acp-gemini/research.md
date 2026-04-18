# Research — Gemini ACP Specifics

Distilled notes for the Gemini MVP. General ACP protocol theory lives
in the spec (and the `@agentclientprotocol/sdk` typings); this file
captures the Gemini-specific quirks we have to work around.

## 1. Three protocols called "ACP" — disambiguation

Only the first row is what we are implementing. The other two share
the acronym and are out of scope for this plan.

| Name                        | Layer                        | Transport              | Our use                                    |
|-----------------------------|------------------------------|------------------------|--------------------------------------------|
| **Agent Client Protocol**   | Editor ↔ local agent         | JSON-RPC over stdio    | **This is what Gemini speaks.**            |
| **AI Context Protocol**     | Codebase metadata / constraints | static JSON cache    | Not used. Different project, same acronym. |
| **Agent Communication Protocol (A2A)** | Agent ↔ agent east-west | REST + WebSocket     | Not used. Out of scope.                    |

**Model Context Protocol (MCP)** is distinct again — it is the
tool-layer protocol agents use to call tools. ACP agents can be MCP
*clients* themselves; bridging MCP over ACP is deferred.

## 2. Gemini `--experimental-acp`: the good, the bad, the bugs

### Real, open issues

**#22647 — stdout pollution.** Gemini writes diagnostics to stdout
interleaved with JSON-RPC frames. Known patterns:
- `Loaded cached credentials.` (plain text line)
- `<EPHEMERAL_MESSAGE>\n{...}\n</EPHEMERAL_MESSAGE>` (XML-ish block
  wrapping an inner JSON object that is not a JSON-RPC frame)

Mitigation: `filterNonJsonLines` Transform between raw stdout and
`ndJsonStream` (see `design.md §6`). Whitelist-only: accept lines
whose first non-whitespace byte is `{` or `[`.

**#8672 — `session/new` rejects non-stdio MCP transports.** If we
pass SSE or HTTP entries in `mcpServers`, `session/new` fails.
Mitigation: MVP passes `mcpServers: []`. Phase 2 may forward only
stdio MCP entries.

### Hard facts from the `initialize` response

- `loadSession: false` — session resume is not supported. Don't
  call `session/load`.
- `promptCapabilities.embeddedContext: false` — no "here's the
  whole repo context" shortcut on the agent side; we send explicit
  file content when we want it considered.
- `promptCapabilities.image: true` — images can be forwarded.
- `authMethods` advertises `oauth-personal` and `gemini-api-key`.
  The `oauth-personal` flow opens a browser **on the agent side**,
  which is useless inside a subprocess: we must pre-authenticate
  and never call `authenticate` with that method at runtime.

### Quirks the spec allows but Gemini uses aggressively

- `agent_thought_chunk` updates precede `agent_message_chunk`
  routinely. Our `event-mapping` state machine closes one span when
  the other opens.
- Zero-length `agent_message_chunk` updates arrive as keepalives.
  Drop them — they shouldn't emit empty text deltas.
- `tool_call_update` sometimes arrives *after* `session/prompt`
  response. Race condition; we close spans on response and ignore
  late updates at DEBUG.

## 3. Auth posture — never at runtime

The Gemini CLI has three auth paths:

1. `~/.gemini/oauth_creds.json` (OAuth, produced by
   `gemini auth login`).
2. `GEMINI_API_KEY` env var (or `GOOGLE_API_KEY`).
3. Vertex / service-account setups (not addressed here).

A subprocess with no TTY cannot interactively auth. Our probe
(`auth-probe.ts`) checks state **before** spawn:

- `missing` — binary not found.
- `logged_out` — binary exists, no creds file, no env key.
- `logged_in_oauth` — creds file present with recent mtime.
- `logged_in_api_key` — env key present.

On `missing` or `logged_out`, we yield `auth_required` with the
install or login command and don't spawn. Re-auth during a session
is impossible — if it were to happen, the `session/prompt` would
return `refusal` and we'd surface it as an error.

## 4. What happens if we don't filter stdout

Quick test (for the curious, not recommended in CI): if you feed
Gemini's raw stdout straight into `ndJsonStream`, the
`Loaded cached credentials.` line triggers a JSON parse error deep
inside the SDK, which some versions surface as a fatal stream error
and others swallow silently. Either way, the first `session/update`
after the line gets dropped. That's the whole reason the filter
exists — not cosmetic.

## 5. What we explicitly do not build (for Gemini)

- No `terminal` capability. We set `clientCapabilities.terminal = false`
  so the agent can't ask to drive a pty.
- No `session/load` (unsupported anyway).
- No community packages: `@mcpc-tech/acp-ai-provider`,
  `@finityno/claude-code-acp`, and the Vercel AI-SDK ACP provider
  all collapse the interesting parts — they force a single event
  shape or don't expose the permission flow. We use
  `@agentclientprotocol/sdk` directly.

## 6. Prior art in omp we're NOT touching

- `packages/coding-agent/src/modes/acp/` is the ACP **server** side
  (omp-as-agent). Unchanged by this plan.
- `packages/ai/src/providers/google-gemini-cli.ts` is the direct-API
  Gemini provider (not ACP). Remains the faster path when the user
  just wants text generation and doesn't need the agent-semantics
  (plan, tool streams, permissions). The ACP-agent path's value is
  richer semantics + uniformity across future CLIs — not raw speed.

## 7. Prior art we're learning from

Two Rust prototypes informed the design without being ported:

- `~/ais/resources/llm-proxy` — HTTP facade over CLI agents.
  Keeper: adapter-per-vendor layout, auth-error keyword
  classification, model-list cache. Discarded: the HTTP facade
  itself, process pool, admin UI.
- `~/ais/acp-proxy` — ACP *server* over CLI agents (mirror of what
  we're building). Keeper: declarative adapter trait,
  config-driven defaults. Discarded: file-based event log, separate
  HTTP surface, Rust tokio plumbing.

Details in `prototypes.md`.

## 8. Tracing and debugging

Two paths when you need to see the raw frames:

- `GEMINI_CLI_ACP_TRACE=1 gemini --debug --experimental-acp` writes
  frames with timestamps to stderr. Couple with omp's DEBUG logger
  for a synced view.
- A socat/fifo shim (15-line Node wrapper) that runs between omp
  and `gemini`, teeing each direction to a `.jsonl` file. Useful
  for diffing before/after a Gemini release bumps framing.

Both are developer tools; we don't ship either.

## 9. Why `"acp-agent"` is one Api type, not one per CLI

The protocol is identical across Gemini, Claude Code (via bridge),
Copilot (if/when they ship native ACP), and Kiro. Only the spawn
command changes. Making four Api types would duplicate the
orchestrator, the event-mapping, the fs-proxy, and the
permissions logic four times. One Api + one adapter per CLI is
strictly less code and a tighter blast radius when the SDK drops a
new version.

## 10. Deferred ecosystem notes

Captured so we don't re-research next time someone asks:

- **SACP** (Rust, "Symposium ACP") will become the foundation of the
  v1.0 `agent-client-protocol` crate. We stay on the current TS SDK
  version and revisit when the v1.0 TS SDK lands.
- **`sacp-rmcp`** bridges MCP over ACP. Agent-side work — not
  relevant to this plan.
- **Multi-agent fan-out, HTTP facades, L3 conformance tools, AI
  Context Protocol's `acp_*` helpers** — all out of scope. No
  planning dir for any of these until a concrete need appears.
