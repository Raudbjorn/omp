import { describe, expect, it } from "bun:test";
import type { AcpStopReason } from "../src/providers/acp/stop-reason";
import { mapStopReason } from "../src/providers/acp/stop-reason";

describe("mapStopReason", () => {
	it("maps end_turn to stop", () => {
		expect(mapStopReason("end_turn")).toBe("stop");
	});
	it("maps max_tokens to length", () => {
		expect(mapStopReason("max_tokens")).toBe("length");
	});
	it("maps max_turn_requests to length", () => {
		expect(mapStopReason("max_turn_requests")).toBe("length");
	});
	it("maps cancelled to aborted", () => {
		expect(mapStopReason("cancelled")).toBe("aborted");
	});
	it("maps refusal to error", () => {
		expect(mapStopReason("refusal")).toBe("error");
	});
	it("falls back to stop for unknown future variants", () => {
		expect(mapStopReason("some_future_variant" as AcpStopReason)).toBe("stop");
	});
});
