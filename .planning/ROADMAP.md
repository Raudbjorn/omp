# Roadmap: Oh My Pi — Context Bounding

## Overview

Context bounding delivers a bounded active context window for long AI coding sessions. The roadmap has two phases: first, deliver the core bounding mechanism with config cutover and observability so the hypothesis is immediately testable — prompt size plateaus instead of growing linearly. Second, add relevance-gated hydration so high-value older context survives bounding while low-value context stays excluded. The simplest implementation ships first (per salvage guardrail); machinery is added only when dogfooding shows a specific failure.

## Phases

**Phase Numbering:**
- Integer phases (1, 2): Planned milestone work
- Decimal phases (1.1, 1.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Bounded Context Window** - Config cutover, observability, hard message cap, tool transcript exclusion, omission markers
- [ ] **Phase 2: Relevance-Gated Hydration** - Relevance floor for older history, contract validation of tool-mediated recovery

## Phase Details

### Phase 1: Bounded Context Window
**Goal**: In long sessions, the active context stays deliberately bounded — prompt size plateaus instead of growing linearly, tool transcript is excluded, and every bounding decision is observable
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, CONF-02, OBSV-01, OBSV-02, BOUND-01, BOUND-02, BOUND-03
**Success Criteria** (what must be TRUE):
  1. In a 50+ turn session, effective prompt size plateaus instead of growing linearly — token telemetry shows a ceiling near the configured cap rather than unbounded growth
  2. Old tool call/result pairs are absent from the active conversation window; only lightweight omission markers remain in their place, indicating what was excluded and how to recover it
  3. Every turn's debug log shows a per-message inclusion/exclusion decision with reason (cap, tool-transcript) and before/after token counts — the operator can trace exactly why each message was included or excluded
  4. Configuration uses only recentMessageCap + relevanceFloor; the legacy hotWindowTurns and 4 budget knobs are gone; startup rejects any config that would activate both legacy compaction and assembler simultaneously
**Plans**: 3 plans in 2 waves

Plans:
- [ ] 01-01-PLAN.md — Config cutover (5 assembler knobs) and dual-mode guard (CONF-01, CONF-02)
- [ ] 01-02-PLAN.md — Observability wiring (enriched types, snapshot logging) (OBSV-01, OBSV-02)
- [ ] 01-03-PLAN.md — Bounding logic (tool exclusion, markers, plateau) (BOUND-01, BOUND-02, BOUND-03)

### Phase 2: Relevance-Gated Hydration
**Goal**: High-value older context survives bounding while low-value context stays excluded — the model retains critical decisions and referenced context without the user re-briefing, and anything omitted is recoverable on demand through existing tools
**Depends on**: Phase 1
**Requirements**: RELV-01, RELV-02
**Success Criteria** (what must be TRUE):
  1. In a 50+ turn session, messages older than the recent cap that contain critical decisions or referenced context appear in the active window when their relevance score exceeds the configured floor — the model remembers what matters without carrying everything
  2. User does not experience more re-brief turns, forgotten decisions, or redundant tool calls after bounding is enabled compared to unbounded sessions — competence is preserved while prompt size is reduced
  3. When the model needs omitted context, existing tools (read/grep/LSP/recall) successfully recover it without requiring user intervention — tool-mediated recovery is verified as a viable fallback, not assumed
**Plans**: TBD

Plans:
- [ ] 02-01: TBD

## Coverage

All 9 v1 requirements mapped to exactly one phase. No orphans. No duplicates.

| Category | Requirements | Phase |
|----------|-------------|-------|
| Configuration | CONF-01, CONF-02 | Phase 1 |
| Observability | OBSV-01, OBSV-02 | Phase 1 |
| Conversation Bounding | BOUND-01, BOUND-02, BOUND-03 | Phase 1 |
| Relevance Gating | RELV-01, RELV-02 | Phase 2 |

**Mapped: 9/9 ✓**

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Bounded Context Window | 0/3 | Planned | - |
| 2. Relevance-Gated Hydration | 0/1 | Not started | - |
