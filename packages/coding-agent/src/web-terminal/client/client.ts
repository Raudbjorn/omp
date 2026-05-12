import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import type { ClientDebugInfo } from "../protocol";

const terminalRoot = (() => {
	const element = document.getElementById("terminal-host");
	if (!(element instanceof HTMLElement)) {
		throw new Error("Terminal host container not found");
	}
	return element;
})();

type WebTerminalControlKey = "esc" | "enter" | "up" | "down" | "left" | "right" | "ctrl+c";

type WebTerminalRuntimeConfig = {
	fontFamily?: string;
	fontSize?: number;
	showExtraControls?: boolean;
	extraControlKeys?: WebTerminalControlKey[];
	extraControlsHeightPx?: number;
};

type ClientCapabilities = {
	fontFamilyConfigured: string;
	fontFamilyResolved: string;
	fontSize: number;
	fontMatch: "exact" | "fallback" | "unknown";
	supportsNerdSymbols: boolean;
	supportsTokenEmoji: boolean;
};

const runtimeConfig = (window as typeof window & { __OMP_WEB_TERMINAL_CONFIG?: WebTerminalRuntimeConfig })
	.__OMP_WEB_TERMINAL_CONFIG;

const FONT_FAMILY =
	runtimeConfig?.fontFamily?.trim() ||
	'"JetBrains Mono", "Cascadia Mono", "Cascadia Code", "Consolas", "DejaVu Sans Mono", "Noto Sans Mono", monospace';

const configuredFontSize = runtimeConfig?.fontSize;
const FONT_SIZE =
	typeof configuredFontSize === "number" && Number.isFinite(configuredFontSize)
		? Math.max(8, Math.min(24, Math.round(configuredFontSize)))
		: 12;
const RIGHT_MARGIN_COLS = 0;
const NERD_GLYPH = "";
const TOKEN_GLYPH = "🪙";

let term: Terminal | null = null;
let ws: WebSocket | null = null;
let resizeTimer: number | null = null;
let lastSentCols = 0;
let lastSentRows = 0;
let lastCapabilitiesPayload: string | null = null;

function collectSizing(): Record<string, unknown> {
	const xterm = terminalRoot.querySelector(".xterm");
	const viewport = terminalRoot.querySelector(".xterm-viewport");
	const screen = terminalRoot.querySelector(".xterm-screen");
	return {
		terminal: { w: terminalRoot.clientWidth, h: terminalRoot.clientHeight },
		xterm: xterm ? { w: xterm.clientWidth, h: xterm.clientHeight } : null,
		viewport: viewport ? { w: viewport.clientWidth, h: viewport.clientHeight } : null,
		screen: screen ? { w: (screen as HTMLElement).clientWidth, h: (screen as HTMLElement).clientHeight } : null,
	};
}

function applyViewportSize(): void {
	const viewport = window.visualViewport;
	const heightCandidates = [viewport?.height, window.innerHeight, document.documentElement.clientHeight].filter(
		(value): value is number => typeof value === "number" && Number.isFinite(value),
	);
	const widthCandidates = [viewport?.width, window.innerWidth, document.documentElement.clientWidth].filter(
		(value): value is number => typeof value === "number" && Number.isFinite(value),
	);
	const height = Math.min(...heightCandidates);
	const width = Math.min(...widthCandidates);
	const heightPx = `${Math.max(0, Math.floor(height))}px`;
	const widthPx = `${Math.max(0, Math.floor(width))}px`;
	document.documentElement.style.height = heightPx;
	document.body.style.height = heightPx;
	document.documentElement.style.width = widthPx;
	document.body.style.width = widthPx;
}

function sendMessage(payload: object): void {
	if (ws?.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(payload));
}

function parseFontFamilies(fontFamily: string): string[] {
	return fontFamily
		.split(",")
		.map(entry => entry.trim())
		.filter(Boolean)
		.map(entry => entry.replace(/^['"]|['"]$/g, ""));
}

function quoteFontFamily(family: string): string {
	if (family.startsWith("'") || family.startsWith('"')) return family;
	if (/[^a-zA-Z0-9_-]/.test(family)) return `"${family}"`;
	return family;
}

function resolveFontFamily(families: string[]): { resolved: string; match: ClientCapabilities["fontMatch"] } {
	if (!document.fonts?.check || families.length === 0) {
		return { resolved: "unknown", match: "unknown" };
	}
	const firstFamily = families[0];
	if (firstFamily && document.fonts.check(`${FONT_SIZE}px ${quoteFontFamily(firstFamily)}`)) {
		return { resolved: firstFamily, match: "exact" };
	}
	for (let i = 1; i < families.length; i += 1) {
		const family = families[i];
		if (family && document.fonts.check(`${FONT_SIZE}px ${quoteFontFamily(family)}`)) {
			return { resolved: family, match: "fallback" };
		}
	}
	return { resolved: "unknown", match: "unknown" };
}

function measureGlyphWidth(fontFamily: string, glyph: string): number | null {
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.font = `${FONT_SIZE}px ${fontFamily}`;
	return context.measureText(glyph).width;
}

function detectNerdSymbols(fontFamily: string, match: ClientCapabilities["fontMatch"]): boolean {
	if (match === "unknown") return false;
	const withFont = measureGlyphWidth(fontFamily, NERD_GLYPH);
	const fallback = measureGlyphWidth("monospace", NERD_GLYPH);
	if (withFont === null || fallback === null) return false;
	return Math.abs(withFont - fallback) > 0.1;
}

function measureEmojiWidth(): number | null {
	const probe = document.createElement("span");
	probe.textContent = TOKEN_GLYPH;
	probe.style.position = "fixed";
	probe.style.top = "-10000px";
	probe.style.left = "-10000px";
	probe.style.visibility = "hidden";
	probe.style.whiteSpace = "pre";
	probe.style.fontFamily = FONT_FAMILY;
	probe.style.fontSize = `${FONT_SIZE}px`;
	probe.style.lineHeight = "1";
	probe.style.contain = "layout paint size";
	document.body.appendChild(probe);
	const rect = probe.getBoundingClientRect();
	probe.remove();
	return rect.width > 0 ? rect.width : null;
}

function detectTokenEmoji(cellWidth: number): boolean {
	if (cellWidth <= 0) return false;
	const width = measureEmojiWidth();
	if (width === null) return false;
	return width <= cellWidth * 1.2;
}

function collectCapabilities(): ClientCapabilities {
	const families = parseFontFamilies(FONT_FAMILY);
	const resolved = resolveFontFamily(families);
	const fallbackCellWidth = Math.max(6, Math.min(14, FONT_SIZE * 0.62));
	const cell = measureCell();
	const cellWidth = cell?.width ?? fallbackCellWidth;
	return {
		fontFamilyConfigured: FONT_FAMILY,
		fontFamilyResolved: resolved.resolved,
		fontSize: FONT_SIZE,
		fontMatch: resolved.match,
		supportsNerdSymbols: detectNerdSymbols(FONT_FAMILY, resolved.match),
		supportsTokenEmoji: detectTokenEmoji(cellWidth),
	};
}

function sendCapabilities(): void {
	const payload = {
		type: "client_capabilities",
		...collectCapabilities(),
	};
	const serialized = JSON.stringify(payload);
	if (serialized === lastCapabilitiesPayload) return;
	lastCapabilitiesPayload = serialized;
	sendMessage(payload);
}

function collectDebugInfo(): ClientDebugInfo {
	const rect = terminalRoot.getBoundingClientRect();
	const viewport = window.visualViewport;
	const capabilities = collectCapabilities();
	return {
		timestamp: new Date().toISOString(),
		location: window.location.href,
		userAgent: navigator.userAgent,
		devicePixelRatio: window.devicePixelRatio,
		viewport: {
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
			documentWidth: document.documentElement.clientWidth,
			documentHeight: document.documentElement.clientHeight,
			visualViewport: viewport
				? {
						width: viewport.width,
						height: viewport.height,
						scale: viewport.scale,
						offsetLeft: viewport.offsetLeft,
						offsetTop: viewport.offsetTop,
					}
				: null,
		},
		terminal: {
			cols: term?.cols ?? null,
			rows: term?.rows ?? null,
			rootRect: {
				width: rect.width,
				height: rect.height,
				top: rect.top,
				left: rect.left,
			},
			sizing: collectSizing(),
			cell: measureCell(),
		},
		capabilities,
		config: {
			fontFamily: runtimeConfig?.fontFamily,
			fontSize: runtimeConfig?.fontSize,
		},
	};
}

function debugWebTerminal(reason = "manual"): ClientDebugInfo {
	const info = collectDebugInfo();
	console.log("[web-terminal] debug", { reason, info });
	sendMessage({ type: "client_debug", reason, info });
	return info;
}

function measureCell(): { width: number; height: number } | null {
	const xtermMeasure = terminalRoot.querySelector(".xterm-char-measure-element") as HTMLElement | null;
	if (xtermMeasure) {
		const rect = xtermMeasure.getBoundingClientRect();
		const contentLength = xtermMeasure.textContent?.length ?? 1;
		const charWidth = rect.width > 0 ? rect.width / Math.max(1, contentLength) : 8;
		const lineHeight = rect.height > 0 ? rect.height : 17;
		return {
			width: Math.max(4, Math.min(20, charWidth)),
			height: Math.max(1, lineHeight),
		};
	}
	return null;
}

function computeDimensions(): { cols: number; rows: number } | null {
	if (!term) return null;
	const rect = terminalRoot.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	const cell = measureCell();
	if (!cell) return null;
	let cols = Math.max(2, Math.floor(rect.width / cell.width) - RIGHT_MARGIN_COLS);
	if (cols < 20 && rect.width > 500) {
		const fallbackCellWidth = Math.max(6, Math.min(14, FONT_SIZE * 0.62));
		cols = Math.max(2, Math.floor(rect.width / fallbackCellWidth) - RIGHT_MARGIN_COLS);
	}
	const rows = Math.max(1, Math.floor(rect.height / cell.height));
	if (term.cols !== cols || term.rows !== rows) {
		term.resize(cols, rows);
	}
	return { cols, rows };
}

function sendResize(): void {
	const dimensions = computeDimensions();
	if (!dimensions) {
		console.log("[web-terminal] resize skipped", collectSizing());
		return;
	}
	if (dimensions.cols === lastSentCols && dimensions.rows === lastSentRows) {
		return;
	}
	if (ws?.readyState !== WebSocket.OPEN) {
		return;
	}
	lastSentCols = dimensions.cols;
	lastSentRows = dimensions.rows;
	const payload = { type: "resize", cols: dimensions.cols, rows: dimensions.rows };
	console.log("[web-terminal] resize", payload, collectSizing());
	sendMessage(payload);
}

function scheduleResize(reason: string): void {
	if (resizeTimer !== null) return;
	console.log("[web-terminal] scheduleResize", { reason });
	resizeTimer = window.setTimeout(() => {
		resizeTimer = null;
		sendResize();
	}, 80);
}

function attachResizeHooks(): void {
	const handleResize = (reason: string): void => {
		applyViewportSize();
		scheduleResize(reason);
	};
	window.addEventListener("resize", () => {
		handleResize("window");
	});
	window.visualViewport?.addEventListener("resize", () => {
		handleResize("visual-viewport");
	});
	window.visualViewport?.addEventListener("scroll", () => {
		handleResize("visual-viewport-scroll");
	});
	document.fonts?.ready.then(() => {
		handleResize("fonts-ready");
		sendCapabilities();
	});
}

function startWebSocket(): void {
	const wsUrl = new URL("/ws", window.location.href);
	wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
	ws = new WebSocket(wsUrl.toString());
	ws.addEventListener("open", () => {
		console.log("[web-terminal] websocket open", wsUrl.toString());
		requestAnimationFrame(() => sendResize());
		sendCapabilities();
		debugWebTerminal("websocket-open");
	});
	ws.addEventListener("message", event => {
		let payload: unknown;
		try {
			payload = JSON.parse(String(event.data));
		} catch {
			return;
		}
		if (!payload || typeof payload !== "object") return;
		const record = payload as Record<string, unknown>;
		if (record.type === "output" && typeof record.data === "string") {
			term?.write(record.data);
			return;
		}
		if (record.type === "status") {
			const message = typeof record.message === "string" ? record.message : "";
			const state = typeof record.state === "string" ? record.state : "status";
			const text = message ? `[${state}] ${message}` : `[${state}]`;
			term?.writeln(`\r\n${text}`);
		}
	});
	ws.addEventListener("close", () => {
		term?.writeln("\r\n[disconnected] WebSocket closed.");
	});
	ws.addEventListener("error", () => {
		term?.writeln("\r\n[error] WebSocket error.");
	});
}

function initTerminal(): void {
	term = new Terminal({
		cursorBlink: true,
		fontFamily: FONT_FAMILY,
		fontSize: FONT_SIZE,
		lineHeight: 1,
		letterSpacing: 0,
		allowProposedApi: true,
		scrollback: 5000,
	});
	const unicode11Addon = new Unicode11Addon();
	term.loadAddon(unicode11Addon);
	term.unicode.activeVersion = "11";
	term.open(terminalRoot);
	term.onData(data => {
		sendMessage({ type: "input", data });
	});
}

(
	window as typeof window & { webTerminalDebug?: () => void; debugWebTerminal?: () => ClientDebugInfo }
).webTerminalDebug = () => {
	debugWebTerminal("manual");
};
(
	window as typeof window & { webTerminalDebug?: () => void; debugWebTerminal?: () => ClientDebugInfo }
).debugWebTerminal = () => debugWebTerminal("manual");

function boot(): void {
	applyViewportSize();
	setupControls();
	initTerminal();
	attachResizeHooks();
	startWebSocket();
}

function setupControls(): void {
	if (!runtimeConfig?.showExtraControls) return;

	const controlsBar = document.getElementById("controls-bar");
	if (!controlsBar) return;

	const height = runtimeConfig.extraControlsHeightPx ?? 48;
	controlsBar.style.height = `${height}px`;
	controlsBar.style.display = "flex";

	const keys = runtimeConfig.extraControlKeys ?? ["esc", "enter", "up", "down", "left", "right"];

	const KEY_LABELS: Record<string, string> = {
		esc: "ESC",
		enter: "⏎",
		up: "↑",
		down: "↓",
		left: "←",
		right: "→",
		"ctrl+c": "Ctrl+C",
	};

	const KEY_CODES: Record<string, string> = {
		esc: "\u001b",
		enter: "\r",
		up: "\u001b[A",
		down: "\u001b[B",
		right: "\u001b[C",
		left: "\u001b[D",
		"ctrl+c": "\u0003",
	};

	for (const key of keys) {
		const btn = document.createElement("div");
		btn.className = "control-btn";
		btn.textContent = KEY_LABELS[key] ?? key.toUpperCase();

		const sendKey = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			const code = KEY_CODES[key];
			if (code) {
				sendMessage({ type: "input", data: code });
				term?.focus();
			}
		};

		btn.addEventListener("mousedown", sendKey);
		btn.addEventListener("touchstart", sendKey);

		controlsBar.appendChild(btn);
	}

	// Add keyboard toggle for mobile devices
	const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
	if (isMobile) {
		const btn = document.createElement("div");
		btn.className = "control-btn";
		btn.textContent = "⌨";
		btn.style.flex = "0 0 40px"; // Give it a fixed width so it doesn't take too much space

		const focusTerm = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			term?.focus();
		};

		btn.addEventListener("mousedown", focusTerm);
		btn.addEventListener("touchstart", focusTerm);

		controlsBar.appendChild(btn);
	}
}

if (document.readyState === "complete") {
	boot();
} else {
	window.addEventListener("load", boot, { once: true });
}
