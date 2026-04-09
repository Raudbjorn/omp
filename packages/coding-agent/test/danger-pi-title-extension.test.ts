import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { createTitleExtension } from "../src/danger-pi/extensions/title";

type RegisteredCommand = {
	handler: (args: string, ctx: unknown) => Promise<void> | void;
};

describe("Danger Pi title extension", () => {
	afterEach(() => {
		spyOn(process.stdout, "write").mockRestore?.();
	});

	it("registers title command and updates the session title from editor input", async () => {
		const stdoutWrite = spyOn(process.stdout, "write").mockImplementation(() => true);
		let handler: ((args: string, ctx: unknown) => Promise<void> | void) | undefined;
		createTitleExtension()({
			registerCommand(name: string, command: RegisteredCommand) {
				if (name === "title") {
					handler = command.handler as typeof handler;
				}
			},
		} as never);

		let sessionTitle: string | undefined;
		const notifications: Array<{ message: string; type: string | undefined }> = [];
		await handler?.("", {
			sessionManager: {
				getSessionName: () => sessionTitle,
				setSessionName: async (nextTitle: string) => {
					sessionTitle = nextTitle;
				},
				getCwd: () => "/tmp/project",
			},
			ui: {
				editor: async () => "  Incident War Room  ",
				notify: (message: string, type?: string) => {
					notifications.push({ message, type });
				},
			},
		});

		expect(sessionTitle).toBe("Incident War Room");
		expect(notifications).toEqual([{ message: "Session title updated", type: "info" }]);
		expect(stdoutWrite).toHaveBeenCalled();
		stdoutWrite.mockRestore();
	});

	it("treats cancel and blank input as no-ops", async () => {
		let handler: ((args: string, ctx: unknown) => Promise<void> | void) | undefined;
		createTitleExtension()({
			registerCommand(name: string, command: RegisteredCommand) {
				if (name === "title") {
					handler = command.handler as typeof handler;
				}
			},
		} as never);

		let sessionTitle: string | undefined;
		await handler?.("", {
			sessionManager: {
				getSessionName: () => sessionTitle,
				setSessionName: async (nextTitle: string) => {
					sessionTitle = nextTitle;
				},
				getCwd: () => "/tmp/project",
			},
			ui: {
				editor: async () => undefined,
				notify: () => {
					throw new Error("notify should not be called for cancelled input");
				},
			},
		});
		expect(sessionTitle).toBeUndefined();

		await handler?.("", {
			sessionManager: {
				getSessionName: () => sessionTitle,
				setSessionName: async (nextTitle: string) => {
					sessionTitle = nextTitle;
				},
				getCwd: () => "/tmp/project",
			},
			ui: {
				editor: async () => "   ",
				notify: () => {
					throw new Error("notify should not be called for blank input");
				},
			},
		});
		expect(sessionTitle).toBeUndefined();
	});
});
