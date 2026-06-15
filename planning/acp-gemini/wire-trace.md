# Wire Trace — `gemini --experimental-acp`

This is an annotated JSON-RPC trace of a real Gemini ACP session. Use
it as the single source of truth for the frames we exchange, and as
replay fodder for `event-mapping` tests.

All frames are NDJSON (one JSON object per line) over stdin/stdout.
Sender `C` = omp (client), `A` = Gemini (agent).

## 1. Handshake

### 1.1 `initialize` (C → A)

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":1,
  "clientCapabilities":{
    "fs":{"readTextFile":true,"writeTextFile":true},
    "permissions":{"requestPermission":true},
    "terminal":false
  },
  "clientInfo":{"name":"omp","version":"<version>"}
}}
```

**Note:** `protocolVersion` is a **number**, not a string. Getting
that wrong yields `code: -32602 InvalidParams`.

### 1.2 `initialize` response (A → C)

```json
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":1,
  "agentCapabilities":{
    "fs":{"readTextFile":true,"writeTextFile":true},
    "permissions":{"requestPermission":true},
    "loadSession":false,
    "promptCapabilities":{"audio":false,"embeddedContext":false,"image":true}
  },
  "authMethods":[{"id":"oauth-personal","name":"OAuth (personal)"},
                 {"id":"gemini-api-key","name":"Gemini API key"}],
  "agentInfo":{"name":"gemini-cli","version":"<version>"}
}}
```

Key things we remember:

- `loadSession: false` → we never call `session/load`; single session per process.
- `promptCapabilities.image: true` → we may forward image parts.
- `authMethods` tells us the agent's menu; we never call `authenticate`
  interactively (see §2 below).

### 1.3 (optional) `authenticate` (C → A)

Skipped by default. Only used when we're confident the host env has
an API key (`GEMINI_API_KEY`) and we want to pin the method:

```json
{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{
  "methodId":"gemini-api-key"
}}
```

If `auth-probe` returns `logged_in_oauth` we rely on the agent
auto-picking its ambient OAuth state and skip this frame.

### 1.4 `session/new` (C → A)

```json
{"jsonrpc":"2.0","id":3,"method":"session/new","params":{
  "cwd":"/abs/path/to/workspace",
  "mcpServers":[]
}}
```

- `cwd` must be absolute. We pass the workspace root that omp already
  resolved.
- `mcpServers: []` for the MVP (Gemini issue #8672 — rejects SSE /
  HTTP transports; stdio would require us to ship MCP spawn configs).

### 1.5 `session/new` response (A → C)

```json
{"jsonrpc":"2.0","id":3,"result":{
  "sessionId":"01J9…",
  "modes":{"current":"default","available":["default","acceptEdits","bypassPermissions"]}
}}
```

## 2. The noisy stdout problem

Between frames, Gemini may emit non-JSON lines on stdout. Verbatim
samples:

```
Loaded cached credentials.
<EPHEMERAL_MESSAGE>
{"status":"loading model registry"}
</EPHEMERAL_MESSAGE>
```

These are issue #22647. Our `filterNonJsonLines` Transform drops any
line whose first non-whitespace byte is not `{` or `[`. The
`<EPHEMERAL_MESSAGE>` block must be dropped line-by-line: the first
and last lines aren't JSON, and the inner JSON is not a JSON-RPC
frame (no `jsonrpc` field). Simpler than sniffing for `jsonrpc`: the
inner object also starts with `{`, so it **will** get forwarded —
but `ndJsonStream` / `ClientSideConnection` will then reject it as
not a JSON-RPC frame and drop it at a later filter stage. Either
drop point is fine; we accept both.

## 3. Prompting

### 3.1 `session/prompt` (C → A)

```json
{"jsonrpc":"2.0","id":4,"method":"session/prompt","params":{
  "sessionId":"01J9…",
  "content":[{"type":"text","text":"List the .ts files in src/."}]
}}
```

The response will arrive at the end of the turn. Between the request
and the response, the agent streams `session/update` notifications.

### 3.2 Update: thought chunk (A → C, notification)

```json
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"01J9…",
  "update":{"sessionUpdate":"agent_thought_chunk",
            "content":{"type":"text","text":"I should list the files…"}}
}}
```

Maps to `thinking_start` (first) → `thinking_delta` (subsequent) on
the omp event stream.

### 3.3 Update: text chunk (A → C)

```json
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"01J9…",
  "update":{"sessionUpdate":"agent_message_chunk",
            "content":{"type":"text","text":"Here are the files: "}}
}}
```

If a `thinking_*` span is currently open, `event-mapping` closes it
before emitting `text_start`.

### 3.4 Update: tool call (A → C)

```json
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"01J9…",
  "update":{"sessionUpdate":"tool_call",
            "toolCallId":"tc_1",
            "kind":"fs/read_text_file",
            "title":"Read",
            "locations":[{"path":"src"}],
            "rawInput":{"path":"src"}}
}}
```

This closes any open text/thought span and opens a `toolcall_start`
on the omp stream with `kind=fs/read_text_file`.

### 3.5 Request: `fs/read_text_file` (A → C, request, id=101)

```json
{"jsonrpc":"2.0","id":101,"method":"fs/read_text_file","params":{
  "sessionId":"01J9…",
  "path":"/abs/path/to/workspace/src"
}}
```

**We must respond** (this is a request, not a notification). The
fs-proxy validates the path against workspaceRoot, refuses directory
reads (or returns a synthesized error), and returns:

```json
{"jsonrpc":"2.0","id":101,"error":{"code":-32602,"message":"path is a directory"}}
```

In practice Gemini tends to call `list_directory` for dir listings
and only calls `fs/read_text_file` for files, so the happy path
returns `{content:"…file contents…"}`.

### 3.6 Update: tool-call progress / end (A → C)

```json
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"01J9…",
  "update":{"sessionUpdate":"tool_call_update",
            "toolCallId":"tc_1",
            "status":"completed",
            "content":[{"type":"content","content":{"type":"text","text":"…"}}]}
}}
```

Status `pending | in_progress | completed | failed`. We map
`completed` / `failed` to `toolcall_end` on the omp stream.

### 3.7 `session/request_permission` (A → C, request, id=102)

Tool-call requiring user approval:

```json
{"jsonrpc":"2.0","id":102,"method":"session/request_permission","params":{
  "sessionId":"01J9…",
  "toolCall":{"toolCallId":"tc_2","kind":"fs/write_text_file","title":"Write",
              "locations":[{"path":"src/foo.ts"}]},
  "options":[
    {"optionId":"o1","kind":"allow_once","name":"Allow once"},
    {"optionId":"o2","kind":"allow_always","name":"Always allow"},
    {"optionId":"o3","kind":"reject_once","name":"Reject"}
  ]
}}
```

`permissions.ts` consults the active policy and returns:

```json
{"jsonrpc":"2.0","id":102,"result":{
  "outcome":{"outcome":"selected","optionId":"o1"}
}}
```

### 3.8 `session/prompt` response (A → C)

Arrives once the turn is complete:

```json
{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}
```

`mapStopReason("end_turn") → "stop"`. Any open text/thought spans
are closed by `event-mapping` when the response lands.

## 4. Cancellation and shutdown

### 4.1 Mid-turn cancellation

If the user hits Esc, we call:

```json
{"jsonrpc":"2.0","id":5,"method":"session/cancel","params":{
  "sessionId":"01J9…"
}}
```

The agent responds with `stopReason: "cancelled"` on the original
`session/prompt` (id=4). `mapStopReason("cancelled") → "aborted"`.

### 4.2 Process shutdown

On session end:

1. Send `session/cancel` if a prompt is in flight; wait ≤ 10 s for the
   original `session/prompt` to resolve.
2. Close stdin.
3. Wait ≤ 5 s for the child to exit naturally.
4. `SIGTERM`; wait 5 s.
5. `SIGKILL`.

If steps 1–3 succeed, `subprocess.unref()` was already called after
`initialize`, so the parent can exit without blocking on the child.

## 5. Known wire edge cases

- **Empty content on `agent_message_chunk`.** Gemini occasionally
  sends zero-length text chunks as keepalive. Drop them in
  `event-mapping` (don't emit a delta for empty strings).
- **`tool_call_update` arrives after `stopReason`.** Race condition
  when the agent finishes the response and then flushes a final
  status update. We close out any open tool span on response arrival
  and ignore the late update at DEBUG.
- **`plan` updates arrive mid-text.** We attach them to metadata and
  keep the text span open — they are advisory.
- **`available_commands_update` may arrive right after
  `session/new`** (before the first prompt). Dispatched to metadata
  with no side effect.

## 6. Learning aids

Two useful ways to gather your own traces:

- `GEMINI_CLI_ACP_TRACE=1 gemini --debug --experimental-acp` — writes
  frames to stderr with timestamps; easy to read alongside omp's
  DEBUG log.
- socat-style fifo shim: a 15-line Node script that pipes stdin to
  the real `gemini` and tees both sides to `.jsonl` files. Useful
  for diffing before/after a Gemini release.

Both are developer-only; we do not ship either.
