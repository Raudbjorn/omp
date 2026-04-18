# ACP-Kiro Provider — Future Work (Placeholder)

Branch: `acp-integration`

**Status:** speculative. Kiro CLI's ACP support status is unclear at
planning time. This folder exists so that if/when Kiro is worth
adding, the slot is ready.

## What we'd do if Kiro shipped ACP

```ts
// providers/acp/cli/kiro.ts
export const kiroAdapter: CliAdapter = {
  id: "kiro-cli-acp",
  displayName: "Kiro CLI (ACP)",
  binary: "kiro",
  installHint: /* TBD — vendor-published command */,
  loginCommand: ["kiro", "auth", "login"],

  async probeAuth(env) {
    // Likely: `~/.config/kiro/credentials` presence + `kiro --version` exit.
  },

  spawnArgs(config) {
    // TBD — mirror whatever ACP flag Kiro settles on.
    return [];
  },

  extraEnv(_config) {
    return {};
  },
};
```

Model list is historically static (`kiro-v1`) so model discovery
degrades to a fallback allowlist.

## What would need to exist upstream first

- Kiro CLI stably available via some package manager (Homebrew,
  npm, direct download).
- A stable ACP flag.
- A credentials/auth probe that doesn't require running the full CLI.

## Bridge alternative

Same reasoning as the Copilot placeholder: if Kiro ships a
proprietary event stream, we either wait for a bridge or skip ACP
entirely for Kiro. We do not plan to write a Kiro bridge ourselves.

## Not in this folder

No `design.md`, `tasks.md`, or `requirements.md`. Any concrete
design work would be speculation on a moving target.

## Trigger for promoting this plan

- Kiro CLI ships an ACP flag.
- A user actively requests Kiro through ACP.

Until then, this placeholder sits.
