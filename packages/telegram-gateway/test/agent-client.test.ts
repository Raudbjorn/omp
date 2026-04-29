import { describe, expect, it } from "bun:test";
import { AgentClient } from "../src/agent-client";

const TEST_TIMEOUT = 60_000;
const hasApiKey = !!(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_TEST_KEY);
const itReal = hasApiKey ? it : it.skip;

describe("AgentClient", () => {
	it("rejects prompt before init", async () => {
		const client = new AgentClient();
		expect(client.prompt("hello")).rejects.toThrow(/not initialized/);
	});
});

describe("AgentClient real session", () => {
	itReal("connects and responds to a simple prompt", async () => {
		const client = new AgentClient();
		await client.init("/tmp/pi-gateway-test", null);

		const result = await client.prompt("Say hello in one word.");
		expect(result.text.length).toBeGreaterThan(0);
		expect(typeof result.partial).toBe("boolean");

		await client.shutdown();
	}, TEST_TIMEOUT);

	itReal("queues sequential prompts", async () => {
		const client = new AgentClient();
		await client.init("/tmp/pi-gateway-test", null);

		const [r1, r2] = await Promise.all([
			client.prompt("Say 'first'"),
			client.prompt("Say 'second'"),
		]);
		expect(r1.text).toBeTruthy();
		expect(r2.text).toBeTruthy();

		await client.shutdown();
	}, TEST_TIMEOUT);

	itReal("maintains conversation context across prompts", async () => {
		const client = new AgentClient();
		await client.init("/tmp/pi-gateway-test", null);

		await client.prompt("Remember the secret word: zebra");
		const r2 = await client.prompt("What is the secret word?");
		expect(r2.text.toLowerCase()).toContain("zebra");

		await client.shutdown();
	}, TEST_TIMEOUT);

	itReal("isBusy reflects processing state", async () => {
		const client = new AgentClient();
		await client.init("/tmp/pi-gateway-test", null);
		expect(client.isBusy).toBe(false);

		const p = client.prompt("Say 'busy'");
		expect(client.isBusy).toBe(true);

		await p;
		expect(client.isBusy).toBe(false);
		await client.shutdown();
	}, TEST_TIMEOUT);
});
