## Context

Slash-command discovery from the built-in `native` provider currently loads only Markdown files from command directories and turns them into `SlashCommand` capability items. Here, `native` means the provider implemented in `packages/coding-agent/src/discovery/builtin.ts`, which scans the standard OMP command directories such as `<project>/.omp/commands/*.md` and `~/.omp/agent/commands/*.md`. The missing piece is a declarative file format that can sit beside `.md` files, participate in the same discovery and live-reload flow, and materialize prompt chains without adding bespoke TypeScript for each chain.

This fork also has an explicit bias toward small hooks in upstream-owned code and keeping most logic in fork-owned files. That means the implementation should avoid broad rewrites of slash-command discovery or UI plumbing. The best-fit seams are the existing built-in-provider discovery path in `packages/coding-agent/src/discovery/builtin.ts`, the slash-command materialization layer in `packages/coding-agent/src/extensibility/slash-commands.ts`, a new fork-owned prompt-chain runtime under `packages/coding-agent/src/danger-pi/command-chain-files/`, and the runtime refresh path in `packages/coding-agent/src/modes/interactive-mode.ts`.

A second constraint is user-visible error reporting. Command-file problems must be visible with full detail, but they must not enter session history or the agent-visible prompt. The existing `showWarning(...)` path appends warning text directly to the interactive chat container or `stderr` in backgrounded mode, and those warnings are not reconstructed from session state.

### Current APIs and behaviors that implementation will touch

#### Built-in-provider slash-command discovery
- `builtin.ts` defines `async function loadSlashCommands(ctx): Promise<LoadResult<SlashCommand>>`.
- For each config dir from `getConfigDirs(ctx)`, it computes `commandsDir = path.join(dir, "commands")` and calls `loadFilesFromDir(...)` with `extensions: ["md"]`.
- The current transform builds `SlashCommand` items with:
  - `name`
  - `path`
  - `content`
  - `level`
  - `_source`
- `LoadResult<T>` is `{ items: T[]; warnings?: string[] }`.
- `loadFilesFromDir(...)` takes a single `transform(name, content, path, source)` callback. It does not support per-extension transforms, so `.cmd.yaml` support must be added by calling it separately or by replacing the provider's current one-format path with a custom directory loader.

#### Capability merge and precedence
- `slashCommandCapability` uses `cmd.name` as the deduplication key.
- `loadCapability(...)` aggregates provider warnings, then deduplicates with `first wins = highest priority` semantics.
- Same-directory duplicate handling does not exist today; the capability system only sees flattened command items keyed by name.
- The spec must therefore describe cross-provider precedence as `highest-priority-provider-wins`, not `last-provider-wins`.

#### File slash-command materialization and execution
- `extensibility/slash-commands.ts` currently defines:
  - `interface FileSlashCommand { name; description; content; source; _source? }`
  - `async function loadSlashCommands(options): Promise<FileSlashCommand[]>`
  - `async function expandSlashCommand(text, fileCommands, { cwd }): Promise<string>`
- `loadSlashCommands(...)` currently consumes `loadCapability<SlashCommand>(...)`, materializes only `result.items`, and drops `result.warnings`.
- `AgentSession.prompt(text, options)` currently handles file slash commands by calling `expandSlashCommand(text, this.#slashCommands, { cwd })`, then treating the result as prompt text.
- `modes/controllers/multi-block-runner.ts` uses the same `expandSlashCommand(...)` path for file commands in multi-block submissions.
- `InteractiveMode.refreshSlashCommandState()` calls `loadSlashCommands(...)`, uses the result to populate autocomplete entries, and stores them via `session.setSlashCommands(fileCommands)`.

#### Existing helpers relevant to prompt-chain execution
- `parseCommandArgs(argsString)` splits a slash-command argument string into positional arguments.
- `substituteArgs(template, args)` applies `$1`, `$2`, `$@`, `$@[start:length]`, and `$ARGUMENTS` substitutions.
- `renderPromptTemplate(template, context)` performs prompt-template rendering with a context object.
- There is currently no built-in file-command runtime for deferred prompt chains. That runtime must be introduced by this feature.

#### Session/runtime surfaces available to a file-command implementation
- `AgentSession.prompt(text)` already routes prompt text through normal slash-command and prompt-template expansion, queueing, and turn-start behavior.
- `AgentSession.subscribe(listener)` exposes live `AgentSessionEvent`s, including `agent_end`.
- `showWarning(...)` writes directly to the UI chat transcript, or to `stderr` in backgrounded mode.
- `rebuildChatFromMessages()` clears the chat and reconstructs from `session.buildDisplaySessionContext()`. Warning lines appended through `showWarning(...)` are therefore ephemeral and not session-backed.

#### Refresh paths that must emit warning blocks
- Startup calls `refreshRuntimeCommandState()`.
- OMP live reload also calls `refreshRuntimeCommandState()`.
- `refreshRuntimeCommandState()` calls `refreshSlashCommandState()`.
- Manual plugin reload in `builtin-registry.ts` calls `refreshSlashCommandState()` directly.
- Therefore command-file warning emission must live in `refreshSlashCommandState()` or a helper that it always invokes, not only in `refreshRuntimeCommandState()`.

#### Recommended fork-owned module split
To keep the shared-file diff small and give a junior implementor obvious homes for each piece of behavior, the new code should be split into small fork-owned modules under `packages/coding-agent/src/danger-pi/`.

Recommended layout:
- `danger-pi/command-chain-files/schema.ts`
  - exports the TypeBox schema for `.cmd.yaml`
  - exports the static TypeScript type derived from that schema
- `danger-pi/command-chain-files/load.ts`
  - scans one `commands` directory
  - loads `.md` candidates and `.cmd.yaml` candidates
  - parses YAML
  - validates `.cmd.yaml`
  - resolves same-directory duplicates
  - returns `LoadResult<SlashCommand>` plus warning strings
- `danger-pi/command-chain-files/runtime.ts`
  - contains the reusable prompt-chain runtime core
  - contains the session-backed adapter used by file commands
  - renders queued steps just-in-time when they are about to be dispatched, not when the command is first invoked
- `danger-pi/command-chain-files/render-warning.ts`
  - normalizes load problems into `{ commandName, filePath, messages[] }`
  - renders the combined grouped warning block used by `showWarning(...)`

This exact file naming is not mandatory, but the responsibilities should remain split this way so each part stays small and testable.

## Goals / Non-Goals

**Goals:**
- Add a `.cmd.yaml` command-file format that is discovered anywhere native `.md` command files are discovered today.
- Keep command naming filename-driven so `foo.cmd.yaml` always maps to `/foo`, even when the file contents are invalid.
- Implement one prompt-chain runtime shared by all `.cmd.yaml` commands instead of scattering queue logic across call sites.
- Validate `.cmd.yaml` files using the repository's existing TypeBox + Ajv approach.
- Preserve non-fatal problems (schema errors and same-directory duplicate names) through the command-loading pipeline so they can be emitted as combined warning blocks.
- Emit combined warning blocks on both initial load and reload, with no dedupe, and keep them out of agent/session context.
- Keep same-directory `.md` files authoritative over `.cmd.yaml` files when they share the same command name.
- Concentrate parsing, validation, duplicate handling, and warning rendering in fork-owned `danger-pi` code, with minimal hooks elsewhere.

**Non-Goals:**
- Supporting nested command schemas, per-step metadata, conditional execution, or any `.cmd.yaml` behavior beyond `description` and `steps`.
- Changing how existing `.md` slash commands are authored or expanded.
- Introducing a new validation library such as Zod.
- Persisting command-file diagnostics in session history, replaying them on chat rebuild, or making them visible to the model.
- Changing cross-provider precedence away from the current highest-priority-provider-wins behavior.

## Decisions

### 1. Add a fork-owned command-directory loader and keep the builtin provider as the hook point

The built-in `native` provider in `builtin.ts` remains the place that answers "what slash commands exist in the standard OMP command directories," but the heavy lifting for `.cmd.yaml` lives in fork-owned code. The provider will delegate each `commands` directory to a helper in `packages/coding-agent/src/danger-pi/*` that:
- scans `.md` and `.cmd.yaml` siblings in one directory
- parses YAML and validates `.cmd.yaml`
- derives command names from filenames
- records non-fatal problems
- resolves same-directory collisions with `.md` precedence
- returns `LoadResult<SlashCommand>`-compatible items plus warning strings

This should replace the current one-line `loadFilesFromDir(... extensions: ["md"])` usage for native commands, because `loadFilesFromDir(...)` only supports one transform callback and cannot express mixed `.md` vs `.cmd.yaml` parsing cleanly.

Why this over teaching `loadFilesFromDir(...)` about mixed formats or rewriting capability loading generically?
- It keeps the new behavior local to the built-in provider's command loading instead of making discovery helpers carry fork-specific command semantics.
- It matches the fork's preference for thin hooks in shared files and most logic in fork-owned files.
- It avoids changing other providers that already have their own `.md`-only command rules.

Alternative considered: make `loadFilesFromDir(...)` support multiple transforms by extension. Rejected because it would spread command-chain-specific behavior into a generic helper and increase the shared diff against upstream.

### 2. Use TypeBox + Ajv for `.cmd.yaml` schema validation, and Bun YAML for parsing

The `.cmd.yaml` schema should be expressed with `@sinclair/typebox`, validated with `ajv`, and parsed with `YAML.parse` from `bun`.

Schema:
- `description: string`
- `steps: string[]`

Validation should follow the repository's existing local-encapsulation pattern:
- create a feature-local Ajv validator
- collect Ajv `ErrorObject[]`
- render raw-ish messages in the existing config/tool style (`instancePath` + `message`)

Why this over Zod?
- TypeBox + Ajv is the repository's established validation stack.
- Bun YAML is already the in-repo parser used for YAML configuration.
- Raw-ish Ajv output already matches the user's preference for error fidelity.

Alternative considered: Zod for authoring ergonomics. Rejected because it would create a new validation direction in a codebase already standardized on TypeBox + Ajv.

### 3. Split file slash commands into prompt-template commands and prompt-chain commands

Current file slash commands are prompt-text expansions only: `AgentSession.prompt(...)` and `multi-block-runner.ts` both route them through `expandSlashCommand(...)`, which returns a string. That path cannot queue deferred prompts while remaining string-only.

Implementation should make this explicit by changing file-command representation from one shape into a tagged union or equivalent two-variant model:
- template command: existing Markdown prompt-expansion behavior
- prompt-chain command: `.cmd.yaml` behavior carrying `stepTemplates`

Recommended in-memory shape:
- template command: `{ kind: "template", name, description, content, source, _source? }`
- prompt-chain command: `{ kind: "prompt-chain", name, description, stepTemplates, source, _source? }`

Then replace the current `expandSlashCommand(...)`-only execution assumption with a higher-level resolver in `extensibility/slash-commands.ts`, for example:
- `executeFileSlashCommand(text, fileCommands, runtime): Promise<{ kind: "text"; text: string } | { kind: "handled" }>`

Behavior:
- template command → same output as current `expandSlashCommand(...)`
- prompt-chain command → hand off to the prompt-chain runtime, return `{ kind: "handled" }`

Call sites that must switch to that higher-level resolver:
- `AgentSession.prompt(...)`
- `modes/controllers/multi-block-runner.ts` (with the locked final-renderable-block-only rule for prompt-chain commands)

The execution contract for a prompt-chain command must be explicit:
1. Parse the command arguments with the same helper used today for slash commands (`parseCommandArgs(argsString)`).
2. Store the original `stepTemplates` plus the parsed `args` on a chain object. Do **not** render all steps up front.
3. Start the chain immediately by dispatching step index `0` through the prompt-chain runtime.
4. Keep the remaining step templates queued.
5. After each later completed turn (`turn_end` in the session runtime), dispatch exactly one more queued step from the head chain.

There is one locked exception for multi-block submissions. The current multi-block architecture only turns the final renderable block into agent-visible prompt content; earlier text blocks are transcript-only custom messages. Because of that, prompt-chain commands in multi-block submissions are supported only when they are the final renderable block. If a prompt-chain command appears before later renderable blocks, the command runner must show an error and stop processing that submission instead of guessing at reordered semantics.

That immediate first-step kickoff is required. Without it, `/foo` executed from an idle session would only enqueue the chain and nothing would happen until some unrelated later turn ended.

Just-in-time rendering is also required. Steps must be rendered only when they are about to be dispatched. Pre-rendering all steps when the command first runs is incorrect because later steps should reflect the prompt-template environment at the time they are sent, not the environment from the initial invocation moment.

Recommended in-memory shape:

```typescript
type QueuedChainState = {
	commandName: string;
	stepTemplates: string[];
	args: string[];
	nextStepIndex: number;
};
```

Recommended render helper:

```typescript
function renderQueuedChainStep(template: string, args: string[]): string {
	const argsText = args.join(" ");
	const substituted = substituteArgs(template, args);
	return renderPromptTemplate(substituted, { args, ARGUMENTS: argsText, arguments: argsText });
}
```

Dispatch rule:
- look up `chain.stepTemplates[chain.nextStepIndex]`
- render that one template just before dispatch
- call `runtime.prompt(renderedStep)`
- only after `runtime.prompt(...)` succeeds, increment `nextStepIndex`
- if `nextStepIndex === stepTemplates.length`, remove the chain from the queue

Concrete pseudocode for the desired behavior:

```python
def execute_queued_chain(command_text, runtime):
    args = parse_command_args(command_text)
    chain = Chain(
        command_name=command.name,
        step_templates=command.step_templates,
        args=args,
        next_step_index=0,
    )
    runtime.enqueue(chain)

    runtime.dispatch_next_step(chain)
    return handled
```

And for later turns:

```python
def on_agent_end():
    while queue.head and queue.head.is_finished():
        queue.pop_head()

    chain = queue.head
    if not chain:
        return

    runtime.dispatch_next_step(chain)

    if chain.is_finished():
        queue.pop_head()
```

`dispatch_next_step(chain)` must use the same rule for both the first step and deferred steps: if `runtime.prompt(renderedStep)` throws, do not increment `nextStepIndex`. The failed step stays current and should retry the next time the runtime decides to dispatch it.

Why this over generating synthetic Markdown bodies from `.cmd.yaml` files?
- Queued prompt chains are behaviorally different from one-shot prompt expansion.
- The current execution path is string-only and would erase the distinction.
- A tagged union keeps autocomplete and registry behavior shared while making execution semantics explicit.

Alternative considered: create a separate command registry for chain files. Rejected because it would split autocomplete, command lookup, and reload logic.

### 4. Introduce a dedicated prompt-chain runtime with just-in-time rendering

Implementation should add a fork-owned prompt-chain runtime. The runtime only needs two capabilities from the surrounding system:
- subscribe to the event fired after a completed turn (`turn_end` in `AgentSession`)
- submit prompt text

The session-backed adapter should use:
- `session.subscribe(listener)` and trigger the handler when `event.type === "agent_end"`
- `session.prompt(text)` for prompt submission

The runtime should be small enough that a junior engineer can reason about it in one read. It should not know anything about:
- slash-command discovery
- `.cmd.yaml` file loading
- interactive mode
- autocomplete

It should only know:
- how to hold FIFO chains
- how to kick off the first step immediately
- how to render one step just-in-time before dispatch
- how to prompt one deferred step per `agent_end`
- how to leave a failed step in place for retry

Recommended runtime interface:

```typescript
interface PromptChainRuntimeHost {
	onAgentEnd(handler: () => Promise<void>): void;
	prompt(text: string): Promise<void>;
}

interface PromptChainExecutor {
	execute(commandName: string, stepTemplates: readonly string[], argsString: string): Promise<void>;
}
```

Recommended responsibilities:
- `createPromptChainExecutor(host)`
  - owns the FIFO queue
  - installs one `onAgentEnd` listener lazily
  - parses args once at command invocation time
  - stores templates and args on the queued chain state
  - renders each step only when `dispatch_next_step(...)` is called
  - exposes `execute(commandName, stepTemplates, argsString)`
- file-command execution
  - calls `PromptChainExecutor.execute(...)`

This matters because it keeps one source of truth for chain behavior. The junior implementor should not duplicate queue logic in multiple command paths.

Two subtle requirements:
1. The `agent_end` listener must be installed only once per executor instance.
2. Empty finished chains at the head of the queue must be skipped before attempting the next deferred step.

Recommended dispatch helper pseudocode:

```python
def dispatch_next_step(chain):
    template = chain.step_templates[chain.next_step_index]
    rendered = render_step(template, chain.args)
    runtime.prompt(rendered)
    chain.next_step_index += 1
```

The increment happens only after `runtime.prompt(rendered)` succeeds.

Why this over storing pre-rendered strings in the queue?
- Pre-rendering captures the wrong time boundary.
- Later steps should render against the prompt-template environment at dispatch time.
- Keeping templates plus parsed args in the queue is the smallest representation that preserves correct behavior.

Alternative considered: pre-render all steps at invocation time. Rejected because it is behaviorally incorrect for queued prompts.

### 5. Keep duplicate handling local to one command directory; `.md` wins within that directory

When two files in the same command directory resolve to the same command name, that is a non-fatal load problem. The warning should be grouped under the command name, list both files explicitly, and identify the selected winner. If one file is `.md` and the other is `.cmd.yaml`, `.md` wins. If additional same-directory duplicate cases arise, the loader should still pick one deterministically and report the ambiguity.

This rule applies only within one directory scan, before capability deduplication. After the directory-local winner is chosen, normal capability precedence remains unchanged (`highest-priority-provider-wins`, keyed by `cmd.name`).

Why this over suppressing both files or changing global precedence?
- The user wants cross-provider precedence to remain unchanged.
- Suppressing both files would make a local authoring mistake remove an otherwise usable command.
- `.md` precedence preserves existing behavior for legacy commands when a `.cmd.yaml` sibling is introduced accidentally.

Alternative considered: treat same-directory duplicates as fatal and load neither. Rejected because the requested behavior is explicitly non-blocking.

### 6. Preserve command-load warnings through slash-command loading and emit them once per load cycle from `refreshSlashCommandState()`

The current `loadSlashCommands(...)` helper drops capability warnings and returns only `FileSlashCommand[]`. That boundary should be widened so the runtime refresh path can receive both commands and warnings, for example:
- `loadSlashCommands(...) => Promise<{ commands: FileSlashCommand[]; warnings: string[] }>`

`InteractiveMode.refreshSlashCommandState()` should then:
- load commands and warnings
- update autocomplete
- call `session.setSlashCommands(commands)`
- emit one combined `showWarning(...)` block if `warnings.length > 0`

The implementation order inside `refreshSlashCommandState()` matters:
1. Load commands and warnings.
2. Replace autocomplete entries from the new command set.
3. Store the new file-command set on the session.
4. Emit the warning block.

Doing it in this order ensures that if the user immediately retries the command after reading the warning, the newly loaded valid commands are already active.

The warning payload should:
- start with `Command file errors:`
- group entries by command name
- include file paths under each command name
- include raw-ish validation details or duplicate-file details

Expected warning shape:

```text
Command file errors:

foo
  - /abs/path/to/foo.cmd.yaml
    - /description: must be string
    - /steps/0: must be string

bar
  - duplicate command files in same directory:
    - /abs/path/to/bar.md
    - /abs/path/to/bar.cmd.yaml
    - using /abs/path/to/bar.md
```

Parse failures must use the same grouped format. Even if the YAML is syntactically invalid, the command name still comes from the filename, so the warning block can still group that problem under `foo`.

This emission point is chosen because all relevant load cycles reach it:
- startup via `refreshRuntimeCommandState()`
- OMP live reload via `refreshRuntimeCommandState()`
- manual plugin reload via direct `refreshSlashCommandState()` call

Why emit from this path instead of directly from discovery?
- Discovery can happen in multiple contexts; interactive mode owns the user-visible chat surface.
- Emitting once after the full warning set is known naturally produces the combined block the user wants.
- It covers both full runtime refresh and slash-command-only refresh paths.

Alternative considered: use hook widgets above the editor. Rejected because the user wants higher-fidelity warnings than that compact surface is suited for.

### 7. Do not persist or reconstruct command-file warnings

Warnings should use `showWarning(...)`, which:
- appends directly to `chatContainer`
- writes to `stderr` when backgrounded
- does not create session entries
- is not included in `session.buildDisplaySessionContext()`

That keeps these diagnostics out of model-visible context and ensures they disappear on chat rebuild or session reload unless a fresh load cycle emits them again.

Why this over storing warnings in session state?
- The user explicitly wants these to be runtime diagnostics, not part of the session.
- Session-backed warnings would leak into replayed history and risk polluting the agent-visible context.
- The startup + reload emission requirement already provides enough visibility without persistence.

Alternative considered: add a dedicated persisted warning section to session context. Rejected because it violates the desired separation between UI diagnostics and conversation state.

## Risks / Trade-offs

- [Warning blocks can be repetitive across repeated reloads] → This is intentional. Emit one combined block per load cycle and keep the text structured so repeat occurrences are readable.
- [Widening `loadSlashCommands(...)` to preserve warnings touches shared code] → Keep the interface change small and focused on carrying warnings forward; put parsing/validation/collision logic in fork-owned helpers.
- [File-command execution is currently string-only] → Make the execution split explicit with a tagged union and a higher-level file-command executor instead of trying to hide queued behavior inside string expansion.
- [Prompt-chain code currently depends on extension-oriented APIs] → Extract a runtime core with only `onAgentEnd` and `prompt`, then keep the extension factory as a wrapper.
- [Raw Ajv output is precise but less friendly] → Preserve it because fidelity is preferred for this feature and the grouped warning block provides enough structure around the raw details.
- [Local duplicate handling adds a new precedence rule] → Limit the rule strictly to same-directory collisions and document that global provider precedence is unchanged.

## Migration Plan

1. Introduce the fork-owned schema, parser, duplicate resolver, prompt-chain runtime, and warning renderer for `.cmd.yaml` command files.
2. Hook the native command discovery provider to call the new directory loader for each command directory while preserving its `LoadResult<SlashCommand>` output shape.
3. Expand `FileSlashCommand` into explicit template vs prompt-chain variants and replace the string-only file-command execution path with a higher-level resolver used by both `AgentSession.prompt(...)` and multi-block execution, where multi-block prompt-chain support is limited to final renderable blocks.
4. Extend slash-command loading to carry warnings alongside materialized commands.
5. Update `InteractiveMode.refreshSlashCommandState()` to emit one combined warning block per load cycle.
6. Add focused tests covering valid `.cmd.yaml` loading, schema validation failures, same-directory duplicate handling, warning grouping, file-command execution, and startup/reload emission.

Recommended implementation order for a junior engineer:
1. Build and test the fork-owned directory loader first.
2. Build and test the reusable prompt-chain runtime second.
3. Change `FileSlashCommand` into explicit variants and add the higher-level executor.
4. Switch `AgentSession.prompt(...)` to the higher-level executor.
5. Switch `multi-block-runner.ts` to the same executor.
6. Finally, carry warnings through `loadSlashCommands(...)` and emit them from `refreshSlashCommandState()`.

This order minimizes confusion because each step builds on one already-tested abstraction instead of changing discovery, execution, and UI warning behavior all at once.

Rollback strategy:
- Remove the `.cmd.yaml` loader hook from native command discovery.
- Remove the prompt-chain variant and higher-level file-command executor.
- Revert slash-command warning plumbing.
- Existing `.md` commands continue to function unchanged because the new format is additive and `.md` remains authoritative within same-directory collisions.

## Open Questions

None currently open after code review. The spec now reflects the verified repository APIs, corrected precedence semantics, and the required execution/refactor seam for file-based queued commands.