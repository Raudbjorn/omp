import { describe, expect, it } from "bun:test";

import { KEYBINDINGS, KeybindingsManager } from "../src/config/keybindings";

describe("keybindings execute-intent paste action", () => {
	it("includes pasteExec default binding", () => {
		expect(KEYBINDINGS["app.clipboard.pasteExec"].defaultKeys).toBe("ctrl+shift+alt+v");

		const manager = KeybindingsManager.inMemory();
		expect(manager.getKeys("app.clipboard.pasteExec")).toEqual(["ctrl+shift+alt+v"]);
	});

	it("supports overriding pasteExec via keybindings config", () => {
		const manager = KeybindingsManager.inMemory({
			"app.clipboard.pasteExec": "alt+v",
		});

		expect(manager.getKeys("app.clipboard.pasteExec")).toEqual(["alt+v"]);
	});
});
