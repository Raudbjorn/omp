# Phase 1 Research: Bounded Context Window

**Researched:** 2026-03-19
**Domain:** Context assembly pipeline — message bounding, config cutover, observability
**Confidence:** HIGH

## Summary

The context assembly system lives in `packages/coding-agent/src/context/` and is already well-structured for bounding. The `message-transform.ts` module already implements turn segmentation, hot-window stubbing, token estimation, and per-turn decision tracking (`TurnDecision[]`). The work is primarily a config cutover (replacing 5 assembler knobs with 2 simpler ones), adding a dual-mode guard (fail-closed when both compaction and assembler could activate), and enhancing observability (structured logging of inclusion/exclusion decisions and token telemetry).

The existing architecture is sound. `transformMessages()` already groups messages into turns, stubs tool results outside the hot window, and drops old turns to fit a token budget. The budget derivation (`deriveBudget()`) currently uses 4 percentage-based knobs — these need replacement with a simpler `recentMessageCap` (absolute token cap) and `relevanceFloor` (minimum relevance score for hydration). The `TransformMetadata` type already captures per-turn decisions with reasons, making OBSV-01 largely a logging concern rather than an architecture change.

**Primary recommendation:** This is a config simplification + observability enhancement, not an architecture rewrite. The message-transform pipeline's turn-segmentation and decision-tracking machinery stays. The budget derivation gets simplified. Logging gets added. The dual-mode guard gets formalized.

## Current Architecture

### File Layout
```
packages/coding-agent/src/context/
├── assembler/
│   ├── index.ts              # Re-exports from message-transform.ts and types.ts
│   ├── message-transform.ts  # Core: deriveBudget(), transformMessages(), segmentIntoTurns()
│   └── types.ts              # AssemblerConfig, TransformResult types
├── bridge/
│   └── bridge.ts             # ContextBridge — maps raw ConversationTurn[] → assembler input
├── recall/
│   ├── ingest.ts             # Indexes tool results into ToolResultStore after each turn
│   ├── passive-hydration.ts  # Injects recalled context into system prompt prefix
│   └── tool-result-store.ts  # FTS5-backed SQLite store for tool result search
├── assembly-summary.ts       # formatAssemblySummary() — human-readable summary text
├── effective-prompt-snapshot.ts # Captures pre/post token snapshots for telemetry
└── index.ts                  # Module re-exports
```

### Assembly Pipeline Flow
```
ConversationTurn[] (raw SDK history)
  → ContextBridge.mapToMessages()       [bridge.ts]
      Converts ConversationTurn[] to flat MessageParam[]
  → transformMessages()                 [message-transform.ts]
      1. segmentIntoTurns() — groups messages into Turn objects
      2. Applies hot-window logic (keeps last N turns verbatim)
      3. Stubs tool_result content in older turns
      4. Drops oldest turns if budget exceeded
      5. Returns TransformResult { messages, metadata }
  → passiveHydration.buildPrefix()      [passive-hydration.ts]
      Searches ToolResultStore, builds context prefix
  → formatAssemblySummary()             [assembly-summary.ts]
      Generates "[Assembly: X turns, Y kept, Z stubbed]" header
  → EffectivePromptSnapshot.capture()   [effective-prompt-snapshot.ts]
      Records token counts before/after
```

### Entry Point: `transformContext()` in `sdk.ts`
Located at ~line 1440 in `packages/coding-agent/src/sdk.ts`. This is the orchestrator function called before each LLM request. It:
1. Checks if context management mode is `"assembler"` (vs legacy compaction)
2. Gets conversation turns from the SDK session
3. Calls `ContextBridge.mapToMessages()` to flatten turns
4. Calls `transformMessages()` with derived budget
5. Calls `passiveHydration.buildPrefix()` for recalled context
6. Generates assembly summary header
7. Captures effective prompt snapshot
8. Returns the bounded messages + system prompt additions

## Config Schema

### Current Config: `settings-schema.ts`
**File:** `packages/coding-agent/src/config/settings-schema.ts`

The assembler settings live under the `assembler` group namespace. The settings schema uses a builder pattern with typed definitions:

#### The 5 knobs to replace:

| Setting Key | Type | Default | Purpose |
|---|---|---|---|
| `assembler.hotWindowTurns` | `number` | 5 | Number of recent turns kept verbatim |
| `assembler.messageBudgetPercent` | `number` | 0.6 (60%) | Fraction of model context for messages |
| `assembler.hydrationBudgetPercent` | `number` | 0.15 (15%) | Fraction of model context for passive hydration |
| `assembler.safetyMarginPercent` | `number` | 0.1 (10%) | Reserved margin |
| `assembler.turnBufferPercent` | `number` | 0.15 (15%) | Buffer for system prompt and tool definitions |

#### The mode toggle:

| Setting Key | Type | Default | Purpose |
|---|---|---|---|
| `contextManager.mode` | `enum` | `"compaction"` | Selects between `"compaction"` and `"assembler"` modes |

#### How settings are consumed:

Settings are read via `settings.get("assembler.hotWindowTurns")` or `settings.getGroup("assembler")`. The `getGroup()` call returns a typed `AssemblerSettings` object with all assembler keys. The type is inferred from the schema definition.

#### Budget derivation (`deriveBudget()`):
Located in `message-transform.ts` ~line 80. Takes `maxContextTokens` (model limit) and the 4 percentage knobs, returns a `Budget` object:
```typescript
interface Budget {
  messageTokens: number;    // maxContextTokens * messageBudgetPercent
  hydrationTokens: number;  // maxContextTokens * hydrationBudgetPercent
  safetyMargin: number;     // maxContextTokens * safetyMarginPercent
  turnBuffer: number;       // maxContextTokens * turnBufferPercent
}
```
The effective message cap = `messageTokens - safetyMargin`. This is what BOUND-01's `recentMessageCap` replaces.

### Replacement Config (CONF-01):

| New Setting Key | Type | Default | Purpose |
|---|---|---|---|
| `assembler.recentMessageCap` | `number` | 150000 | Hard token cap on recent messages (absolute, not percentage) |
| `assembler.relevanceFloor` | `number` | TBD | Minimum relevance score for hydration inclusion |

**Impact:** `deriveBudget()` simplifies dramatically — no percentage math, just a direct cap. The 4 percentage knobs and `hotWindowTurns` get removed. `hotWindowTurns` is replaced by the bounding logic that counts backwards from newest messages until `recentMessageCap` is reached.

## Implementation Surface Analysis

### `message-transform.ts` — Primary target
**File:** `packages/coding-agent/src/context/assembler/message-transform.ts` (~600 lines)

**Key functions:**
- `estimateMessageTokens(messages)` — Char-based token estimation (chars/4 heuristic). **Stays as-is.**
- `deriveBudget(maxContextTokens, settings)` — Computes budget from percentage knobs. **Gets simplified to use `recentMessageCap` directly.**
- `segmentIntoTurns(messages)` — Groups flat messages into `Turn[]` objects. Groups assistant + following tool_result messages. **Stays as-is.**
- `stubToolResults(messages)` — Replaces tool_result content with compact pointers. **Stays as-is.**
- `computeBudgetDropCount(tokenCounts, maxTokens, hotWindowSize)` — Determines how many old turns to drop. **Modified: `hotWindowSize` parameter removed, bounding logic changes.**
- `transformMessages(messages, opts)` — Main orchestrator. **Modified: uses `recentMessageCap` instead of derived budget.**

**Key types:**
- `Turn` — `{ messages: MessageParam[], hasToolResults: boolean }`
- `TurnDecision` — Per-turn record: `{ turnIndex, action, reason, messageCount, hasToolResults, tokensBefore, tokensAfter, sourceTags }`
- `TurnDecisionAction` — `"kept" | "stubbed" | "dropped"`
- `TransformMetadata` — Aggregate: `{ decisions[], totalTurns, keptCount, stubbedCount, droppedCount, tokensBefore, tokensAfter }`

**Decision reasons currently tracked:**
- `"hot-window"` — within hot window, kept verbatim
- `"no-tool-results"` — beyond hot window, no tool results to stub
- `"beyond-hot-window"` — tool results replaced with stubs
- `"budget-exceeded"` — dropped to fit token budget

**Where bounding logic inserts:** The `transformMessages()` function at ~line 440 is the insertion point. Today it:
1. Segments into turns
2. Computes token counts per turn
3. Applies hot window (last N turns kept)
4. Stubs tool results in older turns
5. Drops oldest if over budget
6. Returns `TransformResult { messages, metadata }`

For BOUND-01/02/03, step 3 changes: instead of "last N turns", count backwards from newest until `recentMessageCap` is reached. Steps 4-5 become part of this unified bounding pass.

### `passive-hydration.ts` — Secondary target
**File:** `packages/coding-agent/src/context/recall/passive-hydration.ts` (~340 lines)

**What it does:** Searches `ToolResultStore` for relevant recalled content and injects it as a system prompt prefix. Uses the hydration budget from `deriveBudget()`.

**Key functions:**
- `buildPrefix(query, budget)` — Searches tool results, builds formatted prefix
- `selectResults(candidates, budget)` — Ranks and selects results within token budget

**Change needed:** Replace `hydrationBudgetPercent` consumption with `relevanceFloor` filtering. Instead of a percentage-derived token budget, use a relevance score threshold to decide what gets included.

### `bridge.ts` — Minimal changes
**File:** `packages/coding-agent/src/context/bridge/bridge.ts` (~290 lines)

**What it does:** `ContextBridge` adapts raw `ConversationTurn[]` from the SDK session into flat `MessageParam[]` that the assembler consumes. It handles:
- Mapping SDK turn objects to Anthropic `MessageParam[]`
- Preserving message ordering
- Handling system messages separately

**Change needed:** Minimal. Bridge is a mapping layer, not a decision-making layer. It may need to attach metadata for the bounding pass to use, but the core mapping stays.

### `ingest.ts` — Read-only for Phase 1
**File:** `packages/coding-agent/src/context/recall/ingest.ts` (~200 lines)

**What it does:** After each turn, extracts tool results and indexes them into `ToolResultStore` for later recall. Runs asynchronously.

**Change needed:** None for Phase 1. Ingest feeds the recall system; bounding doesn't affect ingestion.

### `sdk.ts` — Orchestration changes
**File:** `packages/coding-agent/src/sdk.ts` (~1600 lines)

**Key function:** `transformContext()` (~line 1440) orchestrates the full assembly pipeline. This is where:
- The mode check happens (`contextManager.mode === "assembler"`)
- Budget is derived from settings
- `transformMessages()` is called
- Passive hydration is triggered
- Assembly summary is generated
- Snapshot is captured

**Change needed:**
- Pass `recentMessageCap` instead of derived budget
- Add OBSV-01 logging after `transformMessages()` returns metadata
- Add OBSV-02 token telemetry from snapshot
- Add CONF-02 dual-mode guard

## Message Flow

### Step-by-step: Raw Conversation → LLM Call

```
1. User sends message → SDK session receives it
2. SDK session calls transformContext() [sdk.ts:~1440]
3. Check mode: contextManager.mode === "assembler" or "compaction"
   - If "compaction": use legacy path (not our concern)
   - If "assembler": continue
4. Get ConversationTurn[] from SDK session history
5. ContextBridge.mapToMessages(turns) → MessageParam[]
6. deriveBudget(maxContextTokens, assemblerSettings) → Budget
7. transformMessages(messages, { budget, hotWindowTurns }) → TransformResult
   a. segmentIntoTurns(messages) → Turn[]
   b. estimateTokens per turn
   c. Apply hot window: last hotWindowTurns kept verbatim
   d. Stub tool_result content in turns outside hot window
   e. Drop oldest turns if total > budget.messageTokens
   f. Build TurnDecision[] with reasons
   g. Return { messages: MessageParam[], metadata: TransformMetadata }
8. passiveHydration.buildPrefix(lastUserMessage, budget.hydrationTokens)
   → Search ToolResultStore, build prefix string
9. formatAssemblySummary(metadata) → human-readable header
   → "[Assembly: 42 turns, 5 kept, 37 stubbed (turns 1-37) | Budget: 37K/200K tokens, 163K headroom]"
10. EffectivePromptSnapshot.capture(systemPrompt, messages)
    → Records token counts before/after bounding
11. Return bounded messages + system prompt with hydration prefix + summary header
12. SDK sends to Anthropic API
```

## Tool Transcript Handling

### Current Implementation

Tool calls and results flow through the system as follows:

1. **Storage format:** Messages use Anthropic's format:
   - `tool_use` blocks in assistant messages (contains `name`, `id`, `input`)
   - `tool_result` messages as separate user-role messages (contains `tool_use_id`, `content`)

2. **Turn grouping:** `segmentIntoTurns()` groups an assistant message + all immediately-following `tool_result` messages into a single `Turn`. This ensures `tool_use`/`tool_result` pairs are never broken.

3. **Stubbing:** `stubToolResults(messages)` replaces `tool_result` content with a compact pointer stub. The stub text includes the tool name and a `[ref:...]` pointer so the model knows what was there. The `hasToolResults` flag on `Turn` tracks whether stubbing applies.

4. **Recall system:** After each turn, `ingest.ts` extracts tool results and indexes them into `ToolResultStore` (FTS5-backed SQLite). This allows `passive-hydration.ts` to re-surface relevant old tool results via keyword search.

5. **Current behavior for old tool results:**
   - Within hot window: kept verbatim (full tool results in context)
   - Outside hot window: tool_result content replaced with stubs
   - Oldest turns: dropped entirely (no stub, no marker)

### What BOUND-02 and BOUND-03 change:
- **BOUND-02:** "Exclude old tool call/result pairs" — this is already partially implemented via stubbing. The change is to make exclusion more aggressive: beyond `recentMessageCap`, tool pairs are excluded entirely rather than stubbed.
- **BOUND-03:** "Lightweight markers for excluded turns" — dropped turns currently leave no trace. The change adds a lightweight marker (e.g., `[Turn 3-15 excluded: 12 turns, ~45K tokens. Use recall tool to recover.]`) so the model knows content existed and can use recall tools to access it.

## Observability Infrastructure

### Existing Logging

**Logger:** Winston-based centralized logger at `packages/utils/src/logger.ts`.
- Logs to `~/.oh-omp/logs/omp.YYYY-MM-DD.log` with daily rotation
- JSON format with timestamp, level, pid, and arbitrary metadata
- Import: `import { logger } from "@oh-my-pi/pi-utils"`
- Levels: `error`, `warn`, `debug`
- Has `logger.time(op, fn)` for timing operations
- Has `logger.ring` (RingBuffer) for in-memory recent logs

**Current logging in context assembly:**
- `logger.debug(...)` calls exist in some context files but coverage is sparse
- `assembly-summary.ts` generates a human-readable summary string (injected into the prompt as a header)
- `effective-prompt-snapshot.ts` captures token counts but currently just returns them as data — no logging

### Where OBSV-01 hooks in:
The `TransformMetadata.decisions[]` array already has per-turn `TurnDecision` records with `action` and `reason`. OBSV-01 just needs to log this structured data via the winston logger after `transformMessages()` returns. The data structure exists; the logging call doesn't.

**Implementation:** In `transformContext()` (sdk.ts), after getting `TransformResult`, call:
```typescript
logger.debug("context-assembly:decisions", {
  totalTurns: metadata.totalTurns,
  kept: metadata.keptCount,
  stubbed: metadata.stubbedCount,
  dropped: metadata.droppedCount,
  decisions: metadata.decisions
});
```

### Where OBSV-02 hooks in:
`EffectivePromptSnapshot.capture()` already computes before/after token counts. OBSV-02 needs to log these as telemetry. The data flows through `transformContext()` in sdk.ts.

**Implementation:** After snapshot capture, log:
```typescript
logger.debug("context-assembly:tokens", {
  tokensBefore: metadata.tokensBefore,
  tokensAfter: metadata.tokensAfter,
  reduction: metadata.tokensBefore - metadata.tokensAfter,
  reductionPercent: ((metadata.tokensBefore - metadata.tokensAfter) / metadata.tokensBefore * 100).toFixed(1)
});
```

## Dual-Mode Guard

### Current State

**File:** `packages/coding-agent/src/context-manager/index.ts`

The `contextManager.mode` setting controls which context management strategy is used:
- `"compaction"` — legacy mode, uses SDK's built-in message compaction
- `"assembler"` — new mode, uses the assembler pipeline

The mode is checked in `transformContext()` (sdk.ts) with a simple if-branch. **There is NO explicit guard preventing both from activating simultaneously.** The mode is a simple string enum, and the check is:
```typescript
if (settings.get("contextManager.mode") === "assembler") {
  // use assembler pipeline
} else {
  // use legacy compaction
}
```

This is an implicit guard (if/else), but it doesn't fail-closed. If someone misconfigures or if runtime state causes both paths to partially execute, there's no safety net.

### What CONF-02 requires:
A runtime validation that fails closed (throws/errors) if conditions indicate both compaction and assembler would activate. This should live at the entry point of `transformContext()` in sdk.ts, before any processing begins.

**Implementation approach:**
1. At the start of `transformContext()`, check for conflicting configuration
2. If the SDK's built-in compaction is also enabled alongside `assembler` mode, throw a clear error
3. Log the conflict and refuse to proceed
4. This prevents silent data corruption where both systems modify the conversation

**Where the guard lives:** Top of `transformContext()` in `sdk.ts`. The guard needs to detect:
- `contextManager.mode === "assembler"` AND legacy compaction SDK feature is also active
- Any setting combination that would cause both to run

## Test Coverage

### Existing Tests

| Test File | Coverage | Lines |
|---|---|---|
| `test/message-transform.test.ts` | Core transform logic — segmentation, stubbing, budget drops, decision tracking | ~600 lines |
| `test/budget-derivation.test.ts` | `deriveBudget()` percentage calculations | ~100 lines |
| `test/assembly-summary.test.ts` | `formatAssemblySummary()` output format | ~80 lines |
| `test/effective-prompt-snapshot.test.ts` | Snapshot capture/comparison | ~60 lines |
| `test/passive-hydration.test.ts` | Hydration prefix building, result selection | ~100 lines |
| `test/bridge.test.ts` | `ContextBridge.mapToMessages()` mapping | ~80 lines |
| `test/context-manager.test.ts` | Mode selection, context manager orchestration | ~60 lines |
| `test/context/recall/tool-result-store.test.ts` | FTS5 store CRUD and search | ~120 lines |

### Test Coverage Analysis

**Well-covered:**
- `transformMessages()` — extensive tests for segmentation, hot window, stubbing, dropping, decision metadata
- `deriveBudget()` — percentage calculation edge cases
- `formatAssemblySummary()` — output format verification
- `ToolResultStore` — FTS5 search, indexing, cleanup

**Gaps for Phase 1:**
- No tests for dual-mode guard (doesn't exist yet)
- No tests for `recentMessageCap` as absolute token cap (new config)
- No tests for `relevanceFloor` filtering in passive hydration
- No tests for OBSV-01 structured logging output
- No tests for OBSV-02 token telemetry logging
- No tests for BOUND-03 exclusion markers
- No tests for config validation (new settings replace old)
- No integration tests for the full `transformContext()` pipeline in sdk.ts

### Test Infrastructure
- Framework: Bun test runner (`bun test`)
- Pattern: Test files in `packages/coding-agent/test/` mirroring source structure
- Mocking: Bun's built-in `mock()` for dependencies
- Fixtures: Inline message arrays constructed in tests

## Key Findings

### 1. The architecture is already 70% there
`transformMessages()` already does turn segmentation, hot-window keeping, tool-result stubbing, and per-turn decision tracking. The `TurnDecision` type already carries `action`, `reason`, `tokensBefore`, `tokensAfter`, and `sourceTags`. The work is config simplification and observability, not architecture.

### 2. Config cutover is clean
The 5 assembler knobs (`hotWindowTurns` + 4 budget percentages) are consumed in exactly 2 places: `deriveBudget()` and `transformMessages()`. Replacing them with `recentMessageCap` + `relevanceFloor` simplifies `deriveBudget()` to near-trivial and changes the bounding loop in `transformMessages()` to count tokens instead of turns.

### 3. Observability is data-present but logging-absent
`TransformMetadata` already captures everything OBSV-01 needs. `EffectivePromptSnapshot` already captures what OBSV-02 needs. The gap is purely: nobody calls `logger.debug()` with this data. Straightforward.

### 4. Dual-mode guard is implicit, needs explicit fail-closed
The if/else in `transformContext()` is the only guard. No runtime validation detects conflicting config. Adding a guard at the top of `transformContext()` that throws on conflict is the right approach.

### 5. BOUND-03 exclusion markers are the most novel piece
Currently, dropped turns vanish without trace. Adding markers requires a new message type or a synthetic message injected at the boundary. The format should be lightweight (single text block) and actionable (tells the model how to recover the content).

### 6. Token estimation is approximate
`estimateMessageTokens()` uses a chars/4 heuristic. For `recentMessageCap` targeting ~150K tokens, this is adequate — the approximation error is proportional and consistent, so the cap still prevents unbounded growth even if the absolute number is off by ~20%.

### 7. Settings schema uses a builder pattern
New settings need to be registered in `settings-schema.ts` using the builder: `setting("assembler.recentMessageCap").number(150000).describe(...)`. Old settings need to be removed. The `AssemblerSettings` inferred type will update automatically.

## Risks and Unknowns

### Risk 1: SDK compaction detection
CONF-02 requires detecting when the SDK's built-in compaction is active. The exact mechanism to detect this needs investigation — it may be a setting, a runtime flag, or an SDK API call. If the SDK doesn't expose this, the guard may need to be config-only (validate that `contextManager.mode` is not `"assembler"` when legacy compaction config is present).

### Risk 2: Token estimation accuracy at scale
The chars/4 heuristic may diverge significantly for messages with structured content (JSON tool results, code blocks). A 20% error on a 150K cap means ±30K tokens. This is acceptable for Phase 1 but should be monitored.

### Risk 3: Exclusion marker format
BOUND-03 markers need to be in a format the LLM understands and acts on. The exact wording needs experimentation. Too verbose wastes tokens; too terse gets ignored. The `[Assembly: ...]` header format is a good precedent.

### Risk 4: Backward compatibility
Removing 5 config knobs and adding 2 new ones is a breaking change for any users who've customized assembler settings. This is acceptable (CONF-01 explicitly calls for cutover), but the settings schema should validate and warn if old knobs are present in config files.

### Risk 5: Passive hydration budget
Replacing `hydrationBudgetPercent` with `relevanceFloor` changes the bounding model from "fill up to N tokens" to "include everything above score X." The token consumption becomes unpredictable. May need a secondary cap (e.g., `relevanceFloor` + a hard token cap for hydration).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test runner (built-in) |
| Config file | None (Bun uses `bunfig.toml` if present) |
| Quick run command | `bun test packages/coding-agent/test/message-transform.test.ts` |
| Full suite command | `bun test packages/coding-agent/test/` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Config cutover: recentMessageCap + relevanceFloor replace 5 knobs | unit | `bun test packages/coding-agent/test/budget-derivation.test.ts` | Exists but needs rewrite |
| CONF-02 | Dual-mode guard fails closed on conflict | unit | `bun test packages/coding-agent/test/context-manager.test.ts` | Exists but needs new cases |
| OBSV-01 | Per-turn inclusion/exclusion logging | unit | `bun test packages/coding-agent/test/message-transform.test.ts` | Exists but needs logging tests |
| OBSV-02 | Token count telemetry before/after | unit | `bun test packages/coding-agent/test/effective-prompt-snapshot.test.ts` | Exists but needs telemetry tests |
| BOUND-01 | Hard cap on recent messages ~150K tokens | unit | `bun test packages/coding-agent/test/message-transform.test.ts` | Exists but needs cap tests |
| BOUND-02 | Exclude old tool call/result pairs | unit | `bun test packages/coding-agent/test/message-transform.test.ts` | Exists, partially covers |
| BOUND-03 | Lightweight markers for excluded turns | unit | `bun test packages/coding-agent/test/message-transform.test.ts` | Does not exist |

### Sampling Rate
- **Per task commit:** `bun test packages/coding-agent/test/message-transform.test.ts`
- **Per wave merge:** `bun test packages/coding-agent/test/`
- **Phase gate:** Full suite green before completion

### Wave 0 Gaps
- [ ] New test cases for `recentMessageCap`-based bounding in `message-transform.test.ts`
- [ ] New test cases for dual-mode guard in `context-manager.test.ts`
- [ ] New test cases for exclusion markers (BOUND-03) in `message-transform.test.ts`
- [ ] New test cases for OBSV-01/OBSV-02 logging verification

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | Config cutover: replace hotWindowTurns + 4 budget knobs with recentMessageCap + relevanceFloor | Settings schema builder pattern understood, `deriveBudget()` and `transformMessages()` are the only consumers, clean replacement path identified |
| CONF-02 | Runtime validation fails closed if both legacy compaction and assembler would activate | Current implicit guard identified in `transformContext()`, explicit guard needed at function entry, SDK compaction detection is the main unknown |
| OBSV-01 | Log every inclusion/exclusion decision per turn with reason | `TransformMetadata.decisions[]` already captures all data, just needs `logger.debug()` call in `transformContext()` |
| OBSV-02 | Token count telemetry before and after bounding | `EffectivePromptSnapshot` and `TransformMetadata` already have the data, just needs logging |
| BOUND-01 | Hard cap on recent messages (recentMessageCap), targeting ~150K tokens | `computeBudgetDropCount()` already implements token-based dropping, needs parameter change from percentage-derived to absolute cap |
| BOUND-02 | Exclude old tool call/result pairs from conversation window | `stubToolResults()` already replaces content, exclusion logic enhances this to full removal beyond cap |
| BOUND-03 | Lightweight markers for excluded turns so model can recover via tools | New functionality, no existing code. Inject synthetic marker message at exclusion boundary. `formatAssemblySummary()` is the format precedent |

## Sources

### Primary (HIGH confidence)
- Direct source code reading: `packages/coding-agent/src/context/` — all files listed above
- Direct source code reading: `packages/coding-agent/src/config/settings-schema.ts`
- Direct source code reading: `packages/coding-agent/src/sdk.ts`
- Direct source code reading: `packages/coding-agent/src/context-manager/index.ts`
- Direct source code reading: `packages/coding-agent/test/` — all test files listed above
- Project docs: `.oh/context-bounding.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`
- Design spec: `docs/superpowers/specs/2026-03-14-context-bounding-design.md` (salvage reference)

## Metadata

**Confidence breakdown:**
- Config schema: HIGH — read the actual schema definition and all consumers
- Architecture: HIGH — read all implementation files and traced the full pipeline
- Message flow: HIGH — traced from sdk.ts through bridge, transform, hydration, summary
- Observability: HIGH — existing data structures identified, logging gaps confirmed
- Dual-mode guard: MEDIUM — implicit guard identified, SDK compaction detection mechanism needs verification
- Test coverage: HIGH — read all test files, gaps identified

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (internal codebase, stable unless refactored)
