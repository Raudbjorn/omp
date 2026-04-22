# Session: context-decay

## Aim
**Updated:** 2025-07-14

**Aim:** The agent proactively recovers compressed content when it detects information gaps, instead of reasoning over truncated messages or silently losing context as sessions grow.

**Current State:** The assembler compresses old conversation turns (head+tail) and tool results (warm codec, stubs). The compression markers exist in-context:
- Tool results: `[warm:...]` and `[ref:...]` — mentioned in system prompt (line 94) and recall tool description (line 10)
- Conversation turns: `[... N lines compressed — use recall(query=...) to expand]` — **not mentioned anywhere** in system prompt, recall tool description, or runtime-surfaces prompt

The agent has no training signal connecting `[... N lines compressed]` to the recall tool. The assembly summary says `(recoverable via recall)` as an aggregate stat, but there's no per-message instruction. The recall tool description explicitly names `[warm:...]` and `[ref:...]` as expansion targets but ignores conversation compression entirely.

Result: as sessions grow, the agent silently loses information from compressed conversation turns. It sees truncated messages but doesn't know recovery is possible, doesn't know which tool to use, and doesn't know what query to formulate.

**Desired State:** The agent treats all forms of compression — tool result stubs, warm codec summaries, and conversation compression — as first-class recoverable content. When it encounters any compressed marker, it knows:
1. That content was compressed (not naturally truncated)
2. That the full content is recoverable
3. Which tool to use (`recall`)
4. How to formulate the query (use visible head/tail lines for conversation turns, use turn number for tool stubs)

### Mechanism
**Change:** Update the prompt layer (system prompt, recall tool description, runtime-surfaces) to treat recall+expansion as a primary context-management tool — not a secondary search utility. Specifically:
1. Add `[... N lines compressed]` to the recall tool description alongside `[warm:...]` and `[ref:...]`
2. Add a "Context Compression" section to the system prompt explaining all three compression types and how to expand them
3. Promote recall from "Information Retrieval" to "Context Management" in the prompt hierarchy

**Hypothesis:** The agent already has the recall tool and the compressed markers. The gap is in the prompt — the agent isn't told that conversation-compressed content is recoverable or how to recover it. Prompt-level instruction will close the loop.

**Assumptions:**
- The recall tool's semantic search (query mode) reliably finds the full text stored by IngestPipeline when queried with the head/tail lines from compression
- The agent will read and follow prompt instructions about compression markers (standard LLM instruction-following)
- The assembly summary stats (`N scored, sim X-Y`) give the agent enough self-diagnostic to know when compression is active

### Feedback
**Signal:** In sessions where conversation compression is active (scored count > 0), observe:
- Does the agent call recall when it encounters `[... N lines compressed]` markers?
- Does the recall query succeed in finding the full content?
- Does the agent's reasoning quality degrade less in long sessions compared to before?

**Timeframe:** Observable on the next session with compression active (requires diverse-topic session or lower threshold).

### Guardrails
- **Prompts live in static `.md` files** — no prompt construction in code (project rule)
- **Don't change the recall tool's API** — only update descriptions and prompt text
- **Don't over-prompt** — the instruction should be concise, not a tutorial. One short section in system prompt, one line in recall tool description
- **Keep backward compatibility** — `[warm:...]` and `[ref:...]` expansion instructions must remain unchanged
