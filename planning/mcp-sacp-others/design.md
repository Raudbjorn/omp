# Design — Deferred ACP-adjacent Work

One section per workstream. Each section has its own architecture
sketch, interface, error modes, and testing strategy.

## W1 — MCP Bridging

### 1.1 Architecture

```
 ┌────────────┐   ACP session   ┌──────────────┐
 │  CLI agent │ ◀───stdio────▶ │ AcpCliSession│
 └────────────┘                 └──────┬───────┘
       ▲                                │ mcpServers in initialize
       │ tool call over                 │
       │ its MCP channel                ▼
       │                        ┌──────────────────────────────┐
       │                        │ MCP bridge (new)             │
       │                        │ • map CLI MCP tool call →    │
       │                        │   MCPManager.callTool        │
       │                        │ • stream result back on ACP  │
       │                        └─────────────┬────────────────┘
       │                                      │
       │                                      ▼
       │                        ┌──────────────────────────────┐
       └────────────────────────│ existing MCPManager          │
                                │ packages/coding-agent/src/mcp│
                                └──────────────────────────────┘
```

### 1.2 Interface

```ts
// packages/ai/src/providers/acp-cli/mcp-bridge.ts
export interface McpBridge {
  /** Serialize omp's current MCP servers into the ACP initialize message. */
  describe(manager: MCPManager): AcpMcpServer[];

  /** Handle `tool_call` where the tool originates from an omp MCP server. */
  handleToolCall(
    manager: MCPManager,
    call: AcpToolCall,
    signal: AbortSignal,
  ): Promise<AcpToolResult>;

  /** Watch MCPManager for add/remove events and push capability updates. */
  subscribe(
    manager: MCPManager,
    session: AcpCliSession,
  ): Disposable;
}
```

### 1.3 Error Modes

| Condition                              | Behavior                                   |
|----------------------------------------|--------------------------------------------|
| MCP server disconnected mid-call       | return ACP `tool_result` with `isError=true`; existing reconnect logic handles the next call |
| CLI calls a tool omp doesn't expose    | return "unknown tool" error; do not crash session |
| `describe()` called with 0 MCP servers | send empty `mcpServers: []`; valid per ACP spec |

### 1.4 Testing

- Unit: `describe()` serialization snapshots.
- Integration: fake ACP server calls a known MCP tool; verify it
  flows through a real `MCPManager` fixture against a stub MCP
  server (existing `test/mcp-test-utils.ts` has the fixtures).

---

## W2 — SACP Migration

### 2.1 Tracking, not porting

No design diagram — this is a decision protocol, not an
implementation. The deliverable is a CHECKLIST.md in this folder
that we tick off when v1.0 of the TS SDK lands.

### 2.2 Evaluation checklist (to grade v1.0 against)

1. **Link builder API** — can we replace our hand-rolled
   `AcpCliSession` state machine with a declarative link?
2. **Session-scoped closures** — does it remove the `Map<id,
   Deferred>` boilerplate?
3. **Starvation-free async** — is there a `run_until`-equivalent in
   JS to prevent handler monopolization?
4. **Codec tolerance** — does it expose a hook for non-JSON line
   filtering (our Gemini workaround)?
5. **Backwards-compat** — can v1.0 still speak to agents pinned at
   the v0.16 wire format?

### 2.3 Risk

Low — staying on v0.16 indefinitely is a valid fallback. The only
forcing function would be a security advisory.

---

## W3 — Worker Pools

### 3.1 Architecture

```
 session open request          returned on close
        │                               ▲
        ▼                               │
 ┌─────────────────────────────────────────────┐
 │ AcpCliPool (per adapter+cwd)                │
 │                                             │
 │  free:   [ child_a , child_b ]  ◀─ return   │
 │  busy:   { s1→child_c, s2→child_d }         │
 │  queue:  [ waiter_1, waiter_2 ]             │
 │                                             │
 │  sweep every 60s → kill idle > TTL          │
 └──────────────┬──────────────────────────────┘
                │ spawn if free==[] and busy<max
                ▼
            Bun.spawn(adapter, acpArgs, { cwd })
```

### 3.2 Interface

```ts
// packages/ai/src/providers/acp-cli/pool.ts
export interface AcpCliPool {
  acquire(key: PoolKey, signal: AbortSignal): Promise<AcpCliChild>;
  release(child: AcpCliChild): void;
  /** Force-kill a child and remove it from tracking. */
  discard(child: AcpCliChild, reason: string): void;
  /** Cooperative drain — used by the parent-exit hook. */
  shutdown(timeoutMs: number): Promise<void>;
  stats(): { free: number; busy: number; queued: number };
}

export interface PoolKey {
  readonly kind: CliKind;
  readonly cwd: string;
  readonly authProfile?: string; // reserved for multi-user scenarios
}
```

### 3.3 Key invariants

- A child process is in **exactly one** of `free`, `busy`, or gone.
- No waiter starves: queue is FIFO and enforced by a single async
  scheduler task.
- Every `acquire` is paired with exactly one `release` **or**
  `discard` — enforced by a `using`-style wrapper in `session.ts`.

### 3.4 Error Modes

| Condition                 | Behavior                                        |
|--------------------------|-------------------------------------------------|
| Child exits while in free | drop silently; logs at debug                   |
| Child exits while in busy | surface to the owning session as `child-exited-unexpectedly`; do not recycle |
| `acquire` aborted         | if already spawning, let spawn finish then terminate immediately |
| Shutdown timeout          | SIGTERM → wait → SIGKILL; logged              |

### 3.5 Testing

- Unit: pool state machine with fake children (scripted exit codes).
- Stress: 100 concurrent `acquire` / `release` cycles with randomly
  exiting fake children; assert no leaked children, no unpaired
  releases, queue drains to zero.

---

## W4 — AI Context Protocol Tools (feature-flagged)

### 4.1 Placement

**Not a provider; a capability.** Implemented as a new MCP server
hosted by omp itself — i.e. we expose the four tools via the
existing MCP surface, not via ACP. This keeps the name-collision
from leaking into our code structure.

```
packages/coding-agent/src/acp-context/
├── index.ts             ← register as built-in MCP server (feature-flagged)
├── cache-reader.ts      ← reads .acp.cache.json from cwd
├── tools/
│   ├── check-constraints.ts
│   ├── query.ts
│   ├── expand.ts
│   └── debug.ts
└── types.ts
```

### 4.2 Lock-level enforcement

A file with `lock: "frozen"` in the cache:
- `acp_check_constraints` returns `{ level: "frozen", ... }`.
- The **edit / write** tool's approval flow is patched to consult
  `check_constraints` before prompting; `frozen` short-circuits to
  hard deny.

### 4.3 Feature flag

`features.acpContext` (default `false`). When off:
- The MCP server is not registered.
- No performance or correctness change for existing users.

### 4.4 Why this is last

The AI Context Protocol is a separate, externally-owned spec. omp
would be a consumer; we should not invest heavily until a real user
asks for it. Plan exists so we know the shape when they do.

---

## W5 — HTTP Exit-Code Mapping

### 5.1 Architecture

```
 curl ─▶ omp --http :8080 ─▶ AcpCliSession ─▶ CLI child
          │                      │
          │                      └─▶ aggregates: stdout events, stderr tail,
          │                                        exit code
          ▼
    HTTP 200 / 400 / 429 / 500 / 502 + optional SSE body
```

### 5.2 Routing

| Path                     | Method | Purpose                              |
|--------------------------|--------|--------------------------------------|
| `/v1/prompt`             | POST   | Single-turn; response body = final text + metadata |
| `/v1/prompt/stream`      | POST   | SSE; each `session/update` becomes an SSE event |
| `/v1/adapters`           | GET    | List detected adapters + auth status |

### 5.3 Exit-code → HTTP table

```ts
const EXIT_TO_HTTP: Record<number, number> = {
  0:  200,
  1:  500,
  42: 400,
  53: 429,
};
// any other non-zero → 502
```

### 5.4 Auth

- Default bind: `127.0.0.1`.
- If `--http-bind 0.0.0.0` is used, require `--http-token <secret>`
  and reject requests without a matching `Authorization: Bearer`.
- No cookie-based flow; this is an automation surface, not a UI.

### 5.5 Error Modes

| Condition                  | Response                                      |
|----------------------------|-----------------------------------------------|
| Adapter missing            | `404` with install hint                       |
| Adapter logged out         | `401` with login command in body              |
| Pool saturated (W3)        | `503` with `Retry-After`                      |
| Handshake timeout          | `504 Gateway Timeout`                         |

---

## W6 — stream-json Event Taxonomy

### 6.1 When it runs

`claude` supports both ACP and headless-JSON modes. Adapter logic:

```ts
async runClaude(prompt: string): Promise<Stream> {
  try {
    return await this.openAcp(prompt);           // preferred
  } catch (err) {
    if (isAcpUnsupported(err)) {
      return this.openStreamJson(prompt);         // fallback
    }
    throw err;
  }
}
```

### 6.2 Event → omp-event mapping

| stream-json event  | omp event                          | notes                     |
|--------------------|------------------------------------|---------------------------|
| `init`             | stored as session metadata         | one per invocation        |
| `message`          | `text-delta`                       | append to assistant msg   |
| `tool_use`         | `tool-call`                        | carries id + args         |
| `tool_result`      | `tool-call-progress` → `tool-call-complete` | keyed by tool_use id |
| `error`            | `warning` event (non-fatal)        | log + continue            |
| `result`           | `turn-end` with usage              | terminal event            |

### 6.3 Shared codec

The tolerant line reader from the parent plan's `jsonrpc-codec.ts`
is extracted into a lower-level `line-json-reader.ts` and reused
here — avoids two divergent parsers for near-identical streams.

### 6.4 Error Modes

| Condition               | Behavior                                |
|-------------------------|-----------------------------------------|
| stdout silent > timeout | cancel + surface stderr tail            |
| `result` missing at exit| synthesize a `turn-end` with code + stderr tail |
| unknown event type      | trace-log and ignore (per R6.8)         |

### 6.5 Testing

- Fixture file `test/fixtures/stream-json-turn.jsonl` captured from a
  real `claude --output-format stream-json` run.
- Snapshot: feed fixture through the parser; assert emitted omp
  event sequence.

---

## Cross-workstream risks

| Risk                                                                 | Mitigation                                                  |
|----------------------------------------------------------------------|-------------------------------------------------------------|
| Worker pool + MCP bridge race (MCP state attached to a recycled child) | per-session MCP state lives in `AcpCliSession`, not in the pooled child |
| HTTP facade leaks a session on crash                                 | pool shutdown hook + per-request session lifetime         |
| SACP migration ships half-done                                       | migrate server and client in one PR (R2.2)                |
| stream-json and ACP codec drift                                      | share `line-json-reader.ts` (§6.3)                         |
| AI-Context-Protocol cache poisoning                                  | treat cache file as untrusted input; validate schema before use |
