# ACP-CLI Provider Integration — Planning

Branch: `acp-integration`

Goal: Extend omp so it can use a local CLI tool (claude-code, gemini-cli,
kiro-cli, github-copilot-cli) in Agent Client Protocol (ACP) mode as a
first-class provider — i.e. omp becomes an ACP **client** that spawns and
drives another CLI agent over stdio JSON-RPC, in addition to its existing
role as an ACP **server** (for IDEs).

## Artifacts

1. [`requirements.md`](./requirements.md) — EARS-format functional and
   non-functional requirements.
2. [`design.md`](./design.md) — architecture diagrams, module layout,
   protocol flow, error modes, and the extension seams already present in
   omp.
3. [`tasks.md`](./tasks.md) — ordered executable tasks (2–4 hours each),
   each traced back to a requirement.
4. [`research.md`](./research.md) — distilled protocol / library notes
   (ACP handshake, SACP suite, Rust library landscape, known CLI bugs).
5. [`prototypes.md`](./prototypes.md) — what the two reference prototypes
   (`~/ais/resources/llm-proxy`, `~/ais/acp-proxy`) contributed and what
   we're keeping vs discarding.

## Scope

**In scope**

- Four CLI backends: `claude` (Anthropic Claude Code), `gemini` (Google
  Gemini CLI), `kiro` (Kiro CLI), `copilot` (GitHub Copilot CLI).
- Auth **status** detection — is the user logged into the CLI? — plus
  surfacing the login command when they aren't.
- Model discovery per CLI (vendor-specific: Claude `--list-models`,
  Gemini `model list`, Copilot probe + fallback, Kiro static).
- `/login` integration so existing selector UI surfaces CLI providers
  alongside OAuth providers.
- Subprocess lifecycle, JSON-RPC codec with resilient non-JSON filtering
  (Gemini `#22647` workaround), permission-proxy handler for tool calls.

**Out of scope (deferred)**

- MCP-over-ACP bridging (`sacp-rmcp` / conductor work).
- WASM sandboxed proxy extensions.
- Proxy-chain orchestration (conductor pattern). Single-hop only.
- Moving omp's ACP server to SACP / v1.0 SDK — stays on `@agentclientprotocol/sdk@0.16.1` for now.
- AI Context Protocol (the tree-sitter/constraint protocol that shares the name) and Agent-to-Agent / A2A. See `research.md §1` for the three-way name disambiguation.
