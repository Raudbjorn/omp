# Testing

**Analysis Date:** 2026-03-19

## Framework & Runner

**Runner:** Bun's built-in test runner (`bun:test`)
- No Jest, Vitest, or other external test framework
- Config: None required -- Bun discovers `*.test.ts` files automatically
- Assertion library: `expect` from `bun:test` (Jest-compatible API)

**Import pattern (every test file):**
```typescript
import { describe, expect, test } from "bun:test";
// or
import { describe, expect, it } from "bun:test";
```

Both `test` and `it` are used; `test` appears slightly more common in newer files.

**Run Commands:**
```bash
bun test                          # Run all tests in current package
bun test test/bash-executor.test.ts  # Run specific test file
bun test --filter "pattern"       # Filter tests by name
```

**Package-level scripts (from `packages/coding-agent/package.json`):**
```bash
bun run test           # Run tests for the package
```

**Root-level (from root `package.json`):**
```bash
bun run test           # Run all workspace tests
```

## Test File Organization

**Location:** Tests live in a dedicated `test/` directory alongside `src/`, NOT co-located:
```
packages/<name>/
  src/           # Source code
  test/          # All test files
    fixtures/    # Test fixtures (where needed)
    tools/       # Subdirectory mirroring src structure
    utilities.ts # Shared test helpers
```

**Naming:** `<feature-name>.test.ts` using kebab-case:
- `packages/coding-agent/test/bash-executor.test.ts`
- `packages/coding-agent/test/edit-diff.test.ts`
- `packages/coding-agent/test/memory-contract.test.ts`
- `packages/ai/test/anthropic-alignment.test.ts`
- `packages/tui/test/markdown.test.ts`

**Subdirectories mirror source structure:**
- `packages/coding-agent/test/tools/` -- Tests for `src/tools/`
- `packages/coding-agent/test/core/` -- Tests for `src/core/`
- `packages/coding-agent/test/discovery/` -- Tests for `src/discovery/`
- `packages/coding-agent/test/session-manager/` -- Tests for `src/session-manager/`
- `packages/coding-agent/test/internal-urls/` -- Tests for internal URL protocols
- `packages/coding-agent/test/plan-mode/` -- Tests for plan mode features

**Scale:** ~220+ test files across the monorepo:
- `packages/coding-agent/test/` -- ~170 test files (bulk of testing)
- `packages/ai/test/` -- ~60 test files
- `packages/tui/test/` -- ~18 test files
- `packages/agent/test/` -- 2 test files
- `packages/utils/test/` -- 3 test files
- `packages/natives/test/` -- 1 test file

## Test Patterns & Examples

**Basic structure:**
```typescript
import { describe, expect, test } from "bun:test";
import { myFunction } from "../src/my-module.js";

describe("myFunction", () => {
  test("handles basic input", () => {
    const result = myFunction("input");
    expect(result).toBe("expected");
  });

  test("handles edge case", () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

**Nested describe blocks for grouping:**
```typescript
describe("BashExecutor", () => {
  describe("execute", () => {
    test("runs simple command", async () => { ... });
    test("handles timeout", async () => { ... });
  });
  
  describe("validation", () => {
    test("rejects empty commands", () => { ... });
  });
});
```

**Contract tests (common pattern):**
Test files like `rpc-compatibility-contract.test.ts` and `memory-contract.test.ts` verify API contracts. These are named with a `-contract` suffix to signal their intent: they guard against breaking changes to public-facing interfaces.

**Snapshot-like assertions:**
No `toMatchSnapshot()` usage detected. Instead, explicit string/structure matching:
```typescript
expect(result).toEqual({
  type: "text",
  content: "expected content",
});
```

**Async testing:**
```typescript
test("async operation", async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

**Error testing:**
```typescript
test("throws on invalid input", () => {
  expect(() => riskyFunction()).toThrow("expected message");
});

test("async error", async () => {
  await expect(asyncRiskyFunction()).rejects.toThrow();
});
```

**Environment variable manipulation (common pattern):**
```typescript
async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, Bun.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = value;
      }
    }
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = value;
      }
    }
  }
}
```
This `withEnv` helper appears in multiple test files (e.g., `packages/ai/test/anthropic-alignment.test.ts`). Use it for any test that modifies environment variables.

## Fixtures & Test Data

**Location:** `packages/coding-agent/test/fixtures/`

**Types of fixtures:**
- Text files with sample content for tool testing
- Configuration fixtures for context/session tests
- Inline fixtures defined as constants within test files (most common approach)

**Inline fixture pattern (preferred):**
```typescript
const ANTHROPIC_MODEL: Model<"anthropic-messages"> = {
  id: "claude-sonnet-4-5",
  name: "Claude Sonnet 4.5",
  api: "anthropic-messages",
  provider: "anthropic",
  // ...
};
```

**Test helper module:** `packages/coding-agent/test/utilities.ts`
- Contains shared test utilities and helper functions
- Import as: `import { ... } from "./utilities.js";`

**Virtual terminal for TUI tests:** `packages/tui/test/virtual-terminal.ts`
- `VirtualTerminal` class for rendering tests without a real terminal
- Used in markdown, editor, and input tests

**Theme fixtures for TUI:** `packages/tui/test/test-themes.ts`
- `defaultMarkdownTheme` and similar theme objects for deterministic rendering

## Mocking Approach

**Philosophy:** Minimal mocking. The codebase avoids heavy mock usage.

**Bun mock/spy API (when needed):**
```typescript
import { mock, spyOn } from "bun:test";

// Spy on a method
const spy = spyOn(object, "method");
expect(spy).toHaveBeenCalledWith(args);

// Mock a function
const mockFn = mock(() => "mocked value");
```

**What is mocked:**
- External API calls (HTTP responses from AI providers)
- File system operations in some tool tests
- Environment variables (via `withEnv` helper above, not via mocks)

**What is NOT mocked:**
- Internal module interactions -- test through the public API
- Data transformations -- use real inputs/outputs
- Utility functions -- call them directly

**No mock frameworks (no `jest.mock`, no `sinon`):** Uses only `bun:test` built-in `mock()` and `spyOn()`.

**AbortSignal pattern (common in AI tests):**
```typescript
function createAbortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}
```

## CI Integration

**CI system:** GitHub Actions

**Workflow file:** `.github/workflows/ci.yml`

**CI pipeline includes:**
1. **Lint check:** `bun run biome:ci` -- Runs Biome linting/formatting checks
2. **TypeScript check:** `bun run tsc` -- Full type checking across the monorepo
3. **Test run:** `bun test` -- Runs all test suites
4. **Rust checks:** Cargo build/test for `crates/pi-natives/`

**Key CI characteristics:**
- Tests run on every PR and push to main
- Bun version is pinned in CI
- Tests must pass for merge
- No coverage thresholds enforced (no `--coverage` flags in CI)

**Pre-commit checks (local):**
```bash
bun run biome:ci    # Lint + format check
bun run tsc         # Type check
bun test            # Run tests
```

## Test Commands

```bash
# Run all tests in the monorepo
bun test

# Run tests for a specific package
cd packages/coding-agent && bun test

# Run a single test file
bun test packages/coding-agent/test/bash-executor.test.ts

# Run tests matching a pattern
bun test --filter "bash"

# Lint and format check (pre-test)
bun run biome:ci

# Type check (pre-test)
bun run tsc

# Combined pre-merge checks
bun run biome:ci && bun run tsc && bun test
```

## Writing New Tests

**Where to put new tests:**
- For `packages/<pkg>/src/foo.ts` -> create `packages/<pkg>/test/foo.test.ts`
- For `packages/<pkg>/src/tools/bar.ts` -> create `packages/<pkg>/test/tools/bar.test.ts`
- For shared test helpers -> add to `packages/<pkg>/test/utilities.ts`

**Test file template:**
```typescript
import { describe, expect, test } from "bun:test";
// Import the module under test with .js extension
import { myFunction } from "../src/my-module.js";

describe("myFunction", () => {
  test("describes what it does", () => {
    // Arrange
    const input = "test input";

    // Act
    const result = myFunction(input);

    // Assert
    expect(result).toBe("expected output");
  });

  test("handles edge case", () => {
    expect(myFunction("")).toBe("");
  });
});
```

**Rules for tests (from `AGENTS.md`):**
- Never modify existing test files -- tests encode human intent
- Tests must be deterministic -- no reliance on real time, network, or environment
- Use `withEnv()` helper for environment variable tests (save and restore)
- Use real inputs/outputs where possible; minimize mocking
- Force color level in TUI tests for deterministic ANSI assertions: `new Chalk({ level: 3 })`
