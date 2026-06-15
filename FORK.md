---
setup: bun install && uv tool run prek install --prepare-hooks
changelog:
  exclude:
    - ./packages/ai/src/models.json
rebase:
  continue_check: bun fix
---

* Prek (a modern pre-commit equivalent) is installed on this project, and runs on commit.
* If it fails, check the logs, but be aware that a `bun fix:ts` will fix some of the easier issues that you're likely to encounter.

## Fork feature set

This fork adds the following feature areas on top of upstream:

### Agent workflow and submission handling
- Multi-block submissions in interactive mode
- Fenced multi-block shortcut syntax
- Streaming multi-block queue ordering so prompt text and command results stay in authored order
- Execute-intent paste for explicit executable clipboard input
- Plan review approval option to exit plan mode and submit `Approved` into the current session without starting a fresh execution session
- Fork-local `fork-factorizer` daemon at `.agents/daemons/fork-factorizer/DAEMON.md` that advises on isolating fork-specific logic behind extension points/hooks during code changes to reduce upstream merge conflicts

### Runtime and session behavior
- Native `.omp` live reload for commands and skills
- Native `.cmd.yaml` prompt-chain command files in `.omp/commands` and `~/.omp/agent/commands`: `foo.cmd.yaml` registers `/foo`, same-directory `.md` siblings win on name collisions, and invalid YAML/schema files surface as non-fatal interactive warning blocks during startup and reload
- `/reload` support for refreshing runtime state
- Fork-local bundled `/title` extension for manually setting the current session title from interactive mode
- Codex OAuth account stickiness per session / top-level agent
- Fork-local Codex account selection: keep reusing a still-usable sticky pin to avoid cache churn; when a new pin is needed, prefer Spark/Pro accounts first, then choose the non-exhausted account whose long window renews soonest; fail fast if Codex ranking data is missing so regressions surface immediately.
- Codex affinity and cache-observability logging
- Fork-local assistant token line in interactive mode: when `display.showTokenUsage` is enabled, assistant messages show dim input/output counts, a `\uf49b` cache segment with explicit cached-token count including `0` and hit/miss tinting, plus a trailing `` elapsed segment derived from assistant-message timestamps in compact `d/h/m/s` form
- Native shell interpolation in rendered command and skill bodies
- Bundled `.omp` workflow prompt commands include `/fix-issues` and `/review-prs` for issue/PR batch workflows

### Supporting platform and tooling changes
- Pre-commit blocks staged `CHANGELOG.md` files with `This is a fork. We do not modify CHANGELOG.md`
- Changelogs use Git's union merge strategy to reduce append-only sync conflicts
- Better extension discovery, including symlinked package dirs
- Package name derivation fixes for discovered extensions
- Session token tracking and related session-link fixes
- Stats dashboard sync now parses session files through a worker pool, tracks user-message behavior and priority-service premium request metrics, and release-binary smoke checks exercise the worker entrypoint with `omp --smoke-test`
- Persistent per-install ID stored outside the agent state directory, logger transport switching, prompt ASCII replacement that preserves HTML comments, and safe spawned-process environment filtering
- Clipboard and native integration improvements
- Nano Banana 2 image-generation pipeline upgrade
- OpenRouter image-generation requests now send `modalities` and forward `image_config` (`aspect_ratio`, `image_size`) when provided
- AI tool schema normalization and wire-format compatibility across Zod/JSON Schema inputs, provider-specific strict modes, and tool-call/result healing
- AI auth broker/gateway infrastructure for sharing refreshed provider credentials through broker snapshots and server-side OpenAI/Anthropic/pi-native protocol shims
- Fork-local bundled Danger Pi extensions now live in `packages/coding-agent/src/danger-pi/extensions/index.ts` and are wired directly into `sdk.ts` inline extensions, separate from filesystem-discovered user/project extensions
- Added fork-local `meta` bundled extension slash command for UI/autocomplete experimentation with `foo`, `bar`, and `baz` argument suggestions
- Platform additions for isolation and orchestration: `pi-iso` native isolation backends, SIXEL-only native image encoding, Windows-safe native addon staging/version sentinels, Python `omp-rpc` host URI helpers, and the `robomp` Docker/Python/Solid dashboard workspace
