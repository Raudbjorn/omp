# omp — Arch Linux PKGBUILD

Builds the omp coding-agent CLI from the local worktree and installs
`/usr/bin/omp`. The compiled binary bundles the Bun runtime, so it
has no npm/bun runtime dependency once installed.

## Prerequisites

```bash
sudo pacman -S --needed base-devel bun rustup git jq
# rustup will pull the nightly toolchain pinned in rust-toolchain.toml
# during the prepare() step — no need to pre-install it.
```

## Install from this worktree

From the directory containing this file:

```bash
cd packaging/archlinux
makepkg -si
```

`makepkg` will:

1. Clone the current branch of the worktree at `../..` into `src/omp/`.
2. Install the pinned Rust nightly via `rustup` (toolchain-local, does
   not touch your default).
3. Run `bun install --frozen-lockfile`.
4. Build the N-API native addon (`crates/pi-natives`).
5. Produce `packages/coding-agent/dist/omp` via `bun build --compile`.
6. Install it to `/usr/bin/omp` plus docs and LICENSE under
   `/usr/share/{doc,licenses}/omp/`.

## Environment overrides

Both are optional.

| Variable     | Default                                        | Purpose                                      |
|--------------|------------------------------------------------|----------------------------------------------|
| `OMP_REPO`   | realpath of the worktree containing `PKGBUILD` | Build a different checkout.                  |
| `OMP_BRANCH` | `acp-integration`                              | Build a different branch or tag.             |

Examples:

```bash
OMP_BRANCH=main makepkg -si
OMP_REPO=/srv/omp OMP_BRANCH=v14.1.4 makepkg -si
```

## Building from GitHub instead

Open `PKGBUILD` and swap the active `source=(...)` line for the
commented `git+https://github.com/Raudbjorn/omp.git` variant.

## Uninstall

```bash
sudo pacman -Rns omp
```

## Notes

- `options=('!strip' '!debug' '!lto')` — the Bun-compiled binary is
  already stripped; running `strip` on it corrupts the executable.
- `pkgver()` appends `.r<count>.<sha>` so every rebuild from a dirty
  branch produces a distinct, strictly-increasing package version,
  and `pacman -U` will upgrade cleanly.
- The build is hermetic: `BUN_INSTALL` is pointed at `$srcdir/.bun`
  so the user's `~/.bun/install` is not modified.
