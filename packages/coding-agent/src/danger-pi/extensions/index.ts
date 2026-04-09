import type { ExtensionFactory } from "../../extensibility/extensions";

import { createTitleExtension } from "./title";

/**
 * Fork-local, bundled Danger Pi extensions wired directly into the SDK.
 *
 * Keep this distinct from filesystem-discovered user/project extensions.
 */
export const dangerPiBundledExtensions: ReadonlyArray<ExtensionFactory> = [createTitleExtension()];
