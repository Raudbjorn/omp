#!/usr/bin/env bun
// Smoke test for the web terminal harvested from nnk97/oh-my-pi.
// Boots the server on loopback, verifies HTTP + WS endpoints, shuts down.

import { Settings } from "../packages/coding-agent/src/config/settings";
import {
	getOrStartWebTerminalServer,
	stopWebTerminalServer,
} from "../packages/coding-agent/src/web-terminal/server";

const TEST_PORT = Number.parseInt(process.env.OMP_WEB_TERMINAL_SMOKE_PORT ?? "21358", 10);

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
	if (!server.url.includes("?t=")) {
		throw new Error("server URL missing auth token");
	}

	// HTTP unauthorized: without ?t=, expect 401
	const unauthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
	if (unauthRes.status !== 401) {
		throw new Error(`expected 401 without token, got ${unauthRes.status}`);
	}

	// HTTP authorized: full URL with token returns client HTML
	const authRes = await fetch(server.url);
	const html = await authRes.text();
	console.log("http status:", authRes.status, "bytes:", html.length);
	if (authRes.status !== 200) throw new Error(`http status ${authRes.status}`);
	if (!html.toLowerCase().includes("<!doctype html")) {
		throw new Error("response did not look like HTML");
	}

	// WS unauthorized: without token, expect handshake failure
	const wsRejected = await new Promise<boolean>(resolve => {
		const wsBare = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);
		wsBare.addEventListener("open", () => {
			wsBare.close();
			resolve(false);
		});
		wsBare.addEventListener("error", () => resolve(true));
		wsBare.addEventListener("close", event => resolve(event.code !== 1000));
	});
	if (!wsRejected) throw new Error("WS without token should be rejected");
	console.log("ws unauth rejected ok");

	// WS authorized: URL derived from server.url carries the token in query
	const wsUrl = new URL(server.url);
	wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
	wsUrl.pathname = "/ws";
	const ws = new WebSocket(wsUrl.toString());

	const firstMessage = await new Promise<string>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("ws message timeout")), 3000);
		ws.addEventListener("open", () => {
			console.log("ws open");
			ws.send(
				JSON.stringify({
					type: "client_capabilities",
					fontFamilyConfigured: "monospace",
					fontFamilyResolved: "monospace",
					fontSize: 14,
					fontMatch: "unknown",
					supportsNerdSymbols: false,
					supportsTokenEmoji: false,
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
