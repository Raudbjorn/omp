# Technology Stack

**Analysis Date:** 2026-03-19

## Languages & Runtime

**Primary: TypeScript**
- All packages under `packages/` are written in TypeScript
- Strict mode enabled via `tsconfig.base.json` (`"strict": true`)
- Target: `ESNext` with `bundler` module resolution
- Path aliases: `~/*` maps to `./src/*` per package (configured in each `packages/*/tsconfig.json`)
- JSX: `react-jsx` (used in `packages/tui/`)

**Secondary: Rust**
- Single crate: `crates/pi-natives/`
- Compiled to native Bun addon via `napi-rs`
- Rust edition 2024, toolchain: `nightly-2025-04-18` (pinned in `rust-toolchain.toml`)
- Provides native functions: file watching, process management, PTY, clipboard, globbing

**Runtime: Bun**
- Bun is the sole JavaScript/TypeScript runtime; Node.js is not used
- Uses Bun-native APIs: `bun:sqlite`, `Bun.serve`, `Bun.spawn`, `Bun.file`, `Bun.password`
- Workspace protocol: `"workspace:*"` for inter-package dependencies

## Package Manager & Build

**Package Manager: Bun**
- Workspace root: `package.json` with `"workspaces": ["packages/*"]`
- Lockfile: `bun.lock` (present, committed)
- Config: `bunfig.toml` — sets install scope `@anthropic-private` to private registry `https://us-npm.pkg.dev/anthropic-private/npm/`

**Build System: Makefile + Bun scripts**
- Primary build orchestration: `Makefile` at project root
- Key Makefile targets:
  - `make build` — builds all packages
  - `make build-rust` — compiles Rust native addon (`cd crates/pi-natives && bun run build`)
  - `make check` — runs lint, typecheck, tests
  - `make test` — runs `bun test` across packages
  - `make link` — links the CLI binary globally
  - `make typecheck` — runs `bun run tsc --noEmit` per package
- Package-level scripts: each `packages/*/package.json` defines `build`, `dev`, `test` scripts
- Root scripts: `"build"`, `"check"`, `"format"`, `"lint"`, `"test"`, `"typecheck"`

**Rust Build:**
- `napi-rs` (`@napi-rs/cli`) compiles `crates/pi-natives/` to a native Bun-compatible `.node` addon
- Build: `napi build --platform --release --dts ../index.d.ts`
- Output lands in `packages/natives/` and is consumed as `@anthropic/natives`

**TypeScript Compilation:**
- No bundler step for dev — Bun runs TypeScript natively
- `tsconfig.base.json` extends across all packages
- `"moduleResolution": "bundler"`, `"verbatimModuleSyntax": true`
- Path aliases: `~/*` per package

## Key Dependencies (with versions)

**LLM Provider SDKs** (in `packages/ai/`):
- `@anthropic-ai/sdk` `^0.52.0` — Anthropic Claude API
- `openai` `^4.96.0` — OpenAI, Azure OpenAI, GitHub Copilot, and OpenAI-compatible providers
- `@google/genai` `^1.0.0` — Google Gemini API
- `@aws-sdk/client-bedrock-runtime` `^3.840.0` — Amazon Bedrock
- `@mistralai/mistralai` — Mistral AI API

**MCP (Model Context Protocol)** (in `packages/coding-agent/`):
- `@modelcontextprotocol/sdk` `^1.12.1` — Official MCP SDK for client-side transport

**Data & Embeddings** (in `packages/coding-agent/`):
- `@lancedb/lancedb` `^0.19.2` — Vector database for semantic recall
- `apache-arrow` `^19.0.1` — Arrow format for LanceDB table schemas

**TUI & Rendering** (in `packages/tui/`):
- `ink` `^5.2.0` — React-based terminal UI framework
- `react` `^19.1.0` / `react-dom` — React for Ink components
- `@anthropic/agent-core` (workspace) — Agent execution core
- `@anthropic/ai` (workspace) — AI provider abstraction

**Agent Core** (in `packages/agent/`):
- `zod` `^3.25.23` — Schema validation for tool parameters and configs
- `diff` `^7.0.0` — Text diff computation
- `@anthropic/ai` (workspace) — AI layer dependency

**Utilities** (in `packages/utils/`):
- `@anthropic/natives` (workspace) — Rust native functions

**Stats** (in `packages/stats/`):
- `@anthropic/ai` (workspace) — AI types for cost tracking

**Browser Automation** (in `packages/coding-agent/`):
- `puppeteer-core` `^24.9.0` — Headless browser for web fetch tool
- `@anthropic/natives` (workspace) — native helpers

## Dev Dependencies

**Root-level:**
- `@biomejs/biome` `1.9.4` — Linting and formatting (replaces ESLint + Prettier)
- `typescript` `^5.8.3` — TypeScript compiler for type checking
- `@anthropic-private/biome-config` — shared Biome config

**Testing:**
- Bun's built-in test runner (`bun test`) — no external test framework
- `bun:test` API — `describe`, `it`, `expect`, `mock`, `spyOn`

**Rust-side dev deps:**
- `napi` `^2.16.17` / `napi-derive` `^2.16.13` — FFI bridge
- `napi-build` — build script
- `tree-sitter` + language grammars (TypeScript, Python, Go, Rust, Java, Ruby, C#, Swift, Kotlin, PHP, Markdown, etc.) — AST parsing for code intelligence

## Configuration Files

**Root:**
- `package.json` — workspace root, scripts, devDependencies
- `bun.lock` — lockfile
- `bunfig.toml` — Bun config (private registry scope)
- `tsconfig.json` — root TypeScript config (references `tsconfig.base.json`)
- `tsconfig.base.json` — shared compiler options across all packages
- `biome.json` — Biome linter/formatter config
- `Cargo.toml` — Rust workspace definition (members: `crates/*`)
- `rust-toolchain.toml` — pinned Rust nightly toolchain
- `Makefile` — top-level build orchestration

**Per-package:**
- `packages/*/package.json` — dependencies, scripts, exports
- `packages/*/tsconfig.json` — extends `tsconfig.base.json` with package-specific paths
- `packages/natives/build.ts` — Rust build script using `@napi-rs/cli`

**Environment:**
- `.env` files (existence noted, contents never read) — API keys per provider
- `.env` loading: Bun auto-loads `.env`; code also checks `~/.env` fallback

## Build & Check Commands

```bash
# Full build
make build

# Build Rust native addon only
make build-rust

# Run all checks (lint + typecheck + test)
make check

# Lint with Biome
bun run lint          # or: bunx biome check .

# Format with Biome
bun run format        # or: bunx biome format . --write

# Type check
make typecheck        # runs tsc --noEmit per package

# Run tests
make test             # runs bun test across workspace

# Link CLI globally for development
make link             # bun link in packages/coding-agent

# Build specific package
cd packages/coding-agent && bun run build

# Rust native rebuild
cd crates/pi-natives && bun run build
```

## Monorepo Package Graph

```
@anthropic/coding-agent (CLI entry point)
  ├── @anthropic/agent-core
  │   ├── @anthropic/ai
  │   │   └── (LLM SDKs: anthropic, openai, google, bedrock, mistral)
  │   └── @anthropic/utils
  │       └── @anthropic/natives (Rust FFI)
  ├── @anthropic/tui
  │   ├── @anthropic/agent-core
  │   └── @anthropic/ai
  ├── @anthropic/stats
  │   └── @anthropic/ai
  └── @anthropic/natives

@anthropic/swarm-extension
  ├── @anthropic/ai
  ├── @anthropic/agent-core
  └── @anthropic/utils
```
