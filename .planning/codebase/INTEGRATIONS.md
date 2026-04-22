# External Integrations

**Analysis Date:** 2026-03-19

## LLM Providers

The AI provider abstraction lives in `packages/ai/src/`. Each provider has a dedicated streaming implementation under `packages/ai/src/providers/`.

**Anthropic Claude:**
- SDK: `@anthropic-ai/sdk` `^0.52.0`
- Provider file: `packages/ai/src/providers/anthropic.ts`
- Auth env var: `ANTHROPIC_API_KEY`
- Models: Claude 4 Sonnet, Claude 4 Opus, Claude 3.5/3.7 Sonnet, Claude 3.5 Haiku
- Supports: streaming, extended thinking, tool use, prompt caching, image input
- OAuth flow: supported via `packages/ai/src/utils/oauth/` for token-based auth (Max/Console)

**OpenAI & OpenAI-Compatible:**
- SDK: `openai` `^4.96.0`
- Provider file: `packages/ai/src/providers/openai-responses.ts`
- Auth env var: `OPENAI_API_KEY`
- Also used for OpenAI-compatible endpoints: Azure OpenAI, GitHub Copilot, DeepSeek, Groq, Fireworks, Together, xAI/Grok, LM Studio, Ollama, vLLM, NanoGPT, Venice, Xiaomi, Qianfan, Qwen Portal, Zenmux
- Each compatible provider has its own env var (e.g., `AZURE_OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `FIREWORKS_API_KEY`, `TOGETHER_API_KEY`, etc.)

**Google Gemini:**
- SDK: `@google/genai` `^1.0.0`
- Provider file: `packages/ai/src/providers/google.ts`
- Auth env var: `GOOGLE_API_KEY` or `GEMINI_API_KEY`
- Supports: streaming, tool use, image generation (Gemini image models)

**Amazon Bedrock:**
- SDK: `@aws-sdk/client-bedrock-runtime` `^3.840.0`
- Provider file: `packages/ai/src/providers/bedrock/`
- Auth: AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)
- Routes Anthropic Claude models through AWS Bedrock

**Mistral AI:**
- SDK: `@mistralai/mistralai`
- Auth env var: `MISTRAL_API_KEY`

**GitLab Duo:**
- Provider file: `packages/ai/src/providers/gitlab-duo.ts`
- Uses a custom endpoint with GitLab auth token

**Provider Selection:**
- Provider + model selected via `packages/ai/src/provider-models/descriptors.ts`
- `KnownProvider` type union: `"anthropic" | "openai" | "azure-openai" | "google" | "bedrock" | ...` (30+ providers defined in `packages/ai/src/types.ts`)
- API key resolution: `packages/ai/src/stream.ts` — `serviceProviderMap` maps provider names to env var names
- Custom API registry supports extension-provided APIs (e.g., Vertex Claude)

## APIs & Services

**Web Search (for agent web_search tool):**
- Pluggable search providers under `packages/coding-agent/src/web/search/providers/`
- Brave Search: `packages/coding-agent/src/web/search/providers/brave.ts` — env: `BRAVE_API_KEY`
- Perplexity AI: `packages/coding-agent/src/web/search/providers/perplexity.ts` — env: `PERPLEXITY_API_KEY`
- Exa: `packages/coding-agent/src/web/search/providers/exa.ts` — env: `EXA_API_KEY`
- Tavily: `packages/coding-agent/src/web/search/providers/tavily.ts` — env: `TAVILY_API_KEY`
- Jina: `packages/coding-agent/src/web/search/providers/jina.ts` — env: `JINA_API_KEY`
- Codex (code search): `packages/coding-agent/src/web/search/providers/codex.ts`
- Zai: `packages/coding-agent/src/web/search/providers/zai.ts`
- Kagi: `packages/coding-agent/src/web/kagi.ts` — env: `KAGI_API_KEY`

**Web Fetch (for agent fetch tool):**
- Puppeteer-based headless browser: `puppeteer-core` `^24.9.0`
- Used to render JavaScript-heavy pages and extract content
- Located under `packages/coding-agent/src/web/`

**GitHub:**
- Integration via `gh` CLI subprocess (not Octokit SDK)
- Used for PRs, issues, checks, releases
- Located in skill-based tools (e.g., `oh-task`, `oh-review`, `oh-merge`)

**Jira:**
- MCP-based integration (external MCP server, not built into codebase)
- Skills reference Jira operations via MCP tools

**Open Horizons (OH):**
- External service at `ohlabs.ai` domain
- MCP server integration for endeavor/mission tracking
- Referenced in `packages/coding-agent/src/` — URLs point to `app.ohlabs.ai`
- OAuth-based authentication

**Image Generation:**
- Gemini image models via `@google/genai` SDK
- Tool: `generate_image` exposed as an agent tool
- Located in coding-agent tools

## Database

**SQLite (via `bun:sqlite`):**
- Primary persistent storage for agent state
- Implementation: `packages/coding-agent/src/session/agent-storage.ts`
- Database file: `agent.db` stored under project `.omp/` directory
- Tables:
  - `sessions` — conversation sessions (id, project_path, model, created_at, etc.)
  - `messages` — conversation messages per session
  - `session_costs` — token usage and cost tracking
  - `oauth_credentials` — stored OAuth tokens for providers
  - `mcp_auth` — MCP server OAuth credentials
  - `tasks` — task tracking (BA system) in `packages/coding-agent/src/tasks/store.ts`
- WAL mode enabled for concurrent access
- Uses Bun's native SQLite binding (no ORM)

**LanceDB (vector database):**
- Used for semantic recall (cross-session memory)
- Implementation: `packages/coding-agent/src/context/recall/store.ts`
- SDK: `@lancedb/lancedb` `^0.19.2`
- Data format: Apache Arrow (`apache-arrow` `^19.0.1`)
- Embedding: `packages/coding-agent/src/context/recall/embed.ts`
  - Uses LLM provider embedding APIs (e.g., OpenAI `text-embedding-3-small`)
  - Falls back based on available API keys
- Storage: local LanceDB directory under project `.omp/` or `~/.omp/`
- Table: `recall` — stores embedded session summaries for semantic search

## Protocol & Transport

**JSON-RPC 2.0:**
- Used for MCP client-server communication
- Types: `packages/coding-agent/src/mcp/types.ts`
- Message types: `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcNotification`
- Custom error codes defined in MCP spec

**RPC Mode (agent-to-agent):**
- Custom JSON-RPC-style protocol for headless/subagent operation
- Types: `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- Messages: `init`, `message`, `resume`, `cancel`, `abort`
- Responses: `assistant_message`, `input_required`, `result`, `error`
- Transport: stdio (JSON lines)
- Used by: orchestrator/subagent spawning, CI mode

**Stats Server (local HTTP):**
- `Bun.serve` HTTP server in `packages/stats/src/server.ts`
- Provides real-time cost/token usage data
- SSE endpoint for live streaming updates to TUI
- Bound to localhost only

**LSP (Language Server Protocol):**
- Client implementations under `packages/coding-agent/src/lsp/clients/`
- Supports: TypeScript/JavaScript (tsserver), Go (gopls), Rust (rust-analyzer), Python (pyright/pylsp)
- Transport: stdio-based child process communication
- Used for: go-to-definition, find-references, hover, diagnostics

## MCP (Model Context Protocol)

**Client Implementation:**
- Full MCP client in `packages/coding-agent/src/mcp/`
- SDK: `@modelcontextprotocol/sdk` `^1.12.1`
- Spec version: MCP 2025-03-26

**Transport Support:**
- **Stdio:** default — launches MCP server as child process (`MCPStdioServerConfig` in `packages/coding-agent/src/mcp/types.ts`)
- **Streamable HTTP:** connects to remote MCP server via HTTP POST + SSE (`MCPHttpServerConfig`)
- **SSE (deprecated):** legacy transport still supported (`MCPSseServerConfig`)
- Transport implementations: `packages/coding-agent/src/mcp/transports/`

**Configuration:**
- `.mcp.json` files — project-level and user-level (`~/.omp/.mcp.json`)
- Config loading: `packages/coding-agent/src/mcp/config.ts`
- Supports: per-server `enabled`, `timeout`, `auth` (OAuth or API key), `env` vars
- Discovery: reads `.mcp.json` from project root, user config dir, and VS Code settings

**Authentication:**
- OAuth 2.0 flow for remote MCP servers (authorization code grant)
- API key auth for simpler servers
- Credentials stored in `agent.db` SQLite (`oauth_credentials`, `mcp_auth` tables)
- Auth config type: `MCPAuthConfig` in `packages/coding-agent/src/mcp/types.ts`
- OAuth utilities: `packages/ai/src/utils/oauth/`
- Token refresh: proactive refresh using stored `tokenUrl`, `clientId`, `clientSecret`

**Capabilities Exposed:**
- Tools: MCP servers register tools that become available to the agent
- Resources: MCP servers can expose file-like resources
- Prompts: MCP servers can provide prompt templates
- Sampling: reverse-direction — MCP server can request LLM completions from the agent

## Auth Mechanisms Summary

| Mechanism | Where Used | Storage |
|-----------|-----------|---------|
| API Keys (env vars) | LLM providers, web search APIs | `.env` files, `Bun.env` |
| OAuth 2.0 (authorization code) | Anthropic Console/Max, remote MCP servers, OH | `agent.db` `oauth_credentials` table |
| AWS IAM credentials | Amazon Bedrock | AWS credential chain (`~/.aws/`) |
| MCP OAuth | Remote MCP servers requiring OAuth | `agent.db` `mcp_auth` table |
| GitLab tokens | GitLab Duo | Environment variable |

## Environment Variables (Key Examples)

| Variable | Provider/Service |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Google Gemini |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Amazon Bedrock |
| `MISTRAL_API_KEY` | Mistral AI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `XAI_API_KEY` | xAI / Grok |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `TOGETHER_API_KEY` | Together AI |
| `BRAVE_API_KEY` | Brave Search |
| `PERPLEXITY_API_KEY` | Perplexity AI |
| `TAVILY_API_KEY` | Tavily Search |
| `EXA_API_KEY` | Exa Search |
| `JINA_API_KEY` | Jina AI |
| `KAGI_API_KEY` | Kagi Search |
