# Requirements: Oh My Pi — Context Bounding

**Defined:** 2026-03-19
**Core Value:** In long sessions, the agent stays competent and oriented without bloating the active context window or forcing the user to re-brief.

## v1 Requirements

Requirements for v1.0 context-bounding milestone. Derived from `.oh/context-bounding.md` aim and salvage.

### Conversation Bounding

- [ ] **BOUND-01**: Active turn window is capped at a configurable recent message count (recentMessageCap), hard upper limit targeting ~150k tokens of prior context
- [ ] **BOUND-02**: Old tool call/result pairs are excluded from the conversation window entirely
- [ ] **BOUND-03**: Excluded turns are replaced with lightweight markers so the model knows context was omitted and can recover via tools

### Relevance Gating

- [ ] **RELV-01**: Messages older than the recent cap are included only if they score above a configurable relevance floor (relevanceFloor)
- [ ] **RELV-02**: Omitted context remains recoverable on demand through existing tools (read/grep/LSP/recall)

### Observability

- [ ] **OBSV-01**: Every inclusion/exclusion decision is logged per turn with reason (cap, floor, tool-transcript)
- [ ] **OBSV-02**: Token count telemetry emitted before and after bounding so the hypothesis can be validated

### Configuration

- [ ] **CONF-01**: Config cutover: replace hotWindowTurns + 4 budget knobs with recentMessageCap + relevanceFloor
- [ ] **CONF-02**: Runtime validation fails closed if configuration would activate both legacy compaction and assembler simultaneously

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Refinement

- **REFN-01**: Relevance scoring tuned by dogfood data (scoring formulas, per-category weights)
- **REFN-02**: Budget borrowing semantics for high-value older context that exceeds floor
- **REFN-03**: Anchor system for topic-key identity if dogfooding reveals causal context amputation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Anchor state machines | Speculative, zero production evidence (salvage) |
| Tool evidence lane plumbing | Over-engineered, data should drive need (salvage) |
| Scoring formulas and budget borrowing | Design debt without measurement (salvage) |
| Entity management for unrealized concepts | No production entity exists yet (salvage guardrail) |
| Feedback loop / conversation distillation | Deferred, get forward path right first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOUND-01 | Phase 1 | Pending |
| BOUND-02 | Phase 1 | Pending |
| BOUND-03 | Phase 1 | Pending |
| RELV-01 | Phase 2 | Pending |
| RELV-02 | Phase 2 | Pending |
| OBSV-01 | Phase 1 | Pending |
| OBSV-02 | Phase 1 | Pending |
| CONF-01 | Phase 1 | Pending |
| CONF-02 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
