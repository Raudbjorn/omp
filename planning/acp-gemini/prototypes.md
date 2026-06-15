# Prototypes — Gemini-Relevant Takeaways

Two Rust proxies were referenced during planning. Neither ships in
omp; we study their code and port the **patterns**, not the code. For
the Gemini MVP, the relevant patterns are narrower than the original
"all four CLIs" plan implied.

## Prototype A — `~/ais/resources/llm-proxy`

**Role.** HTTP facade over CLI agents (OpenAI / Anthropic /
Gemini-compatible APIs). Delegates to CLI tools over stdio.
**Shape.** Rust + Tokio + Axum. Per-vendor adapter under
`src/providers/`. Hand-rolled JSON-RPC codec in
`src/providers/acp_driver.rs`.

Relevant-for-Gemini patterns we're keeping:

- **Gemini stdout filter**
  (`src/providers/gemini_cli.rs:323-330`). Ours is
  `filterNonJsonLines` in `providers/acp/process.ts`. Simpler than
  the Rust version because we don't need to classify the noise —
  `ndJsonStream` drops non-frames downstream for free once they make
  it past the "starts with `{`/`[`" gate.
- **Binary resolution via PATH probe**
  (`src/providers/native_driver.rs:160-171`). Ours is the adapter's
  `hasExecutable()` + `probeAuth`.
- **Error classification keywords**
  (`src/providers/common.rs:32-41`: `"unauthorized"`,
  `"not logged in"`, `"token expired"`). Maps into `AcpError`
  taxonomy; most of what we need is a `refusal` stopReason + stderr
  tail.
- **Model-list caching** (`src/state.rs:158-185`) — 30-min cache
  there, 24 h for us per R26.

Not ported:

- HTTP facade — omp has its own provider type.
- Process pool — MVP is single-session-per-process.
- Admin UI — out of scope.

## Prototype B — `~/ais/acp-proxy`

**Role.** ACP *server* that proxies to CLI agents (mirror of what
we're building — it sits on the agent side instead of the client
side).
**Shape.** Rust + Tokio `current_thread` + `LocalSet`, using the
official `agent-client-protocol` crate. Per-vendor `AgentBackend`
trait in `src/agents/traits.rs`.

Relevant-for-Gemini patterns we're keeping:

- **Declarative adapter trait** (mirror: our `CliAdapter` interface
  in `providers/acp/cli/types.ts`).
- **Config-driven defaults** (command + args per backend). Our
  `GeminiAdapter.spawnArgs(config)` follows the same shape.
- **Gemini JSON-first / plaintext-fallback reader**
  (`src/agents/gemini.rs:50-74`). We go further: we drop non-JSON
  lines entirely rather than attempting a plaintext path.

Not ported:

- `try_prompt() + fallback` structure in `src/acp/server.rs` — it
  existed to hedge between `--acp` and `--experimental-acp` when
  Gemini's flag was rotating. As of the version we're targeting,
  `--experimental-acp` is the flag; fallback logic is dead weight.
- File-based event-log persistence — omp has session persistence
  elsewhere.
- Separate admin HTTP server — out of scope.
- Rust async plumbing — we have `Bun.spawn` + `async/await` + the
  TS SDK's `ClientSideConnection`.

## Patterns **not** taken from any prototype

- **SDK over hand-rolled codec.** Both prototypes wrote their own
  framing because the Rust `agent-client-protocol` crate was still
  immature at the time. We have `@agentclientprotocol/sdk@0.18.2`
  with `ClientSideConnection` and `ndJsonStream` — a hand-rolled
  codec is strictly extra surface area we'd need to keep in sync.
- **Try `--acp` first, fall back to `--experimental-acp`.** The
  original plan carried this. It's obsolete: `--experimental-acp`
  is the current flag; `--acp` returns immediately with an error on
  current Gemini builds. Adapter just uses `--experimental-acp`.

## Decision summary (Gemini MVP scope)

| Pattern                          | Source    | Ported? | Where                           |
|----------------------------------|-----------|---------|---------------------------------|
| Per-vendor adapter               | A, B      | ✔       | `providers/acp/cli/gemini.ts`   |
| Declarative adapter interface    | B         | ✔       | `providers/acp/cli/types.ts`    |
| Gemini non-JSON stdout filter    | A, B      | ✔       | `providers/acp/process.ts`      |
| PATH probe / binary resolution   | A         | ✔       | `providers/acp/auth-probe.ts`   |
| Auth-error keyword map           | A         | ⚠       | inline in `AcpError` taxonomy only as needed |
| Model-list caching (24 h)        | A         | ✔       | `utils/discovery/acp.ts`        |
| Hand-rolled JSON-RPC codec       | A         | ✗       | SDK provides it                 |
| `--acp`/`--experimental-acp` fallback | B    | ✗       | obsolete flag rotation          |
| HTTP facade                      | A         | ✗       | —                               |
| Process pool                     | A         | ✗       | MVP is single-session-per-proc  |
| Admin UI                         | A, B      | ✗       | —                               |
| File-based event log             | B         | ✗       | omp has session persistence     |
| Official ACP crate adoption      | B         | ✗ (TS)  | TS SDK instead                  |
