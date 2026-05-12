# Design — ACP-Claude Adapter

## 1. Picture

```
┌──────────────┐              ┌──────────────────────────────┐
│ omp session  │ ─ provider ─▶│ providers/acp/ (shared core) │
└──────────────┘              │  ↳ cli/claude-code.ts        │ ← THIS PLAN
                              │     spawn claude-agent-acp   │
                              └──────────────┬───────────────┘
                                             │ stdio JSON-RPC (ACP)
                                             ▼
                              ┌──────────────────────────────┐
                              │ claude-agent-acp (external)  │ ← Zed's bridge
                              │   Apache-2.0 prebuilt binary │
                              └──────────────┬───────────────┘
                                             │ stdio stream-json
                                             ▼
                              ┌──────────────────────────────┐
                              │ claude (Anthropic CLI)       │
                              └──────────────────────────────┘
```

Everything left of `claude-agent-acp` is the shared core from the
Gemini MVP. Everything right of `claude-agent-acp` is Anthropic's
territory — we don't touch it.

## 2. Adapter shape

```ts
// providers/acp/cli/claude-code.ts
export const claudeCodeAdapter: CliAdapter = {
  id: "claude-code-acp",
  displayName: "Claude Code (ACP via claude-agent-acp)",

  binary: "claude-agent-acp",          // the bridge, not `claude`
  installHint:
    "npm i -g @agentclientprotocol/claude-agent-acp  (and `npm i -g @anthropic-ai/claude-code`)",
  loginCommand: ["claude", "setup-token"],

  async probeAuth(env) {
    if (!(await hasExecutable("claude"))) return { kind: "missing" };
    if (!(await hasExecutable("claude-agent-acp"))) return { kind: "missing" };
    const cfg = await readJsonSafe(join(homedir(), ".claude", "config.json"));
    if (cfg?.accessToken) return { kind: "logged_in_api_key" };
    if (env.ANTHROPIC_API_KEY) return { kind: "logged_in_api_key" };
    return { kind: "logged_out" };
  },

  spawnArgs(config) {
    // claude-agent-acp forwards --model to the underlying claude invocation.
    return ["--model", config.model ?? "claude-sonnet-4.5"];
  },

  extraEnv(config) {
    // Let claude-agent-acp read ~/.claude/config.json on its own;
    // only plumb an explicit API key when the user set one.
    return config.apiKey ? { ANTHROPIC_API_KEY: config.apiKey } : {};
  },
};
```

The adapter is ~30 lines. All the heavy lifting happens in the
shared core and in `claude-agent-acp` itself.

## 3. Auth

`claude-agent-acp` inherits whatever auth state the local `claude`
CLI has:

- `~/.claude/config.json` contains the OAuth access token after
  `claude setup-token` (interactive). That file is the source of
  truth for logged-in state.
- `ANTHROPIC_API_KEY` env var is honored if set.

Our `probeAuth` checks both binaries exist, then checks for a token.
We do **not** try to call `claude-agent-acp --version` as an auth
test — `claude-agent-acp` doesn't hit Anthropic on startup, only
when a prompt arrives. If the token is stale, we'll see a failed
prompt with a clean error message, which we surface.

## 4. Install hints

Two dependencies, both npm globals today:

- `claude` — `npm i -g @anthropic-ai/claude-code` — the Anthropic
  CLI.
- `claude-agent-acp` — `npm i -g @agentclientprotocol/claude-agent-acp` —
  the Zed-authored bridge.

Our `installHint` string lists both. `probeAuth` returns `missing`
if either is absent. `/login` row shows the missing binary(ies) and
the install command.

## 5. Invocation semantics

`claude-agent-acp` treats its stdin/stdout as plain ACP. It
internally spawns `claude --output-format=stream-json` and translates
events. From our side:

- We never run `claude` directly — only `claude-agent-acp`.
- We do not pass `claude`-specific flags. The bridge owns that.
- Stdout will be clean JSON-RPC (no `<EPHEMERAL_MESSAGE>` blocks or
  credential lines), so `filterNonJsonLines` is still active for
  safety but should rarely fire.

## 6. Tool calls and permissions

`claude-agent-acp` maps Claude Code's tool calls into ACP's
`tool_call` / `tool_call_update` / `session/request_permission`
surface. The existing shared `fs-proxy.ts` and `permissions.ts`
handle them without modification:

- Read-heavy tools get `auto-allow` under `deny-destructive`.
- Write tools get prompted (or auto-allow under `auto-allow` mode).
- `Bash` / `execute` maps to kind `execute` → rejected by default
  under `deny-destructive`.

If the bridge emits a tool we don't recognize, `permissions.ts`
falls through to `reject_once`, consistent with R22.

## 7. Risks

| Risk                                                      | Mitigation                                          |
|-----------------------------------------------------------|-----------------------------------------------------|
| Bridge and `claude` CLI version drift                     | `omp doctor` (future) checks versions; meantime the bridge surfaces a clear error on incompatibility |
| User installs `claude` but not `claude-agent-acp`          | `probeAuth` returns `missing` with the install hint |
| Bridge expands scope (e.g. adds its own config format)     | Adapter is ~30 lines; adjusting flags is cheap      |
| Network hop (claude-agent-acp → claude → Anthropic)       | Same latency budget as using `claude` directly; 120 s prompt timeout still reasonable |
| OAuth token expires mid-session                           | Surfaced as a prompt-time error; user re-runs `claude setup-token` |

## 8. What's deliberately not in this plan

- No sidecar maintenance of `claude-agent-acp`. If the bridge has
  bugs, we file them upstream.
- No stream-json translator in pi-ai. If we ever had to drop the
  bridge, that would be a separate future plan.
- No `claude-agent-acp` packaging as part of omp's release. Users
  install globally; we hint at it.
- No re-using Anthropic's auth surface — we point at
  `claude setup-token`.
