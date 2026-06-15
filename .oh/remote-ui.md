# Session: remote-ui

## Aim
**Updated:** 2026-03-26

### Aim Statement

**Aim:** The user walks away from the terminal, pulls out their phone, and is already looking at the live session — no setup, no tunneling ceremony, no SSH.

**Current State:** Session is trapped on the host. `/background` keeps the agent working but the user is blind until they return to the terminal.

**Desired State:** The user opens `http://macbook:7777` on their phone (Tailscale handles reachability), sees the live transcript, approves tool calls, sends messages. It just works because Tailscale is already running.

### Mechanism

**Change:** A local HTTP server embedded in the agent process that serves a mobile-first web UI over the Tailscale interface.

**Hypothesis:** The hard part of remote control is usually networking. Tailscale eliminates that entirely — every device is already on the same network with TLS. What remains is purely a UI problem: render the session in a browser and accept input.

**Assumptions:**
- Tailscale is running on both the host and the phone (already true for this user)
- The session's event stream is rich enough to reconstruct a readable transcript in a web view
- Browser-based is sufficient — no native app needed
- The agent process can serve HTTP without meaningful overhead
- Tailscale's auth (device identity + MagicDNS) is sufficient security for v1 — no separate auth layer

### Feedback

**Signal:** The user completes a "walk away, steer from phone, return to desk" cycle without ever touching SSH or `fg`.

**Timeframe:** First session after shipping.

### Guardrails

- **Separate from Context Assembler.** This is remote UI, not memory infrastructure. Different concern, different codebase area.
- **Tailscale is the network.** No port forwarding, no tunneling setup, no relay service. If Tailscale isn't running, the feature simply isn't reachable — that's fine.
- **Agent stays local.** The web server is a view into the process, not a migration of it.
- **v1 surface is small.** Read transcript. Send messages. Approve/reject pending tool calls. That's it.
- **No disruption to terminal UX.** The TUI keeps working exactly as-is. The web view is additive.

## Problem Space
**Updated:** 2026-03-26

### Objective

Minimize latency between "user leaves terminal" and "user can see and interact with the session from their phone." The optimization target is presence, not coding — reading, steering, approving.

### Constraints

| Constraint | Type | Reason | Question? |
|-|-|-|-|
|Tailscale is the network layer|hard|User decision. No cloud relay, no port forwarding.|No|
|Agent runs local, single process|hard|No session migration to cloud. Agent IS the host process.|No|
|No disruption to TUI|hard|Terminal UX must work exactly as-is. Web view is additive.|No|
|v1 surface: read, send, approve|soft|Enough for steering. File browsing, diff review later.|Could expand if trivial|
|Web-only, no native app|soft|Browser sufficient for read+steer use case.|Revisit if UX is bad on mobile Safari|
|Single concurrent remote viewer|assumed|One user, one phone.|Could lift later|
|No separate auth layer|assumed|Tailscale device identity is sufficient.|Revisit if exposing to non-TS networks|

### Terrain

**Systems involved:**
- `AgentSession` — the core session object. **Supports multiple concurrent event subscribers** (`subscribe()` returns per-listener unsubscribe). This is the critical enabler.
- `RpcMode` — already defines the complete command/event vocabulary (prompt, steer, abort, get_messages, get_state, extension_ui_request/response). This is the protocol, already built.
- `InteractiveModeContext` — the TUI's session context. Background mode (`/background`) transitions this but is orthogonal — the web view can work while TUI is active.
- `Bun.serve()` — built-in HTTP + WebSocket server. Zero dependencies.

**Who's affected:**
- The user (sole consumer of both TUI and web view)
- The agent process (now serves HTTP in addition to running the agent)

**Blast radius if wrong:**
- Low. This is purely additive. If the web server crashes, the agent keeps running. If the WebSocket drops, reconnect and re-fetch transcript.
- Only risk: if HTTP serving introduces event loop contention that slows tool execution. Unlikely with Bun's architecture but measurable.

**Precedents:**
- Claude Code Remote Control — the reference UX. Phone as steering wheel, not keyboard.
- RPC mode itself — proves the agent can be driven headlessly via a command/event protocol.
- `session.subscribe()` multi-listener design — proves N consumers can observe the same event stream.

### Key Technical Findings

1. **No separate RPC process needed.** AgentSession.subscribe() supports N listeners. The web server can subscribe alongside the TUI on the same session instance. No IPC, no sidecar, no session file handoff.

2. **RPC types are the WebSocket protocol.** The existing `RpcCommand` and `RpcEvent` types define exactly what the web client sends and receives. We reuse the type vocabulary, not the stdio transport.

3. **Extension UI requests are ID-based.** When the agent asks "run this command?" it emits an `extension_ui_request` with an ID. Whoever responds first (TUI or web) resolves the promise. First-writer-wins is correct for single-user-two-devices.

4. **History on connect is trivial.** `session.agent.state.messages` gives the full transcript. Send it on WebSocket open, then stream events.

5. **Background mode is orthogonal.** `/background` + SIGTSTP suspends the TUI process. The web view works regardless — whether the TUI is active, backgrounded, or the user started in headless mode.

### Assumptions Made Explicit

1. **Bun.serve() inside the agent process won't cause event-loop contention.** If false: the web server would need to be a separate worker/process, complicating the architecture significantly.

2. **The RPC event vocabulary is sufficient for a readable transcript.** If false: we'd need to define new event types for the web client, diverging from the existing protocol.

3. **First-writer-wins for extension UI responses is acceptable.** If false: we'd need request routing or exclusive claim semantics. Unlikely for single-user.

4. **Tailscale MagicDNS resolves the host from the phone.** If false: user falls back to Tailscale IP, which still works but is less magic.

5. **Mobile Safari WebSocket works reliably over Tailscale.** If false: we'd need SSE fallback or long-polling. Worth testing early.

### X-Y Check

- **Stated need (Y):** Resume sessions on mobile
- **Underlying need (X):** Maintain presence — see what the agent is doing, steer it, unblock it — without being at the desk
- **Confidence:** High that Y=X. "Resume" is the colloquial framing; the real need is continuous presence.

### The Actual Work

The session infrastructure is already built. The problem decomposes into:

1. **HTTP/WebSocket bridge** (~200 lines) — `Bun.serve()` inside the agent process. Serves static web assets on GET, upgrades `/ws` to WebSocket. On connect: send transcript. On message: dispatch as session commands. On session event: forward to WebSocket.

2. **Web frontend** (small but real) — Mobile-first HTML/CSS/JS. Renders the message transcript. Input box for sending messages. Pending-approval cards for extension UI requests. No build step — vanilla JS or a single bundled file.

3. **Lifecycle integration** — `--remote-port 7777` flag (or config setting). Server starts with the agent, stops on exit. Port printed to stderr on startup.

4. **Dual-input arbitration** — Mostly free (session handles queuing). Only edge case: both TUI and web submit a prompt simultaneously → session sees it as a steer/follow-up, which is correct.

### Ready for Solution Space?

Yes. The problem is well-scoped. The infrastructure is favorable. The three work items (bridge, frontend, lifecycle) are independent enough to plan concretely. The biggest unknown is the web frontend — what's the minimal viable rendering of the event stream on a phone screen — which is a solution-space question.
