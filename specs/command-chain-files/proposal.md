## Why

Slash commands currently come only from Markdown prompt files, even though the fork needs a declarative way to define prompt chains. Adding a companion command-file format lets command authors define simple chained commands without writing TypeScript, while keeping discovery, naming, and hot reload aligned with the existing command-file flow.

## What Changes

- Add a new `.cmd.yaml` slash-command file type that lives alongside existing `.md` command files in the same command directories.
- Derive the generated command name from the filename stem (for example, `foo.cmd.yaml` registers `/foo`).
- Define a minimal schema for `.cmd.yaml` files with:
  - `description: string`
  - `steps: string[]`
- Validate `.cmd.yaml` files at load time using the repository's existing TypeBox + Ajv direction.
- Materialize valid `.cmd.yaml` files into registered slash commands by routing them through a prompt-chain runtime in the shared file-command execution path. In multi-block submissions, prompt-chain commands are supported only when they are the final renderable block; earlier prompt-chain blocks are a non-fatal user error.
- Treat malformed `.cmd.yaml` files and same-directory duplicate command names as non-fatal load problems.
- Surface command-file load problems to the user as combined chat warnings at startup and on every slash-command reload cycle.
- Keep `.md` files authoritative over `.cmd.yaml` when both define the same command name in the same directory.

## Capabilities

### New Capabilities
- `command-chain-files`: Declarative `.cmd.yaml` slash-command files that register prompt-chain commands without new TypeScript code.

### Modified Capabilities
- `slash-command-loading`: Built-in-provider slash-command discovery now loads both `.md` and `.cmd.yaml` files from the standard OMP command directories, validates command-chain files, and preserves non-fatal load warnings through the slash-command refresh path.
- `slash-command-live-reload`: Runtime command refresh now emits combined command-file warning blocks during both initial load and hot reload.
- `slash-command-collision-handling`: Same-directory collisions between command files become explicit non-fatal warnings, with `.md` winning over `.cmd.yaml` in that directory.

## Impact

- Affected code is centered in `packages/coding-agent/src/danger-pi/*`, with thin hooks in existing slash-command discovery/loading and interactive refresh paths.
- Valid `.cmd.yaml` files depend on a new prompt-chain runtime plus the existing command-directory discovery/hot-reload mechanics.
- Validation follows existing repository tooling (`@sinclair/typebox` + `ajv`) instead of introducing a new schema library.
- User-visible behavior changes in interactive sessions: command-file errors appear as chat warnings with raw-ish validation details, but do not enter session history or agent-visible conversation context.
