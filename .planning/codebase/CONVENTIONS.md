# Code Conventions

**Analysis Date:** 2026-03-19

## TypeScript Rules

**Strictness:**
- `tsconfig.base.json` uses `"strict": true` with `"noUncheckedIndexedAccess": true`
- Paths aliased: `@oh-my-pi/pi-coding-agent/*` maps to `packages/coding-agent/src/*`, similar for other packages
- Module: `"module": "nodenext"`, `"moduleResolution": "nodenext"`
- Target: `"target": "esnext"`

**Banned TypeScript Features (from `AGENTS.md` and `biome.json`):**
- **No `any`** -- Use `unknown` and narrow with type guards. Biome rule: `noExplicitAny` is enforced as error.
- **No `private`/`protected`/`public` keywords** -- Use `#privateField` syntax for private fields. Biome rule: `noUselessConstructor` enforced.
- **No `ReturnType<>`** -- Spell out return types explicitly.
- **No `class` unless wrapping resources** -- Prefer plain functions and objects. Exception: CLI commands extend `Command` from oclif (`packages/coding-agent/src/commands/*.ts`).
- **No enums** -- Use union types or `as const` objects.
- **No non-null assertions (`!`)** -- Biome rule: `noNonNullAssertion` enforced as error.
- **No `namespace`** keyword.
- **No empty interfaces** -- Biome rule: `noEmptyInterface` enforced.
- **No `arguments`** keyword -- Biome rule: `noArguments` enforced.
- **No `void` type** -- Biome rule: `noConfusingVoidType` enforced.

**Preferred TypeScript Patterns:**
- Use `type` over `interface` for type definitions
- Use discriminated unions for state modeling
- Use `satisfies` for type checking inline objects
- Annotate return types explicitly on exported functions
- Use `unknown` + narrowing, not `any`

## Import Style

**Node builtins -- namespace imports:**
```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
```
Always use the `node:` prefix. Named imports from `node:` modules are NOT used.

**Internal packages -- named imports:**
```typescript
import { findMatch, adjustIndentation } from "@oh-my-pi/pi-coding-agent/patch";
import { logger } from "@oh-my-pi/pi-utils/logger";
import type { Context, Model } from "@oh-my-pi/pi-ai/types";
```

**External dependencies -- named imports:**
```typescript
import { Chalk } from "chalk";
import { describe, expect, test } from "bun:test";
```

**Type-only imports -- use `import type`:**
```typescript
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import type { Context, Model } from "@oh-my-pi/pi-ai/types";
```
Biome rule: `useImportType` enforced as error.

**Import order (enforced via Biome `useImportExtensions` and conventions):**
1. `bun:*` imports
2. `node:*` imports (namespace style)
3. External packages
4. Internal `@oh-my-pi/*` packages
5. Relative imports

**No default exports** in library code. Exception: CLI command files in `packages/coding-agent/src/commands/` use `export default class ... extends Command` (oclif requirement).

**Barrel files:** Used via `index.ts` in directories like `packages/coding-agent/src/tools/index.ts`. Pattern:
```typescript
export { bashTool } from "./bash.js";
export { readTool } from "./read.js";
```
Note the `.js` extension in relative imports (required by `nodenext` resolution).

## Error Handling

**Custom error classes:** Located in `packages/coding-agent/src/tools/tool-errors.ts`:
- `ToolError` -- Base class for tool errors (has `message`, `isExpected`)
- `ToolSoftError` -- Non-fatal, shown to user
- `ToolHardError` -- Fatal, stops execution
- Each takes `message: string` constructor

**Pattern in tool implementations:**
```typescript
try {
  // tool logic
} catch (err) {
  if (isEnoent(err)) {
    return toolResult(`File not found: ${filePath}`, true);
  }
  throw err; // re-throw unexpected errors
}
```

**File system errors:** Use `isEnoent()` from `packages/utils/src/fs-error.ts` to check for ENOENT errors instead of string matching.

**Tool results:** Functions return `toolResult(content, isError)` from `packages/coding-agent/src/tools/tool-result.ts`:
```typescript
return toolResult("Success message", false); // success
return toolResult("Error: file not found", true); // error shown to LLM
```

**Error handling strategy:**
- Catch and wrap expected errors (file not found, permission denied) into user-friendly tool results
- Let unexpected errors propagate (crash fast)
- Never swallow errors silently

## Logging

**Framework:** Custom `logger` from `packages/utils/src/logger.ts`

**Usage pattern:**
```typescript
import { logger } from "@oh-my-pi/pi-utils/logger";

logger.debug("message");
logger.info("message");
logger.warn("message");
logger.error("message");
```

**Rules:**
- `console.log` is banned in production code; Biome rule `noConsole` enforced as warn (some legacy usage exists)
- Use `logger` for all application logging
- Debug logs gated behind log level
- Sensitive data must never be logged

## Bun-Specific Patterns

**Runtime:** Bun (not Node.js). All code runs on Bun.

**File I/O:**
```typescript
await Bun.write(filePath, content);       // Write files
const file = Bun.file(filePath);          // Get file handle
const text = await file.text();           // Read as text
```

**Process spawning:**
```typescript
Bun.spawn(["command", "arg1"], { cwd, env, stdout: "pipe" });
```

**Environment variables:**
```typescript
Bun.env.VARIABLE_NAME  // Not process.env
```

**Sleep:**
```typescript
await Bun.sleep(ms);  // Not setTimeout-based
```

**Which (find executables):**
```typescript
Bun.which("git");
```

**Test framework:** `bun:test` (built-in), not Jest or Vitest:
```typescript
import { describe, expect, test } from "bun:test";
```

**File imports with type attribute:**
```typescript
import content from "./file.txt" with { type: "text" };
```

## File Organization

**Monorepo structure:** Bun workspaces defined in root `package.json`

**Package layout pattern:**
```
packages/<name>/
  src/          # Source code
  test/         # Test files (NOT __tests__, NOT co-located)
  package.json
  tsconfig.json
```

**Key packages:**
- `packages/coding-agent/` -- Main CLI entry point, tools, commands
- `packages/ai/` -- AI provider integrations (Anthropic, OpenAI, Google, etc.)
- `packages/agent/` -- Agent loop abstraction
- `packages/tui/` -- Terminal UI components
- `packages/natives/` -- Native module bindings
- `packages/utils/` -- Shared utilities (logger, fs helpers, etc.)
- `packages/stats/` -- Usage statistics
- `crates/pi-natives/` -- Rust crate for native functionality

**Within `packages/coding-agent/src/`:**
- `tools/` -- Tool implementations (bash, read, grep, edit, write, etc.)
- `commands/` -- CLI commands (oclif `Command` subclasses)
- `context/` -- Context management
- `core/` -- Core logic (python executor, patching, etc.)
- `discovery/` -- Agent/skill/plugin discovery
- `session-manager/` -- Session persistence

## Naming Conventions

**Files:**
- `kebab-case.ts` for all TypeScript files: `bash-executor.ts`, `tool-errors.ts`, `edit-diff.ts`
- Test files: `<name>.test.ts` (never `.spec.ts` in practice, though some exist)
- Barrel files: `index.ts`

**Functions:**
- `camelCase` for all functions: `findMatch()`, `adjustIndentation()`, `computeHashlineDiff()`
- Prefix booleans with `is`/`has`/`should`: `isEnoent()`, `isExpected`, `hasContent`

**Types:**
- `PascalCase` for types, interfaces, enums (though enums are banned): `ToolError`, `Model`, `Context`
- Use `type` keyword, not `interface`

**Constants:**
- `SCREAMING_SNAKE_CASE` for module-level constants: `DEFAULT_FUZZY_THRESHOLD`, `ANTHROPIC_MODEL`
- `camelCase` for local constants

**Variables:**
- `camelCase` throughout
- Destructure objects at point of use

**Test descriptions:**
- `describe` for grouping by feature/function name
- `test` or `it` for individual cases (both used, `test` slightly preferred)
- Descriptive strings: `"finds exact match"`, `"reports multiple occurrences"`

## Anti-Patterns (Explicitly Banned)

From `AGENTS.md` and Biome configuration:

1. **No `any`** -- Use `unknown` with type guards
2. **No `ReturnType<>`** -- Write return types explicitly
3. **No `private`/`protected`/`public`** -- Use `#field` for private
4. **No `class` (except commands/resource wrappers)** -- Functions + objects
5. **No enums** -- Union types or `as const`
6. **No non-null assertions `!`** -- Narrow types properly
7. **No `console.log`** -- Use `logger`
8. **No `arguments` keyword** -- Use rest params
9. **No `void` type annotations** -- Use `undefined` or omit
10. **No `namespace`** -- Use modules
11. **No default exports** (except oclif commands) -- Named exports only
12. **No `.env` file reading in code** -- Use `Bun.env` directly
13. **No hand-written TypeScript interfaces for Rust types** -- Use `ts-rs` with `#[derive(TS)]`
14. **No `process.env`** -- Use `Bun.env`
15. **No barrel `index.ts` re-exports across package boundaries** -- Import specific subpaths

**Biome-enforced rules (partial list):**
- `noExplicitAny`: error
- `noNonNullAssertion`: error
- `useImportType`: error
- `noEmptyInterface`: error
- `noArguments`: error
- `noConfusingVoidType`: error
- `useNodejsImportProtocol`: error (forces `node:` prefix)
- `noUselessConstructor`: error
- `noParameterAssign`: error
- `useNumberNamespace`: error (use `Number.parseInt` not `parseInt`)
- `noConsole`: warn

**Formatting (Biome):**
- Tab indentation (not spaces)
- Double quotes for strings
- 120 character line width
- Trailing commas
- Semicolons always
