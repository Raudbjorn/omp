import { describe, expect, it } from "bun:test";
import type * as schema from "@agentclientprotocol/sdk";
import { AcpError } from "../src/providers/acp/errors";
import { makePermissionPolicy } from "../src/providers/acp/permissions";

const SID = "test-session";

function makeRequest(
	toolKind: schema.ToolKind,
	options: readonly schema.PermissionOption[] = [
		{ optionId: "allow", name: "Allow", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject_once" },
	],
): schema.RequestPermissionRequest {
	return {
		sessionId: SID,
		options: [...options],
		toolCall: {
			toolCallId: "tc-1",
			title: "sample",
			kind: toolKind,
			status: "pending",
		},
	};
}

describe("makePermissionPolicy — auto-allow", () => {
	const policy = makePermissionPolicy("auto-allow");

	it("picks allow_once when present", async () => {
		const res = await policy(makeRequest("execute"));
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "allow" });
	});

	it("falls back to the first option if no allow_once is offered", async () => {
		const res = await policy(
			makeRequest("execute", [
				{ optionId: "maybe", name: "Maybe", kind: "allow_always" },
				{ optionId: "nope", name: "No", kind: "reject_once" },
			]),
		);
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "maybe" });
	});

	it("throws when no options are offered at all", async () => {
		await expect(policy(makeRequest("execute", []))).rejects.toBeInstanceOf(AcpError);
	});
});

describe("makePermissionPolicy — deny-destructive", () => {
	const policy = makePermissionPolicy("deny-destructive");

	it("allows read tools", async () => {
		const res = await policy(makeRequest("read"));
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "allow" });
	});

	it("allows edit tools (fs/write_text_file carveout)", async () => {
		const res = await policy(makeRequest("edit"));
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "allow" });
	});

	it("rejects execute tools", async () => {
		const res = await policy(makeRequest("execute"));
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "reject" });
	});

	it("rejects delete tools", async () => {
		const res = await policy(makeRequest("delete"));
		expect(res.outcome).toEqual({ outcome: "selected", optionId: "reject" });
	});
});

describe("makePermissionPolicy — delegate", () => {
	const policy = makePermissionPolicy("delegate");

	it("throws not_implemented (phase 2)", async () => {
		await expect(policy(makeRequest("read"))).rejects.toBeInstanceOf(AcpError);
	});
});
