# Fork feature port plan (L2b)

Branch: rebuild/upstream-elikoga-fork. Port in dependency order, build-gate each.

NOTE: multi-block <-> execute-intent-paste are CIRCULAR — port as one unit.

base=True features already have an upstream/elikoga version — verify the fork-specific delta before porting.

## multi-block  [moderate, embedded, base=False]
deps: execute-intent-paste

Multi-block enables stacking slash commands, shortcut blocks (! !$ $$), and text in a single submission while preserving author order in the transcript. The feature is embedded across session/messages (two new MULTI_BLOCK_* constants), input-controller (calls runMultiBlockSubmission), and six new files for submission parsing/execution logic. Core entry point is input-controller's multi-block check before normal submission; fork-owned policy logic (command-policy.ts) classifies commands as skill/builtin-btw/file/unsupported. Hard dependency: execute-intent-paste supplies EditorSubmitMetadata with lineIntents array used by splitSubmissionIntoBlocks. Integration risk: input-controller undergoes substantial refactoring (imports, submission flow), ui-helpers gains custom message rendering for MULTI_BLOCK_* types, tree-selector uses new getCustomMessageLabel/formatCustomMessageSummary helpers. Extraction is pure-additive for new files + type additions to messages.ts, but intermingled with upstream changes in input-controller, ui-helpers, types.ts, builtin-registry, and agent-session sendCustomMessage API.

files:
  - /home/svnbjrn/omp/packages/coding-agent/src/session/messages.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/input-controller.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/components/message-labels.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/multi-block-runner.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/submission-blocks.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/multi-block/command-policy.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/multi-block/live-chat-sync.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/multi-block/turn-contributors.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/shortcut-command-executor.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/utils/ui-helpers.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/components/custom-message.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/components/tree-selector.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/types.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/session/agent-session.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/slash-commands/builtin-registry.ts
symbols: MULTI_BLOCK_TEXT_MESSAGE_TYPE, MULTI_BLOCK_COMMAND_MESSAGE_TYPE, runMultiBlockSubmission, splitSubmissionIntoBlocks, classifyMultiBlockCommand, getCustomMessageLabel, formatCustomMessageSummary, SubmissionBlock, MultiBlockRunnerOptions, MultiBlockProcessingResult, syncMultiBlockLiveChat, executeBashShortcut, executePythonShortcut

## execute-intent-paste  [moderate, embedded, base=False]
deps: multi-block

Execute-intent paste adds explicit keyboard shortcut (Ctrl+Shift+Alt+V) to paste clipboard text marked as "exec" intent, allowing it to execute bash/python shortcuts immediately on submit. The feature is intermingled with upstream changes: keybindings.ts replaces pasteTextRaw with pasteExec; input-controller.ts adds the handler method and wires it; submission-blocks.ts is a new file defining line intent parsing (safe vs exec); clipboard.ts refactors text reading. Tests are new (input-controller-exec-paste.test.ts) and submission-blocks tests are added. The feature depends on multi-block submission architecture to propagate lineIntents metadata through the editor to submission parsing, making it moderately difficult to extract—requires porting all of submission-blocks.ts and integrating lineIntents throughout the input handling pipeline.

files:
  - /packages/coding-agent/src/config/keybindings.ts
  - /packages/coding-agent/src/modes/controllers/input-controller.ts
  - /packages/coding-agent/src/modes/controllers/submission-blocks.ts
  - /packages/coding-agent/src/utils/clipboard.ts
  - /packages/coding-agent/test/input-controller-exec-paste.test.ts
  - /packages/coding-agent/test/submission-blocks.test.ts
  - /packages/coding-agent/test/keybindings.test.ts
  - /packages/coding-agent/test/utils/clipboard.test.ts
symbols: handleExecuteIntentPaste, app.clipboard.pasteExec, SubmissionLineIntent, SubmissionLineIntentEntry, readTextFromClipboard, EXECUTE_INTENT_PASTE_UNAVAILABLE_STATUS, startsWithSafePasteIntent, splitSubmissionIntoBlocks

## plan-review-approval  [moderate, embedded, base=False]
deps: multi-block

The feature adds a third plan approval path ("Approve and execute (current session)") alongside existing "Approve and execute" and "Approve and keep context" options. It exits plan mode and queues "Approved" into the current session without starting a fresh execution session, preserving session context. The implementation is cleanly isolated within InteractiveMode, extracting helper methods (#finalizeApprovedPlan, #submitPlanReviewInput) to reduce duplication. The feature depends on existing methods (setActiveToolsByName, renameApprovedPlanFile) and plan-mode infrastructure already on HEAD. The embedded nature stems from changes interspersed throughout the handleExitPlanModeTool method alongside other plan review logic, though changes are algorithmic rather than structural conflicts.

files:
  - packages/coding-agent/src/modes/interactive-mode.ts
  - packages/coding-agent/test/interactive-mode-plan-review.test.ts
symbols: InteractiveMode#approvePlanInCurrentSession, InteractiveMode#finalizeApprovedPlan, InteractiveMode#submitPlanReviewInput, InteractiveMode#handleExitPlanModeTool, Approve and execute (current session)

## omp-live-reload  [moderate, standalone, base=False]

Standalone feature with 466 lines added across 9 files. Core implementation in new omp-live-reload.ts module (292 lines) watches .omp root directories for command/skill changes. Integrated into interactive-mode.ts via OmpLiveReloadController instance, adding three public methods (syncOmpLiveReloadState, handleReloadCommand, refreshRuntimeCommandState with omp-specific branching). Settings schema adds commands.liveReloadMode enum (omp|none). Builtin /reload slash command added to builtin-registry.ts. Selector-controller and mcp-command-controller have small integration points for settings changes and reload calls. Pure additive changes with no conflicts with upstream—this is a fork-unique feature for native .omp file watching without affecting existing code paths.

files:
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/omp-live-reload.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/interactive-mode.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/types.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/config/settings-schema.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/slash-commands/builtin-registry.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/selector-controller.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/mcp-command-controller.ts
  - /home/svnbjrn/omp/packages/coding-agent/test/omp-live-reload.test.ts
  - /home/svnbjrn/omp/packages/coding-agent/test/slash-commands/reload.test.ts
symbols: OmpLiveReloadController, OmpLiveReloadMode, OmpLiveReloadState, OmpLiveReloadCallbacks, syncOmpLiveReloadState, refreshRuntimeCommandState, handleReloadCommand, commands.liveReloadMode, /reload

## cmd-yaml-commands  [moderate, mixed, base=False]
deps: omp-live-reload, multi-block

The feature is MISSING from HEAD and must be added from origin/main. It consists of four pure-fork implementation files under danger-pi/command-chain-files/ (schema, load, runtime, render-warning), plus moderate intermingled changes to four upstream-owned integration points: slash-command capability type system (union type with guard functions), builtin discovery (replace .md-only loading with loadCommandChainFilesFromDir), extensibility layer (materialize and execute both template and prompt-chain variants), and agent-session (create PromptChainExecutor and wire it to turn-complete events). The multi-block-runner is new and entirely fork-owned. Test files are pure-additive. Upstream seams are small and localized; risk is low if integrated in order: (1) add schema+load+runtime+render-warning modules, (2) update SlashCommand type union and guards, (3) rewire builtin.ts discovery function, (4) split FileSlashCommand type union and execution in extensibility/slash-commands.ts, (5) add PromptChainExecutor to agent-session, (6) add multi-block-runner, (7) integrate in input-controller and interactive-mode. Spec files describe design rationale and testing strategy.

files:
  - packages/coding-agent/src/danger-pi/command-chain-files/load.ts
  - packages/coding-agent/src/danger-pi/command-chain-files/schema.ts
  - packages/coding-agent/src/danger-pi/command-chain-files/runtime.ts
  - packages/coding-agent/src/danger-pi/command-chain-files/render-warning.ts
  - packages/coding-agent/src/capability/slash-command.ts
  - packages/coding-agent/src/discovery/builtin.ts
  - packages/coding-agent/src/extensibility/slash-commands.ts
  - packages/coding-agent/src/session/agent-session.ts
  - packages/coding-agent/src/modes/controllers/input-controller.ts
  - packages/coding-agent/src/modes/controllers/multi-block-runner.ts
  - packages/coding-agent/src/modes/interactive-mode.ts
  - packages/coding-agent/test/command-chain-files.test.ts
  - packages/coding-agent/test/command-chain-files-integration.test.ts
  - specs/command-chain-files/design.md
  - specs/command-chain-files/proposal.md
symbols: loadCommandChainFilesFromDir, CommandChainFileSchema, CommandChainFile, createPromptChainExecutor, PromptChainExecutor, PromptChainRuntimeHost, renderPromptChainStep, SlashCommand (union type with TemplateSlashCommand | PromptChainSlashCommand), isPromptChainSlashCommand, isTemplateSlashCommand, PromptChainSlashCommand, TemplateSlashCommand, FileSlashCommand (union type), isPromptChainFileSlashCommand, CommandFileProblem

## title-extension  [easy, standalone, base=False]

The /title extension is a standalone bundled extension that registers a single `title` command for manually setting session titles. It has zero dependencies on other fork features. Extract by: (1) copying the new danger-pi/extensions directory with title.ts from origin/main, (2) adding the test file, (3) updating sdk.ts to import and include dangerPiBundledExtensions in inlineExtensions array, (4) updating builtin-registry.ts to import dangerPiBundledBuiltinSlashCommands and merge into the command registry. The utility function setSessionTerminalTitle already exists on HEAD with compatible signature. No conflicts with upstream changes—all changes are purely additive in new danger-pi/ directory.

files:
  - /home/svnbjrn/omp/packages/coding-agent/src/danger-pi/extensions/title.ts
  - /home/svnbjrn/omp/packages/coding-agent/test/danger-pi-title-extension.test.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/danger-pi/extensions/index.ts
symbols: createTitleExtension, dangerPiBundledExtensions

## codex-multi-account  [moderate, embedded, base=True]
deps: auth-broker-gateway

The codex-multi-account feature already exists on HEAD (rebuild/upstream-elikoga-fork). It implements session-sticky OAuth account selection for Codex with intelligent ranking based on usage windows (primary/secondary), Pro-plan entitlement, and priority boost detection for fresh 5-hour windows. Core implementation is in auth-storage.ts with session credential recording (#recordSessionCredential), retrieval (#getSessionCredential), and ranking (#rankOAuthSelections) methods; ranking strategy integrated via codexRankingStrategy from usage/openai-codex.ts. The feature is intermingled with upstream changes—auth-storage.ts has evolved beyond origin/main with additional broker/reset-credit features, making a clean extraction challenging. Tests exist and expect session affinity behavior. No new files needed; integration is pure enhancement to existing auth flow.

files:
  - /home/svnbjrn/omp/packages/ai/src/auth-storage.ts
  - /home/svnbjrn/omp/packages/ai/src/usage/openai-codex.ts
  - /home/svnbjrn/omp/packages/ai/test/auth-storage-codex-selection.test.ts
symbols: #rankOAuthSelections, #getSessionCredential, #recordSessionCredential, getOAuthAccountId, codexRankingStrategy, sessionPreferredIndex, hasOpenAICodexProPlan, #isCredentialBlocked

## assistant-token-line  [moderate, embedded, base=False]

The assistant-token-line feature renders a token usage metadata line below assistant messages when display.showTokenUsage is enabled, showing input/output token counts (dimmed), cache-read count with explicit cached-token icon (error-colored if zero), and elapsed time in d/h/m/s format (error-colored only if cache miss). The feature is embedded: assistant-message.ts and event-controller.ts (key handlers) are heavily refactored with much code removal unrelated to this feature. Extract the new file assistant-usage-format.ts as standalone, then port the specific setUsageInfo/setElapsedTime methods and their callers, plus the formatting call in the updateContent path that conditionally appends the token line at line 221. The settings entry (display.showTokenUsage) already exists on HEAD with minimal schema variation.

files:
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/components/assistant-usage-format.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/components/assistant-message.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/event-controller.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/utils/ui-helpers.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/config/settings-schema.ts
  - /home/svnbjrn/omp/packages/coding-agent/test/assistant-usage-format.test.ts
symbols: formatAssistantUsageMetadata, getElapsedSincePreviousAssistant, setUsageInfo, setElapsedTime, TimedMessageLike, display.showTokenUsage

## shell-interpolation  [easy, standalone, base=False]
deps: multi-block, execute-intent-paste

Shell-interpolation is a standalone feature that adds bang-backtick (!`) shell expression expansion to native (OMP) slash commands and skill bodies after template rendering. The core logic is isolated in the new shell-interpolation.ts module which provides interpolateShellExpressions(). Integration points are clean conditional calls: in expandSlashCommand() for native slash commands (checking _source?.provider === "native"), and in input-controller's handleSkillCommand() checking the isNative flag from SkillCommandBinding. Upstream changes in slash-commands.ts and input-controller.ts are orthogonal refactoring (splitting FileSlashCommand into template vs prompt-chain variants), making the feature straightforward to port as pure-additive: copy the new shell-interpolation.ts, add the conditional interpolateShellExpressions calls at marked integration points, and add the SkillCommandBinding interface to types.ts. No conflict risks with upstream due to clean isolation.

files:
  - packages/coding-agent/src/extensibility/shell-interpolation.ts
  - packages/coding-agent/src/extensibility/slash-commands.ts
  - packages/coding-agent/src/modes/controllers/input-controller.ts
  - packages/coding-agent/src/modes/types.ts
  - packages/coding-agent/src/config/prompt-templates.ts
  - packages/coding-agent/test/shell-interpolation.test.ts
  - packages/coding-agent/test/slash-command-shell-interpolation.test.ts
  - packages/coding-agent/test/input-controller-skill-command.test.ts
symbols: interpolateShellExpressions, ShellInterpolationOptions, expandSlashCommand, executeFileSlashCommand, SkillCommandBinding, renderPromptTemplate, SHELL_INTERPOLATION_TIMEOUT_MS, isNative

## omp-workflow-commands  [moderate, embedded, base=False]
deps: cmd-yaml-commands

The feature consists of two parts: (1) Bundled workflow command files (`.omp/commands/{fix-issues,review-prs,release,triage}.md`) are ALREADY on HEAD via the fork-unique standalone paths added in the latest commit; (2) The infrastructure to load and execute these commands (`danger-pi/command-chain-files/` module + updated `builtin.ts` provider) is NOT on HEAD. Extraction requires: (a) cherry-pick the prompt-chain command loader (commit `4f61cb3fe` or equivalent) which adds `loadCommandChainFilesFromDir()` support, (b) update `packages/coding-agent/src/discovery/builtin.ts` to call `loadCommandChainFilesFromDir()` instead of generic `loadFilesFromDir()` for slash commands, (c) ensure `cmd-yaml-commands` feature (`.cmd.yaml` schema support) is also ported. Risk: The command files are pure-additive, but the loader integration touches the `builtin.ts` provider which also loads other capabilities—test all providers after porting to ensure no regressions.

files:
  - .omp/commands/fix-issues.md
  - .omp/commands/review-prs.md
  - .omp/commands/release.md
  - .omp/commands/triage.md
  - packages/coding-agent/src/danger-pi/command-chain-files/load.ts
  - packages/coding-agent/src/danger-pi/command-chain-files/schema.ts
  - packages/coding-agent/src/danger-pi/command-chain-files/render-warning.ts
  - packages/coding-agent/src/danger-pi/command-chain-files/runtime.ts
  - packages/coding-agent/src/discovery/builtin.ts
symbols: loadCommandChainFilesFromDir, loadSlashCommands, CommandChainFile, PromptChainSlashCommand, fix-issues.md, review-prs.md

## changelog-union-merge  [trivial, config, base=True]

This feature is already present on HEAD (rebuild/upstream-elikoga-fork). The changelog-union-merge includes two config components: (1) .gitattributes line 56 declares `packages/*/CHANGELOG.md merge=union` to auto-merge append-only changelog edits by taking both sides (commit 46f2c9676), and (2) prek.toml forbid-changelog hook (lines 7-12) blocks staged CHANGELOG.md edits with a pre-commit hook error message. Both files are pure-additive config without intermingling upstream changes—the feature is standalone and can be extracted by copying both .gitattributes and prek.toml as-is. No script or code changes required.

files:
  - .gitattributes
  - prek.toml
symbols: merge=union, forbid-changelog, packages/*/CHANGELOG.md

## extension-discovery  [moderate, embedded, base=False]

The extension-discovery feature enables symlinked extension package directories and improves package name derivation. HEAD has partial symlink support (12ef9b11a: discoverLinkedExtensionModuleFiles callback detecting top-level symlinks). Origin/main adds PACKAGE_ENTRY_CONTAINER_DIRS constant and enhanced getExtensionNameFromPath logic that derives the package name from grandparent directory when index.ts/js are nested inside src/dist/build/lib containers. The feature is intermingled: discoverExtensionModulePaths in origin/main uses enhanced glob patterns (globIf function) and synthetic subdirectory matching for symlinks, while test coverage differs (origin/main has consolidated tests for both real and symlinked discovery). Pure-additive extraction requires adding the constant, enhancing getExtensionNameFromPath with three-level path analysis, and updating test assertions.

files:
  - packages/coding-agent/src/discovery/helpers.ts
  - packages/coding-agent/test/extensions-discovery.test.ts
symbols: discoverLinkedExtensionModuleFiles, discoverExtensionModulePaths, getExtensionNameFromPath, PACKAGE_ENTRY_CONTAINER_DIRS

## session-token-tracking  [moderate, mixed, base=False]

The feature splits into two parts: (1) Goals-based token budget tracking (completely new on origin/main, not on HEAD), and (2) Session-link/share enhancements (heavily refactored across collab/ and export/share.ts). The token tracking in SessionStats already exists on HEAD but goal-mode augments it. Session-link involves new write-token encryption and relay protocols. Extraction requires pulling the entire goals/ directory, updating agent-session.ts and session-manager.ts for goal integration callbacks, and modernizing share/collab code for encrypted links and guest permissions.

files:
  - /packages/coding-agent/src/goals/runtime.ts
  - /packages/coding-agent/src/goals/state.ts
  - /packages/coding-agent/src/goals/tools/goal-tool.ts
  - /packages/coding-agent/src/goals/guided-setup.ts
  - /packages/coding-agent/src/session/agent-session.ts
  - /packages/coding-agent/src/session/session-manager.ts
  - /packages/coding-agent/src/collab/host.ts
  - /packages/coding-agent/src/collab/guest.ts
  - /packages/coding-agent/src/collab/protocol.ts
  - /packages/coding-agent/src/collab/crypto.ts
  - /packages/coding-agent/src/export/share.ts
  - /packages/coding-agent/src/slash-commands/builtin-registry.ts
symbols: GoalRuntime, GoalTokenUsage, GoalModeState, SessionStats, getSessionStats, shareSession, CollabHost, CollabGuest, writeTokenBased

## stats-worker-pool  [moderate, embedded, base=True]
deps: session-token-tracking

The feature is present on both HEAD (via HEAD's older approach using workerHostEntry) and origin/main (via the refactored isCompiledBinary approach). The key difference: HEAD uses workerHostEntry() from pi-utils to dispatch workers through the CLI host entrypoint with an argv selector, while origin/main directly passes a literal worker path string to Bun's --compile bundler with isCompiledBinary() conditional logic. The worker pool itself, smoke test, user-behavior metrics parsing, and premium-request tracking are implemented identically. This is a pure refactor—extracting origin/main's version replaces the workerHostEntry dispatch pattern with direct literal-string bundler discovery, which is a straightforward substitution in aggregator.ts and build-binary.ts. No conflicts; worker pool is standalone and orthogonal to other features.

files:
  - /home/svnbjrn/omp/packages/stats/src/aggregator.ts
  - /home/svnbjrn/omp/packages/stats/src/sync-worker.ts
  - /home/svnbjrn/omp/packages/stats/src/db.ts
  - /home/svnbjrn/omp/packages/stats/src/parser.ts
  - /home/svnbjrn/omp/packages/stats/src/user-metrics.ts
  - /home/svnbjrn/omp/packages/stats/src/index.ts
  - /home/svnbjrn/omp/packages/stats/test/priority-premium-requests.test.ts
  - /home/svnbjrn/omp/packages/stats/test/user-metrics.test.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/cli.ts
  - /home/svnbjrn/omp/packages/coding-agent/scripts/build-binary.ts
  - /home/svnbjrn/omp/.github/workflows/ci.shyndman.yml
symbols: smokeTestSyncWorker, syncAllSessions, SyncOptions, SyncProgress, WorkerHandle, createSyncWorker, spawnWorker, dispatch, defaultWorkerCount, isCompiledBinary, computeUserMessageMetrics, UserMessageMetrics, getPriorityPremiumRequests, parseSessionFile, SyncWorkerRequest

## platform-misc  [moderate, mixed, base=False]

The platform-misc feature comprises four interconnected utilities: (1) Persistent per-install ID at ~/.omp/install-id stored outside agent state, generated once and reused via getInstallId() in packages/utils/src/dirs.ts; (2) Logger transport switching via setTransports() API in packages/utils/src/logger.ts for runtime swap between file and console transports used by headless services; (3) Safe spawned-process environment filtering via scrubProcessEnv() in packages/utils/src/procmgr.ts to strip macOS malloc-logging vars before subprocess inheritance; (4) Prompt ASCII replacement preserving HTML comments via replaceCommonAsciiSymbolsOutsideHtmlComments() in packages/utils/src/prompt.ts. The feature is mixed: install-id and logger transport switching are pure-additive (new exports), but the ASCII-replacement and scrubProcessEnv are intermingled with upstream refactorings (embedded within existing functions). Device_id derivation (crypto.createHash SHA256 of account_uuid) in packages/coding-agent/src/session/agent-session.ts is tightly coupled but backward-compatible. No breaking changes; all additions are exports or internal implementations. Tests added in packages/utils/test/install-id.test.ts verify concurrent race handling with O_EXCL file creation. The feature was synced/ported in commit bcc7c246b with additional refinement in 8c33633af (relocated malloc scrubbing to CLI entrypoint to avoid dirs.ts side effects).

files:
  - packages/utils/src/dirs.ts
  - packages/utils/src/logger.ts
  - packages/utils/src/procmgr.ts
  - packages/utils/src/prompt.ts
  - packages/utils/test/install-id.test.ts
  - packages/coding-agent/src/cli.ts
  - packages/coding-agent/src/session/agent-session.ts
symbols: getInstallId, scrubProcessEnv, setTransports, replaceCommonAsciiSymbolsOutsideHtmlComments, deriveDeviceId

## clipboard-native  [moderate, embedded, base=True]
deps: execute-intent-paste

The clipboard-native feature is already substantially present on HEAD. The key difference between HEAD and origin/main involves refactoring of clipboard text reading: origin/main extracts a reusable readClipboardCommand helper and returns Promise<string | null> from readTextFromClipboard (instead of Promise<string>), unifying platform dispatch logic and removing native Windows fallback logic. Rust natives in origin/main also simplify Linux clipboard by removing the persistent OnceLock pattern. On HEAD, readTextFromClipboard uses execSync with fallback logic, while origin/main uses async Bun.spawn with a helper. The test file on origin/main includes the new input-controller-exec-paste.test.ts which tests execute-intent paste, not present on HEAD. This is a refactoring+enhancement that simplifies clipboard text reads and introduces execute-intent paste support.

files:
  - /home/svnbjrn/omp/packages/coding-agent/src/utils/clipboard.ts
  - /home/svnbjrn/omp/crates/pi-natives/src/clipboard.rs
  - /home/svnbjrn/omp/packages/coding-agent/test/utils/clipboard.test.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/modes/controllers/input-controller.ts
  - /home/svnbjrn/omp/packages/coding-agent/src/config/keybindings.ts
symbols: copyToClipboard, readTextFromClipboard, readImageFromClipboard, readTextViaPowerShell, readImageViaPowerShell, copy_to_clipboard, read_image_from_clipboard, ClipboardImage, POWERSHELL_IMAGE_SCRIPT, POWERSHELL_TIMEOUT_MS

## image-gen  [moderate, embedded, base=False]
deps: tool-schema-normalization

The image-gen feature upgrade involves replacing Zod schema builders with @sinclair/typebox Type/StringEnum constructors (tool-schema-normalization dependency), updating OpenRouter image generation to default to `openai/gpt-5.4-image-2` instead of Gemini, removing xAI/Grok support entirely, and critically adding `modalities: ["image", "text"]` and conditional `image_config` (aspect_ratio, image_size) forwarding to OpenRouter requests. Changes are intermingled across all four files—settings schema adds imageOpenRouterModel config entry, prompts markdown formatting updates, test file adds comprehensive modalities/image_config validation, and the main tool refactors OpenRouter request assembly and removes all xAI handling code (~400 LOC net removal). This feature directly depends on tool-schema-normalization being in place first to avoid schema validation conflicts. The extraction is non-trivial due to removal of xAI and schema migration being closely coupled.

files:
  - packages/coding-agent/src/tools/image-gen.ts
  - packages/coding-agent/test/tools/image-gen.test.ts
  - packages/coding-agent/src/config/settings-schema.ts
  - packages/coding-agent/src/prompts/tools/image-gen.md
symbols: resolveConfiguredOpenRouterImageModel, OPENROUTER_IMAGE_MODEL_SETTING, DEFAULT_OPENROUTER_MODEL, imageGenSchema, ImageGenParams, responseModalitySchema, aspectRatioSchema, imageSizeSchema, modalities, image_config

## tool-schema-normalization  [hard, embedded, base=False]
deps: auth-broker-gateway

This is a large embedded feature that normalizes AI tool schemas across Zod/JSON Schema inputs for provider wire-format compatibility (Google Gemini, OpenAI strict mode, Cloud Code Assist Claude, MCP). The core normalization engine in normalize.ts unifies five provider-specific paths (Google/CCA/MCP/OpenAI strict/OpenAI Responses). File tool-call-healing.ts is ABSENT from HEAD but present on origin/main — it must be added during extraction. Stream-markup-healing.ts exists on HEAD with different scope than the origin/main healing; check before porting tool-call-healing. Encoder functions isZodSchema/zodToWireSchema/toolWireSchema normalize Zod emission noise (safe-integer bounds, schema metadata, defaulted property semantics). The feature also encompasses Zod decontamination (zod-decontaminate.ts) to rewrite serialized Zod instances leaking as inputSchema from MCP servers. Auth-broker wire schemas integrate this for credential transport normalization. Provider callsites (anthropic.ts, google-shared.ts, openai-*.ts) have embedded schema-normalization calls; each uses the appropriate dispatcher. The feature is tightly interleaved with upstream and requires careful sequencing: normalize-cca.ts and sanitize-google.ts are deleted (merged into unified normalize.ts), strict-mode.ts is deleted (merged into normalize.ts), and compatibility.ts is heavily edited. Tests are substantial (schema-normalization.test.ts has 50+ cases, schema-wire.test.ts validates Zod emission post-processing, kimi-tool-call-healing.test.ts validates healing state machine). Extraction is harder because most schema normalization logic is rewritten in-place in normalize.ts rather than added as new code. Some light optimizations (epoch-based cycle guard refactoring in stamps.ts) exist on origin/main but not HEAD.

files:
  - packages/ai/src/utils/schema/normalize.ts
  - packages/ai/src/utils/schema/wire.ts
  - packages/ai/src/utils/schema/adapt.ts
  - packages/ai/src/utils/schema/fields.ts
  - packages/ai/src/utils/schema/zod-decontaminate.ts
  - packages/ai/src/utils/schema/CONSTRAINTS.md
  - packages/ai/src/utils/tool-call-healing.ts
  - packages/ai/src/utils/stream-markup-healing.ts
  - packages/ai/src/auth-broker/wire-schemas.ts
  - packages/ai/src/providers/anthropic.ts
  - packages/ai/src/providers/google-shared.ts
  - packages/ai/src/providers/openai-completions.ts
  - packages/ai/src/providers/openai-responses.ts
  - packages/ai/test/schema-normalization.test.ts
  - packages/ai/test/schema-wire.test.ts
symbols: normalizeSchema, normalizeSchemaForGoogle, normalizeSchemaForCCA, normalizeSchemaForMCP, normalizeSchemaForOpenAIResponses, sanitizeSchemaForStrictMode, enforceStrictSchema, tryEnforceStrictSchema, adaptSchemaForStrict, isZodSchema, zodToWireSchema, toolWireSchema, normalizeEmptySchemas, stripResidualCombiners, ToolCallHealer

## auth-broker-gateway  [moderate, embedded, base=True]

The auth-broker-gateway feature is ALREADY present on HEAD (rebuild base). Origin/main contains 8 commits of enhancements over HEAD's base, primarily removing SSE streaming support (`openSnapshotStream`, `SnapshotStreamEvent` handling), streamlining snapshot-cache exports, and inlining OAuth failure detection. HEAD is a NEWER rebuild of elikoga's fork that added the full feature. The feature is fully embedded: it modifies core auth-storage.ts to expose snapshot contracts and changes provider implementations (anthropic-messages-server, openai-chat-server, openai-responses-server, pi-native-client/server) to support gateway shims. Extraction involves cherry-picking origin/main's recent refinements (SSE removal, isDefinitiveFailure inlining, OAuth path adjustments) back onto HEAD if desired, or accepting HEAD's fuller implementation. No external dependencies beyond existing ai package (auth-storage, usage, registry).

files:
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/client.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/index.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/refresher.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/remote-store.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/server.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/snapshot-cache.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/types.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-broker/wire-schemas.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-gateway/http.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-gateway/server.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-gateway/types.ts
  - /home/svnbjrn/omp/packages/ai/src/auth-gateway/index.ts
  - /home/svnbjrn/omp/packages/ai/test/auth-broker-refresher.test.ts
  - /home/svnbjrn/omp/packages/ai/test/auth-broker-wire.test.ts
  - /home/svnbjrn/omp/packages/ai/test/auth-gateway-anthropic-messages.test.ts
symbols: AuthBrokerClient, AuthBrokerServer, AuthBrokerRefresher, AuthBrokerStreamUnsupportedError, RemoteAuthCredentialStore, startAuthBroker, startAuthGateway, AuthGatewayBootOptions, SnapshotResponse, SnapshotStreamEvent, AuthBrokerError, readAuthBrokerSnapshotCache, writeAuthBrokerSnapshotCache

## danger-pi-extensions  [easy, standalone, base=False]
deps: extension-discovery

Feature adds fork-local bundled Danger Pi extensions (currently just createTitleExtension) wired into sdk.ts inline extensions array, kept separate from filesystem-discovered extensions. Two new files in danger-pi/extensions/ are pure additions with no upstream conflicts. sdk.ts requires minimal patch: add import + prepend dangerPiBundledExtensions to inlineExtensions initialization (~1224). All dependencies (ExtensionFactory, SessionManager, setSessionTerminalTitle) exist on HEAD. Test file is pure additive. Standalone-additive pattern with zero conflicts expected.

files:
  - packages/coding-agent/src/danger-pi/extensions/index.ts
  - packages/coding-agent/src/danger-pi/extensions/title.ts
  - packages/coding-agent/src/sdk.ts
  - packages/coding-agent/test/danger-pi-bundled-extensions.test.ts
symbols: dangerPiBundledExtensions, createTitleExtension, ExtensionFactory

## meta-extension  [easy, standalone, base=False]
deps: danger-pi-extensions

The meta-extension feature is documented in FORK.md on origin/main as a "fork-local meta bundled extension slash command for UI/autocomplete experimentation with foo, bar, and baz argument suggestions" but the actual implementation file (meta.ts) does NOT exist on origin/main yet—only the stub description exists. To implement: create packages/coding-agent/src/danger-pi/extensions/meta.ts following the same pattern as title.ts (which registers a command via ExtensionFactory), then add the import and createMetaExtension() to the dangerPiBundledExtensions array export in index.ts. The feature is pure-additive (new file + minimal changes to index.ts array) and has zero risk of conflicts with upstream code since it's isolated in the danger-pi directory which is fork-local.

files:
  - packages/coding-agent/src/danger-pi/extensions/meta.ts
  - packages/coding-agent/src/danger-pi/extensions/index.ts
symbols: createMetaExtension, dangerPiBundledExtensions, /meta

## native-platform  [hard, embedded, base=True]

The feature is ALREADY PRESENT on HEAD but has been refactored and diverged from origin/main. It consists of three main parts: (1) pi-iso crate (cross-platform isolation backends: APFS/btrfs/ZFS/Linux reflink/overlayfs/Windows block-clone/ProjFS/rcopy) with 5 post-merge commits; (2) SIXEL-only native image encoding in pi-natives crate plus Windows-safe addon staging/version sentinels in packages/natives; (3) Python omp-rpc host URI helpers and robomp Docker/Python dashboard with 26 divergent robomp commits and 14 in omp-rpc. Major changes on HEAD: pi-iso projfs/windows_block_clone refactored (extracted symlink_extended_info), pi-natives build-native.ts and embed-native.ts heavily simplified (removed sccache fallback, ELF stripping, cross-compile support, archive generation), and python components significantly modified post-upstream. Pure-additive native exports via packages/natives N-API shim; robomp is fully embedded in monorepo structure but content heavily reworked."

files:
  - /home/svnbjrn/omp/crates/pi-iso/src/lib.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/apfs.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/btrfs.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/diff.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/linux_reflink.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/overlayfs.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/windows_block_clone.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/zfs.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/rcopy.rs
  - /home/svnbjrn/omp/crates/pi-iso/src/projfs.rs
  - /home/svnbjrn/omp/crates/pi-natives/src/sixel.rs
  - /home/svnbjrn/omp/crates/pi-natives/src/iso.rs
  - /home/svnbjrn/omp/crates/pi-natives/src/lib.rs
  - /home/svnbjrn/omp/crates/pi-natives/Cargo.toml
  - /home/svnbjrn/omp/packages/natives/native/index.d.ts
symbols: IsoBackendKind, IsolationBackend, IsoChangeKind, IsoProbeResult, IsoResolveResult, isoStart, isoStop, isoDiff, isoProbe, isoResolve, encode_sixel, BackendKind, ChangeKind, Diff, FileChange

