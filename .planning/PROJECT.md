# Oh My Pi (oh-oh-my-pi)

## What This Is

A constrained fork of [oh-omp](https://github.com/open-horizon-labs/oh-omp) — a terminal-native AI coding agent — that adds a context-assembly system to replace legacy compaction-based context management. The goal is a reliable daily-driver harness for AI-assisted development where long sessions stay competent without ballooning the active context window.

## Core Value

In long sessions, the agent stays competent and oriented without bloating the active context window or forcing the user to re-brief.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- Tiered memory architecture (LTM/STM/WM) with addressable locator maps (ADR 0003)
- Tool-result assembly bridge observes tool events and populates memory contract (ADR 0004)
- Extension-based integration — context assembly hooks wire as extensions, not protocol replacements
- Multi-provider LLM client with streaming support (Anthropic, OpenAI, Google, Azure)
- Agent runtime with tool calling and state management
- RPC/SSE protocol compatibility with upstream (ADR 0002)
- Fork strategy: minimize upstream diff, add via new files, prefer composition (ADR 0001)

### Active

<!-- Current scope. Building toward these for v1.0 context-bounding milestone. -->

- [ ] Bound active turn window with hard upper limit (~150k tokens of prior context)
- [ ] Gate older history behind relevance floor
- [ ] Exclude old tool transcript from conversation window
- [ ] Log every inclusion/exclusion decision for observability
- [ ] Config cutover: replace hotWindowTurns + 4 budget knobs with recentMessageCap + relevanceFloor

### Out of Scope

<!-- Explicit boundaries. -->

- Anchor state machines for topic-key identity — speculative, zero production evidence (per salvage)
- Tool evidence lane plumbing — over-engineered, data should drive need (per salvage)
- Scoring formulas and budget borrowing semantics — design debt without measurement (per salvage)
- Entity management systems for concepts that don't exist in production yet
- Feedback loop / conversation distillation — deferred, get forward path right first
- Broad runtime rewrites or renaming core events (ADR 0001 constraint)

## Context

- **Codebase state:** Bun/TypeScript monorepo with Rust native addon. Primary package is `packages/coding-agent/` (4839-line `agent-session.ts` god object).
- **Fork additions:** Context assembly pipeline in `packages/coding-agent/src/context/` (assembler, bridge, recall, memory-contract) — 3060 lines total with zero test coverage.
- **Dual context systems:** Legacy compaction (`compaction.ts`, 1328 lines) coexists with new assembler, gated by runtime mode flag. This is the fork's primary technical debt.
- **Previous attempt:** A 380-line design spec was produced but over-engineered (anchor systems, evidence lanes, scoring formulas). Salvaged to 4 core rules. See `.oh/context-bounding.md` for full salvage notes.
- **Implementation surface:** `message-transform.ts`, `passive-hydration.ts`, `bridge.ts`, `ingest.ts`, `sdk.ts`
- **Spec for reference:** `docs/superpowers/specs/2026-03-14-context-bounding-design.md`

## Constraints

- **Protocol compat:** Preserve event names, lifecycle semantics, and completion signaling (ADR 0001, 0002). Downstream orchestrators consume these contracts.
- **Single active context manager:** Only one context-management system may be active at runtime (ADR 0003 cutover invariant).
- **Patch scope:** Only context-assembly hooks, observability, provenance metadata, and token/latency budget enforcement. No broad runtime rewrites.
- **Upstream sync:** Keep patch queue small. Gate syncs with compatibility tests.
- **Simplicity first:** Start with simplest implementation that tests the hypothesis. Add machinery only when dogfooding shows a specific failure (per salvage guardrail).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 4 core rules over anchor state machine | Salvage: anchor system was speculative, designed from first principles with zero production evidence | -- Pending |
| Config cutover: 5 knobs to 2 | Salvage: sound decision that survived review pruning | -- Pending |
| Extension-based integration | ADR 0001: composition over modification, minimize upstream diff | Good |
| Tool-result bridge as observer | ADR 0004: bridge observes, assembler manages — separate responsibilities | Good |

---
*Last updated: 2026-03-19 after v1.0 milestone initialization*
