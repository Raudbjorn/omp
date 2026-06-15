# Design — ACP-Gemini Provider

## 1. Architecture overview

omp already plays the ACP **server** role (IDE ⇄ omp agent, under
`packages/coding-agent/src/modes/acp/`). This plan adds the ACP
**client** role for Gemini:

```
┌──────────────┐                ┌─────────────────────────────────┐
│ omp session  │ ── provider ──▶│  packages/ai/src/providers/acp/ │
│ (any mode)   │                │  ┌───────────────────────────┐  │
└──────────────┘                │  │ stream.ts (orchestrator)  │  │
       ▲  AssistantMessageEvent │  │ process.ts (spawn + pipes)│  │
       │                        │  │ client.ts (Client-side    │  │
       │                        │  │   ACP + fs/perm handlers) │  │
       │                        │  │ event-mapping.ts          │  │
       │                        │  │ stop-reason.ts            │  │
       │                        │  │ fs-proxy.ts               │  │
       │                        │  │ permissions.ts            │  │
       │                        │  │ auth-probe.ts             │  │
       │                        │  │ cli/gemini.ts (adapter)   │  │
       │                        │  └─────────────┬─────────────┘  │
       └────────────────────────┴────────────────┼────────────────┘
                                                 │ stdio JSON-RPC
                                                 ▼
                                ┌─────────────────────────────────┐
                                │ gemini --experimental-acp       │
                                │   --model gemini-2.5-pro        │
                                │ (child process, no TTY)         │
                                └─────────────────────────────────┘
```

The module is **additive**. Everything under `providers/acp/` is new;
we touch `api-registry.ts`, the global `stream()` dispatcher, and the
`/login` and `/usage` surfaces for user-visible integration.

## 2. Module layout

```
packages/ai/src/
├── api-registry.ts              ← add "acp-agent" to Api union + BUILTIN_APIS
├── stream.ts                    ← case "acp-agent": return streamAcp(...)
├── models.json                  ← seed: gemini-2.5-pro, gemini-2.5-flash (api=acp-agent)
├── cli.ts                       ← /login + /usage rows for gemini-cli-acp
└── providers/acp/
    ├── index.ts                 ← exports streamAcp and registerable adapters
    ├── stream.ts                ← StreamFunction<"acp-agent"> orchestrator
    ├── process.ts               ← spawn wrapper + filterNonJsonLines Transform
    ├── client.ts                ← wraps ClientSideConnection, wires fs + perms
    ├── event-mapping.ts         ← session/update → AssistantMessageEvent state machine
    ├── stop-reason.ts           ← StopReason → FinishReason
    ├── fs-proxy.ts              ← readTextFile / writeTextFile scoped to cwd
    ├── permissions.ts           ← makePermissionPolicy(mode)
    ├── auth-probe.ts            ← CliAdapter.probeAuth dispatcher
    └── cli/
        └── gemini.ts            ← GeminiAdapter: binary, args, env, probeAuth

packages/ai/src/utils/discovery/
└── acp.ts                       ← per-CLI model discovery with static fallback

packages/coding-agent/src/slash-commands/
└── builtin-registry.ts          ← /login rows for ACP CLIs (status + hint)
```

## 3. `Api` registration

`packages/ai/src/api-registry.ts`:

```ts
export type Api =
  | "openai-responses"
  | "anthropic-messages"
  | "google-gemini-cli"         // existing (direct-API provider)
  | "acp-agent"                 // NEW — the protocol, not a vendor
  | /* … */;

export const BUILTIN_APIS = new Set<Api>([
  "openai-responses",
  "anthropic-messages",
  "google-gemini-cli",
  "acp-agent",
  /* … */
]);
```

The *protocol* is the asset. CLI specificity lives in
`providers/acp/cli/<name>.ts`. Adding Claude Code later adds one file
under `cli/` and one entry in a registry map — no second Api type.

## 4. Adapter interface

```ts
// providers/acp/cli/types.ts
export interface CliAdapter {
  readonly id: "gemini-cli-acp" | "claude-code-acp";
  readonly displayName: string;
  readonly binary: string;                       // "gemini", "claude-agent-acp"
  readonly installHint: string;
  readonly loginCommand: readonly string[];

  /** Cheap, bounded auth check — never spawns the ACP binary. */
  probeAuth(env: NodeEnv): Promise<AuthStatus>;

  /** Argv for ACP mode. */
  spawnArgs(config: AcpConfig): readonly string[];

  /** Env vars to merge (e.g. GEMINI_API_KEY). */
  extraEnv(config: AcpConfig): Readonly<Record<string, string>>;
}

export type AuthStatus =
  | { kind: "missing" }
  | { kind: "logged_out" }
  | { kind: "logged_in_oauth"; mtime: Date }
  | { kind: "logged_in_api_key" };
```

The Gemini adapter:

```ts
// providers/acp/cli/gemini.ts
export const geminiAdapter: CliAdapter = {
  id: "gemini-cli-acp",
  displayName: "Gemini CLI (ACP)",
  binary: "gemini",
  installHint: "npm i -g @google/gemini-cli",
  loginCommand: ["gemini", "auth", "login"],

  async probeAuth(env) {
    if (!(await hasExecutable("gemini"))) return { kind: "missing" };
    if (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY) return { kind: "logged_in_api_key" };
    const creds = await stat(join(homedir(), ".gemini", "oauth_creds.json")).catch(() => null);
    if (!creds) return { kind: "logged_out" };
    return { kind: "logged_in_oauth", mtime: creds.mtime };
  },

  spawnArgs(config) {
    return ["--experimental-acp", "--model", config.model ?? "gemini-2.5-pro"];
  },

  extraEnv(config) {
    return config.apiKey ? { GEMINI_API_KEY: config.apiKey } : {};
  },
};
```

## 5. Session lifecycle

```
 stream(config)
   │
   ├─ probeAuth(adapter)
   │    ├─ missing / logged_out ─▶ yield { error: "auth_required", hint }; return
   │    └─ logged_in_*           ─▶ continue
   │
   ├─ spawn(adapter.binary, adapter.spawnArgs(config), { stdio: 'pipe'×3, env })
   │    ├─ stderr ─▶ DEBUG logger (never merged into stdout)
   │    └─ stdout ─▶ filterNonJsonLines Transform ─▶ ndJsonStream
   │
   ├─ ClientSideConnection(stdin_write, filteredStdout_read, { handlers })
   │
   ├─ initialize({ protocolVersion: 1, clientCapabilities: { fs: {...}, permissions: {...} }})
   │    timeout: 15s   ─▶ on timeout: shutdown ladder + yield error
   │
   ├─ (optional) authenticate(methodId)   — only if adapter flagged env-api-key flow
   │
   ├─ session/new({ cwd: workspaceRoot, mcpServers: [] })
   │    timeout: 30s
   │
   ├─ session/prompt(sessionId, content)
   │    │
   │    ├─ session/update notifications ─▶ event-mapping.ts ─▶ AsyncGenerator<AssistantMessageEvent>
   │    ├─ session/request_permission  ─▶ permissions.ts policy ─▶ response
   │    ├─ fs/read_text_file, fs/write_text_file ─▶ fs-proxy.ts
   │    │
   │    └─ response { stopReason } ─▶ stop-reason.ts ─▶ FinishReason
   │
   └─ shutdown ladder: session/cancel(10s) ─▶ SIGTERM(5s) ─▶ SIGKILL
```

## 6. Stdout filter (issue #22647)

Gemini prints diagnostic frames on stdout that are not valid
JSON-RPC:

```
Loaded cached credentials.
<EPHEMERAL_MESSAGE>
{ "status": "…" }
</EPHEMERAL_MESSAGE>
{"jsonrpc":"2.0", …}      ← the actual frame we want
```

We insert a `Transform` stream between the child's raw stdout and
`ndJsonStream`:

```ts
// providers/acp/process.ts
function filterNonJsonLines(): Transform {
  return new Transform({
    transform(chunk, _enc, cb) {
      // Reassemble line-buffered input so we don't split frames.
      this._buf = (this._buf ?? "") + chunk.toString("utf8");
      const lines = this._buf.split("\n");
      this._buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith("{") || t.startsWith("[")) {
          this.push(line + "\n");
        } else {
          debugLog("acp/stdout-drop", { line: t.slice(0, 200) });
        }
      }
      cb();
    },
  });
}
```

~20 lines. Unit test: feed it a mixed buffer (credentials line +
`<EPHEMERAL_MESSAGE>` block + real frame + half-frame + second half)
and assert only the real frames come out intact.

## 7. Event mapping state machine

ACP interleaves text, thought, and tool-call updates. omp's event
stream is a flat sequence of typed spans with `start` / `delta` /
`end` boundaries. `event-mapping.ts` translates:

| ACP `session/update.sessionUpdate` | omp events                                   |
|------------------------------------|----------------------------------------------|
| `user_message_chunk`               | *(dropped)*                                  |
| `agent_message_chunk`              | `text_start` / `text_delta` / `text_end`    |
| `agent_thought_chunk`              | `thinking_start` / `thinking_delta` / `thinking_end` |
| `tool_call`                        | `toolcall_start` (closes any open text/thought first) |
| `tool_call_update`                 | `toolcall_delta` / `toolcall_end` (status-dependent) |
| `plan`                             | metadata.plan                                |
| `available_commands_update`        | metadata.availableCommands                   |
| `current_mode_update`              | metadata.currentMode                         |

Minimal state: `currentSpan: "none" | "text" | "thought" | "tool"`.
Opening a tool call closes any open text/thought span. Closing text /
thought is driven by ordering — when a new discriminator appears or
when `session/prompt` responds, the currently open span is ended.

## 8. Stop-reason mapping

```ts
// providers/acp/stop-reason.ts
import type { StopReason } from "@agentclientprotocol/sdk";
import type { FinishReason } from "../../types";

export function mapStopReason(reason: StopReason): FinishReason {
  switch (reason) {
    case "end_turn":   return "stop";
    case "max_tokens": return "length";
    case "tool_use":   return "toolUse";
    case "cancelled":  return "aborted";
    case "refusal":    return "error";
    default: {
      const _exhaustive: never = reason;
      return "stop";
    }
  }
}
```

## 9. Filesystem proxy

```ts
// providers/acp/fs-proxy.ts
const MAX_READ_BYTES = 10 * 1024 * 1024;

async function scopedPath(workspaceRoot: string, requested: string): Promise<string> {
  if (requested.includes("..") || path.isAbsolute(requested)) {
    // Absolute: only accept if it's already inside workspaceRoot.
  }
  const resolved = path.resolve(workspaceRoot, requested);
  const real = await fs.realpath(resolved);           // resolves symlinks
  const rel = path.relative(workspaceRoot, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AcpFsError("path_escapes_workspace", { requested });
  }
  return real;
}
```

`readTextFile`:
- `scopedPath` → `fs.stat` (fail on dir, reject > 10 MB)
- read file, optional `line`/`limit` slicing (1-indexed per ACP spec)
- return `{ content }`

`writeTextFile`:
- `scopedPath` on parent dir; reject if parent missing
- write atomically (`fs.writeFile` with temp-rename if atomic is
  cheap; plain `writeFile` is fine for MVP)

Symlink handling is the non-obvious bit: resolving symlinks **after**
the path join is the only way `ln -s /etc/passwd ./notes/secret` is
caught.

## 10. Permissions policy

```ts
// providers/acp/permissions.ts
type Mode = "auto-allow" | "deny-destructive" | "delegate";

export function makePermissionPolicy(mode: Mode) {
  return async (req: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    const allow = req.options.find(o => o.kind === "allow_once");
    const reject = req.options.find(o => o.kind === "reject_once");
    switch (mode) {
      case "auto-allow":
        return { outcome: { outcome: "selected", optionId: (allow ?? req.options[0]).optionId } };
      case "deny-destructive": {
        const destructive = /delete|execute|write/i.test(req.toolCall?.kind ?? "");
        const writeOk = req.toolCall?.kind === "fs/write_text_file";
        const choice = (!destructive || writeOk) ? allow : reject;
        return { outcome: { outcome: "selected", optionId: (choice ?? reject!).optionId } };
      }
      case "delegate":
        throw new Error("delegate not implemented in MVP");
    }
  };
}
```

Default is `deny-destructive`. `auto-allow` is opt-in via config for
headless runs. `delegate` is phase 2 — it threads the request into
omp's existing interactive approval UI.

## 11. Auth probe (before spawn)

No TTY means we cannot detect auth by poking the child. We must know
before we spawn. `auth-probe.ts` is a thin dispatcher that calls the
adapter's `probeAuth`; the adapter owns "what to check" for its CLI:

- Gemini: `gemini --version` + `~/.gemini/oauth_creds.json` or env.
- Claude Code (later): `claude --version` + `~/.claude/config.json`
  existence + token field, or `claude-agent-acp` bridge equivalent.

Probing fires synchronously on every turn start and is cheap enough
(one `stat` + one `--version` spawn) that we don't need to cache it
across turns within a session. We DO cache across
`models.json`-generation runs (24 h via the model-discovery cache).

## 12. Timeouts

| Step                  | Default | Override            |
|-----------------------|---------|---------------------|
| `initialize`          | 15 s    | `acp.initializeMs`  |
| `session/new`         | 30 s    | `acp.sessionNewMs`  |
| `session/prompt`      | 120 s   | `acp.promptMs`      |
| `session/cancel`      | 10 s    | `acp.cancelMs`      |
| `SIGTERM` grace       | 5 s     | `acp.sigtermMs`     |

Each timeout is an `AbortController` armed at request dispatch. On
fire we transition into the shutdown ladder.

## 13. User-facing surfaces

**`/login`** (builtin-registry.ts): a new row type `acp-cli` that
renders `displayName + status + hint`. Selecting a logged-out row
runs the adapter's `loginCommand` in a PTY subprocess (inherit
stdio); selecting a missing row copies the install command to the
clipboard and shows a toast.

**`/usage`** (`cli.ts`): Gemini CLI appears alongside other
providers with its auth state and active model. The existing
account-ordering logic sorts it with the other CLI providers.

## 14. What we are **not** building (tracked here so reviewers can
double-check intent)

- No `terminal` capability advertised to the agent. Terminal tool
  calls are rejected by the capability negotiation — we don't want
  the agent driving pty sessions inside omp.
- No `session/load`. Gemini reports `loadSession: false` so resuming
  is impossible anyway.
- No warm subprocess pool. Spawn on turn start; teardown on turn end
  if the config says so, otherwise on session end.
- No `plan` / `available_commands` / `current_mode` as first-class
  typed events — metadata only.
- No MCP-over-ACP fan-in (omp's MCP servers are not relayed to the
  agent in this plan).
- No community ACP provider packages adopted; we wire
  `@agentclientprotocol/sdk` directly.

## 15. Error surfaces

| Error                         | Source                | Surface to user                    |
|-------------------------------|-----------------------|------------------------------------|
| `binary_missing`              | probeAuth             | `/login` row: install hint         |
| `auth_required`               | probeAuth / handshake | `/login` row: login command        |
| `handshake_timeout`           | initialize timeout    | error toast + DEBUG log dump       |
| `invalid_json_line`           | filterNonJsonLines    | DEBUG only (never user-visible)    |
| `fs_escape`                   | fs-proxy              | error reported back to agent       |
| `permission_denied`           | permissions.ts        | error reported back to agent       |
| `child_exit_unexpected`       | process exit          | error toast + stderr tail          |
| `stop_reason: refusal`        | session/prompt        | `FinishReason: "error"` + message  |

## 16. Testing strategy

- **Unit** for each module: `filterNonJsonLines`, `mapStopReason`,
  `scopedPath`, `makePermissionPolicy`, `event-mapping` state
  transitions.
- **Integration** via a fake ACP server fixture (small Node script)
  driven over the real `ClientSideConnection` + `ndJsonStream`. Runs
  the full dance: initialize → session/new → prompt → updates →
  stopReason. No real Gemini binary in CI.
- **Wire-trace replay** test: the `wire-trace.md` doc has canned
  JSON frames; a test harness replays them into `event-mapping` and
  snapshots the output stream.
- **Manual smoke** against real `gemini --experimental-acp` — gated
  on `GEMINI_SMOKE=1` env.

## 17. Risks

| Risk                                             | Mitigation                                           |
|--------------------------------------------------|------------------------------------------------------|
| Gemini changes stdout framing                    | `filterNonJsonLines` is whitelist-style (keep only `{`/`[` starts); new prefixes get dropped automatically |
| `oauth-personal` method opens browser mid-session | Auth is detected *before* spawn; if we'd have to re-auth during the session, we fail with `auth_required` instead |
| `session/new` rejects non-stdio MCP transports (issue #8672) | We pass `mcpServers: []` in MVP; phase 2 only forwards stdio MCP |
| Child hangs on `session/prompt`                  | 120 s per-request timeout; cancel → SIGTERM → SIGKILL ladder |
| Agent requests symlink-escape fs path            | `fs.realpath` before final scope check              |
| Permission fatigue → user clicks allow           | Default is `deny-destructive`, not `auto-allow`     |
