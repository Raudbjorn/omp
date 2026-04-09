import { describe, expect, it } from "bun:test";

import { dangerPiBundledExtensions } from "../src/danger-pi/extensions";

describe("Danger Pi bundled extensions", () => {
	it("registers the title command exactly once", () => {
		const registeredCommands: string[] = [];
		for (const factory of dangerPiBundledExtensions) {
			factory({
				registerCommand(name: string) {
					registeredCommands.push(name);
				},
			} as never);
		}

		expect(registeredCommands.filter(name => name === "title")).toEqual(["title"]);
	});
});
