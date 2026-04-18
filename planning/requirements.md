# Requirements — ACP-CLI Provider

Format: EARS (Easy Approach to Requirements Syntax).

Legend: **R** = functional, **NF** = non-functional, **C** = constraint.

## Discovery and Detection

**R1.** WHEN the `/login` selector opens THEN the system SHALL include all
four ACP-CLI backends (`claude`, `gemini`, `kiro`, `copilot`) as
first-class entries alongside OAuth providers.

**R2.** WHEN the `/login` selector renders an ACP-CLI entry THEN the
system SHALL probe the host `$PATH` for the corresponding executable and
display one of: **missing** (not in PATH), **logged out**, **logged in**.

**R3.** IF the CLI executable is missing from `$PATH` THEN the selector
entry SHALL display the vendor-supplied install command (e.g.
`npm i -g @anthropic-ai/claude-code`, `npm i -g @google/gemini-cli`).

**R4.** IF the CLI is present but the user is logged out THEN the
selector entry SHALL display the login command (e.g. `claude login`,
`gemini auth login`, `copilot auth login`).

**R5.** WHEN the user selects an ACP-CLI entry that is already logged in
THEN the system SHALL register the CLI as an available provider and
refresh the model list.

## Authentication Probing

**R6.** WHEN determining login status for a given CLI THEN the system
SHALL use a vendor-specific probe (e.g. `claude --list-models` exits 0
when authenticated, a credentials file exists, `authenticate` JSON-RPC
call succeeds during ACP handshake).

**R7.** IF the probe takes longer than 5 seconds THEN the system SHALL
treat the result as **unknown** and surface a retry affordance rather
than blocking the selector UI.

**R8.** WHEN a logged-in user triggers login again THEN the system SHALL
run the vendor login command in an attached terminal (PTY) and re-probe
on exit.

## Model Discovery

**R9.** WHEN an ACP-CLI provider is first registered as available THEN
the system SHALL enumerate models using the vendor strategy:
 - Claude: `claude --list-models` parsed as JSON / line-delimited output
 - Gemini: `gemini model list` parsed similarly
 - Copilot: try `github-copilot-cli list-models`; if that fails, use the
   static fallback list
 - Kiro: static list (`kiro-v1`)

**R10.** WHEN model discovery fails for any reason THEN the system SHALL
fall back to the static default model and log (not surface) the error.

**R11.** WHEN the model list is older than 24 hours THEN the system
SHALL re-run discovery on next use; successful runs SHALL be cached.

## ACP Session Lifecycle

**R12.** WHEN a chat turn targets an ACP-CLI provider THEN the system
SHALL spawn the CLI once per session with its ACP flag
(`--acp`, falling back to `--experimental-acp`) and reuse the process for
subsequent turns in the same session.

**R13.** WHEN a session ends or the parent omp process exits THEN the
system SHALL cleanly terminate all ACP-CLI child processes.

**R14.** WHEN the ACP handshake runs THEN the system SHALL call
`initialize` → (optional) `authenticate` → `session/new` → `session/prompt`
in that order per the ACP spec.

**R15.** WHEN the CLI emits `session/update` notifications THEN the
system SHALL translate them into omp's `AssistantMessageEventStream`
events (text deltas, tool calls, thinking blocks).

**R16.** WHEN the CLI emits `fs/read_text_file` or `fs/write_text_file`
requests THEN the system SHALL perform the operation against the host
filesystem and return the response per the ACP spec.

**R17.** WHEN the CLI emits `session/request_permission` THEN the system
SHALL route the request through omp's existing tool-approval UI and
honor the user's decision.

## Resilience

**R18.** WHEN a line arriving on the CLI's stdout fails JSON parsing
THEN the system SHALL log it at `trace` level and continue reading the
stream without erroring (workaround for Gemini CLI issue #22647).

**R19.** IF the CLI process exits unexpectedly mid-turn THEN the system
SHALL surface a structured error to the user (stderr tail + exit code)
and allow them to retry without re-authenticating.

**R20.** WHEN the ACP handshake returns `auth_required` THEN the system
SHALL display the login command and abort the turn without retrying.

## Non-Functional

**NF1.** The integration SHALL not block the TUI event loop. All
subprocess I/O goes through `Bun.spawn` + async reads.

**NF2.** The integration SHALL not add any new runtime dependency
heavier than the existing `@agentclientprotocol/sdk`.

**NF3.** Typecheck, lint, and tests SHALL remain clean across
`packages/ai`, `packages/coding-agent`, `packages/utils`.

**NF4.** Credentials for CLI providers SHALL NOT be stored by omp —
they stay in each CLI's own credential store, as the host is the source
of truth.

**NF5.** All subprocess spawns (detect, probe, list, login, session)
SHALL use the array-of-strings argv form with no shell interpretation.
User- or LLM-controlled values SHALL NOT be concatenated into argv.

**NF6.** The filesystem proxy SHALL canonicalize every path received
from the agent and reject any path that escapes the session cwd
(absolute paths, `..` traversal, symlink escapes). Same policy as the
built-in read/edit tools.

## Constraints

**C1.** Stay on `@agentclientprotocol/sdk@0.16.1` for the ACP transport.
Do not migrate to the SACP / v1.0 suite in this PR.

**C2.** No proxy-chain orchestration. Single client → single CLI agent
per session.

**C3.** Add-only surface area in `packages/ai/src/utils/oauth/` and
`packages/ai/src/providers/`. Do not rewire existing providers.

**C4.** Reuse `Bun.spawn` as the subprocess primitive — do not
introduce a new spawn wrapper.

## Traceability (requirement → touch point)

| Req | Touch point |
|-----|-------------|
| R1, R2, R3, R4, R5 | `packages/ai/src/utils/oauth/acp-cli.ts`, `oauth/types.ts`, `oauth/index.ts`, `slash-commands/builtin-registry.ts` |
| R6, R7, R8 | `packages/ai/src/providers/acp-cli/probe.ts` |
| R9, R10, R11 | `packages/ai/src/providers/acp-cli/models.ts` |
| R12, R13, R14 | `packages/ai/src/providers/acp-cli/session.ts` |
| R15, R16, R17 | `packages/ai/src/providers/acp-cli/event-bridge.ts`, `fs-proxy.ts`, `permission-proxy.ts` |
| R18, R19, R20 | `packages/ai/src/providers/acp-cli/jsonrpc-codec.ts`, `errors.ts` |
| NF5 | all `Bun.spawn` call sites under `providers/acp-cli/` and `utils/oauth/acp-cli.ts` |
| NF6 | `packages/ai/src/providers/acp-cli/fs-proxy.ts` (delegates to `capability/fs`) |
