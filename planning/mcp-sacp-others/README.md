# Deferred Work — MCP Bridging, SACP, Worker Pools, and Friends

This folder plans the six items the parent `acp-integration` plan
explicitly deferred. Each is an independent workstream; they do not
all need to ship together, and the traceability matrix in `tasks.md`
lets you slice them individually.

## The six workstreams

| # | Name                              | Shape                                               | Depends on    |
|---|-----------------------------------|-----------------------------------------------------|---------------|
| W1 | **MCP bridging**                 | Expose omp's MCP servers to the CLI agent through the ACP session; optionally relay the agent's MCP servers back to omp. | acp-cli lands |
| W2 | **SACP migration**               | Track the `agent-client-protocol` v1.0 TS SDK when it lands; adopt conductor/link-builder patterns in TS. | SDK release   |
| W3 | **Worker pools**                 | Pre-warmed CLI child-process pool + bounded work queue with backpressure. | acp-cli lands |
| W4 | **L3 conformance tools**         | `acp_check_constraints`, `acp_query`, `acp_expand`, `acp_debug` — **but these belong to the AI Context Protocol, not the Agent Client Protocol**. Plan covers what adopting them would mean for omp. | Codebase index |
| W5 | **HTTP exit-code mapping**       | Optional HTTP facade that maps CLI exit codes to HTTP statuses (0→200, 1→500, 42→400, 53→429). | acp-cli lands |
| W6 | **stream-json event taxonomy**   | Parse `--output-format stream-json` events (init / message / tool_use / tool_result / error / result) for Claude-Code-style headless mode as a second provider shape. | acp-cli lands |

## Scope boundary: what this plan is not

- Not a re-plan of the parent `acp-integration` work.
- W4 is a different protocol (name collision — see `research.md §1`
  in the parent plan). The plan discusses what it would cost to adopt,
  not how to call it "ACP L3 conformance" in omp.
- SACP is Rust; the "migration" is really "port the design ideas to
  TS when the v1.0 TS SDK exposes them."

## Prerequisites

- `planning/` (parent): the acp-integration plan must have landed —
  specifically the adapter, session, codec, and provider seams.
- `packages/coding-agent/src/mcp/` already has a full MCP client /
  manager; W1 extends it, it doesn't replace it.

## Artifacts

1. [`requirements.md`](./requirements.md) — EARS per workstream
2. [`design.md`](./design.md) — architecture, interfaces, risks
3. [`tasks.md`](./tasks.md) — ordered 2–4h tasks per workstream with traceability

## Recommended sequencing

```
acp-integration lands
       │
       ├──▶ W3 (worker pools)          ─┐   fast, isolated, unlocks production scale
       │                                │
       ├──▶ W1 (MCP bridging)          ─┤   medium; touches MCP manager + ACP session
       │                                │
       ├──▶ W6 (stream-json taxonomy)  ─┤   medium; second provider shape
       │                                │
       ├──▶ W5 (HTTP facade)           ─┘   only if a need materializes; optional
       │
       │   (later, when TS SDK ships)
       ├──▶ W2 (SACP migration)
       │
       │   (only if we grow a codebase-metadata index)
       └──▶ W4 (AI-Context-Protocol tools)
```

W3 first: it's the smallest, has no protocol dependencies, and removes
the largest production risk (spawn latency). W4 is last because it's
the only workstream that isn't an ACP/MCP integration at all.
