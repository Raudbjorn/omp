# Session: recall-specificity

## Aim
**Updated:** 2025-07-14

**Aim:** The agent can retrieve specific information from its own conversation history in long single-topic sessions, instead of getting back a wall of topically similar but imprecise results.

**Current State:** In a 340-turn session about context assembly, similarity scores cluster 0.50-0.63. A query for "what did we set CONVERSATION_VERBATIM_TOKEN_THRESHOLD to" returns dozens of turns mentioning thresholds, tokens, and compression — all scoring nearly the same. The specific turn with the answer (`50`) ranks no better than the planning discussions around it. Keyword search (which would find the exact identifier) only covers tool results in SQLite, not conversation content in LanceDB.

**Desired State:** The agent can retrieve the specific turn where a value was defined, a decision was made, or a correction was issued — even when surrounded by hundreds of topically similar turns. Retrieval quality doesn't degrade as session length grows within a single topic.

### Mechanism
**Change:** Add keyword/hybrid search capability over conversation content in the recall store. Three candidate approaches (to be evaluated in problem-space):

1. **Ingest conversation text into ToolResultStore** — piggyback on the existing BM25/FTS5 infrastructure. Keyword search covers everything.
2. **Full-text filter on LanceDB queries** — add a `WHERE text LIKE '%term%'` filter to vector search. Combines semantic relevance with keyword precision.
3. **Hybrid scoring** — re-rank vector search results by keyword overlap with the query. No storage changes.

**Hypothesis:** The specificity problem in single-topic sessions is caused by vector search being the only retrieval method for conversation content. Adding keyword matching — either as a primary search mode or as a re-ranking signal — would let the agent find exact identifiers, values, and phrases that vector embeddings blur together.

**Assumptions:**
- The IngestPipeline already stores the full text in LanceDB — the data is there, it's just not keyword-searchable
- BM25/FTS5 keyword matching discriminates well on identifiers, constants, and specific terms even when semantic similarity is saturated
- The recall tool's `mode: "keyword"` parameter already exists — it just needs to search conversation content too

### Feedback
**Signal:** In a single-topic session with 500+ turns, `recall(mode="keyword", query="CONVERSATION_VERBATIM_TOKEN_THRESHOLD")` returns the defining turn as the top result, not buried under topically similar noise.

**Timeframe:** Testable immediately after implementation.

### Guardrails
- Don't break existing vector search — keyword is additive, not a replacement
- Don't duplicate storage unnecessarily — prefer extending existing stores over creating new ones
- Keyword search must be as fast as vector search (FTS5 is sub-millisecond)
- The recall tool API already has `mode: "keyword"` — extend its backing store, don't add new parameters
