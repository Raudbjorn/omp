export type ClientCapabilities = {
	fontFamilyConfigured: string;
	fontFamilyResolved: string;
	fontSize: number;
	fontMatch: "exact" | "fallback" | "unknown";
	supportsNerdSymbols: boolean;
	supportsTokenEmoji: boolean;
};

export type ClientDebugInfo = {
	timestamp: string;
	location: string;
	userAgent: string;
	devicePixelRatio: number;
	viewport: Record<string, unknown>;
	terminal: Record<string, unknown>;
	capabilities: ClientCapabilities;
	config: {
		fontFamily?: string;
		fontSize?: number;
	};
};

export type ClientMessage =
	| { type: "input"; data: string }
	| { type: "resize"; cols: number; rows: number }
	| ({ type: "client_capabilities" } & ClientCapabilities)
	| { type: "client_debug"; reason?: string; info: ClientDebugInfo };

export type ServerStatusState = "starting" | "running" | "exited" | "error";

export type ServerMessage =
	| { type: "output"; data: string }
	| { type: "status"; state: ServerStatusState; message?: string };

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isFontMatch(value: unknown): value is ClientCapabilities["fontMatch"] {
	return value === "exact" || value === "fallback" || value === "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function parseClientCapabilities(record: Record<string, unknown>): ClientCapabilities | null {
	const fontFamilyConfigured = record.fontFamilyConfigured;
	const fontFamilyResolved = record.fontFamilyResolved;
	const fontSize = record.fontSize;
	const fontMatch = record.fontMatch;
	const supportsNerdSymbols = record.supportsNerdSymbols;
	const supportsTokenEmoji = record.supportsTokenEmoji;
	if (
		typeof fontFamilyConfigured === "string" &&
		typeof fontFamilyResolved === "string" &&
		isNumber(fontSize) &&
		isFontMatch(fontMatch) &&
		typeof supportsNerdSymbols === "boolean" &&
		typeof supportsTokenEmoji === "boolean"
	) {
		return {
			fontFamilyConfigured,
			fontFamilyResolved,
			fontSize,
			fontMatch,
			supportsNerdSymbols,
			supportsTokenEmoji,
		};
	}
	return null;
}

function parseClientDebugInfo(value: unknown): ClientDebugInfo | null {
	if (!isRecord(value)) return null;
	const timestamp = value.timestamp;
	const location = value.location;
	const userAgent = value.userAgent;
	const devicePixelRatio = value.devicePixelRatio;
	const viewport = value.viewport;
	const terminal = value.terminal;
	const config = value.config;
	const capabilitiesRecord = value.capabilities;
	const capabilities = isRecord(capabilitiesRecord) ? parseClientCapabilities(capabilitiesRecord) : null;
	if (
		typeof timestamp === "string" &&
		typeof location === "string" &&
		typeof userAgent === "string" &&
		isNumber(devicePixelRatio) &&
		isRecord(viewport) &&
		isRecord(terminal) &&
		isRecord(config) &&
		capabilities
	) {
		const fontFamily = config.fontFamily;
		const fontSize = config.fontSize;
		return {
			timestamp,
			location,
			userAgent,
			devicePixelRatio,
			viewport,
			terminal,
			capabilities,
			config: {
				fontFamily: typeof fontFamily === "string" ? fontFamily : undefined,
				fontSize: isNumber(fontSize) ? fontSize : undefined,
			},
		};
	}
	return null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	if (record.type === "input") {
		return typeof record.data === "string" ? { type: "input", data: record.data } : null;
	}
	if (record.type === "resize") {
		return isNumber(record.cols) && isNumber(record.rows)
			? { type: "resize", cols: record.cols, rows: record.rows }
			: null;
	}
	if (record.type === "client_capabilities") {
		const capabilities = parseClientCapabilities(record);
		return capabilities ? { type: "client_capabilities", ...capabilities } : null;
	}
	if (record.type === "client_debug") {
		const info = parseClientDebugInfo(record.info);
		if (!info) return null;
		const reason = record.reason;
		return {
			type: "client_debug",
			reason: typeof reason === "string" ? reason : undefined,
			info,
		};
	}
	return null;
}

export function serializeServerMessage(message: ServerMessage): string {
	return JSON.stringify(message);
}
