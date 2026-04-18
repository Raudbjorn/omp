# ACP-Copilot Provider — Future Work (Placeholder)

Branch: `acp-integration`

**Status:** speculative. GitHub Copilot CLI does **not** currently
speak ACP, and there is no public roadmap that commits to it. This
folder exists so that if/when Copilot gains ACP support, the shape
of the adapter is already thought through.

## What we'd do if Copilot shipped ACP

The adapter drops into the shared core with zero changes to
`providers/acp/`:

```ts
// providers/acp/cli/copilot.ts
export const copilotAdapter: CliAdapter = {
  id: "copilot-cli-acp",
  displayName: "GitHub Copilot CLI (ACP)",
  binary: "copilot",                // TBD — may be `github-copilot-cli`
  installHint: "npm i -g @github/copilot",
  loginCommand: ["gh", "auth", "login"],

  async probeAuth(env) {
    // Likely: `gh auth status` exit code, or a file under ~/.config/gh/
    // plus binary-on-PATH check. Pinned once the CLI actually ships ACP.
  },

  spawnArgs(config) {
    // Whatever flag Copilot chooses for ACP mode — mirror Gemini's
    // `--experimental-acp` pattern if applicable.
    return [];
  },

  extraEnv(_config) {
    return {};
  },
};
```

## What would need to exist upstream first

- A stable ACP mode flag on the Copilot CLI.
- A documented auth probe (`gh auth status` or equivalent).
- A model enumeration endpoint — Copilot historically rotated its
  model surface (grok-code, gpt-5-mini, claude-sonnet-4.5, gpt-4.1,
  o4-mini-high, etc.) so a static fallback list is table stakes.

## Bridge alternative

If Copilot follows Anthropic's pattern — proprietary event stream
instead of ACP — there's no equivalent to `claude-agent-acp` today.
We'd either:

1. Wait for someone (Zed, GitHub, or the community) to ship a
   Copilot-to-ACP bridge binary — then the adapter pattern from
   `../acp-claude/` applies verbatim.
2. Use the existing Copilot direct-API provider (if omp has one) and
   skip ACP for Copilot indefinitely.

Option 1 is strictly better ergonomics if someone else does the
work. We are not that someone.

## Not in this folder

- No `design.md`, `tasks.md`, or `requirements.md`. All of those
  would be speculative and would rot.
- No discussion of specific Copilot bugs — we have none to work
  around because we have no ACP code for Copilot to exercise.

## Trigger for promoting this plan

Write this folder up properly when any of these is true:

- Copilot CLI ships an ACP flag (announced by GitHub).
- A community ACP bridge for Copilot ships under an open license.
- A user actively requests Copilot through ACP (not just "through
  omp") and nothing else will suffice.

Until one of those, this stays a placeholder.
