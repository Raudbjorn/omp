# Design — ACP-CLI Provider

## 1. Architecture Overview

omp already plays two roles with respect to ACP:

```
 ┌────────────────┐  (ACP server role, existing)
 │  IDE / Zed /   │ ──stdio──▶ omp ACP agent  (packages/coding-agent/src/modes/acp/)
 │  JetBrains     │
 └────────────────┘

 This plan adds the ACP **client** role:

 ┌─────────────┐                  ┌──────────────────────────────┐
 │ omp session │ ──provider──▶   │  acp-cli provider module     │
 │ (any mode)  │                  │  • detects CLI in $PATH     │
 └─────────────┘                  │  • probes auth status       │
       ▲                          │  • spawns CLI with --acp    │
       │ AssistantMessageEvent*  │  • speaks JSON-RPC 2.0       │
       └──────────────────────────│  • proxies fs + permission  │
                                  │    callbacks to omp UI       │
                                  └──────────────┬───────────────┘
                                                 │ stdio
                                                 ▼
                                   ┌─────────────────────────────┐
                                   │ claude / gemini / kiro /    │
                                   │ copilot   (child process)   │
                                   └─────────────────────────────┘
```

The new provider is **additive** — it reuses the existing provider
seams (one streaming function, one OAuth handler, one models.json
entry) and does not touch the server-side ACP code.

## 2. Module Layout

```
packages/ai/src/
├── providers/
│   ├── acp-cli.ts                 ← streamAcpCli entrypoint (matches devin.ts shape)
│   └── acp-cli/
│       ├── adapters/              ← vendor-specific specialisations
│       │   ├── claude.ts          ← spawn args, model list, login probe
│       │   ├── gemini.ts          ← + stdout filter for issue #22647
│       │   ├── kiro.ts            ← static model list
│       │   ├── copilot.ts         ← probe + static fallback
│       │   └── index.ts           ← AdapterRegistry (Record<CliKind, Adapter>)
│       ├── jsonrpc-codec.ts       ← tolerant line reader, id-keyed pending map
│       ├── session.ts             ← AcpCliSession: spawn + handshake + prompt
│       ├── event-bridge.ts        ← session/update → AssistantMessageEvent
│       ├── fs-proxy.ts            ← fs/read_text_file, fs/write_text_file
│       ├── permission-proxy.ts    ← session/request_permission → omp approval UI
│       ├── probe.ts               ← auth detection per adapter
│       ├── models.ts              ← discovery + 24h cache
│       └── errors.ts              ← AcpCliError variants
└── utils/oauth/
    └── acp-cli.ts                 ← loginAcpCli: runs vendor login in PTY
```

```
packages/coding-agent/src/slash-commands/
└── builtin-registry.ts            ← /login selector: show CLI adapters with status
```

## 3. Adapter Interface

```ts
export interface AcpCliAdapter {
  readonly kind: "claude" | "gemini" | "kiro" | "copilot";
  readonly displayName: string;
  readonly binaryNames: readonly string[];        // $PATH candidates
  readonly installHint: string;                    // shown when binary missing
  readonly loginCommand: readonly string[];        // shown when logged out
  readonly acpArgs: readonly string[];             // e.g. ["--acp"] or ["--experimental-acp"]

  /** Cheap, bounded check — file on disk, `--version`, etc. */
  detect(env: NodeEnv): Promise<DetectResult>;

  /** Returns logged-in / logged-out / unknown within a timeout. */
  probeAuth(env: NodeEnv, signal: AbortSignal): Promise<AuthStatus>;

  /** Vendor-specific model enumeration (with static fallback). */
  listModels(env: NodeEnv, signal: AbortSignal): Promise<readonly ModelInfo[]>;

  /** Stream filter — return true to keep the line, false to drop. */
  acceptStdoutLine?(line: string): boolean;
}
```

Each adapter is a small, declarative module. The generic session /
codec / event-bridge code consumes the adapter — vendor quirks (like
Gemini's stdout pollution, Copilot's missing `--list-models`) are
confined to the adapter file.

## 4. Session Lifecycle

```
 open()           ─────▶ spawn(binary, [...acpArgs], {cwd, env})
   │                       drain stderr → log tail buffer
   │                       wrap stdin/stdout in JsonRpcCodec
   │
 initialize()     ─────▶ negotiate protocolVersion + capabilities
   │
 authenticate()   ─────▶ only if adapter declared authMethodId
   │                     on `auth_required` → emit AcpCliError("auth_required")
   │
 newSession()     ─────▶ supply cwd; store returned sessionId
   │
 prompt(text)     ─────▶ stream session/update → event-bridge
   │   ↑ loop for each turn, process persists
   │
 close()          ─────▶ send exit / kill signal; await clean exit w/ timeout
```

Process reuse: one child per ACP-CLI session, not per turn. On turn
cancellation we send ACP `session/cancel` (if supported) and let the
child drain the in-flight stream.

## 5. JSON-RPC Codec

- Line-delimited JSON over stdin/stdout.
- **Tolerant reader**: if `JSON.parse(line)` throws, log at trace and
  skip. Required for Gemini (`"Loaded cached credentials."` etc.).
- Outbound requests get incrementing numeric `id`s; a `Map<id, Deferred>`
  resolves on matching response.
- Notifications (`session/update`, `session/request_permission`) are
  dispatched to handlers by method name.

Hand-rolled rather than SDK-wrapped because we are the **client** side,
and `@agentclientprotocol/sdk@0.16.1` primarily exposes the agent /
server side in omp's current usage. The codec is ~150 lines and fully
testable in isolation — mirrors the `acp_driver.rs` approach in the
Rust `llm-proxy` prototype (see `prototypes.md`).

**Buffering.** `Bun.spawn` with piped stdio gives unbuffered
byte streams by default, so we get line-granular streaming without
`stdbuf -o0` or `python -u` tricks. Verify if a future adapter routes
through a wrapper (`npx`, `gh copilot …`) that may re-buffer.

## 6. Event Bridge

Translates ACP `session/update` variants to
`AssistantMessageEvent` values (omp's existing stream type):

| ACP update            | omp event                              |
|-----------------------|----------------------------------------|
| `agent_message_chunk` | `text-delta`                           |
| `agent_thought_chunk` | `thinking-delta` (if capability on)    |
| `tool_call`           | `tool-call`                            |
| `tool_call_update`    | `tool-call-progress`                   |
| `plan`                | `plan-update` (best-effort, fallback to text) |

All events carry the ACP `sessionId` so multi-session state (the
rzp-labs ACP multi-session work, commit `8f3b3f1c7`) keeps working.

## 7. Filesystem Proxy

ACP defines `fs/read_text_file` and `fs/write_text_file` requests from
agent → client. omp handles them by calling its existing `capability/fs`
module (used by the built-in read/edit tools) so:

- Path canonicalization and the capability allowlist apply.
- Edits go through the same dry-run / diff pipeline used by
  built-in tools.
- **Path-traversal rejection.** Paths containing `..` sequences,
  absolute paths outside the session cwd, or symlinks that escape it
  are rejected before any `fs.*` call. Same policy as the built-in
  read/edit tools — no new surface. Covered by T8 tests.

## 8. Permission Proxy

`session/request_permission` is translated to omp's tool-approval flow:

1. Look up the tool name in `session/request_permission.tool`.
2. Invoke the interactive-mode permission prompt (`ctx.requestPermission`).
3. Return `"allow_once"` / `"allow_always"` / `"reject"` per user choice.

Auto-approve (for scripted / headless use) is governed by the same
config knob that already governs built-in tool auto-approval — we do
not invent a new policy surface.

## 9. /login Integration

The selector entry for each CLI shows one of four states:

```
  ◉ Gemini CLI              logged in      gemini --acp
  ◎ Claude Code             logged out     → press Enter to run `claude login`
  ◎ GitHub Copilot CLI      not installed  → npm i -g @github/copilot
  ◌ Kiro                    logged in      (default: kiro-v1)
```

Selecting a "logged out" or "not installed" entry runs the matching
command in a PTY (reusing the existing PTY integration used by
`/screenshot` for desktop capture? — TBD; otherwise `Bun.spawn` with
`stdio: "inherit"` against a new terminal region).

## 10. Error Modes

| Error                    | Surface                              | Recovery                               |
|--------------------------|--------------------------------------|----------------------------------------|
| binary-not-found         | selector entry shows `install hint`  | user installs; re-enter selector       |
| auth-required            | `/login` prompts vendor login        | login succeeds; re-probe               |
| handshake-timeout        | status toast                         | retry once; then surface stderr tail   |
| invalid-json-line        | trace log, drop line                 | continue reading stream                |
| tool-permission-denied   | tool call returns error to CLI       | CLI decides next step                  |
| child-exited-unexpectedly| error event, kill session            | user opens new session                 |

## 11. Testing Strategy

- **Adapter unit tests**: one suite per adapter covering `detect`,
  `probeAuth`, `listModels` against mocked `Bun.spawn` (fake child
  process with scripted stdout / exit code). Patterns to mirror:
  `packages/coding-agent/test/slash-commands/*.test.ts`.
- **Codec tests**: `jsonrpc-codec.test.ts` exercises:
  - Id correlation, timeouts, cancellation.
  - Non-JSON lines interleaved with valid frames.
  - Partial / chunked stdin (half-line, CRLF, empty lines).
- **Session integration test**: spawn a fake ACP server (a small node
  script in `test/fixtures/fake-acp-server.mjs`) and drive a full
  handshake + prompt + fs request + permission request through the
  real codec.
- **Event-bridge snapshot**: feed canned `session/update` payloads,
  assert resulting `AssistantMessageEvent` sequence.
- No live network, no real vendor CLIs in CI.

## 12. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Gemini CLI hangs with `--acp` (issue #22782) | adapter probes both `--acp` and `--experimental-acp`; expose config to disable sandbox per `~/.gemini/settings.json` in docs; documented workaround |
| ACP spec drift across SDK versions | pin to `@agentclientprotocol/sdk@0.16.1`; adapter defines `protocolVersion` it targets |
| Vendor CLI process leak on crash | `unref`-style detach + `SIGTERM` on parent exit via `process.on("beforeExit")` |
| PTY dependency for login command | fall back to `Bun.spawn({ stdio: "inherit" })`; document terminal-only requirement |
| User has multiple matching binaries | pick first in `$PATH` but log; expose adapter override via config key `acp-cli.<kind>.binary` |
| Spawn-arg injection via user input | `Bun.spawn` always called with array-form argv; no `shell: true`; no string concatenation of user-controlled values into arguments — applies to adapter detect/probe/list and to the login PTY flow |
| Agent requests destructive fs / shell op | `session/request_permission` always routes through omp's interactive approval UI; auto-approve only if the existing global config already permits it |

## 13. Extension Seams Touched (from codebase survey)

| File                                                              | Change |
|-------------------------------------------------------------------|--------|
| `packages/ai/src/utils/oauth/types.ts`                            | extend `OAuthProvider` union with `"acp-claude" \| "acp-gemini" \| "acp-kiro" \| "acp-copilot"` |
| `packages/ai/src/utils/oauth/index.ts`                            | register 4 entries in `builtInOAuthProviders`; dispatch in `login()` |
| `packages/ai/src/utils/oauth/acp-cli.ts`                          | new: `loginAcpCli` (delegates to adapter) |
| `packages/ai/src/providers/acp-cli.ts`                            | new: `streamAcpCli` (dispatches on `model.api`) |
| `packages/ai/src/providers/acp-cli/*`                             | new directory with adapters + session + codec |
| `packages/ai/src/stream.ts`                                       | `case "acp-cli-agent": return streamAcpCli(...)` |
| `packages/ai/src/models.json`                                     | new model entries (seeded from static fallbacks) |
| `packages/ai/src/types.ts`                                        | extend `Api` with `"acp-cli-agent"` |
| `packages/coding-agent/src/slash-commands/builtin-registry.ts`    | extend `/login` selector rendering to show CLI status columns |
| `packages/ai/src/auth-storage.ts`                                 | dispatch login flow for 4 new provider ids |

Everything else (TUI, chat hot path, ACP-server mode) remains untouched.
