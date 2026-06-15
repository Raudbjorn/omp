# Milestones

## v1.0 Context Bounding (in progress)

**Started:** 2026-03-19
**Goal:** Bound the active context window with hard limits, relevance-gated hydration, and tool transcript exclusion.

**Scope:**
- Hard cap on recent messages in active window
- Relevance floor for older history inclusion
- Tool transcript exclusion from conversation window
- Observability logging for inclusion/exclusion decisions
- Config cutover: hotWindowTurns + 4 budget knobs to recentMessageCap + relevanceFloor
