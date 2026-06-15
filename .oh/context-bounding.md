# Session: context-bounding

## Aim
**Updated:** 2026-03-19

## Aim Statement

**Aim:** In long sessions, the agent stays competent and oriented without bloating the active context window or forcing the user to re-brief.

**Current State:** Context assembly carries too much low-value history forward, so the live prompt keeps growing and increasingly competes with the task at hand. The user experiences this as wasted budget, noisier reasoning, and a higher risk of "you forgot" or redundant rediscovery. Tool call/result transcript is the primary bloat source — it grows faster than conversational history and contributes less to ongoing decisions.
**Desired State:** The active context stays deliberately bounded and relevance-driven, targeting ~150k tokens of prior context before the current turn. Only the recent causal chain and high-value prior context are included by default. Old tool transcript is excluded from the conversation window entirely. Anything omitted remains recoverable through tools when the model truly needs it.

### Mechanism
**Change:** Bound the default active turn window with a hard upper limit, gate older history behind a relevance floor, exclude old tool transcript from the conversation window, and log every inclusion/exclusion decision. Start with the simplest version that tests the hypothesis.
**Hypothesis:** After ~150k tokens of prior context (before the current turn), model quality degrades regardless of window size. A bounded active window plus relevance-gated hydration will reduce prompt noise without hurting competence, because the model can re-fetch exact details through read/grep/LSP-style tools when those details become necessary. Tool transcript is the fastest-growing and lowest-value portion of context and should be the first thing excluded.
**Assumptions:**
- Per-turn information need is sparse enough that a bounded active window is viable.
- Relevance scoring is good enough to keep causally important older context above the line.
- Tool-mediated recovery is fast enough that omitted context can be reacquired without degrading the experience.
- The main failure mode today is excess irrelevant context, not lack of raw history.

### Feedback
**Signal:** In dogfood sessions, effective prompt size plateaus instead of ballooning, older low-value context is excluded by default, and the user does not experience more re-brief turns, forgotten decisions, or redundant tool calls.
**Timeframe:** Immediate telemetry after implementation, with confidence after 3 real sessions of 50+ turns.

### Guardrails
- The cap is a safety rail, not the product. If it amputates causal context, change it.
- Relevance filtering must optimize for competence first, token savings second.
- Omitted context must remain recoverable on demand through existing tools and locators.
- Do not let bounded context become a lossy shortcut for missing retrieval or weak scoring.
- Start with the simplest implementation that tests the hypothesis. Add machinery only when dogfooding shows a specific failure, not from first-principles speculation.
- Do not design entity management systems (identity, lifecycle, override semantics) for concepts that don't exist in production yet.

## Salvage
**Updated:** 2026-03-19
**Outcome:** Spec over-engineered; restarting with minimal 4-rule design.

### What Happened
Brainstorming session produced a 380-line design spec with anchor state machines, tool evidence lanes, scoring formulas, and budget borrowing semantics. Multiple review iterations added complexity without pruning scope. Dissent analysis confirmed the anchor system and evidence lane were speculative. User called it: the core idea is 4 rules, not a state machine.

### Learnings
1. The problem is simple. Cap recent conversation, floor older history, exclude tool transcript, log exclusions.
2. Review loops inflated instead of pruning. 7 reviewer passes each added detail; none removed scope.
3. The anchor system (topic-key identity, override semantics, budget borrowing, fail-closed) was designed from first principles with zero production evidence.
4. Arbitrary numeric constants (cap of 4 refs, evidence floor uplift, sub-budget shares) are design debt without measurement.
5. Config cutover (5 knobs to 2) is sound and survives.

### Reusable Fragments
- 4 core rules: cap recent messages, relevance-floor older history, exclude old tool transcript, log exclusions
- Config cutover: replace hotWindowTurns + 4 budget knobs with recentMessageCap + relevanceFloor
- Implementation surface map: message-transform.ts, passive-hydration.ts, bridge.ts, ingest.ts, sdk.ts
- Spec file (for reference, not reuse): docs/superpowers/specs/2026-03-14-context-bounding-design.md

### Fresh Start
Write a minimal spec: 4 rules, config cutover, observability, 4-5 testing contracts. No anchor system, no evidence lane plumbing, no scoring formulas. Implement, dogfood, let data tell you what's missing.