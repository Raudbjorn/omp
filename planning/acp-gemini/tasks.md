# Tasks — ACP-Gemini MVP

Rough budget: **~1.5 weeks** of focused work across six phases
(1a–1f). Each task is 2–4 hours; each exit criterion is a bar the PR
reviewer can check.

All tasks trace back to requirements in `requirements.md`.

## Phase 1a — Scaffolding (≈2 days)

### T1. Register `"acp-agent"` Api type *(R1, R2)*
- Edit `packages/ai/src/api-registry.ts`: add `"acp-agent"` to `Api`
  union and `BUILTIN_APIS` set.
- Edit `packages/ai/src/stream.ts`: add
  `case "acp-agent": return streamAcp(...)` (placeholder target).
- Add a no-op `packages/ai/src/providers/acp/index.ts` exporting
  `streamAcp` (throws `NotImplemented`).
- **Exit:** typecheck clean, no new runtime behavior.

### T2. Module skeleton under `providers/acp/` *(structural)*
- Create empty files: `stream.ts`, `process.ts`, `client.ts`,
  `event-mapping.ts`, `stop-reason.ts`, `fs-proxy.ts`,
  `permissions.ts`, `auth-probe.ts`, `cli/types.ts`,
  `cli/gemini.ts`.
- Each file has its exports declared and compiles (bodies may throw).
- **Exit:** `bun run typecheck` green across `packages/ai`.

### T3. `filterNonJsonLines` Transform + unit tests *(R7)*
- Implement the ~20-line `Transform` in `process.ts`.
- Unit tests in `process.test.ts`: feed mixed buffers (credentials
  line, `<EPHEMERAL_MESSAGE>` block, half-line split across chunks,
  valid frame, empty line, leading whitespace).
- **Exit:** 100% branch coverage on the transform; no valid frame
  ever dropped.

### T4. `mapStopReason` + tests *(R17)*
- Implement pure function in `stop-reason.ts`.
- Exhaustive switch with `never` assertion for unknown variants.
- Unit tests: each of `end_turn`, `max_tokens`, `tool_use`,
  `cancelled`, `refusal`.
- **Exit:** `stop-reason.test.ts` green.

## Phase 1b — Core protocol plumbing (≈2 days)

### T5. `spawnAcp` wrapper *(R6)*
- `process.ts`: `spawnAcp(adapter, config)` returns
  `{ child, stdinWriter, filteredStdout, stderrDrain }`.
- `stdio: ['pipe','pipe','pipe']`, `subprocess.unref()` left to
  caller (after `initialize` success).
- stderr → DEBUG logger, bounded ring buffer for later error tails.
- **Exit:** integration test spawns `bash -c 'echo {}; cat >/dev/null'`
  and confirms stdout framing round-trips.

### T6. `client.ts` wrapping `ClientSideConnection` *(R10–R12, R18, R21)*
- Wire `ClientSideConnection` from `@agentclientprotocol/sdk` onto
  the filtered stdout + raw stdin.
- Handlers: `readTextFile` → fs-proxy, `writeTextFile` → fs-proxy,
  `requestPermission` → permissions policy, `sessionUpdate` →
  event-mapping queue.
- **Exit:** fake ACP server fixture sends a frame, `client.ts`
  resolves it via SDK; no hand-rolled codec needed.

### T7. `event-mapping.ts` state machine *(R13–R16)*
- Implement the span state machine (`none | text | thought | tool`).
- Unit tests: sequence of mixed updates from `wire-trace.md §3`
  replayed; assert the exact omp event sequence.
- **Exit:** canned wire-trace replay matches snapshot.

### T8. `stream.ts` orchestrator (Gemini only) *(R10–R17)*
- Put it all together: `probeAuth` → `spawnAcp` → `ClientSideConnection`
  → `initialize` → `session/new` → `session/prompt` → yield events
  from event-mapping queue → `mapStopReason` on response.
- Timeouts per `design.md §12`.
- **Exit:** full handshake + one prompt round-trip against the fake
  fixture, green.

## Phase 1c — Auth, fs, and permissions (≈1 day)

### T9. `auth-probe.ts` + `cli/gemini.ts` *(R3–R5, R23)*
- Implement `GeminiAdapter.probeAuth` per `design.md §4`.
- Stub login surface: log the command that would have been run.
- Unit tests with mocked `fs.stat` and `execFile`.
- **Exit:** four auth states returned correctly given mocked env.

### T10. `fs-proxy.ts` with symlink-escape protection *(R18–R20)*
- `scopedPath` using `path.resolve` + `fs.realpath` + `path.relative`.
- `readTextFile` with 10 MB cap and 1-indexed `line`/`limit` slicing.
- `writeTextFile` (non-atomic for MVP).
- Unit tests: `..` traversal, absolute-path escape, symlink escape
  to `/etc/passwd`, directory read, oversize read.
- **Exit:** all escape vectors return errors without reading target.

### T11. `permissions.ts` with three modes *(R21, R22)*
- Implement `makePermissionPolicy(mode)` with `auto-allow`,
  `deny-destructive`, and a `delegate` stub that throws.
- Unit tests per mode with canned `RequestPermissionRequest` payloads.
- **Exit:** default is `deny-destructive`; `fs/write_text_file`
  always allowed through (to let the user decide upstream).

## Phase 1d — UX and discovery (≈1 day)

### T12. `/login` row for Gemini CLI ACP *(R23)*
- Edit `packages/coding-agent/src/slash-commands/builtin-registry.ts`.
- Add row: `Gemini CLI (ACP) | <status> | <hint>`.
- Selecting a logged-out row runs `gemini auth login` in
  `stdio: 'inherit'` subprocess; re-probes on exit.
- Selecting a missing row copies install hint to clipboard.
- **Exit:** visual smoke test in a real terminal.

### T13. `/usage` ordering + model discovery *(R24–R26)*
- Edit `packages/ai/src/cli.ts` (`status` rows).
- Add `packages/ai/src/utils/discovery/acp.ts` with static-fallback
  list `[gemini-2.5-pro, gemini-2.5-flash]` and a `listModels` call
  that tries `gemini model list` with a 5 s timeout.
- 24 h cache keyed by adapter id.
- **Exit:** `/usage` shows Gemini CLI with auth state; model list
  populates after first use.

### T14. Seed `models.json` *(R2, R25)*
- Add `gemini-2.5-pro` and `gemini-2.5-flash` entries with
  `"api": "acp-agent"`, `"provider": "gemini-cli-acp"`.
- **Exit:** models appear in the model selector.

## Phase 1e — Integration (≈1 day)

### T15. Fake ACP server fixture *(test infra)*
- Small Node script under `packages/ai/test/fixtures/` that implements
  minimal `initialize`, `session/new`, `session/prompt`, and emits a
  canned update sequence.
- **Exit:** reusable by any `providers/acp/` test.

### T16. End-to-end integration test *(R10–R17, R18, R21)*
- Spawn the fake fixture; drive one prompt turn through real
  `streamAcp`; assert event sequence + stop reason.
- **Exit:** test passes in CI without network or vendor binary.

### T17. Manual smoke script *(out-of-CI)*
- `scripts/smoke-gemini-acp.ts`: runs a single prompt through the
  real `gemini --experimental-acp`, prints each event.
- Gated by `GEMINI_SMOKE=1`.
- **Exit:** documented in `README.md`; runs green on a logged-in
  Gemini host.

## Phase 1f — Hardening and docs (≈1 day)

### T18. Shutdown ladder + leak tests *(R8, R9)*
- Implement `gracefulShutdown(child)`: `session/cancel` → close stdin
  → `SIGTERM` (5 s) → `SIGKILL`.
- Test with a fixture that ignores `session/cancel` (forces fallback).
- Wire `process.on('beforeExit')` to kill live children.
- **Exit:** no zombie processes after test suite.

### T19. Error surfaces and stderr tails *(R15, R19 — surfacing)*
- Central `AcpError` class in `providers/acp/errors.ts`.
- Map `auth_required`, `handshake_timeout`, `child_exit_unexpected`,
  `fs_escape`, `permission_denied` to friendly messages.
- Include last N lines of stderr in `child_exit_unexpected`.
- **Exit:** forced-crash test surfaces readable message.

### T20. Docs pass
- Short developer section in a developer-facing doc (no new top-level
  README file).
- Flag: `GEMINI_CLI_ACP_TRACE=1 gemini --debug` as the recommended
  debugging knob.
- Cross-link `wire-trace.md` for anyone extending the module.
- **Exit:** doc edits land with the last code PR.

## Traceability matrix

| Task | Requirements                                |
|------|---------------------------------------------|
| T1   | R1, R2                                      |
| T2   | scaffolding                                 |
| T3   | R7                                          |
| T4   | R17                                         |
| T5   | R6                                          |
| T6   | R10–R12, R18, R21 (wiring)                  |
| T7   | R13–R16                                     |
| T8   | R10–R17 (orchestration), NF5                |
| T9   | R3–R5, R23                                  |
| T10  | R18–R20, NF6                                |
| T11  | R21, R22                                    |
| T12  | R23                                         |
| T13  | R24, R25, R26                               |
| T14  | R2, R25                                     |
| T15  | test scaffolding                            |
| T16  | R10–R17, R18, R21 (integration)             |
| T17  | developer smoke                             |
| T18  | R8, R9                                      |
| T19  | R5, R19 surfacing                           |
| T20  | doc                                         |

## Out-of-plan (explicitly NOT in this MVP)

- Claude Code adapter via `claude-agent-acp` bridge
  → `../acp-claude/`
- Copilot CLI adapter → `../acp-copilot/`
- Kiro CLI adapter → `../acp-kiro/`
- Warm subprocess pool; multi-session per child
- `session/load` / session resume
- `plan` / `available_commands` / `current_mode` as first-class omp
  events
- MCP-over-ACP fan-in (omp's MCP servers relayed to the agent)
- `delegate` permission mode (interactive approval UI)
