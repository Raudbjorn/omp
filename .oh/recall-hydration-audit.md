# Session: recall-hydration-audit

## Aim
**Updated:** 2026-03-29T15:36:10Z

## Aim Statement

**Aim:** Maintainers can tune passive recall for long-running work so the system naturally resurfaces both immediate continuity and older anchor context across sessions, instead of forcing repeated re-briefing.

**Current State:** Passive recall is semantically driven, but it has no temporal prior for total recall across sessions, so long-horizon anchors and recent continuity compete under the same flat age treatment.
**Desired State:** Maintainers can evaluate and adopt a temporal prior that helps passive recall surface temporally useful candidates without replacing semantic relevance or hardcoding brittle age buckets.

### Mechanism
**Change:** Add and evaluate a boost-only temporal prior over passive-recall candidates, likely shaped as a non-symmetric U over normalized candidate temporal position.
**Hypothesis:** Recent candidates often preserve local continuity, distant candidates often preserve durable anchors, and a bounded temporal prior can improve total recall across sessions more effectively than flat semantic ranking alone.
**Assumptions:**
- Temporal position carries useful signal beyond semantic relevance alone.
- Older cross-session recalls can still be valuable anchors rather than mostly stale noise.
- A cohort-relative temporal prior is easier to reason about than absolute age thresholds.

### Feedback
**Signal:** In trace review and dogfooding, retrieved recall more often contains either immediate working context or durable older anchors, and maintainers judge the boosted ranking as more useful than baseline.
**Timeframe:** Immediate qualitative signal from trace comparison; stronger signal after several long-running sessions evaluated against baseline.

### Guardrails
- Semantic relevance remains the floor; temporal policy must not replace it.
- Temporal influence is boost-only; no candidate is explicitly penalized for age.
- The policy must work across sessions because the recall store is already cross-session and the goal is total recall.
- The scoring must stay inspectable enough that maintainers can explain why a candidate was boosted.

## Problem Space
**Updated:** 2026-03-29T15:47:31Z

## Problem Space Map

**Date:** 2026-03-29
**Scope:** Memory architecture for arbitrarily long, cross-session agent work under bounded prompt assembly in `packages/coding-agent`

### Objective
We are optimizing for: reliable long-horizon recall, so maintainers and users can continue arbitrarily long work across sessions without repeatedly re-establishing goals, constraints, decisions, and recent state, while the assembler still produces bounded, trustworthy prompts.

### Constraints

| Constraint | Type | Reason | Question? |
|------------|------|--------|-----------|
| Prompt assembly remains budget-aware and latency-bounded | hard | The assembler runs on the hot path; memory quality cannot come from unbounded prompt growth or slow retrieval | No |
| Protocol/event compatibility must hold | hard | Prompt composition and observability affect downstream tooling and runtime expectations | No |
| Single active context-manager invariant remains in force | hard | Repo cutover constraint; memory changes must not reopen competing runtime context systems | No |
| Passive recall and bridge are orthogonal concerns | hard | Bridge coupling is not the primary memory-architecture question | No |
| Cross-session recall is first-class | hard | The recall store already spans sessions and the target is total recall rather than session-local continuity only | No |
| Memory must remain inspectable and governable | hard | High-salience or durable memory without provenance, revocation, and explainability becomes actively dangerous | No |
| Current passive recall lane can be evolved rather than replaced wholesale | soft | Existing semantic retrieval, MMR, and assembler injection provide a working baseline | Yes |
| Memory may need multiple lanes/types instead of one flat recall pool | soft | This is the architectural hypothesis now emerging; not yet a settled design | Yes |
| Human memory is the right model to imitate directly | assumed | Human memory is inspiring, but literal mimicry may import bias and unreliability instead of useful selection pressures | Probably false |
| One scoring function can cover all memory needs | assumed | Working continuity, durable constraints, major decisions, and episodic traces may need different treatment | Likely false |

### Terrain
- **Systems:** `context/recall/passive-hydration.ts`, `context/recall/store.ts`, `context/recall/types.ts`, `sdk.ts`, `context/assembler/message-transform.ts`, and the parallel provenance/locator lane in `context/bridge/*`.
- **Stakeholders:** maintainers shaping memory behavior, users running long or resumed sessions, operators relying on prompt trustworthiness, and future maintainers who must debug why a memory appeared.
- **Blast radius:** if wrong, the agent can surface stale but authoritative-looking context, bury real goals under trace noise, lose continuity across sessions, or become too opaque to debug.
- **Precedents:** current passive recall already gives one episodic lane; the new ideas suggest additional lanes or types such as temporal priors, cornerstone memories, durable goals/constraints, rehearsal/open-loop signals, and supersession handling.

### Assumptions Made Explicit
1. We assume the real problem is no longer “better passive recall ranking,” but “what memory architecture supports long-horizon agent work” — if false: we should stay at the narrower ranking-policy level.
2. We assume different memory classes exist in practice: recent working continuity, episodic traces, durable goals/constraints, and invalidations — if false: a single flat recall pool with better scoring may be enough.
3. We assume explicit durable memory can outperform purely inferred importance — if false: cornerstone or typed-memory ideas add governance overhead without improving recall quality.
4. We assume supersession and revocation are necessary if memory becomes more durable or more heavily boosted — if false: simpler promotion-only schemes may suffice, though that seems unlikely.
5. We assume cross-session recall should optimize for total usefulness, not merely preserving session-local narrative structure — if false: session-bounded policies should dominate architecture.

### X-Y Check
- **Stated need (Y):** Explore temporal decay, cornerstone memory, and human-memory-inspired recall ideas.
- **Underlying need (X):** Define a memory architecture that preserves useful continuity and durable knowledge across arbitrarily long, cross-session work without sacrificing bounded, trustworthy prompt assembly.
- **Confidence:** High — the specific ideas look like probes around a broader architectural need.

### Ready for Solution Space?
No — not yet. We still need the architecture-level framing made explicit: what memory types exist, which are implicit vs explicit, who can promote durable memory, how memories are revoked or superseded, and how the assembler composes multiple memory classes under budget.

## Problem Statement
**Updated:** 2026-03-29T15:47:31Z

## Problem Statement

**Current framing:** “Improve passive recall” — or more recently, “add a temporal prior” or “add cornerstone memories.” Those framings are mechanism-level and treat retrieval policy as if it were the architecture itself.

**Reframed as:** Maintainers need a memory architecture for arbitrarily long, cross-session agent work that preserves recent continuity, episodic history, durable goals/constraints/decisions, and supersession state under bounded prompt assembly, because a single undifferentiated recall policy will eventually become too blunt to preserve both usefulness and trust.

**The shift:** From “find a better recall score” to “define memory classes, promotion rules, trust levels, and composition rules.” That makes temporal priors one candidate policy inside episodic recall, not the top-level design, and it puts durable salience and invalidation on equal footing with ranking quality.

### Constraints
- **Hard:** Prompt assembly remains budget-aware, latency-bounded, and protocol-compatible.
- **Hard:** Cross-session recall is first-class; the architecture cannot assume session-local-only memory.
- **Hard:** Memory that gains authority must also gain provenance, scope, and revocation semantics.
- **Hard:** Passive recall and bridge remain orthogonal unless a future design explicitly changes that contract.
- **Soft:** The current passive recall lane can be evolved incrementally rather than replaced wholesale.
- **Soft:** New memory classes may coexist with the current episodic recall lane before any larger consolidation.

### What this framing enables
- Distinguishing between working continuity, episodic recall, durable memory, and supersession/invalidation rather than asking one ranker to do everything.
- Evaluating explicit durable-memory ideas like cornerstone, goal, and constraint memories alongside implicit policies like temporal priors and rehearsal boosts.
- Asking who is allowed to promote memory, what trust each source gets, and how the assembler should budget across memory classes.
- Treating long-horizon memory as an assembly/composition problem, not just a search-score problem.

### What this framing excludes
- Prematurely committing to a temporal curve as if chronology alone solves durable recall.
- Treating “important memory” as a flat boost with no lifecycle, provenance, or supersession story.
- Assuming human memory should be copied literally rather than using it as inspiration for machine-native, inspectable memory policies.
- Hiding an architectural problem behind local ranking tweaks if multiple memory classes really are needed.
## Solution Space
**Updated:** 2026-03-29T15:36:10Z

## Solution Space Analysis

**Problem:** We need a boost-only temporal prior for cross-session passive recall that improves total recall by promoting semantically relevant candidates at temporal extremes, without relying on brittle absolute age thresholds.
**Key Constraint:** Temporal influence must remain secondary to semantic relevance and must work across the full recall DB, not just within a single session.

### Candidates Considered

| Option | Level | Approach | Trade-off |
|--------|-------|----------|-----------|
| A | Local Optimum | Absolute-age prior over full history: boost by turn distance or timestamp from now | Requires hard semantics for recent/old that we explicitly do not know |
| B | Local Optimum | Session-normalized temporal prior: compute early/late position within each session, then apply cross-session boost | Preserves session structure but distorts total-recall ranking across sessions |
| C | Reframe | Candidate-cohort asymmetric U-prior: normalize temporal position within the retrieved candidate set and apply a bounded boost-only multiplier | Cohort-relative behavior can be unstable if candidate pool is too small or skewed |
| D | Redesign | Temporal mixture retrieval: explicitly retrieve from multiple temporal bands or learn a temporal reranker from labeled traces | More principled long-term, but much higher complexity and evaluation burden |

### Evaluation

**Option A: Absolute-Age Prior**
- Solves stated problem: Partially
- Implementation cost: Low
- Maintenance burden: Medium
- Second-order effects: Easy to explain, but it reintroduces brittle assumptions about what “recent” and “distant” mean across sessions and session lengths.

**Option B: Session-Normalized Prior**
- Solves stated problem: Partially
- Implementation cost: Medium
- Maintenance burden: Medium
- Second-order effects: Respects session structure, but privileges edges of every session even when some sessions are globally irrelevant to total recall.

**Option C: Candidate-Cohort Asymmetric U-Prior**
- Solves stated problem: Yes
- Implementation cost: Medium
- Maintenance burden: Medium
- Second-order effects: Best fit to the real constraint: no hard age buckets, boost-only behavior, and a simple function over candidate space. The downside is cohort-relative behavior that depends on candidate overfetch quality.

**Option D: Temporal Mixture Retrieval / Learned Reranker**
- Solves stated problem: Yes
- Implementation cost: High
- Maintenance burden: High
- Second-order effects: Stronger long-term design if temporal structure becomes a first-class retrieval axis, but premature without evidence that a lightweight prior is insufficient.

### Recommendation

**Selected:** Option C - Candidate-Cohort Asymmetric U-Prior
**Level:** Reframe

**Rationale:** This is the only option that matches the actual intent: no fixed definitions of recent/distant, boost-only behavior, cross-session total recall, and a simple function over candidate space. It keeps semantic retrieval as the floor and adds only upgrade pressure at temporal extremes.

**Accepted trade-offs:**
- The temporal prior becomes cohort-relative rather than an absolute statement about time.
- Results will depend materially on candidate overfetch quality; a too-small pool will distort the distribution.

### Implementation Notes
- Apply the multiplier after initial semantic candidate retrieval but before final truncation, so the boost has room to affect ranking.
- Keep the function bounded and inspectable: raw score, normalized temporal position, multiplier, and final score should be observable.
- Prefer “temporal prior” or “temporal boost” over “decay” in code/docs, since the function is boost-only and U-shaped.
- Pair the experiment with increased overfetch during evaluation so temporally extreme candidates can actually compete.
- Compare at least baseline semantic ranking, monotonic recency boost, and the asymmetric U-prior before committing to production policy.



## Audit
**Updated:** 2026-03-29T15:07:46Z

### Scope
- Audited the current runtime path in `packages/coding-agent` for automatic recall capture and passive hydration injection.
- Focused on the assembler evidence lane implemented today: session event capture, recall ingest/store, passive retrieval/rerank, budget capping, prompt injection, and observability.
- Excluded broader repo uses of “rehydrate” except where terminology drift affects planning.

### End-to-end runtime flow
1. **Recall infrastructure is optional at startup.** `sdk.ts` initializes `RecallStore` and Memex license early; failure disables ingest and passive hydration without failing startup (`packages/coding-agent/src/sdk.ts`).
2. **Session events drive automatic capture.** On `tool_execution_end`, the SDK sends the event through `ToolResultBridge.handleToolResult()` and separately enqueues a recall ingest row. On `message_end`, it ingests only `user` and `assistant` messages. On `turn_end`, it increments the coarse `ingestTurn` counter (`packages/coding-agent/src/sdk.ts`).
3. **Bridge and recall ingest are parallel lanes, not one pipeline.** The bridge populates locator/STM state and optional FTS indexing; the ingest pipeline embeds text into LanceDB recall rows. Passive hydration later searches only the recall store, not the bridge contract (`packages/coding-agent/src/context/bridge/bridge.ts`, `packages/coding-agent/src/context/recall/ingest.ts`, `packages/coding-agent/src/context/recall/store.ts`).
4. **Ingest is async fire-and-forget.** `IngestPipeline.ingest()` drops empty text, enforces `MAX_IN_FLIGHT = 4`, embeds in the background, and appends `RecallRow` entries with `role`, `turn`, `tool_name`, JSON-encoded `paths`/`symbols`, `project_cwd`, and `session_id` (`packages/coding-agent/src/context/recall/ingest.ts`, `packages/coding-agent/src/context/recall/types.ts`).
5. **Per-turn prompt assembly runs message transform before and after hydration.** `transformContext` first runs `transformMessages()` to stub/compress older tool results and derive a budget, then runs `PassiveHydrator.hydrate(messages)`, then caps recalled entries to fit `hydrationBudgetMax`, then runs a second bounded `transformMessages()` pass for message budget enforcement, then prepends hydrated context as a developer message, then prepends the assembly summary (`packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/context/assembler/message-transform.ts`).
6. **Passive hydration builds its query from raw recent conversation, not transformed history.** It extracts the last N user turns plus intervening assistant text and tool-result text, embeds that hot window, checks a cosine cache, searches LanceDB on cache miss, reranks with MMR, formats `<recalled-context>` XML, and returns raw results plus injection text (`packages/coding-agent/src/context/recall/passive-hydration.ts`, `packages/coding-agent/src/context/recall/message-text.ts`).
7. **Observability is first-class for message transform, but not yet for hydration selection reasons.** The runtime captures an `EffectivePromptSnapshot`, exposes transform metadata and budgets, and injects a compact `[Assembly: ...]` summary. Bridge contract state is separately available through RPC introspection. Hydration result count/cache hit/duration are logged, but explicit rejection reasons/floors are not present (`packages/coding-agent/src/context/effective-prompt-snapshot.ts`, `packages/coding-agent/src/context/assembly-summary.ts`, `packages/coding-agent/src/modes/rpc/rpc-introspection.ts`).

### Key current-state findings
- **Current passive hydration is recall-store-driven, not locator-map-driven.** This differs from ADR 0003/0004 intent. The bridge mostly helps with tool-result stubs and STM observability today; the hydrator does not read bridge freshness, invalidation, or locator retrieval recipes.
- **The bridge’s retention rules do not govern passive hydration.** Control tools are excluded from the bridge, and mutation locators are current-turn only there, but all tool results still get ingested into the recall store on `tool_execution_end` if ingest is available.
- **Search is cross-session and effectively cross-project by default.** `RecallRow` stores both `session_id` and `project_cwd`, but passive hydration calls `store.search()` without a filter. Injection only labels each result as `session="current"` or `session="other"` after selection.
- **There are already multiple recency policies.** `transformMessages()` uses `assembler.hotWindowTurns` from settings (default 4), while `PassiveHydrator` is constructed without that option and therefore uses its own internal default hot window of 5.
- **The latency guard is narrower than advertised.** `MAX_HYDRATION_MS` is only enforced around embedding. LanceDB search and MMR rerank are not time-bounded.
- **Paths and symbols are captured but mostly unused in passive retrieval.** They are stored in recall rows and bridge state, but passive hydration does not filter or rerank by them today.
- **The prompt receives two synthetic developer messages ahead of user/assistant history when active.** First the assembly summary, then the hydrated `<recalled-context>` block.

### Main mismatches between docs and runtime
- ADR 0003/0004 describe assembler hydration as locator-first, freshness-aware, and bridge-informed; current passive hydration instead recalls raw embedded text from LanceDB rows.
- The context-bounding design says old raw tool transcript should stay out of base continuity and only recent tool evidence should feed hydration; current hydrator still queries over raw message history and includes tool-result text from the hot window directly.
- The design spec calls for explicit relevance floors and inclusion/exclusion explanations; current runtime has MMR ranking and budget capping but no relevance floor or reason taxonomy for rejected recall candidates.
- Docs describe the bridge as a key source of recent tool evidence; current runtime does not feed bridge-produced evidence refs into passive hydration.

### Risks for the next enhancement round
- Planning against the docs alone will overestimate how much bridge freshness/invalidation already protects passive recall.
- Ranking tweaks alone may miss larger issues in scope control: cross-session search, divergent hot-window settings, and lack of project/session filtering.
- Budget tuning alone may not solve evidence quality because query construction currently mixes raw assistant/tool text before any disciplined evidence selection.
- Operators can inspect what survived message transform, but they still cannot tell why a recalled candidate did or did not make it into the prompt.

### Recommended audit follow-through
1. Freeze terminology: define this audited path as the **passive recall lane** and separate it from bridge locator hydration and other repo “rehydrate” flows.
2. Decide whether the next enhancement round is about **better retrieval quality inside the current recall-store lane** or **converging runtime toward the locator-first design contract**.
3. If staying incremental, first close the obvious policy drifts: shared hot-window knob, project/session filter policy, and explicit hydration observability.
4. If aiming for contract convergence, treat bridge evidence refs and locator freshness/invalidation as missing runtime inputs rather than assuming they already govern passive recall.