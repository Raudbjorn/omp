# Technical Concerns

**Analysis Date:** 2026-03-19

## Critical (blocks progress)

### God Object: `agent-session.ts` (4839 lines)

- **File:** `packages/coding-agent/src/session/agent-session.ts`
- **Issue:** Single file at 4839 lines owns session lifecycle, tool dispatch, message handling, compaction orchestration, and state management. This is the highest-risk file in the codebase -- every feature touches it, and merge conflicts with upstream are near-guaranteed.
- **Impact:** Fork divergence compounds here. Any upstream refactor to this file (which upstream is likely to do) creates a rebase nightmare. The file is also the primary integration surface for the fork's context assembly system.
- **Fix approach:** Extract cohesive subsystems into separate modules: tool dispatch, compaction orchestration, message lifecycle. ADR-0001 (constrained fork strategy) acknowledges this risk but does not prescribe a mitigation timeline.

### Legacy Compaction Still Active Alongside New Context Assembly

- **Files:** `packages/coding-agent/src/session/compaction/compaction.ts` (1328 lines), `packages/coding-agent/src/context/assembler/message-transform.ts` (600 lines)
- **Issue:** The fork introduces a new context assembly pipeline (assembler, bridge, recall) but the legacy compaction system is still present and active in non-assembler mode. Two parallel context management systems coexist, gated by a runtime mode flag.
- **Impact:** Dual code paths double the testing surface and create subtle behavioral differences. Bug reports may be mode-dependent. The `agent-session.ts` references both systems.
- **Fix approach:** Complete the assembler migration and remove legacy compaction, as outlined in ADR-0004. This is the fork's primary technical debt.

## High Priority (should address soon)

### 109 Empty Catch Blocks Across Codebase

- **Issue:** 109 instances of `catch {}` that silently swallow errors. ~70 are in web scrapers, ~15 in core infrastructure.
- **Key non-scraper locations:**
  - `packages/coding-agent/src/config/settings.ts:471,473,482,489` -- settings parsing silently falls back
  - `packages/coding-agent/src/main.ts:199` -- startup error swallowed
  - `packages/coding-agent/src/tools/browser.ts:173,189,268,824` -- browser tool errors hidden
  - `packages/coding-agent/src/tools/fetch.ts:161,365,392,464` -- fetch failures silently ignored
  - `packages/coding-agent/src/lsp/index.ts:613` -- LSP error suppressed
  - `packages/coding-agent/src/session/session-manager.ts:825,1182` -- session management errors hidden
  - `packages/agent/src/agent.ts:698` -- core agent error suppressed
  - `packages/ai/src/providers/cursor.ts:195,1538,1550` -- provider errors hidden
  - `packages/stats/src/server.ts:71,116` -- telemetry errors swallowed
- **Impact:** Silent failures make debugging extremely difficult. A user-facing bug caused by a swallowed error in settings parsing or session management will produce no diagnostic trail.
- **Fix approach:** Add at minimum `console.debug` logging to non-scraper catch blocks. For scrapers, consider a shared error handler pattern. Prioritize `main.ts`, `settings.ts`, `session-manager.ts`, and `agent.ts`.

### 147 `as any` Type Casts

- **Files:** Distributed across all packages. Counts by package:
  - `packages/coding-agent/src`: ~80 instances
  - `packages/ai/src`: ~48 instances
  - `packages/agent/src`: ~5 instances
- **Impact:** Each `as any` is a type-safety escape hatch that hides potential runtime errors. The `ai` package's 48 casts are concerning because provider response parsing is a common source of runtime failures.
- **Fix approach:** Audit `as any` in `packages/ai/src` first (provider response types), then `packages/coding-agent/src` (tool results, session state). Replace with proper type narrowing or explicit type assertions.

### No Tests for Fork-Specific Context System

- **Files:** `packages/coding-agent/src/context/` (3060 lines total)
- **Issue:** The entire fork-specific context system (assembler, bridge, recall, memory-contract) spanning 3060 lines has no dedicated test files. No `*.test.ts` files found for `context/assembler/`, `context/bridge/`, `context/recall/`, or `context/memory-contract.ts`.
- **Impact:** The most novel and complex code in the fork has zero automated regression protection. Any refactor risks silent breakage. The assembler's message-transform (600 lines) and bridge (427 lines) are particularly risky.
- **Fix approach:** Write unit tests for `memory-contract.ts` (pure data contracts), `bridge/classify.ts` (classification logic), `assembler/message-transform.ts` (transform correctness), and `recall/passive-hydration.ts` (retrieval logic).

## Medium Priority (track and plan)

### Large Files Indicating Complexity Hotspots

Files over 500 lines (outside the 4839-line god object):

| File | Lines |
|------|-------|
| `packages/coding-agent/src/session/compaction/compaction.ts` | 1328 |
| `packages/coding-agent/src/session/session-manager.ts` | ~1200 |
| `packages/coding-agent/src/tools/browser.ts` | ~850 |
| `packages/coding-agent/src/context/assembler/message-transform.ts` | 600 |
| `packages/coding-agent/src/tools/fetch.ts` | ~500 |
| `packages/ai/src/providers/cursor.ts` | ~1550 |
| `packages/ai/src/auth-storage.ts` | ~1700 |

- **Impact:** High cyclomatic complexity, difficult code review, higher defect density.
- **Fix approach:** For fork-owned files (`message-transform.ts`, `bridge.ts`), decompose during the current development cycle. For upstream-inherited files, accept the debt unless a change touches them.

### TODO/FIXME Markers Across Codebase

Approximately 60+ TODO/FIXME markers exist across all packages. Key categories:

- **Fork-specific TODOs in context system:** Pending implementation items in the assembler and bridge code that indicate incomplete feature work.
- **Upstream-inherited TODOs:** Long-standing markers in `agent-session.ts`, `tools/`, and `session/` that upstream hasn't addressed.
- **Impact:** Some TODOs mark incomplete error handling or missing edge-case support. Without triage, it's unclear which are blocking vs. aspirational.
- **Fix approach:** Triage all fork-specific TODOs (in `context/`) as part of the assembler completion milestone. Ignore upstream TODOs unless they affect fork behavior.

### Env Var Access Scattered Without Centralized Config

- **Files:** `packages/coding-agent/src/config/settings.ts`, plus direct `process.env` / `Bun.env` access in multiple files.
- **Issue:** Environment variable access is not fully centralized. While `settings.ts` handles some configuration, other files access env vars directly. The `settings.ts` file itself has 4 empty catch blocks around env parsing.
- **Impact:** Missing env vars produce silent failures instead of clear startup errors. Configuration validation is incomplete.
- **Fix approach:** Centralize all env var access through `settings.ts` with fail-fast validation at startup.

## Low Priority (nice to fix)

### Scraper Boilerplate

- **Files:** `packages/coding-agent/src/web/scrapers/*.ts` (~70 files)
- **Issue:** Each scraper follows a similar pattern with individual `catch {}` blocks. Significant code duplication.
- **Impact:** Low -- scrapers are isolated and rarely modified. But adding error reporting or changing the retry strategy requires touching every file.
- **Fix approach:** Extract a shared `ScraperBase` or utility that handles fetch, error reporting, and JSON parsing centrally.

### `deprecated` Markers in Source

- **Files:** Various locations in `packages/coding-agent/src/`
- **Issue:** Some functions/APIs marked as deprecated but still called. Dead code that hasn't been removed.
- **Impact:** Low -- confusing for maintainers, but not functionally harmful.
- **Fix approach:** Remove deprecated code and update callers as part of regular maintenance.

## Security Considerations

### Secret Handling

- `.env` files present at root (existence noted, contents not read).
- API keys accessed via `process.env` / `Bun.env` throughout the codebase.
- `packages/ai/src/auth-storage.ts` (1700 lines) handles authentication token storage -- this is a sensitive file that warrants careful review for secure storage practices.
- No evidence of secrets being logged or included in error messages (good).

### Path Traversal

- File-system operations in tools (`read`, `write`, `edit`, `bash`) accept user-specified paths.
- Path validation and sandboxing logic exists in `packages/coding-agent/src/tools/` but should be audited for bypass vectors, especially with symlinks and `..` traversal.

### Process Execution

- The `bash` tool executes arbitrary commands. Sandboxing relies on permission prompts (user confirmation).
- `process.exit` / `Bun.exit` calls exist in `packages/coding-agent/src/` -- abrupt termination without cleanup could leave temp files or incomplete state.

## Performance Notes

### Context Assembly Token Budget

- **Files:** `packages/coding-agent/src/context/assembler/message-transform.ts`, `packages/coding-agent/src/context/memory-contract.ts`
- **Issue:** The assembler derives a token budget from the model's context window (ADR-related, PR #21). If budget calculation is wrong, either context is wasted (too conservative) or API calls fail (too aggressive).
- **Impact:** Direct impact on response quality and API costs.
- **Note:** The `message-transform.ts` at 600 lines performs per-turn working memory rebuilds from STM state. This is a hot path that runs every turn.

### Passive Recall Pipeline

- **Files:** `packages/coding-agent/src/context/recall/passive-hydration.ts` (339 lines), `packages/coding-agent/src/context/recall/tool-result-store.ts` (297 lines)
- **Issue:** Passive hydration performs embedding-based retrieval every turn. If the embedding model is slow or the store grows large, this could add latency to every interaction.
- **Impact:** User-perceived latency between turns. No evidence of caching or early termination optimization.

### Large Auth Storage

- **File:** `packages/ai/src/auth-storage.ts` (1700 lines)
- **Issue:** A single file managing all provider auth flows (OAuth, API keys, token refresh). Complex enough to be a performance concern during startup if multiple providers need token refresh.

## Fork-Specific Risks

### Upstream Divergence

- **Status:** 81 fork-specific commits ahead of upstream; 0 commits behind (currently synced).
- **Risk:** The fork's constrained strategy (ADR-0001) aims to minimize upstream touchpoints, but `agent-session.ts` is the primary integration point and is also the largest file. Any upstream refactor there creates a major rebase burden.
- **Mitigation:** ADR-0001 prescribes a "shadow mode" and bridge pattern to avoid direct modifications. The `context-manager` runtime mode flag gates fork behavior. This is sound architecture, but the bridge itself (ADR-0004) adds indirection complexity.

### RPC Compatibility Contract (ADR-0002)

- **Files:** `packages/coding-agent/src/` (RPC layer)
- **Risk:** The fork adds RPC endpoints (e.g., `get_introspection`) that upstream doesn't have. If upstream changes the RPC protocol, fork-specific endpoints may break silently.
- **Mitigation:** ADR-0002 formalizes the contract with tests. These tests must be maintained as upstream evolves.

### Context Manager Mode Flag

- **Files:** `packages/coding-agent/src/context/` (mode activation logic)
- **Risk:** A fail-closed activation guard (PR #8) gates the assembler. If the guard is misconfigured or has a bug, the fork silently falls back to legacy mode without user awareness.
- **Impact:** Users may unknowingly run in degraded mode. Need clear runtime diagnostics for which mode is active.

### Shadow-Mode Telemetry

- **Files:** Context telemetry extension (PR #10)
- **Risk:** NDJSON trace files can grow without bound. No rotation or size-limit mechanism visible.
- **Impact:** Disk space exhaustion on long-running sessions.

## Incomplete/In-Progress Features

### Context Assembly Pipeline (Primary Fork Work)

- **Status:** Core architecture in place (assembler kernel V1, bridge, recall). Per-turn message rebuild implemented (PR #22). Budget derivation implemented (PR #21).
- **Remaining:**
  - Legacy compaction removal (blocked on full assembler validation)
  - Passive recall optimization (currently functional but untuned)
  - Memory contract V1 is implemented but the tiered locator map (ADR-0003) likely has pending tiers
  - No automated tests for the entire context subsystem

### Introspection Snapshot (PR #14)

- **Status:** RPC endpoint added for assembler state inspection.
- **Remaining:** Integration with external tooling/UI for the introspection data is not visible in the codebase.

### Tool-Result-to-Memory Bridge (PR #12)

- **Status:** Locator generation, STM population, and artifact retriever implemented.
- **Remaining:** The bridge classification logic (`context/bridge/classify.ts`, 215 lines) may need tuning as more tool types are added. Currently a potential source of misclassification bugs.

---

*Concerns audit: 2026-03-19*
