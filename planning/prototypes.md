# Prototypes — What We Keep, What We Discard

Two Rust proxies were referenced during planning. Neither ships in
omp; we study their code and port the **patterns**, not the code.

## Prototype A — `~/ais/resources/llm-proxy`

- **Role:** HTTP facade over CLI agents (exposes OpenAI /
  Anthropic / Gemini-compatible APIs). Delegates to CLI tools over
  stdio.
- **Shape:** Rust + Tokio + Axum. Per-vendor adapter module under
  `src/providers/`. Hand-rolled JSON-RPC codec in
  `src/providers/acp_driver.rs`.

**What we're porting conceptually:**

- Adapter-per-vendor layout (`claude_code.rs`, `gemini_cli.rs`,
  `copilot_cli.rs`, `kiro_cli.rs`).
- Binary resolution via `which`-style PATH probe
  (`src/providers/native_driver.rs:160-171`).
- Error classification in `src/providers/common.rs:32-41` — keywords
  like `"unauthorized"`, `"not logged in"`, `"token expired"`. Our
  TS equivalent lives in `acp-cli/errors.ts`.
- Gemini stdout filter (`src/providers/gemini_cli.rs:323-330`). Ours
  is the adapter's `acceptStdoutLine()` hook + codec fallback.
- 30-minute model-list cache + aggregator
  (`src/state.rs:158-185`). Our cache is 24h per `R11` but the
  lazy aggregator pattern maps 1:1.

**What we're not porting:**

- HTTP-API compatibility layer — omp already has its own provider
  type, we plug into that instead.
- Process pool — overkill for a developer tool with 1–few active
  sessions.
- Admin UI backend — out of scope.

## Prototype B — `~/ais/acp-proxy`

- **Role:** ACP server that proxies to CLI agents (i.e. the mirror of
  what we're building — it sits on the agent side instead of the
  client side).
- **Shape:** Rust + Tokio `current_thread` + `LocalSet`. Uses the
  **official `agent-client-protocol` crate**. Per-vendor `AgentBackend`
  trait in `src/agents/traits.rs`. File-based session persistence in
  `src/persistence.rs`.

**What we're porting conceptually:**

- Declarative `AgentBackend`-like trait (ours: `AcpCliAdapter`).
- Config-driven defaults (command + args per backend).
- `try_prompt() + fallback` structure in
  `src/acp/server.rs:120-189` — pattern we reuse for "try `--acp`,
  fall back to `--experimental-acp`."
- Gemini JSON-first / plaintext-fallback reader
  (`src/agents/gemini.rs:50-74`). We're going further than this:
  ours drops non-JSON lines silently.

**What we're not porting:**

- Event-log persistence to disk — omp already has session persistence
  elsewhere; adding a second store would be duplication.
- Separate admin HTTP server — out of scope.
- Rust async plumbing — we use `Bun.spawn` + plain async/await.

## Decision summary

| Pattern                          | Source    | Ported? | Where                          |
|----------------------------------|-----------|---------|--------------------------------|
| Per-vendor adapter modules       | A, B      | ✔       | `acp-cli/adapters/*.ts`        |
| Hand-rolled JSON-RPC codec       | A         | ✔       | `acp-cli/jsonrpc-codec.ts`     |
| Auth error keyword classification| A         | ✔       | `acp-cli/errors.ts`            |
| Gemini non-JSON filter           | A, B      | ✔       | `jsonrpc-codec.ts` + adapter   |
| Model-list caching               | A         | ✔       | `acp-cli/models.ts`            |
| try_prompt fallback loop         | B         | ✔       | `acp-cli/session.ts` (flag)    |
| HTTP facade                      | A         | ✗       | —                              |
| Process pool                     | A         | ✗       | —                              |
| Admin UI                         | A, B      | ✗       | —                              |
| File-based event log             | B         | ✗       | (omp has its own)              |
| Official ACP crate adoption      | B         | ✗ (TS)  | stay on existing SDK version   |
