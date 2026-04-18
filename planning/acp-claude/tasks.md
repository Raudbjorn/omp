# Tasks — ACP-Claude Adapter

Estimated budget: **~1–2 days** once the Gemini MVP is in place. The
adapter is a thin shell around the shared core.

## Prereq

The Gemini MVP (`../acp-gemini/tasks.md`) is landed: `"acp-agent"`
Api type, `providers/acp/` module, shared fs-proxy and permissions,
`CliAdapter` interface.

## Tasks

### T1. `providers/acp/cli/claude-code.ts` adapter
- Implement `claudeCodeAdapter: CliAdapter` per `design.md §2`.
- `probeAuth`: check `claude` + `claude-agent-acp` on PATH; check
  `~/.claude/config.json.accessToken` or `ANTHROPIC_API_KEY`.
- `spawnArgs`: `["--model", config.model ?? "claude-sonnet-4.5"]`.
- Unit tests with mocked `fs.stat`, `execFile`, `readJsonSafe`.
- **Exit:** four auth states return correctly.

### T2. Wire adapter into the registry
- Add `claude-code-acp` to the adapter registry map consumed by
  `providers/acp/stream.ts`.
- Lookup by `model.provider` (already the pattern).
- **Exit:** typecheck clean; fake-fixture test with
  `provider: "claude-code-acp"` routes through the new adapter.

### T3. Seed `models.json`
- Add Claude Code entries: `claude-sonnet-4.5`, `claude-opus-4.1`,
  `claude-haiku-4.5` with `"api": "acp-agent"`,
  `"provider": "claude-code-acp"`.
- **Exit:** models appear in the model selector.

### T4. `/login` and `/usage` rows
- Extend the ACP row rendering (added in Gemini T12) to include
  Claude Code.
- Selecting logged-out row: run `claude setup-token` in inherited
  stdio.
- Missing-row hint: lists both npm globals.
- **Exit:** visual smoke test.

### T5. Model discovery
- Extend `utils/discovery/acp.ts` with Claude Code entries: try
  `claude --list-models` with 5 s timeout, fall back to static list.
- 24 h cache shared with Gemini via adapter id key.
- **Exit:** `/usage` shows Claude Code with auth state.

### T6. Smoke script
- `scripts/smoke-claude-code-acp.ts` — one prompt end-to-end,
  gated by `CLAUDE_SMOKE=1`.
- **Exit:** runs green on a logged-in host.

## Not tasks (do not do these)

- Do **not** write a stream-json parser. Use the bridge.
- Do **not** add Claude-Code-specific branches in
  `providers/acp/stream.ts`, `event-mapping.ts`, or any other shared
  core file. Everything Claude-specific stays in
  `cli/claude-code.ts`.
- Do **not** vendor or ship `claude-agent-acp` inside omp's release
  artifacts. Users install it separately.
