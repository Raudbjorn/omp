# Tasks — ACP-CLI Provider

Order is important: earlier tasks unblock later ones. Each task is
2–4 hours and traces back to one or more requirements (see
`requirements.md`). Treat as a work breakdown, not a final PR — we'll
still slice PRs thematically when shipping.

## Phase 1 — Foundations

### T1. JSON-RPC codec + tolerant line reader  *(requires R18)*
- New: `packages/ai/src/providers/acp-cli/jsonrpc-codec.ts`
- Line-delimited JSON reader with non-JSON line skip.
- Id-correlated request/response, notification dispatch by method.
- Unit tests: id correlation, chunked / partial lines, non-JSON noise,
  request timeout, cancellation via `AbortSignal`.
- **Exit:** 100% line-reader branch coverage in `jsonrpc-codec.test.ts`.

### T2. Adapter interface + registry  *(scaffolding for T3–T6)*
- New: `packages/ai/src/providers/acp-cli/adapters/index.ts` (+ types).
- Declarative `AcpCliAdapter` interface per `design.md §3`.
- Registry keyed by `"claude" | "gemini" | "kiro" | "copilot"`.
- **Exit:** typecheck clean; fixture adapter used by codec tests.

### T3. Session driver  *(requires R12, R13, R14)*
- New: `packages/ai/src/providers/acp-cli/session.ts`.
- `AcpCliSession` class: spawn, stderr drain into ring buffer, handshake
  `initialize → (authenticate?) → session/new`, `prompt` loop.
- Clean shutdown: SIGTERM on turn-cancel + session-close.
- Integration test against `test/fixtures/fake-acp-server.mjs`.
- **Exit:** full handshake + two prompts + close, green test.

## Phase 2 — Vendor Adapters

### T4. Claude Code adapter  *(requires R2, R3, R4, R6, R9)*
- New: `adapters/claude.ts`.
- `detect` via `which claude` / `claude --version`.
- `probeAuth` via `claude --list-models` (exit 0 ⇒ logged in).
- `listModels` via same call, line-delimited parse; static fallback list
  constant at top of file.
- Login command: `claude login`.
- **Exit:** adapter tests pass with mocked `Bun.spawn`.

### T5. Gemini CLI adapter  *(requires R2, R3, R4, R6, R9, R18)*
- New: `adapters/gemini.ts`.
- `detect` via `gemini --version`.
- `probeAuth`: try ACP handshake short-timeout with `--acp`, fall back
  to `--experimental-acp`.
- `listModels` via `gemini model list`.
- `acceptStdoutLine`: filter known non-JSON log prefixes
  (`Loaded cached credentials.`, `Using project:`, etc.).
- Login command: `gemini auth login`.
- Doc note about sandbox workaround for issue #22782.
- **Exit:** adapter tests pass; non-JSON filter exercised.

### T6. Copilot CLI adapter  *(requires R2, R3, R4, R6, R9)*
- New: `adapters/copilot.ts`.
- `detect`: prefer `github-copilot-cli`, fall back to `copilot`.
- `probeAuth` via `gh auth status` (or CLI's native command).
- `listModels`: try `github-copilot-cli list-models`; on failure, static
  fallback (grok-code, gpt-5-mini, claude-sonnet-4.5, etc.).
- Login command: `copilot auth login`.
- **Exit:** adapter tests pass.

### T7. Kiro CLI adapter  *(requires R2, R3, R4, R6, R9)*
- New: `adapters/kiro.ts`.
- `detect` via `kiro --version`.
- `probeAuth`: check `~/.config/kiro/credentials` existence.
- `listModels`: static `[{ id: "kiro-v1", ... }]`.
- Login command: `kiro auth login`.
- **Exit:** adapter tests pass.

## Phase 3 — Proxying back to the client

### T8. Filesystem proxy  *(requires R16, NF6)*
- New: `acp-cli/fs-proxy.ts`.
- Handlers for `fs/read_text_file` and `fs/write_text_file` that
  delegate to omp's `capability/fs` module.
- Unit tests: path traversal rejection (absolute, `..`, symlink escape),
  binary-file rejection, EOL normalization parity with built-in tools.
- **Exit:** round-trip read + write through the real capability layer.

### T9. Permission proxy  *(requires R17)*
- New: `acp-cli/permission-proxy.ts`.
- Translate `session/request_permission` to omp's existing approval
  flow. Respect auto-approve config.
- **Exit:** interactive + auto-approve paths tested with mocked UI.

### T10. Event bridge  *(requires R15)*
- New: `acp-cli/event-bridge.ts`.
- Map `session/update` variants to `AssistantMessageEvent`.
- Snapshot tests with canned `session/update` payloads.
- **Exit:** mappings cover all 5 variants in `design.md §6`.

## Phase 4 — Wire-up

### T11. `streamAcpCli` provider entrypoint  *(requires R12, R15)*
- New: `packages/ai/src/providers/acp-cli.ts`.
- Shape matches `packages/ai/src/providers/devin.ts`.
- Loads adapter from registry by `model.api` → `model.provider`.
- Emits `AssistantMessageEventStream` backed by `AcpCliSession`.
- **Exit:** one end-to-end test via fake ACP server.

### T12. `stream.ts` dispatch + `models.json` + type  *(requires R12)*
- Add `case "acp-cli-agent": return streamAcpCli(...)` in
  `packages/ai/src/stream.ts`.
- Add `"acp-cli-agent"` to `Api` union in `packages/ai/src/types.ts`.
- Seed `packages/ai/src/models.json` with one model per CLI
  (the static fallback).
- **Exit:** typecheck passes; smoke test selects an ACP-CLI model.

### T13. `loginAcpCli` + OAuth registry wiring  *(requires R1, R4, R8)*
- Extend `OAuthProvider` union in `oauth/types.ts` with four IDs.
- Add four entries in `builtInOAuthProviders` (oauth/index.ts).
- New: `oauth/acp-cli.ts` with `loginAcpCli` that runs the vendor's
  login command in an inherited-stdio subprocess and re-probes on exit.
- Dispatch in `auth-storage.ts`.
- **Exit:** `/login` selector shows four new entries.

### T14. `/login` selector rendering  *(requires R1, R2, R3, R4, R5)*
- Edit `packages/coding-agent/src/slash-commands/builtin-registry.ts`
  (and whatever selector component the existing handler uses — follow
  the handler's call tree).
- Show status column: `logged in` / `logged out` / `not installed`.
- Show hint column: install command or login command.
- **Exit:** visual smoke test in a real terminal.

## Phase 5 — Hardening + Docs

### T15. Error surfacing  *(requires R19, R20)*
- Central `errors.ts`: `AcpCliError` taxonomy.
- Map `auth_required` handshake failure to friendly toast + login hint.
- Tail stderr ring buffer into error messages when CLI exits non-zero.
- **Exit:** integration test covering forced crash + surfaced message.

### T16. Timeouts + cache for model discovery  *(requires R7, R10, R11)*
- 5-second default timeout for `probeAuth` + `listModels`.
- 24-hour cache, invalidated on explicit `/login` re-probe.
- Persisted via the same SQLite store used by `AuthStorage`
  (new small table or key prefix — confirm approach with AuthStorage
  during T13).
- **Exit:** cache hit path covered by tests; TTL verified.

### T17. Documentation updates
- Append an "ACP-CLI providers" section to `docs/tui-runtime-internals.md`
  (or the closest developer-facing doc).
- Add a short section to `README.md` pointing users at `/login`.
- Flag Gemini sandbox caveat and Copilot fallback behavior.
- **Exit:** doc updates land in the same PR as T14/T15.

## Out-of-plan follow-ups

- SACP migration (conductor + proxy chains).
- MCP-over-ACP bridging (`sacp-rmcp`).
- Parallel multi-agent fan-out (ties into existing swarm extension).

## Traceability matrix

| Task  | Requirements                     |
|-------|----------------------------------|
| T1    | R18                              |
| T2    | scaffolding                      |
| T3    | R12, R13, R14                    |
| T4    | R2, R3, R4, R6, R9               |
| T5    | R2, R3, R4, R6, R9, R18          |
| T6    | R2, R3, R4, R6, R9               |
| T7    | R2, R3, R4, R6, R9               |
| T8    | R16, NF6                         |
| T9    | R17                              |
| T10   | R15                              |
| T11   | R12, R15                         |
| T12   | R12                              |
| T13   | R1, R4, R8                       |
| T14   | R1, R2, R3, R4, R5               |
| T15   | R19, R20                         |
| T16   | R7, R10, R11                     |
| T17   | R3, R4 (documentation surface)   |
