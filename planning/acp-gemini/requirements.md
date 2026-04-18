# Requirements — ACP-Gemini Provider

Format: EARS (Easy Approach to Requirements Syntax).
Legend: **R** = functional, **NF** = non-functional, **C** = constraint.

Unless explicitly generalized, every requirement is scoped to the
Gemini CLI adapter and the shared `packages/ai/src/providers/acp/`
core. Sibling plans (`../acp-claude/`, etc.) will reuse the core and
add adapter-local requirements.

## 1. Api type and registration

**R1.** WHEN `packages/ai/src/api-registry.ts` is loaded THEN the
system SHALL expose a new Api identifier `"acp-agent"` in both the
`Api` union type and the `BUILTIN_APIS` set.

**R2.** WHEN a model in `models.json` declares `"api": "acp-agent"`
with `"provider": "gemini-cli-acp"` THEN the global `stream()`
dispatcher SHALL route through `packages/ai/src/providers/acp/stream.ts`.

## 2. Auth-before-spawn discipline

**R3.** WHEN the ACP stream function is invoked THEN the system SHALL
run `probeAuth()` for the selected adapter **before** spawning any
child process. A subprocess SHALL NOT be used to detect auth state.

**R4.** WHEN the Gemini adapter runs `probeAuth()` THEN the system
SHALL report one of `{missing, logged_out, logged_in_oauth, logged_in_api_key}` via:
- `gemini --version` exit status and parsed version string for
  existence + version range.
- presence and mtime of `~/.gemini/oauth_creds.json` for OAuth login.
- presence of `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in the process
  environment for API-key login.

**R5.** IF `probeAuth()` returns `missing` or `logged_out` THEN the
stream function SHALL yield a structured error
`{error: "auth_required", hint: "run `gemini auth login`"}` and SHALL
NOT attempt to spawn the child.

## 3. Process lifecycle

**R6.** WHEN spawning the Gemini child THEN the system SHALL use
`stdio: ['pipe','pipe','pipe']` (never `'inherit'`), detach the child
with `subprocess.unref()` after successful `initialize`, and route
stderr to a structured DEBUG logger.

**R7.** WHEN the child's stdout emits a line that fails `JSON.parse`
THEN the system SHALL drop the line silently at DEBUG level without
erroring the stream. (Workaround for Gemini issue #22647: `Loaded
cached credentials.` and `<EPHEMERAL_MESSAGE>…</EPHEMERAL_MESSAGE>`
frames on stdout.)

**R8.** WHEN terminating a session THEN the system SHALL execute the
shutdown ladder: `session/cancel` (10 s) → `SIGTERM` (5 s) → `SIGKILL`.

**R9.** WHEN the parent omp process exits THEN the system SHALL
terminate all live ACP child processes via the same ladder; no child
SHALL outlive the parent.

## 4. ACP handshake

**R10.** WHEN a new ACP session is required THEN the system SHALL
send `initialize` with `protocolVersion: 1` as a **number** (not a
string), followed by `session/new` with `cwd = workspaceRoot`,
`mcpServers: []`, and no `terminal` capability.

**R11.** IF the agent advertises an auth method and the user's probe
returned `logged_in_*` via environment THEN the system MAY call
`authenticate`; otherwise `authenticate` is skipped and the session
proceeds using the agent's ambient OAuth state.

**R12.** WHEN the `initialize` response advertises capabilities THEN
the system SHALL remember which of `fs.read`, `fs.write`,
`permissions`, and `prompt_capabilities.{audio,embedded_context,image}`
are enabled, and gate subsequent behavior on them.

## 5. Streaming `session/prompt`

**R13.** WHEN sending a prompt turn THEN the system SHALL issue a
single `session/prompt` JSON-RPC request and begin emitting events on
the returned `AssistantMessageEventStream` as `session/update`
notifications arrive.

**R14.** WHEN `session/update` arrives with discriminator
`agent_message_chunk` THEN the system SHALL emit the current
text-span delta; with `agent_thought_chunk` SHALL emit the current
thinking-span delta; with `tool_call` SHALL open a tool-call span
and close any open text/thought span first; with `tool_call_update`
SHALL emit a progress delta on the matching tool-call span.

**R15.** WHEN `session/update` arrives with discriminator
`user_message_chunk` THEN the system SHALL drop it (echoes of the
user turn are not interesting to the omp event stream).

**R16.** WHEN `session/update` arrives with discriminator `plan`,
`available_commands_update`, or `current_mode_update` THEN the system
SHALL attach it as metadata on the current stream position but SHALL
NOT emit it as a typed event.

**R17.** WHEN the `session/prompt` response arrives THEN the system
SHALL map its `stopReason` to omp's `FinishReason` per this table:

| ACP `stopReason` | omp `FinishReason` |
|------------------|--------------------|
| `end_turn`       | `stop`             |
| `max_tokens`     | `length`           |
| `tool_use`       | `toolUse`          |
| `cancelled`      | `aborted`          |
| `refusal`        | `error`            |

## 6. Filesystem proxy

**R18.** WHEN the agent calls `fs/read_text_file` or
`fs/write_text_file` THEN the system SHALL:
1. Resolve the path via `path.resolve(workspaceRoot, requested)`.
2. Reject anything containing `..`, absolute paths outside
   workspaceRoot, or non-existent parents.
3. Call `fs.realpath` on the resolved path (resolving symlinks)
   **before** the final scope check.
4. Reject if the real path is not within `workspaceRoot`.

**R19.** WHEN reading a file via `fs/read_text_file` THEN the system
SHALL enforce a 10 MB cap; oversize reads SHALL return an ACP error
rather than streaming partial content.

**R20.** WHEN `fs/read_text_file` is called with `line` and `limit`
parameters THEN the system SHALL honor them (1-indexed, per ACP spec).

## 7. Permissions

**R21.** WHEN the agent calls `session/request_permission` THEN the
system SHALL apply the active policy:
- `auto-allow`: pick the first `allow_once` option; error if none.
- `deny-destructive` (default): pick `allow_once` for read-only tools
  (including `fs/read_text_file`); pick `reject_once` for any option
  whose kind is `delete`, `execute`, or `write` (except
  `fs/write_text_file` which is always prompted to the user).
- `delegate` (non-MVP): route through omp's interactive approval UI.

**R22.** WHEN no matching option is available in the ACP request
options list THEN the system SHALL return the spec's fallback of
`reject_once`, never invent one.

## 8. Surfacing state to the user

**R23.** WHEN the user runs `/login` THEN the selector SHALL include a
Gemini entry showing one of `{missing, logged out, logged in (oauth),
logged in (api key)}` with the matching install or login command as
hint text.

**R24.** WHEN the user runs `/usage` THEN Gemini CLI SHALL appear in
the account-ordering list with its auth state and the active model
identifier.

## 9. Model discovery

**R25.** WHEN the Gemini adapter is first loaded THEN the system
SHALL enumerate models by calling a per-CLI probe in
`packages/ai/src/utils/discovery/acp.ts`; failures SHALL fall back to
a static allowlist (`gemini-2.5-pro`, `gemini-2.5-flash`) and log at
DEBUG level.

**R26.** WHEN the cached model list is older than 24 hours THEN the
system SHALL re-run discovery on next use.

## Non-Functional

**NF1.** Typecheck, biome lint, and tests SHALL remain clean across
`packages/ai` and `packages/coding-agent`.

**NF2.** The integration SHALL reuse `@agentclientprotocol/sdk@0.18.2`
(already a dependency) for schema types and
`ClientSideConnection` / `ndJsonStream`.

**NF3.** All subprocess spawns SHALL use array-of-strings argv. No
`shell: true`. No user- or LLM-controlled values concatenated into
argv or env (env keys are static; values are read from secrets).

**NF4.** The ACP child SHALL NOT be given a TTY; any prompt that
requires a TTY (OAuth login, 2FA) SHALL be surfaced as
`auth_required` and the user SHALL re-run `/login`.

**NF5.** Timeouts SHALL be enforced per request: `initialize` 15 s,
`session/new` 30 s, `session/prompt` 120 s default (override via
config).

**NF6.** Secrets (API keys) SHALL be read from the omp auth storage /
environment and SHALL NOT be written to logs, error messages, or
trace output.

## Constraints

**C1.** This plan targets single-turn, single-session-per-process
operation. Warm pools and multi-session are deferred.

**C2.** `packages/ai/src/providers/acp/` is **shared** with future
CLI adapters. CLI-specific code lives only under
`providers/acp/cli/<name>.ts`; no per-CLI special-cases leak into
`stream.ts`, `client.ts`, or `event-mapping.ts`.

**C3.** We do not adopt any of the three community "ACP provider"
packages (`@mcpc-tech/acp-ai-provider`, `@finityno/claude-code-acp`,
or the Vercel AI-SDK ACP provider) — they each collapse the parts we
want to keep explicit.

## Traceability (requirement → touch point)

| Req          | File(s) |
|--------------|---------|
| R1, R2       | `packages/ai/src/api-registry.ts`, `packages/ai/src/stream.ts` |
| R3–R5        | `providers/acp/auth-probe.ts`, `providers/acp/cli/gemini.ts` |
| R6–R9        | `providers/acp/process.ts`, `providers/acp/stream.ts` |
| R10–R12      | `providers/acp/stream.ts`, `providers/acp/client.ts` |
| R13–R16      | `providers/acp/event-mapping.ts` |
| R17          | `providers/acp/stop-reason.ts` |
| R18–R20      | `providers/acp/fs-proxy.ts` |
| R21–R22      | `providers/acp/permissions.ts` |
| R23, R24     | `packages/ai/src/cli.ts`, `packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| R25, R26     | `packages/ai/src/utils/discovery/acp.ts` |
| NF3          | all spawn call sites |
| NF4          | `providers/acp/process.ts` (`stdio` arg) |
| NF5          | `providers/acp/stream.ts` (per-request `AbortSignal` + timer) |
