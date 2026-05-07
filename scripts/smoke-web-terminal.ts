#!/usr/bin/env bun
// Smoke test for the web terminal harvested from nnk97/oh-my-pi.
// Boots the server on loopback, hits the HTTP + WS endpoints, shuts down.

import { Settings } from "../packages/coding-agent/src/config/settings";
import {
	getOrStartWebTerminalServer,
	stopWebTerminalServer,
} from "../packages/coding-agent/src/web-terminal/server";

const TEST_PORT = 21358;

async function main(): Promise<void> {
	await Settings.init({ inMemory: true });

	const server = await getOrStartWebTerminalServer({
		host: "127.0.0.1",
		port: TEST_PORT,
		cwd: process.cwd(),
	});

	console.log("boot ok:", server.url, "urls:", server.urls);
	if (!server.url || !server.url.startsWith("http://127.0.0.1:")) {
		throw new Error(`unexpected server URL: ${server.url}`);
	}

	// HTTP: expect client HTML
	const res = await fetch(`${server.url}/`);
	const html = await res.text();
	console.log("http status:", res.status, "bytes:", html.length);
	if (res.status !== 200) throw new Error(`http status ${res.status}`);
	if (!html.includes("<!doctype html") && !html.includes("<!DOCTYPE html")) {
		throw new Error("response did not look like HTML");
	}

	// WS: expect to connect and receive at least one server message
	const wsUrl = `${server.url.replace(/^http/, "ws")}/ws`;
	const ws = new WebSocket(wsUrl);

	const firstMessage = await new Promise<string>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("ws message timeout")), 3000);
		ws.addEventListener("open", () => {
			console.log("ws open");
			ws.send(
				JSON.stringify({
					type: "hello",
					capabilities: { unicode: true, nerd: false, termType: "xterm-256color" },
				}),
			);
		});
		ws.addEventListener("message", event => {
			clearTimeout(timeout);
			resolve(typeof event.data === "string" ? event.data : "<binary>");
		});
		ws.addEventListener("error", err => {
			clearTimeout(timeout);
			reject(new Error(`ws error: ${String(err)}`));
		});
	});
	console.log("ws first message:", firstMessage.slice(0, 120));
	ws.close();

	stopWebTerminalServer("smoke test done");
	console.log("PASS");
}

main().catch(err => {
	console.error("FAIL:", err);
	stopWebTerminalServer("smoke test failed");
	process.exit(1);
});
