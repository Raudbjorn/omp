import * as path from "node:path";
import * as url from "node:url";
import { logger } from "@oh-my-pi/pi-utils";
import type { Server, ServerWebSocket } from "bun";
import { settings } from "../config/settings";
import type { WebTerminalControlKey } from "../config/settings-schema";
import {
	getWebTerminalBindingOptions,
	reconcileWebTerminalBindings,
	resolveWebTerminalBindingsWithFallback,
	type WebTerminalBindingError,
	type WebTerminalBindingOption,
} from "./interfaces";
import type { ClientCapabilities, ClientDebugInfo, ClientMessage, ServerMessage, ServerStatusState } from "./protocol";
import { parseClientMessage, serializeServerMessage } from "./protocol";
import { getActiveWebTerminalBridge, type WebTerminalBridge } from "./terminal-bridge";

export type WebTerminalClientInfo = {
	binding: WebTerminalBindingOption;
	localAddress: string;
	localPort: number;
	remoteAddress?: string;
	remotePort?: number;
};

export type WebTerminalListenerInfo = {
	binding: WebTerminalBindingOption;
	localAddress: string;
	localPort: number;
	reason: string;
};

export type WebTerminalServerCallbacks = {
	onClientConnected?: (info: WebTerminalClientInfo) => void;
	onClientDisconnected?: (info: WebTerminalClientInfo) => void;
	onClientDebug?: (info: WebTerminalClientInfo, debug: ClientDebugInfo, reason?: string) => void;
	onListenerStopped?: (info: WebTerminalListenerInfo) => void;
	onServerStopped?: (info: { reason: string }) => void;
};

export interface WebTerminalServerOptions {
	host?: string;
	port?: number;
	cwd?: string;
	callbacks?: WebTerminalServerCallbacks;
}

type WebTerminalSocketData = {
	sessionId: number | null;
	capabilities?: ClientCapabilities;
	bindingId?: string;
	remoteAddress?: string;
	remotePort?: number;
};

type WebTerminalAsset = {
	content: string;
	contentType: string;
};

type WebTerminalClientConfig = {
	fontFamily?: string;
	fontSize?: number;
	showExtraControls?: boolean;
	extraControlKeys?: WebTerminalControlKey[];
	extraControlsHeightPx?: number;
};

function isSameCapabilities(left: ClientCapabilities | null, right: ClientCapabilities): boolean {
	if (!left) return false;
	return (
		left.fontFamilyConfigured === right.fontFamilyConfigured &&
		left.fontFamilyResolved === right.fontFamilyResolved &&
		left.fontSize === right.fontSize &&
		left.fontMatch === right.fontMatch &&
		left.supportsNerdSymbols === right.supportsNerdSymbols &&
		left.supportsTokenEmoji === right.supportsTokenEmoji
	);
}

const DEFAULT_PORT = 21357;

export class WebTerminalServer {
	#servers = new Map<string, Server<WebTerminalSocketData>>();
	#bindings = new Map<string, WebTerminalBindingOption>();
	#assets: Map<string, WebTerminalAsset>;
	#activeSocket: ServerWebSocket<WebTerminalSocketData> | null = null;
	#activeBridge: WebTerminalBridge | null = null;
	#activeBridgeUnsubscribe: (() => void) | null = null;
	#activeSessionId = 0;
	#activeClientCapabilities: ClientCapabilities | null = null;
	#cwd: string;
	#bindingErrors: WebTerminalBindingError[] = [];
	#port: number;
	#urls: string[] = [];
	#url = "";
	#callbacks: WebTerminalServerCallbacks | null = null;

	private constructor(assets: Map<string, WebTerminalAsset>, port: number, cwd: string) {
		this.#assets = assets;
		this.#port = port;
		this.#cwd = cwd;
	}

	static async start(
		bindings: WebTerminalBindingOption[],
		options: WebTerminalServerOptions = {},
	): Promise<WebTerminalServer> {
		const port = options.port ?? DEFAULT_PORT;
		const cwd = options.cwd ?? process.cwd();
		const assets = await buildAssets();
		const instance = new WebTerminalServer(assets, port, cwd);
		const callbacks = options.callbacks ?? cachedCallbacks;
		if (callbacks) {
			instance.setCallbacks(callbacks);
		}
		instance.applyBindings(bindings);
		if (instance.urls.length === 0) {
			instance.stop("No web terminal bindings available");
			throw new Error("No web terminal bindings available.");
		}
		logger.debug("Web terminal server started", { urls: instance.urls, port, cwd });
		return instance;
	}

	stop(reason = "Web terminal stopped"): void {
		this.#disconnectActiveClient(reason);
		for (const server of this.#servers.values()) {
			server.stop();
		}
		this.#emitServerStopped(reason);
		this.#servers.clear();
		this.#bindings.clear();
		this.#bindingErrors = [];
		this.#urls = [];
		this.#url = "";
		logger.debug("Web terminal server stopped", { reason });
	}

	get isRunning(): boolean {
		return this.#servers.size > 0;
	}

	get urls(): string[] {
		return this.#urls;
	}

	get url(): string {
		return this.#url;
	}

	get bindingErrors(): WebTerminalBindingError[] {
		return this.#bindingErrors;
	}

	get port(): number {
		return this.#port;
	}

	setCwd(cwd: string): void {
		this.#cwd = cwd;
	}

	setCallbacks(callbacks: WebTerminalServerCallbacks | null): void {
		this.#callbacks = callbacks;
	}

	applyBindings(bindings: WebTerminalBindingOption[]): void {
		const desired = new Map(bindings.map(binding => [binding.id, binding]));
		const removed: WebTerminalBindingOption[] = [];
		for (const [id, binding] of this.#bindings.entries()) {
			if (!desired.has(id)) {
				removed.push(binding);
			}
		}
		for (const binding of removed) {
			const server = this.#servers.get(binding.id);
			if (server) {
				if (this.#activeSocket?.data.bindingId === binding.id) {
					this.#disconnectActiveClient("Web terminal binding removed");
				}
				server.stop();
			}
			this.#emitListenerStopped(binding, "Web terminal binding removed");
			this.#servers.delete(binding.id);
			this.#bindings.delete(binding.id);
		}

		const failures: WebTerminalBindingError[] = [];
		for (const binding of bindings) {
			if (this.#servers.has(binding.id)) continue;
			try {
				const server = this.#startListener(binding);
				this.#servers.set(binding.id, server);
				this.#bindings.set(binding.id, binding);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn("Web terminal listener failed", {
					binding: binding.label,
					error: message,
				});
				failures.push({
					binding,
					error: message,
				});
			}
		}
		this.#bindingErrors = failures;

		const activeBindings = bindings.filter(binding => this.#servers.has(binding.id));
		this.#urls = activeBindings.map(binding => `http://${binding.ip}:${this.#port}`);
		this.#url = this.#urls[0] ?? "";
	}

	#buildClientInfo(ws: ServerWebSocket<WebTerminalSocketData>): WebTerminalClientInfo | null {
		const bindingId = ws.data.bindingId;
		if (!bindingId) return null;
		const binding = this.#bindings.get(bindingId);
		if (!binding) return null;
		return {
			binding,
			localAddress: binding.ip,
			localPort: this.#port,
			remoteAddress: ws.data.remoteAddress,
			remotePort: ws.data.remotePort,
		};
	}

	#emitClientConnected(ws: ServerWebSocket<WebTerminalSocketData>): void {
		const info = this.#buildClientInfo(ws);
		if (!info) return;
		this.#callbacks?.onClientConnected?.(info);
	}

	#emitClientDisconnected(ws: ServerWebSocket<WebTerminalSocketData>): void {
		const info = this.#buildClientInfo(ws);
		if (!info) return;
		this.#callbacks?.onClientDisconnected?.(info);
	}

	#emitClientDebug(ws: ServerWebSocket<WebTerminalSocketData>, debug: ClientDebugInfo, reason?: string): void {
		const info = this.#buildClientInfo(ws);
		if (!info) return;
		this.#callbacks?.onClientDebug?.(info, debug, reason);
	}

	#emitListenerStopped(binding: WebTerminalBindingOption, reason: string): void {
		this.#callbacks?.onListenerStopped?.({
			binding,
			localAddress: binding.ip,
			localPort: this.#port,
			reason,
		});
	}

	#emitServerStopped(reason: string): void {
		this.#callbacks?.onServerStopped?.({ reason });
	}

	#canAcceptClient(): boolean {
		return !this.#activeSocket || this.#activeSocket.readyState !== WebSocket.OPEN;
	}

	#attachSocket(ws: ServerWebSocket<WebTerminalSocketData>): void {
		this.#activeSocket = ws;
	}

	#handleFetch(req: Request, server: Server<WebTerminalSocketData>, bindingId: string): Response | undefined {
		const requestUrl = new URL(req.url);
		if (requestUrl.pathname === "/favicon.ico") {
			return new Response(null, { status: 204 });
		}
		if (requestUrl.pathname === "/ws") {
			logger.debug("Web terminal websocket upgrade requested", { url: req.url });
			if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
				return new Response("Expected WebSocket upgrade.", { status: 400 });
			}
			if (!this.#canAcceptClient()) {
				logger.warn("Web terminal websocket rejected (already active)");
				return new Response("Web terminal already connected.", { status: 409 });
			}
			const requestIp = server.requestIP(req);
			const upgraded = server.upgrade(req, {
				data: {
					sessionId: null,
					bindingId,
					remoteAddress: requestIp?.address,
					remotePort: requestIp?.port,
				},
			});
			if (!upgraded) {
				logger.error("Web terminal websocket upgrade failed");
				return new Response("WebSocket upgrade failed.", { status: 400 });
			}
			return undefined;
		}
		const asset = this.#assets.get(requestUrl.pathname);
		if (!asset) {
			return new Response("Not found", { status: 404 });
		}

		let content = asset.content;
		if (asset.contentType === "text/html") {
			const config = getWebTerminalClientConfig();
			const configScript = `<script>window.__OMP_WEB_TERMINAL_CONFIG=${JSON.stringify(config).replace(/</g, "\\u003c")};</script>`;
			content = content.replace(/<script>window\.__OMP_WEB_TERMINAL_CONFIG=.*?;<\/script>/, configScript);
		}

		return new Response(content, {
			headers: {
				"Content-Type": asset.contentType,
				"Cache-Control": "no-store",
			},
		});
	}

	#handleOpen(ws: ServerWebSocket<WebTerminalSocketData>): void {
		if (!this.#canAcceptClient()) {
			ws.close(1008, "Only one client allowed");
			return;
		}
		ws.data.capabilities = {
			fontFamilyConfigured: "",
			fontFamilyResolved: "",
			fontSize: 0,
			fontMatch: "unknown",
			supportsNerdSymbols: false,
			supportsTokenEmoji: false,
		};
		logger.debug("Web terminal client connected");
		void this.#startSession(ws);
	}

	async #startSession(ws: ServerWebSocket<WebTerminalSocketData>): Promise<void> {
		if (!this.#canAcceptClient()) {
			this.#sendStatus(ws, "error", "Web terminal is already in use.");
			logger.warn("Web terminal session rejected", { reason: "already connected" });
			ws.close();
			return;
		}
		const bridge = getActiveWebTerminalBridge();
		if (!bridge) {
			this.#sendStatus(ws, "error", "No active terminal session to mirror.");
			logger.warn("Web terminal session rejected", { reason: "no active bridge" });
			ws.close();
			return;
		}
		this.#attachSocket(ws);
		this.#emitClientConnected(ws);
		const sessionId = ++this.#activeSessionId;
		ws.data.sessionId = sessionId;
		const pendingCapabilities = ws.data.capabilities;
		this.#activeClientCapabilities = pendingCapabilities ?? null;
		this.#activeBridge = bridge;
		this.#activeBridgeUnsubscribe?.();
		this.#activeBridgeUnsubscribe = bridge.onOutput(data => {
			if (ws.data.sessionId !== sessionId) return;
			const filtered = this.#filterOutput(data, this.#activeClientCapabilities ?? ws.data.capabilities ?? null);
			this.#send(ws, { type: "output", data: filtered });
		});
		this.#sendStatus(ws, "running", "Connected to host terminal.");
		if (pendingCapabilities) {
			bridge.setClientCapabilities(pendingCapabilities);
		}
		bridge.requestFullRender({ clear: true });
		logger.debug("Web terminal attached", {
			cwd: this.#cwd,
			size: bridge.getSize(),
		});
	}

	#handleMessage(ws: ServerWebSocket<WebTerminalSocketData>, message: ClientMessage | null): void {
		if (!message) {
			this.#sendStatus(ws, "error", "Malformed message received.");
			logger.warn("Web terminal received malformed message");
			return;
		}
		if (message.type === "client_capabilities") {
			ws.data.capabilities = message;
			if (!this.#activeBridge || ws.data.sessionId !== this.#activeSessionId) {
				return;
			}
			if (isSameCapabilities(this.#activeClientCapabilities, message)) {
				return;
			}
			this.#activeClientCapabilities = message;
			logger.debug("Web terminal client capabilities", {
				fontFamilyConfigured: message.fontFamilyConfigured,
				fontFamilyResolved: message.fontFamilyResolved,
				fontSize: message.fontSize,
				fontMatch: message.fontMatch,
				supportsNerdSymbols: message.supportsNerdSymbols,
				supportsTokenEmoji: message.supportsTokenEmoji,
			});
			this.#activeBridge.setClientCapabilities(message);
			return;
		}
		if (message.type === "client_debug") {
			logger.debug("Web terminal client debug", {
				reason: message.reason,
				info: message.info,
			});
			this.#emitClientDebug(ws, message.info, message.reason);
			return;
		}
		if (!this.#activeBridge || ws.data.sessionId !== this.#activeSessionId) {
			return;
		}
		if (message.type === "input") {
			logger.debug("Web terminal input", { length: message.data.length });
			try {
				this.#activeBridge.injectInput(message.data);
			} catch (error) {
				this.#sendStatus(ws, "error", error instanceof Error ? error.message : String(error));
			}
			return;
		}
		if (message.type === "resize") {
			logger.debug("Web terminal resize", { cols: message.cols, rows: message.rows });
			try {
				const cols = Math.max(1, Math.floor(message.cols));
				const rows = Math.max(1, Math.floor(message.rows));
				this.#activeBridge.setSize(cols, rows);
				this.#activeBridge.requestFullRender({ clear: true });
				logger.debug("Web terminal size applied", { cols, rows });
			} catch (error) {
				this.#sendStatus(ws, "error", error instanceof Error ? error.message : String(error));
			}
			return;
		}
	}

	#handleClose(ws: ServerWebSocket<WebTerminalSocketData>): void {
		if (this.#activeSocket !== ws) return;
		this.#clearActiveClient(ws);
	}

	#disconnectActiveClient(reason: string): void {
		const socket = this.#activeSocket;
		if (!socket) return;
		try {
			socket.close(1001, reason);
		} catch {
			// Ignore close errors
		}
		this.#clearActiveClient(socket);
	}

	#clearActiveClient(ws?: ServerWebSocket<WebTerminalSocketData>): void {
		if (ws && this.#activeSocket && this.#activeSocket !== ws) {
			return;
		}
		if (ws) {
			this.#emitClientDisconnected(ws);
		}
		this.#activeSocket = null;
		if (ws) {
			ws.data.sessionId = null;
			ws.data.capabilities = undefined;
		}
		logger.debug("Web terminal client disconnected");
		this.#activeBridgeUnsubscribe?.();
		this.#activeBridgeUnsubscribe = null;
		this.#activeBridge?.clearSize();
		this.#activeBridge?.requestFullRender({ clear: true });
		this.#activeBridge?.setClientCapabilities(null);
		this.#activeClientCapabilities = null;
		logger.debug("Web terminal size cleared", { size: this.#activeBridge?.getSize() });
		this.#activeBridge = null;
	}

	#startListener(binding: WebTerminalBindingOption): Server<WebTerminalSocketData> {
		const server = Bun.serve<WebTerminalSocketData>({
			hostname: binding.ip,
			port: this.#port,
			fetch: (req, serverInstance) => this.#handleFetch(req, serverInstance, binding.id),
			websocket: {
				open: ws => this.#handleOpen(ws),
				message: (ws, message) => this.#handleMessage(ws, normalizeMessage(message)),
				close: ws => this.#handleClose(ws),
			},
		});
		logger.debug("Web terminal listener started", { binding: binding.label, port: this.#port });
		return server;
	}

	#filterOutput(data: string, capabilities: ClientCapabilities | null): string {
		if (capabilities?.supportsTokenEmoji === true) return data;
		return data.replaceAll("🪙", "¤");
	}

	#send(ws: ServerWebSocket<WebTerminalSocketData>, message: ServerMessage): void {
		try {
			ws.send(serializeServerMessage(message));
		} catch (error) {
			logger.warn("Failed to send web terminal message", { error: String(error) });
		}
	}

	#sendStatus(ws: ServerWebSocket<WebTerminalSocketData>, state: ServerStatusState, message?: string): void {
		this.#send(ws, { type: "status", state, message });
	}
}

let cachedServer: WebTerminalServer | null = null;
let cachedCallbacks: WebTerminalServerCallbacks | null = null;

export async function getOrStartWebTerminalServer(options: WebTerminalServerOptions = {}): Promise<WebTerminalServer> {
	if (!settings.get("webTerminal.enabled")) {
		stopWebTerminalServer("Web terminal disabled");
		throw new Error("Web terminal is disabled in settings.");
	}

	if (options.callbacks) {
		cachedCallbacks = options.callbacks;
		if (cachedServer) {
			cachedServer.setCallbacks(options.callbacks);
		}
	}

	const port = options.port ?? DEFAULT_PORT;
	if (cachedServer && cachedServer.port !== port) {
		cachedServer.stop("Web terminal port changed");
		cachedServer = null;
	}

	const bindings = resolveBindings(options);
	if (bindings.length === 0) {
		throw new Error("No available web terminal bindings.");
	}

	if (cachedServer) {
		cachedServer.setCwd(options.cwd ?? process.cwd());
		cachedServer.applyBindings(bindings);
		if (cachedServer.urls.length === 0) {
			cachedServer.stop("Web terminal bindings unavailable");
			cachedServer = null;
			throw new Error("No available web terminal bindings.");
		}
		return cachedServer;
	}

	cachedServer = await WebTerminalServer.start(bindings, { ...options, port });
	return cachedServer;
}

export function getWebTerminalServer(): WebTerminalServer | null {
	return cachedServer;
}

export function setWebTerminalServerCallbacks(callbacks: WebTerminalServerCallbacks | null): void {
	cachedCallbacks = callbacks;
	if (cachedServer) {
		cachedServer.setCallbacks(callbacks);
	}
}

export function stopWebTerminalServer(reason = "Web terminal stopped"): void {
	if (!cachedServer) return;
	cachedServer.stop(reason);
	cachedServer = null;
}

function resolveBindings(options: WebTerminalServerOptions): WebTerminalBindingOption[] {
	if (options.host) {
		const host = options.host;
		const isLoopback = host === "127.0.0.1" || host === "localhost";
		return [
			{
				id: `manual:${host}`,
				interface: "manual",
				ip: host,
				label: `(manual/${host})`,
				isLoopback,
				isInternal: isLoopback,
			},
		];
	}

	const bindingOptions = getWebTerminalBindingOptions();
	const configuredBindings = settings.get("webTerminal.bindings");
	if (configuredBindings.length === 0) {
		const { active } = resolveWebTerminalBindingsWithFallback(configuredBindings, bindingOptions);
		return active;
	}
	const { active } = reconcileWebTerminalBindings(configuredBindings, bindingOptions);
	return active;
}

async function buildAssets(): Promise<Map<string, WebTerminalAsset>> {
	const assetMap = new Map<string, WebTerminalAsset>();
	const clientDir = path.join(import.meta.dir, "client");
	const htmlPath = path.join(clientDir, "index.html");
	const cssPath = path.join(clientDir, "styles.css");
	const clientEntry = path.join(clientDir, "client.ts");
	const html = await Bun.file(htmlPath).text();
	const css = await Bun.file(cssPath).text();
	const clientConfig = getWebTerminalClientConfig();
	const configScript = `<script>window.__OMP_WEB_TERMINAL_CONFIG=${JSON.stringify(clientConfig).replace(/</g, "\\u003c")};</script>`;
	const htmlWithConfig = html.replace("</head>", `${configScript}</head>`);
	const xtermCssPath = resolveModulePath("@xterm/xterm/css/xterm.css");
	const xtermCss = await Bun.file(xtermCssPath).text();

	const build = await Bun.build({
		entrypoints: [clientEntry],
		format: "esm",
		splitting: false,
		target: "browser",
		minify: true,
		sourcemap: "none",
	});
	if (!build.success) {
		const messages = build.logs.map(log => log.message).join("\n");
		throw new Error(`Failed to build web terminal client.\n${messages}`);
	}
	const scriptOutput = build.outputs.find(outputFile => outputFile.path.endsWith(".js")) ?? build.outputs[0];
	if (!scriptOutput) {
		throw new Error("Failed to locate web terminal client bundle.");
	}
	const clientScript = await scriptOutput.text();

	assetMap.set("/", { content: htmlWithConfig, contentType: "text/html" });
	assetMap.set("/index.html", { content: htmlWithConfig, contentType: "text/html" });
	assetMap.set("/client.js", { content: clientScript, contentType: "text/javascript" });
	assetMap.set("/styles.css", { content: css, contentType: "text/css" });
	assetMap.set("/xterm.css", { content: xtermCss, contentType: "text/css" });
	return assetMap;
}

function getWebTerminalClientConfig(): WebTerminalClientConfig {
	const config: WebTerminalClientConfig = {};
	const fontFamily = Bun.env.OMP_WEB_TERMINAL_FONT?.trim();
	if (fontFamily) {
		config.fontFamily = fontFamily;
	}
	const fontSizeText = Bun.env.OMP_WEB_TERMINAL_FONT_SIZE?.trim();
	if (fontSizeText) {
		const parsed = Number(fontSizeText);
		if (Number.isFinite(parsed)) {
			config.fontSize = Math.max(8, Math.min(24, Math.round(parsed)));
		}
	}

	config.showExtraControls = settings.get("webTerminal.showExtraControls");
	config.extraControlKeys = settings.get("webTerminal.extraControlKeys");
	config.extraControlsHeightPx = settings.get("webTerminal.extraControlsHeightPx");

	return config;
}

function resolveModulePath(specifier: string): string {
	const resolved = import.meta.resolve(specifier);
	return url.fileURLToPath(resolved);
}

function normalizeMessage(message: string | Uint8Array | ArrayBuffer): ClientMessage | null {
	const text =
		typeof message === "string"
			? message
			: message instanceof ArrayBuffer
				? new TextDecoder().decode(new Uint8Array(message))
				: new TextDecoder().decode(message);
	return parseClientMessage(text);
}
