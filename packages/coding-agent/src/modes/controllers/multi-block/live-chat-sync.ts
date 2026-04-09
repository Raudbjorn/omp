import type { InteractiveModeContext } from "../../types";

interface LiveChatSyncOptions {
	wasStreaming: boolean;
	display: boolean;
}

export function syncMultiBlockLiveChat(
	ctx: Pick<InteractiveModeContext, "isBackgrounded" | "rebuildChatFromMessages">,
	options: LiveChatSyncOptions,
): void {
	if (ctx.isBackgrounded || options.wasStreaming || !options.display) {
		return;
	}

	ctx.rebuildChatFromMessages();
}
