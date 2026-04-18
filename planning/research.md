# Research — Protocol and Library Landscape

Distilled for ACP-CLI integration. Specific quotes / citations live in
the vendor docs — this file captures what matters for the build.

## 1. Three protocols called "ACP" — disambiguation

The acronym is badly overloaded. When reading any external docs, map
back to this table before assuming anything:

| Name                          | Layer                          | Transport                   | Our use                                         |
|-------------------------------|--------------------------------|-----------------------------|-------------------------------------------------|
| **Agent Client Protocol**     | Editor/harness ↔ local agent   | JSON-RPC 2.0 over stdio     | **This is what we speak to the CLIs.**          |
| **AI Context Protocol**       | Codebase metadata / constraints | static JSON cache, tree-sitter | Not used. Different project, overlapping name.  |
| **Agent Communication Protocol (A2A)** | Agent ↔ agent (east-west) | REST / HTTP + WebSocket    | Not used. Out of scope; see out-of-plan list.   |

Also distinct: **Model Context Protocol (MCP)** handles model↔tool
(southbound). ACP agents can themselves host MCP clients; bridging MCP
over ACP (e.g. `sacp-rmcp`) is deferred.

## 2. ACP handshake: `initialize` vs `authenticate`

ACP setup runs in two sequential steps, both before any session exists.

| Step           | Purpose                                                                                     |
|----------------|---------------------------------------------------------------------------------------------|
| `initialize`   | Negotiate protocol version; exchange capabilities (fs, terminal, MCP transports); agent advertises supported auth methods. Called **once**, first. |
| `authenticate` | Verify identity using one of the advertised auth methods. Called **after** `initialize`, **before** `session/new`. Only needed if the agent requires auth. |

Successful `initialize` ⇒ capability alignment. Successful
`authenticate` ⇒ connection transitions to authenticated state; further
calls no longer get `auth_required`.

**Implication for us:** the `AcpCliSession` state machine must
distinguish "initialized" from "authenticated," and `probeAuth()` can
be as cheap as calling `initialize` + reading the auth-methods response
without actually calling `authenticate`.

## 3. Known CLI quirks we must code around

### Gemini `--acp` / `--experimental-acp`
- **Issue #22647** — stdout pollution: log lines like
  `Loaded cached credentials.` land on the JSON-RPC stream. Our codec
  must drop non-JSON lines silently.
- **Issue #22782** — indefinite hang under the default sandbox. Either
  disable sandbox in `~/.gemini/settings.json` or document the
  workaround.
- Flag name has rotated: try `--acp` first, `--experimental-acp` as
  fallback.

### Copilot CLI
- No stable `list-models` endpoint — probe and fall back to a static
  list (grok-code, gpt-5-mini, claude-sonnet-4.5, gpt-4.1, o4-mini-high,
  etc.).
- Auth status readable via `gh auth status` when installed through the
  GitHub CLI bridge.

### Claude Code
- Well-behaved: `claude --list-models` returns JSON; exit code is a
  reliable proxy for "logged in."

### Kiro CLI
- Model list is static (`kiro-v1`); no vendor discovery command.
- Auth flag is a credentials file at `~/.config/kiro/credentials`.

### Cross-cutting quirks (all four CLIs)

- **Stdout block-buffering under non-TTY.** CLIs often switch to block
  buffering when `isatty(stdout) == false`, defeating streaming. `Bun.spawn`
  gives us unbuffered piped stdio by default; we don't need `stdbuf -o0`.
  Regression check: if a future adapter shells through a wrapper
  (`npx`, `gh copilot …`), verify flush behavior before shipping.
- **TTY prompts during handshake.** A CLI that prompts for a password
  or approval on its controlling terminal will hang forever in ACP mode.
  Mitigation: we always spawn with piped stdio (no inherited TTY), and
  any auth/approval must arrive as an ACP `session/request_permission`
  or `auth_required`. If a CLI insists on a TTY, we kick it back to
  `/login` for a PTY-attached login run.
- **Sandboxing.** Gemini's default sandbox (issue #22782) is the worst
  offender; Claude Code has no sandbox; Kiro/Copilot are unknown.
  Document per-vendor.

## 4. SACP suite (Symposium ACP)

SACP is a set of Rust crates that will become the foundation of the
`agent-client-protocol` v1.0 SDK. Relevant pieces:

- **`sacp-conductor`** — orchestrates proxy chains; bridges MCP tools
  over ACP transparently for agents that don't support MCP natively.
- **`sacp-tokio`** — starvation-free Tokio integration (`run_until`
  pattern) for non-blocking JSON-RPC loops. Crate is transitioning to
  `agent-client-protocol-tokio`.
- **`sacp-rmcp`** — the bridge that makes MCP servers reachable over
  ACP channels.
- **`sacp-tee`** — tracing proxy (logs all traffic before forwarding).
- **`sacp-trace-viewer`** — interactive sequence-diagram viewer.
- **`sacp-test`** — mocking + test infrastructure.
- **Builder / link types** — replaces ad-hoc handlers with explicit
  `ClientToAgent` / `AgentToClient` link builders and session-scoped
  closures.

**Decision (C1):** we stay on `@agentclientprotocol/sdk@0.16.1` for
now. SACP is Rust; omp's ACP agent is TypeScript and already working
against IDEs. Revisit once the v1.0 TypeScript SDK lands.

## 5. Rust libraries — reference only (we are not writing Rust)

For future reference if we ever extract this work into a Rust binary:

| Library                     | Role                                                |
|-----------------------------|-----------------------------------------------------|
| `agent-client-protocol`     | Official Rust SDK, agent + client sides             |
| `sacp-*` suite (above)      | Next-gen composable architecture                    |
| `gate4agent`                | Multi-transport agent bridging (ACP / pipes / PTY)  |
| `acpx`                      | Toolkit for ACP clients, proxies, orchestrators     |

Not adopted in this plan. The Rust proxies at
`/home/svnbjrn/ais/acp-proxy` and `/home/svnbjrn/ais/resources/llm-proxy`
were studied for patterns (see `prototypes.md`) but not used as
dependencies.

## 6. Security boundary notes

The harness is the trust boundary between the user and a
permission-granted subprocess that speaks to an LLM. Three concrete
concerns to design against:

- **Spawn-arg injection.** Every `Bun.spawn` call uses the
  array-of-strings form. No shell interpolation, no `shell: true`, no
  string concatenation of user-controlled values into argv. Applies to
  adapter detect/probe/list commands and to the login PTY flow.
- **Path traversal via fs-proxy.** `fs/read_text_file` /
  `fs/write_text_file` arguments come from the CLI/LLM; an adversarial
  or confused model can send absolute paths or `..` sequences. We
  canonicalize through the existing `capability/fs` module and reject
  anything that escapes the session cwd. Covered by T8.
- **Permission fatigue → auto-allow mistakes.** `session/request_permission`
  must not default to allow. We reuse omp's interactive approval UI
  and respect only the user's existing auto-approve config — we don't
  invent a new, looser policy.

These are not new threats introduced by ACP; they are the same
concerns built-in tools already handle. The requirement is parity,
not a new surface.

## 7. Directly relevant omp prior art

- **rzp-labs ACP multi-session** (`8f3b3f1c7`) — omp's existing ACP
  **server** side. Lives in `packages/coding-agent/src/modes/acp/`.
  Does not overlap with this plan; we are adding an ACP **client**
  surface on the provider side.
- **Devin / Warp providers** (`1dda44167`) — nearest-analog pattern for
  a new provider module. The new `acp-cli.ts` mirrors their shape.
- **UPB AI Gateway** (`a4fd39df4`) — another provider-with-credentials
  precedent. Shows where `api-key` credentials are persisted in
  `AuthStorage`.
- **OAuth providers guide** (`ebc74bd47`) — the doc we'll follow (and
  extend) for the `/login` UX changes in T14.

## 8. Deferred: broader ACP ecosystem

Captured so we don't re-research next time someone asks:

- **L3 (Full) Conformance tools** — `acp_check_constraints`, `acp_query`,
  `acp_expand`, `acp_debug`. These belong to the **AI Context Protocol**
  (constraint/metadata layer), not the Agent Client Protocol we're
  implementing. Only relevant if omp grows a codebase-metadata index.
- **MCP-over-ACP bridging** (`sacp-rmcp`, `acp-mcp-server`) — lets
  agents without native MCP support call MCP tools through their ACP
  channel. omp is the client side here; bridging is agent-side work.
- **SSE resume via `Last-Event-ID`** — relevant if/when we expose ACP
  over HTTP for remote agents. Our single-host stdio transport doesn't
  drop connections the same way.
- **`deploy-to-vercel`-style remote proxies** — not applicable; we are
  local-first.
