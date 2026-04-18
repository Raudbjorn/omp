<p align="center">
  <strong>omp</strong> — a Raudbjorn fork of <a href="https://github.com/can1357/oh-my-pi">can1357/oh-my-pi</a>
</p>

<p align="center">
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Rust-DEA584?style=flat&colorA=222222&logo=rust&logoColor=white" alt="Rust"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&colorA=222222&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat&colorA=222222" alt="Bun"></a>
</p>

This repository is a downstream of `can1357/oh-my-pi` — the entire upstream
feature set (commit tool, LSP, Python kernel, TTSR, task subagents, MCP,
browser tool, hashline edits, native Rust engine, 40+ providers, …) is
unchanged and still authoritative. This README is a changelog against the
family tree, not a reimplementation of the upstream docs.

For full feature documentation, CLI reference, configuration schemas, and
philosophy, read [the upstream README](https://github.com/can1357/oh-my-pi/blob/main/README.md).

---

## Fork lineage

```text
badlogic/pi-mono          (Mario Zechner — original)
        │
        ▼
can1357/oh-my-pi          (canonical upstream; CLI: pi)
        ├───► elikoga/oh-my-pi    (narrow bugfix fork, see below)
        └───► Raudbjorn/omp       (this repo; CLI renamed: omp)
```

## How `Raudbjorn/omp` differs from `can1357/oh-my-pi`

### Branding and CLI surface

- CLI binary renamed from `pi` to `omp` (`packages/coding-agent/package.json#bin`).
- `bearminal` bear artwork replaces the pi icon on the welcome screen
  (`feat(welcome): replace pi icon with bearminal bear branding`).
- Welcome styling kept sticky across Codex selection transitions.

### Additional providers

- **Devin** and **Warp** agent providers (`feat(ai): add Devin and Warp agent providers`).
- **UPB AI Gateway** (also present in elikoga — see contrast section).

### Additional slash commands and workflows

- `/screenshot` — desktop capture with backend auto-detection: macOS
  `screencapture`, Wayland `grim` (`slurp` for region select) and X11
  `scrot` (`feat(coding-agent): add /screenshot desktop capture command`).
- `/plans` — list, load, show, and delete saved plan files. The plans
  directory resolves through XDG: `$XDG_DATA_HOME/omp/plans` when
  `XDG_DATA_HOME` is set, else `~/.omp/plans`. `load` reads the plan
  markdown into the editor; `show` prints it to the status area;
  `delete` is idempotent on `ENOENT`.
- Bundled session-title slash commands.

### Runtime and developer ergonomics

- Live-reload for native commands and skills — no restart to pick up new
  or edited skills/commands while the TUI is running.
- Runtime skill refresh restored.
- `/usage` account ordering stabilized; assistant usage metadata
  preserved in serialized sessions.
- `generate_image` size options corrected.
- TypeScript stubs for the Shyndman port; imports sorted.

### Packaging, CI, and upstream tracking

- **Homebrew tap pipeline** — `.github/workflows/release-brew.yml` plus
  `packaging/homebrew/omp.rb.tmpl` render a formula on tagged releases.
  Guarded `if: false` until the tap repo (`Raudbjorn/homebrew-omp`) and
  `HOMEBREW_TAP_TOKEN` secret are provisioned.
- **Weekly upstream sync** — `.github/workflows/sync-upstream.yml` opens
  a PR with new commits from `can1357/oh-my-pi@main`, labelling
  conflicts for manual review (cron: Mondays 06:00 UTC; also
  `workflow_dispatch`).
- **TUI theme registry** in `packages/tui/src/theme/` — minimal
  semantic-color registry (`accent`/`success`/`warning`/`error`/`info`/
  `muted`/`border`) plus an `omp-default` preset, so primitives in
  `@oh-my-pi/pi-tui` can be themed standalone.
- Status-line truncation extracted into a reusable helper with UTF-16-code-unit
  semantics explicitly documented.

### Active branches (state may shift after merges)

- `acp-integration` — turns `omp` into an **ACP client** that spawns and
  drives another CLI (`claude`, `gemini`, `kiro`, `copilot`) over stdio
  JSON-RPC, in addition to its existing role as an ACP server for IDEs.
  Planning artefacts live under [`planning/`](./planning/) (requirements,
  design, tasks, research, prototypes).

### Documentation

- Imported the OAuth providers guide from
  `choskeli/oh-my-pi` (`docs: import OAuth providers guide from choskeli/oh-my-pi`).

## How `Raudbjorn/omp` differs from `elikoga/oh-my-pi`

`elikoga/oh-my-pi` is a **narrow, focused** downstream of
`can1357/oh-my-pi` (currently 8 ahead / 13 behind). Its contributions are
entirely targeted fixes:

| elikoga patch                                               | Status in omp |
| ----------------------------------------------------------- | ------------- |
| Timeout expiry wall-clock time for long-running commands     | ✅ included   |
| Kitty protocol: `isKeyRelease` guard on all selectors        | ✅ included   |
| UPB AI Gateway provider                                      | ✅ included   |
| OpenRouter upstream proxy error retry                        | ✅ included   |
| Native build: `-gnu`/`-musl` libc suffix handling            | ✅ included   |
| GitHub Copilot: strip `thinking`/`output_config`             | ✅ included   |
| GitHub Copilot: skip prompt caching                          | ✅ included   |
| Treat `model_not_supported` as retryable transient           | ✅ included   |

Everything in elikoga is already in omp. The reverse is not true: omp
adds a rebrand, extra providers (Devin, Warp), `/screenshot`, `/plans`,
live-reload, the Homebrew pipeline, the sync workflow, and the ACP
client work, none of which are goals of elikoga.

Summary: if you want a tight set of bugfixes on top of upstream, use
elikoga. If you want a broader divergence with additional providers,
tooling, and platform glue — plus the ACP client track — use omp.

## Installation (quick)

Install from source with Bun (recommended while the Homebrew tap and
release binaries are still being provisioned):

```bash
bun install
bun --cwd=packages/coding-agent link
omp
```

Full installer script and `mise` instructions are in the upstream README.
Once the Homebrew pipeline is active, `brew install Raudbjorn/omp/omp`
will become available.

## Configuration paths

- User:    `~/.omp/agent/`  (unchanged from upstream)
- Project: `.omp/`          (unchanged from upstream)
- Plans:   `~/.omp/plans/`  (new, for `/plans` — XDG: `$XDG_DATA_HOME/omp/plans` when set)

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2025 Mario Zechner
Copyright (c) 2025-2026 Can Bölük
Copyright (c) 2026 Raudbjorn contributors

---

## Reference: upstream README

For everything not explicitly described above — installation variants,
slash commands, keyboard shortcuts, sessions, configuration schema, SDK,
RPC mode, HTML export, built-in tools, the philosophy note, and the
monorepo package table — consult the canonical upstream README:

**https://github.com/can1357/oh-my-pi/blob/main/README.md**
