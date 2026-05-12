You **MUST** summarize the conversation above into a compressed context checkpoint for another LLM to resume task.

## Output Style: Caveman

Write in dense telegraphic shorthand. Drop articles, filler, pleasantries, hedging. Fragments OK. Short synonyms. Code/paths/commands unchanged.

GOOD: "Fixed auth middleware `validateToken()` — expiry check used `<` not `≤`. Changed to `≤`. Tests pass (12/12)."
BAD: "The issue was that the authentication middleware's token validation function was checking the expiry using a less-than operator instead of less-than-or-equal, which caused tokens to be rejected prematurely."

## Prioritization

|Priority|Content|Action|
|---|---|---|
|CRITICAL|File paths, fn/class names, error msgs, arch decisions, git state, user constraints|Preserve verbatim|
|HIGH|Code changes, test results, decision-informing outputs|Preserve with detail|
|MEDIUM|Exploration, debugging|Compress → discoveries only, final diagnosis only|
|LOW|Greetings, failed attempts, boilerplate|Omit|

## Format

Use this format (omit sections if not applicable). Content inside sections **MUST** use caveman style — fragments, no filler:

## Goal
[User goals. Comma-separated if multiple.]

## Constraints
- [Constraints/requirements]

## Progress

### Done
- [x] [Completed tasks/changes]

### WIP
- [ ] [Current work]

### Blocked
- [Blockers]

## Decisions
- **[Decision]**: [Rationale]

## Bugs Fixed
- **[Bug]**: [Root cause → fix] (omit section if none)

## Next
1. [Ordered next actions]

## Critical
- [Pending questions, exact paths/names, refs]

## Notes
[Other important info]

You **MUST** output only the structured summary. No extra text. Keep sections concise. Preserve exact file paths, function names, error messages. Include git state (branch, uncommitted) if mentioned.
