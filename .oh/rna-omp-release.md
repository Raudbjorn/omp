# Session: rna-omp-release

## Aim
**Updated:** 2026-03-28

**Aim:** Ship oh-omp with RNA as a first-class component — users get the enhanced experience (structural code views, warm codec compression, turn expansion) without manual setup.

**Current State:** oh-oh-my-pi fork has 28 divergent commits on `experiment/rna-replaces-tools`. RNA is a separate Rust binary in `repo-native-alignment/` with an existing release pipeline (GitHub Actions) that ships pre-built binaries for darwin-arm64 (M1 + M4) and linux-x86_64 via GitHub releases as `.tar.gz` artifacts.

**Desired State:** oh-omp main includes the codec pipeline and RNA integration. RNA binary is available via lazy-download on first run (like Bun's install model). Users run oh-omp, RNA downloads automatically, enhanced experience activates.

### Mechanism
**Change:** 
1. Merge the codec pipeline and RNA integration from fork to oh-omp main
2. Add a lazy-download provisioner that fetches the RNA binary from GitHub releases on first use
3. RNA remains optional — graceful degradation when unavailable

**Hypothesis:** The release pipeline already exists (tag → build → GitHub release). oh-omp just needs to resolve the binary at startup and download if missing.

**Assumptions:**
- 28 commits can be cleanly rebased/squashed for merge
- GitHub releases API is accessible from user machines
- Binary size (~10-15MB compressed) is acceptable for lazy download
- `.oh-omp/bin/` is an acceptable cache location

### Feedback
**Signal:** `bun install @anthropic/oh-omp && omp` — RNA activates automatically on first project open.

### Guardrails
- RNA must remain optional (everything degrades gracefully)
- No Rust toolchain required for users
- Binary checksums verified on download
- Version pinning: oh-omp release X pins RNA release Y

## Solution Space
**Updated:** 2026-03-28
**Selected:** Lazy-download from GitHub releases (Bun model)

RNA release pipeline already ships:
- `repo-native-alignment-darwin-arm64.tar.gz` (M1 baseline)
- `repo-native-alignment-darwin-arm64-fast.tar.gz` (M4 optimized)
- `repo-native-alignment-linux-x86_64.tar.gz`

oh-omp adds a provisioner that checks `~/.oh-omp/bin/repo-native-alignment`, downloads from releases if missing, verifies, caches.
