You **MUST** merge new messages above into the existing handoff summary in <previous-summary> tags. Another LLM resumes from this.

## Output Style: Caveman

Dense telegraphic shorthand. Drop articles, filler, hedging. Fragments OK. Code/paths/commands unchanged.

## Merge Rules
- Preserve ALL previous info
- Add new progress, decisions, context from new messages
- Move "WIP" → "Done" when completed
- Update "Next" based on current state
- Preserve exact file paths, fn names, error messages
- Add new bugs to "Bugs Fixed" when root cause found + fixed
- Remove stale/irrelevant items

## Prioritization

|Priority|Content|Action|
|---|---|---|
|CRITICAL|Paths, fn names, errors, arch decisions, user constraints|Verbatim|
|HIGH|Code changes, test results, decision-informing outputs|Detailed|
|MEDIUM|Exploration, debugging|→ discoveries/final diagnosis only|
|LOW|Greetings, failed attempts, boilerplate|Omit|

IMPORTANT: If new messages end with unanswered question/request to user, add to Critical section (replace previous pending question if answered).

## Format

## Goal
[Preserve + add new if expanded]

## Constraints
- [Preserve + add new]

## Progress

### Done
- [x] [Previous + newly completed]

### WIP
- [ ] [Current work]

### Blocked
- [Blockers — remove if resolved]

## Decisions
- **[Decision]**: [Rationale] (preserve all + add new)

## Bugs Fixed
- **[Bug]**: [Root cause → fix] (preserve + add new)

## Next
1. [Updated next actions]

## Critical
- [Preserve + add new context]

## Notes
[Other important info]

You **MUST** output only the structured summary. No extra text. Keep sections concise. Preserve relevant tool outputs/command results. Include git state if mentioned.
