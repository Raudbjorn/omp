# Tasks — Deferred ACP-adjacent Work

Grouped by workstream. Tasks within a workstream are sequential;
workstreams themselves are independent and can ship separately.
Each task is ~2–4 hours and traces back to requirements in
`requirements.md`.

## W1 — MCP Bridging

### T1.1 Shape the `McpBridge` interface  *(R1.1, R1.2)*
- New: `packages/ai/src/providers/acp-cli/mcp-bridge.ts` with the
  interface from `design.md §1.2`.
- No implementation yet; typecheck-clean stub.
- **Exit:** types compile and are exported.

### T1.2 `describe()` + initialize wiring  *(R1.1)*
- Implement `describe()` to project `MCPManager`'s connected servers
  into ACP `McpServer[]`.
- Plumb into `AcpCliSession.initialize()` payload.
- Unit tests: snapshot of `describe()` output for a 2-server fixture.
- **Exit:** initialize payload now includes MCP servers.

### T1.3 `handleToolCall()` implementation  *(R1.2)*
- Route ACP tool_call → `MCPManager.callTool` → ACP tool_result.
- Preserve per-tool permission flow (reuse `permission-proxy.ts`).
- Tests: tool call round-trip against a stub MCP server.
- **Exit:** CLI agent can invoke an omp MCP tool end-to-end.

### T1.4 Subscription to MCP changes  *(R1.3)*
- Watch `MCPManager` add/remove events; push capability update or
  mark the session as stale.
- Tests: add-then-remove, assert the right notification emits.
- **Exit:** live-update path exercised.

### T1.5 (optional, flagged) Surface agent's MCP servers  *(R1.4)*
- Feature flag `features.acpShowAgentMcp` (default off).
- Read `initialize` response's `mcpServers`, render in a debug view.
- **Exit:** flag on → server list visible; flag off → no change.

## W2 — SACP Migration

### T2.1 Track TS SDK v1.0 releases  *(C2.2)*
- Add a CHECKLIST.md here for the v1.0 evaluation criteria
  (`design.md §2.2`).
- Subscribe via `gh repo set-notifications zed-industries/agent-client-protocol`.
- **Exit:** CHECKLIST committed; no code change.

### T2.2 Evaluation spike (only when v1.0 ships)  *(R2.1)*
- On release, run through CHECKLIST. Produce go/no-go memo.
- **Exit:** memo merged; decision recorded.

### T2.3 Migration PR (only if go)  *(R2.2, R2.3)*
- Single PR migrates both server (`modes/acp/acp-agent.ts`) and
  client (`providers/acp-cli/session.ts`).
- All existing ACP integration tests pass unchanged.
- **Exit:** green CI; release notes drafted.

## W3 — Worker Pools

### T3.1 Pool interface + in-memory skeleton  *(R3.1)*
- New: `packages/ai/src/providers/acp-cli/pool.ts`.
- Empty implementations + typed interface per `design.md §3.2`.
- **Exit:** types + scaffolding land.

### T3.2 Acquire / release state machine  *(R3.1, R3.2)*
- Implement `free` / `busy` sets, FIFO waiter queue.
- Every `acquire` returns a disposable-friendly handle.
- Unit tests: acquire-release happy path, queue draining.
- **Exit:** basic pool passes contract tests.

### T3.3 Spawn-on-demand + pool-max gating  *(R3.3)*
- Spawn when `free` is empty and `busy.size < max`.
- Past max → queue + backpressure event (no over-spawning).
- Tests: scripted 10-concurrent requests against max=3, assert
  exactly 3 spawns, 7 queue entries.
- **Exit:** saturation behavior verified.

### T3.4 Idle sweeper + TTL  *(R3.4)*
- Background interval (default 60s) kills children idle > TTL.
- Config hook: `acp-cli.<kind>.idleTtlMs`.
- Tests: fake clock + scripted idle time.
- **Exit:** idle reaping exercised.

### T3.5 Crash handling  *(R3.5)*
- Detect child exit; if busy, surface `child-exited-unexpectedly`
  to owning session; if free, silently drop.
- **Exit:** tests cover both branches.

### T3.6 Integration with `AcpCliSession`  *(R3.1, R3.2)*
- Route `session.open()` through `pool.acquire()`.
- Route `session.close()` through `pool.release()` or `pool.discard()`.
- End-to-end test: two sessions share one pool, assert one spawn
  across them.
- **Exit:** session path uses the pool.

### T3.7 Observability  *(NF3.3)*
- `omp debug acp-pool` command prints `pool.stats()`.
- Add metrics logging to the existing telemetry surface.
- **Exit:** operator can introspect pool state.

## W4 — AI Context Protocol Tools (feature-flagged)

### T4.1 Feature flag + MCP server skeleton  *(C4.2)*
- New dir: `packages/coding-agent/src/acp-context/`.
- Register as a built-in MCP server, gated on `features.acpContext`.
- **Exit:** flag on → server appears in `/mcp` list; flag off → absent.

### T4.2 Cache reader with schema validation  *(R4.1)*
- Parse `.acp.cache.json` at cwd; validate with Typebox schema.
- Tests: malformed cache, missing cache, version mismatch.
- **Exit:** reader returns typed data or a precise error.

### T4.3 `acp_check_constraints` tool  *(R4.2)*
- Maps file path → lock level via cache lookup.
- **Exit:** snapshot tests for each of the 5 lock levels.

### T4.4 Enforcement in edit approval  *(R4.3, R4.4)*
- Patch the edit/write tool's approval flow to consult
  `check_constraints` before prompting.
- `frozen` → hard deny; `restricted`/`approval-required` → inject
  explanation prompt into approval UI.
- **Exit:** integration test for each lock level behavior.

### T4.5 `acp_query` / `acp_expand` / `acp_debug` tools  *(R4.1)*
- Minimal read-only wrappers over the cache.
- **Exit:** each tool callable from an MCP client fixture.

## W5 — HTTP Exit-Code Mapping

### T5.1 CLI flag + bind guard  *(R5.1, NF5.2, C5.1)*
- New `--http <addr>` flag in `packages/coding-agent/src/cli.ts`.
- Default bind `127.0.0.1`; refuse `0.0.0.0` without `--http-token`.
- **Exit:** flag parses; guards unit-tested.

### T5.2 Route scaffolding  *(R5.1)*
- New: `packages/coding-agent/src/serve/http.ts`.
- Routes per `design.md §5.2`.
- Use Bun's built-in HTTP server (no new dependency).
- **Exit:** `/v1/adapters` returns detected adapters.

### T5.3 `POST /v1/prompt` + exit-code mapping  *(R5.2–R5.6)*
- Drive `AcpCliSession` to completion; map exit code via
  `EXIT_TO_HTTP` (see `design.md §5.3`).
- Include stderr tail on non-zero.
- Tests: fake child scripted to each mapped exit code.
- **Exit:** status-code mapping tested end-to-end.

### T5.4 `POST /v1/prompt/stream` — SSE  *(NF5.1)*
- Each `session/update` → SSE event. Double-newline separators.
- Error during stream → terminal `event: error` frame.
- **Exit:** curl-based smoke test works.

### T5.5 Auth for non-loopback binds
- Enforce `Authorization: Bearer <token>` when bound to non-loopback.
- **Exit:** auth bypass attempts rejected in tests.

## W6 — stream-json Event Taxonomy

### T6.1 Extract shared `line-json-reader`  *(NF6.1)*
- Move the tolerant line-reader out of `jsonrpc-codec.ts` into
  `packages/ai/src/providers/acp-cli/line-json-reader.ts`.
- Update existing imports; no behavior change.
- **Exit:** existing codec tests still green.

### T6.2 stream-json parser  *(R6.1–R6.8)*
- New: `packages/ai/src/providers/acp-cli/stream-json.ts`.
- Event type union + dispatch table.
- Tests: fixture-driven snapshot; unknown event tolerance.
- **Exit:** fixture replay produces expected omp event sequence.

### T6.3 Claude adapter fallback  *(C6.1)*
- In `adapters/claude.ts`, try `--acp` first; on recognized
  unsupported-feature error, fall back to headless stream-json.
- **Exit:** adapter test covers both paths.

### T6.4 Turn-end synthesis  *(R6.7, §6.4)*
- On child exit without a `result` event, synthesize a `turn-end`
  with exit code + stderr tail.
- **Exit:** crash scenario covered.

## Traceability matrix

| Task  | Requirements                          |
|-------|---------------------------------------|
| T1.1  | R1.1, R1.2                            |
| T1.2  | R1.1                                  |
| T1.3  | R1.2, NF1.1                           |
| T1.4  | R1.3                                  |
| T1.5  | R1.4                                  |
| T2.1  | C2.2                                  |
| T2.2  | R2.1                                  |
| T2.3  | R2.2, R2.3                            |
| T3.1  | R3.1                                  |
| T3.2  | R3.1, R3.2                            |
| T3.3  | R3.3, NF3.1                           |
| T3.4  | R3.4, NF3.2                           |
| T3.5  | R3.5                                  |
| T3.6  | R3.1, R3.2                            |
| T3.7  | NF3.3                                 |
| T4.1  | C4.2                                  |
| T4.2  | R4.1                                  |
| T4.3  | R4.2                                  |
| T4.4  | R4.3, R4.4                            |
| T4.5  | R4.1                                  |
| T5.1  | R5.1, NF5.2, C5.1                     |
| T5.2  | R5.1                                  |
| T5.3  | R5.2, R5.3, R5.4, R5.5, R5.6          |
| T5.4  | NF5.1                                 |
| T5.5  | NF5.2                                 |
| T6.1  | NF6.1                                 |
| T6.2  | R6.1–R6.8                             |
| T6.3  | C6.1                                  |
| T6.4  | R6.7                                  |

## Slicing guidance

Reasonable first-cut PRs (each independently useful):

- **PR-A: Worker pool (T3.1–T3.7)** — smallest, biggest prod win.
- **PR-B: MCP bridging (T1.1–T1.4)** — unlocks actual tool reuse.
- **PR-C: stream-json fallback (T6.1–T6.4)** — robustness for Claude.
- **PR-D: HTTP facade (T5.1–T5.5)** — only when a consumer asks.
- **PR-E: acp-context tools (T4.1–T4.5)** — only when the cache exists.
- **PR-F: SACP migration (T2.3)** — gated on upstream v1.0 release.

Obstacle protocol: if any task hits a third-attempt failure, escalate
to `BLOCKERS.md` in this folder (same convention as the parent plan).
