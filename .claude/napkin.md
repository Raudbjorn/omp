# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-04-22 | self | Used `\bOMPM\b` in sed when renaming; `\b` doesn't match between `M` and `_`, so `OMPM_HOME`/`OMPM_TMP` were skipped on first pass | For identifier-prefix renames, use an explicit delimiter (e.g. `s/OMPM_/OMP_/g`) instead of relying on `\b` word boundaries when `_` follows |

## User Preferences
- Before pushing branches, opening PRs, or other outside-visible actions, always stop and confirm (matches global CLAUDE.md but worth repeating in this repo).
- When integrating commits from another fork, user expects judgment calls on fork-specific vs universal changes — flag and/or revert commits that tie us to another fork's runtime assumptions (e.g. mrayden's `/login` gut depended on their `aiproxy` service; I reverted).
- User prefers minimal fork divergence from upstream — rejected the `omp → ompm` binary rename as "unnecessary complication." Keep binary name aligned with upstream unless there's a concrete install conflict to solve.

## Patterns That Work
- For a cross-fork harvest, chronological cherry-pick on a dedicated feature branch beats merge: smaller conflict windows, each commit sees the state its author saw.
- Heavy 3-way merge conflicts often overstate the real change. Always `git show <sha> -- <path>` on the original commit to see the actual intent before resolving — saved me twice (the settings-schema.ts `async.enabled` flip was a one-liner disguised as a 120-line conflict).

## Patterns That Don't Work
- `npm/node` LSP errors ("Cannot find module 'node:fs'", "Cannot find name 'process'", "Cannot find name 'console'") are pre-existing in this repo without `bun install` — not caused by edits. Don't chase them.

## Domain Notes
- This is `Raudbjorn/omp`, a fork of `elikoga/oh-my-pi`, which forks `can1357/oh-my-pi`. `mrayden/oh-my-pi-multimodal` is a sibling fork (same root: `can1357/oh-my-pi`).
- CLI binary is `omp` (same as upstream). We deliberately did NOT adopt mrayden's `ompm` rename.
- The only fork-identity point upstream sync could clobber is `scripts/install.sh` `REPO=` pin. `.github/workflows/sync-upstream.yml` has a "Re-apply fork identity" step that handles that on the sync branch — keep that list in sync if more identity points are added.
- Pentest harness system prompt lives at `packages/coding-agent/src/prompts/system/pentest-system-prompt.md` — it configures the agent as "AutoHack"/"CyberAegis". That branding is intentional (the harness persona) and not a fork-identity leak; leave it.
- No `node_modules` committed; `bun install` is required before build/lint.
