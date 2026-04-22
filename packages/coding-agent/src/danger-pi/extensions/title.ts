import type { ExtensionFactory } from "../../extensibility/extensions";
import type { SessionManager } from "../../session/session-manager";
import { setSessionTerminalTitle } from "../../utils/title-generator";

export function createTitleExtension(): ExtensionFactory {
	return api => {
		api.registerCommand("title", {
			description: "Set the current session title.",
			handler: async (args, ctx) => {
				const sessionManager = ctx.sessionManager as SessionManager;
				let title = args.trim();
				if (!title) {
					const nextTitle = await ctx.ui.editor("Session title", sessionManager.getSessionName(), undefined, {
						promptStyle: true,
					});
					if (nextTitle === undefined) {
						return;
					}
					title = nextTitle.trim();
				}

				if (!title) {
					return;
				}

				await sessionManager.setSessionName(title);
				setSessionTerminalTitle(title, sessionManager.getCwd());
				ctx.ui.notify("Session title updated", "info");
			},
		});
	};
}
