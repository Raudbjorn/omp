# Requirements — Deferred ACP-adjacent Work

EARS format. Legend: **R** = functional, **NF** = non-functional, **C** = constraint.

## W1 — MCP Bridging

**R1.1** WHEN a user starts an ACP-CLI session with MCP servers
configured in omp THEN the system SHALL advertise those servers to
the CLI agent during `initialize` via the `mcpServers` capability.

**R1.2** WHEN the CLI agent invokes a tool exposed by an omp-hosted
MCP server THEN the system SHALL route the call through omp's
existing `packages/coding-agent/src/mcp/manager.ts` (`callTool`) and
return the result on the ACP channel.

**R1.3** WHEN an MCP server is added or removed from omp's config
mid-session THEN the system SHALL notify the CLI agent via the
capability-refresh mechanism (or surface that refresh requires a
new session if the SDK does not support live updates).

**R1.4** IF the CLI agent declares its own MCP servers in its
`initialize` response THEN the system MAY surface those servers as
read-only discovery to the user (feature-flagged; off by default).

**NF1.1** MCP tool calls routed via ACP SHALL preserve the same
per-tool permission and allowlist behavior as direct tool calls.

**NF1.2** MCP bridging SHALL add no dependency beyond
`@agentclientprotocol/sdk` and `@modelcontextprotocol/sdk`, both
already in `packages/coding-agent`.

## W2 — SACP Migration

**R2.1** WHEN the `agent-client-protocol` TS SDK v1.0 is published
THEN the system SHALL evaluate it against a documented checklist
(link-builder API, session-scoped closures, starvation-free async,
backwards-compat with v0.16 message shapes).

**R2.2** IF v1.0 ships with breaking changes THEN the system SHALL
migrate ACP **server** (`modes/acp/acp-agent.ts`) and ACP **client**
(`providers/acp-cli/session.ts`) together in a single PR to keep
wire-format consistent.

**R2.3** WHEN the migration lands THEN all existing ACP server
integration tests SHALL continue to pass unchanged.

**C2.1** SACP (the Rust crate suite) SHALL NOT be adopted directly.
We port **patterns** — composable link builders, tolerant codec,
session-scoped closures — into TypeScript.

**C2.2** The migration SHALL NOT be attempted before v1.0 stable;
tracking only until then.

## W3 — Worker Pools

**R3.1** WHEN the first ACP-CLI turn is sent for a given `(adapter,
cwd)` key THEN the system SHALL look up or pre-warm a child process
from a pool rather than spawning a new one per turn.

**R3.2** WHEN a session closes THEN the system SHALL return its
child process to the pool (if clean) or terminate it (if errored).

**R3.3** WHEN the pool reaches its maximum size THEN the system
SHALL queue new session requests and apply backpressure — emitting
a structured "pool-saturated" event rather than spawning over the
limit.

**R3.4** IF a pooled child has been idle longer than the configured
TTL THEN the system SHALL terminate it on the next sweep.

**R3.5** WHEN a pooled child exits unexpectedly THEN the system
SHALL remove it from the pool and NOT return it to waiters; the
next request gets a fresh spawn.

**NF3.1** Default pool size per adapter SHALL be
`min(cpuCount, 4)`; maximum pool size SHALL be configurable via
`acp-cli.<kind>.poolMax`.

**NF3.2** Default idle TTL SHALL be 10 minutes.

**NF3.3** Pool overhead (memory, file descriptors) SHALL be
observable via a debug command; no silent growth.

## W4 — AI Context Protocol Tools (L3 Conformance)

**Note on scope:** these are the AI Context Protocol's
`acp_check_constraints` / `acp_query` / `acp_expand` / `acp_debug`
tools. This is a different protocol from the Agent Client Protocol
despite sharing the acronym. Requirements are scoped to "what would
adopting this mean for omp."

**R4.1** WHEN a codebase contains an `.acp.cache.json` at the repo
root THEN the system MAY surface its contents as a new capability
(read-only) via a new MCP server or built-in tool.

**R4.2** WHEN an agent calls `acp_check_constraints` on a file
THEN the system SHALL look up the file's lock level (frozen /
restricted / approval-required / tests-required / docs-required) in
the cache and return the match.

**R4.3** IF a lock level of `frozen` applies THEN the system SHALL
refuse the edit before routing it through the tool-approval flow.

**R4.4** IF a lock level of `restricted` or `approval-required`
applies THEN the system SHALL inject an explanation-required prompt
into the approval UI.

**C4.1** omp SHALL NOT build the cache itself in this plan. An
external tool (`acp-cli` / `acp index` from the AI-Context-Protocol
project) generates the cache; we only consume it.

**C4.2** The tools SHALL ship behind a feature flag
(`features.acpContext = false` by default) given the protocol is
separate, externally-owned, and not yet load-bearing for omp.

## W5 — HTTP Exit-Code Mapping

**R5.1** WHEN omp is invoked in a non-interactive "serve" mode
(new CLI flag) THEN the system SHALL expose an HTTP endpoint that
accepts a prompt + adapter selector and returns the response with
exit-code-derived HTTP status.

**R5.2** WHEN the underlying CLI exits with code `0` THEN the HTTP
response SHALL be `200 OK`.

**R5.3** WHEN the CLI exits with code `1` THEN the HTTP response
SHALL be `500 Internal Server Error` with stderr tail in the body.

**R5.4** WHEN the CLI exits with code `42` THEN the HTTP response
SHALL be `400 Bad Request`.

**R5.5** WHEN the CLI exits with code `53` THEN the HTTP response
SHALL be `429 Too Many Requests` with a `Retry-After` header.

**R5.6** WHEN the CLI exits with any other non-zero code THEN the
HTTP response SHALL default to `502 Bad Gateway` and include the raw
exit code in the body.

**NF5.1** The HTTP facade SHALL support both request/response and
SSE modes (the SSE variant streams `session/update` events as
they arrive).

**NF5.2** The HTTP facade SHALL be disabled by default; enabling it
SHALL require an explicit `--http <port>` flag.

**C5.1** The HTTP facade SHALL NOT become omp's primary interface;
it is an opt-in automation surface.

## W6 — stream-json Event Taxonomy (Claude-Code Headless)

**R6.1** WHEN the user selects the Claude Code CLI in **headless**
(not ACP) mode with `--output-format stream-json` THEN the system
SHALL parse the newline-delimited JSON stream from stdout.

**R6.2** WHEN an `init` event arrives THEN the system SHALL record
the `session_id` and `model` for downstream metadata.

**R6.3** WHEN a `message` event arrives THEN the system SHALL emit
an `AssistantMessageEvent` text-delta with its content chunk.

**R6.4** WHEN a `tool_use` event arrives THEN the system SHALL emit
a `tool-call` event carrying the tool name and serialized arguments.

**R6.5** WHEN a `tool_result` event arrives THEN the system SHALL
emit a `tool-call-progress` event correlated by tool-use id.

**R6.6** WHEN an `error` event arrives THEN the system SHALL treat
it as non-fatal, surface it as a warning, and continue reading.

**R6.7** WHEN a `result` event arrives THEN the system SHALL emit
an end-of-turn event including token-usage breakdown.

**R6.8** WHEN an unknown event type arrives THEN the system SHALL
log at `trace` and ignore, mirroring the ACP codec's tolerance.

**NF6.1** The stream-json parser SHALL share the same tolerant
line-reader implementation as the ACP JSON-RPC codec to avoid
divergence.

**C6.1** stream-json is an **alternative** to ACP mode, not a
replacement — the Claude Code adapter SHALL pick ACP when
available and fall back to stream-json only if the ACP flag is
rejected.

## Traceability (workstream → primary touch points)

| Req  | Touch points                                                       |
|------|--------------------------------------------------------------------|
| W1   | `coding-agent/src/mcp/manager.ts`, `providers/acp-cli/session.ts`  |
| W2   | `coding-agent/src/modes/acp/`, `providers/acp-cli/session.ts`       |
| W3   | `providers/acp-cli/pool.ts` (new), `providers/acp-cli/session.ts`   |
| W4   | new: `coding-agent/src/acp-context/`, feature flag in config        |
| W5   | new: `coding-agent/src/serve/http.ts`, `cli.ts` flag                |
| W6   | `providers/acp-cli/stream-json.ts` (new), adapter `claude.ts`       |
