import type { BuiltinSlashCommandSpec } from "../../slash-commands/builtin-registry";

import { gentitleSlashCommand } from "./gentitle";

/**
 * Fork-local, bundled native slash commands wired directly into the builtin registry.
 *
 * Keep this distinct from filesystem-discovered prompt commands and dynamic extensions.
 */
export const dangerPiBundledBuiltinSlashCommands: ReadonlyArray<BuiltinSlashCommandSpec> = [gentitleSlashCommand];
