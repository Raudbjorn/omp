import { type Component, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { APP_NAME } from "@oh-my-pi/pi-utils";
import { theme } from "../../modes/theme/theme";

const WELCOME_BORDER_HOT_PINK_ANSI = "\x1b[38;2;247;18;232m";
const ANSI_FOREGROUND_RESET = "\x1b[39m";

export interface RecentSession {
	name: string;
	timeAgo: string;
}

export interface LspServerInfo {
	name: string;
	status: "ready" | "error" | "connecting";
	fileTypes: string[];
}

/**
 * Premium welcome screen with block-based OMP logo and two-column layout.
 */
export class WelcomeComponent implements Component {
	constructor(
		private readonly version: string,
		private modelName: string,
		private providerName: string,
		private recentSessions: RecentSession[] = [],
		private lspServers: LspServerInfo[] = [],
	) {}

	invalidate(): void {}

	setModel(modelName: string, providerName: string): void {
		this.modelName = modelName;
		this.providerName = providerName;
	}

	setRecentSessions(sessions: RecentSession[]): void {
		this.recentSessions = sessions;
	}

	setLspServers(servers: LspServerInfo[]): void {
		this.lspServers = servers;
	}

	render(termWidth: number): string[] {
		// Box dimensions - responsive with max width and small-terminal support
		const maxWidth = 100;
		const boxWidth = Math.min(maxWidth, Math.max(0, termWidth - 2));
		if (boxWidth < 4) {
			return [];
		}
		const dualContentWidth = boxWidth - 3; // 3 = │ + │ + │
		const preferredLeftCol = 26;
		const minLeftCol = 14; // logo width
		const minRightCol = 20;
		const leftMinContentWidth = Math.max(
			minLeftCol,
			visibleWidth("Welcome back!"),
			visibleWidth(this.modelName),
			visibleWidth(this.providerName),
		);
		const desiredLeftCol = Math.min(preferredLeftCol, Math.max(minLeftCol, Math.floor(dualContentWidth * 0.35)));
		const dualLeftCol =
			dualContentWidth >= minRightCol + 1
				? Math.min(desiredLeftCol, dualContentWidth - minRightCol)
				: Math.max(1, dualContentWidth - 1);
		const dualRightCol = Math.max(1, dualContentWidth - dualLeftCol);
		const showRightColumn = dualLeftCol >= leftMinContentWidth && dualRightCol >= minRightCol;
		const leftCol = showRightColumn ? dualLeftCol : boxWidth - 2;
		const rightCol = showRightColumn ? dualRightCol : 0;

		// Block-based OMP bear logo (radial warm-honey → dark-bark gradient)
		// biome-ignore format: preserve ASCII art layout
		const bearLogo = [
			"  #▓░▓##▓░▓#  ",
			" #░░░░░░░░░░# ",
			"##░░░░░░░░░░##",
			"#░██░░░░░░██░#",
			"#░░░░██████░░#",
			"##░░░██░░██░░#",
			" ░░░░░░░░░░░░ ",
			"  ░░░░░░░░░░  ",
			"   ░░░░░░░░   ",
			"    ░░░░░░    ",
			"     ░░░░     ",
		];

		// Apply gradient to bear (warm honey center → dark bark edges)
		const logoColored = this.#radialGradient(bearLogo, 7, 5);

		// Left column - centered content
		const leftLines = [
			"",
			this.#centerText(theme.bold("Welcome back!"), leftCol),
			"",
			...logoColored.map(l => this.#centerText(l, leftCol)),
			"",
			this.#centerText(theme.fg("muted", this.modelName), leftCol),
			this.#centerText(theme.fg("borderMuted", this.providerName), leftCol),
		];

		// Right column separator
		const separatorWidth = Math.max(0, rightCol - 2); // padding on each side
		const separator = ` ${this.#hotPink(theme.boxRound.horizontal.repeat(separatorWidth))}`;

		// Recent sessions content
		const sessionLines: string[] = [];
		if (this.recentSessions.length === 0) {
			sessionLines.push(` ${theme.fg("dim", "No recent sessions")}`);
		} else {
			// Reserve width for the bullet prefix (" • ") and the trailing " (timeAgo)"
			// so the relative time is never the part that gets truncated. The name
			// absorbs whatever space is left.
			const bulletPrefix = ` ${theme.md.bullet} `;
			const prefixWidth = visibleWidth(bulletPrefix);
			for (const session of this.recentSessions.slice(0, 3)) {
				const timeSuffixRaw = ` (${session.timeAgo})`;
				const timeWidth = visibleWidth(timeSuffixRaw);
				const nameBudget = Math.max(1, rightCol - prefixWidth - timeWidth);
				const nameVis = visibleWidth(session.name);
				const name = nameVis > nameBudget ? truncateToWidth(session.name, nameBudget) : session.name;
				sessionLines.push(
					`${theme.fg("dim", bulletPrefix)}${theme.fg("muted", name)}${theme.fg("dim", timeSuffixRaw)}`,
				);
			}
		}

		// LSP servers content
		const lspLines: string[] = [];
		if (this.lspServers.length === 0) {
			lspLines.push(` ${theme.fg("dim", "No LSP servers")}`);
		} else {
			for (const server of this.lspServers) {
				const icon =
					server.status === "ready"
						? theme.styledSymbol("status.success", "success")
						: server.status === "connecting"
							? theme.styledSymbol("status.pending", "muted")
							: theme.styledSymbol("status.error", "error");
				const exts = server.fileTypes.slice(0, 3).join(" ");
				lspLines.push(` ${icon} ${theme.fg("muted", server.name)} ${theme.fg("dim", exts)}`);
			}
		}

		// Right column
		const rightLines = [
			` ${theme.bold(theme.fg("accent", "Tips"))}`,
			` ${theme.fg("dim", "?")}${theme.fg("muted", " for keyboard shortcuts")}`,
			` ${theme.fg("dim", "#")}${theme.fg("muted", " for prompt actions")}`,
			` ${theme.fg("dim", "/")}${theme.fg("muted", " for commands")}`,
			` ${theme.fg("dim", "!")}${theme.fg("muted", " to run bash")}`,
			` ${theme.fg("dim", "$")}${theme.fg("muted", " to run python")}`,
			separator,
			` ${theme.bold(theme.fg("accent", "LSP Servers"))}`,
			...lspLines,
			separator,
			` ${theme.bold(theme.fg("accent", "Recent sessions"))}`,
			...sessionLines,
			"",
		];

		// Border characters (ANSI hot pink)
		const hChar = theme.boxRound.horizontal;
		const v = this.#hotPink(theme.boxRound.vertical);
		const tl = this.#hotPink(theme.boxRound.topLeft);
		const tr = this.#hotPink(theme.boxRound.topRight);
		const bl = this.#hotPink(theme.boxRound.bottomLeft);
		const br = this.#hotPink(theme.boxRound.bottomRight);

		const lines: string[] = [];

		// Top border with embedded title
		const title = ` ${APP_NAME} v${this.version} `;
		const titlePrefixRaw = hChar.repeat(3);
		const titleStyled = this.#hotPink(titlePrefixRaw) + theme.fg("muted", title);
		const titleVisLen = visibleWidth(titlePrefixRaw) + visibleWidth(title);
		const titleSpace = boxWidth - 2;
		if (titleVisLen >= titleSpace) {
			lines.push(tl + truncateToWidth(titleStyled, titleSpace) + tr);
		} else {
			const afterTitle = titleSpace - titleVisLen;
			lines.push(tl + titleStyled + this.#hotPink(hChar.repeat(afterTitle)) + tr);
		}

		// Content rows
		const maxRows = showRightColumn ? Math.max(leftLines.length, rightLines.length) : leftLines.length;
		for (let i = 0; i < maxRows; i++) {
			const left = this.#fitToWidth(leftLines[i] ?? "", leftCol);
			if (showRightColumn) {
				const right = this.#fitToWidth(rightLines[i] ?? "", rightCol);
				lines.push(v + left + v + right + v);
			} else {
				lines.push(v + left + v);
			}
		}
		// Bottom border
		if (showRightColumn) {
			lines.push(
				bl +
					this.#hotPink(hChar.repeat(leftCol)) +
					this.#hotPink(theme.boxSharp.teeUp) +
					this.#hotPink(hChar.repeat(rightCol)) +
					br,
			);
		} else {
			lines.push(bl + this.#hotPink(hChar.repeat(leftCol)) + br);
		}

		return lines;
	}

	/** Center text within a given width */
	#centerText(text: string, width: number): string {
		const visLen = visibleWidth(text);
		if (visLen >= width) {
			return truncateToWidth(text, width);
		}
		const leftPad = Math.floor((width - visLen) / 2);
		const rightPad = width - visLen - leftPad;
		return padding(leftPad) + text + padding(rightPad);
	}

	/** Apply a radial gradient (warm honey at center → dark bark at edges) to the bear logo */
	#radialGradient(logo: string[], centerCol: number, centerRow: number): string[] {
		const cx = centerCol - 1;
		const cy = centerRow - 1;

		let maxDist = 0;
		for (let row = 0; row < logo.length; row++) {
			for (let col = 0; col < logo[row].length; col++) {
				if (logo[row][col] !== " ") {
					const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
					if (dist > maxDist) maxDist = dist;
				}
			}
		}

		const stops = [
			[255, 210, 130],
			[230, 165, 80],
			[190, 115, 55],
			[140, 75, 35],
			[85, 45, 20],
			[35, 18, 8],
		];
		const reset = "\x1b[0m";

		return logo.map((line, row) => {
			let result = "";
			for (let col = 0; col < line.length; col++) {
				const char = line[col];
				if (char === " ") {
					result += char;
					continue;
				}
				const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
				const t = maxDist > 0 ? Math.min(1, dist / maxDist) : 0;
				const scaledT = t * (stops.length - 1);
				const idx = Math.min(Math.floor(scaledT), stops.length - 2);
				const frac = scaledT - idx;
				const r = Math.round(stops[idx][0] + (stops[idx + 1][0] - stops[idx][0]) * frac);
				const g = Math.round(stops[idx][1] + (stops[idx + 1][1] - stops[idx][1]) * frac);
				const b = Math.round(stops[idx][2] + (stops[idx + 1][2] - stops[idx][2]) * frac);
				result += `\x1b[38;2;${r};${g};${b}m${char}${reset}`;
			}
			return result;
		});
	}

	#hotPink(text: string): string {
		return `${WELCOME_BORDER_HOT_PINK_ANSI}${text}${ANSI_FOREGROUND_RESET}`;
	}

	/** Fit string to exact width with ANSI-aware truncation/padding */
	#fitToWidth(str: string, width: number): string {
		const visLen = visibleWidth(str);
		if (visLen > width) {
			const ellipsis = "…";
			const ellipsisWidth = visibleWidth(ellipsis);
			const maxWidth = Math.max(0, width - ellipsisWidth);
			let truncated = "";
			let currentWidth = 0;
			let inEscape = false;
			for (const char of str) {
				if (char === "\x1b") inEscape = true;
				if (inEscape) {
					truncated += char;
					if (char === "m") inEscape = false;
				} else if (currentWidth < maxWidth) {
					truncated += char;
					currentWidth++;
				}
			}
			return `${truncated}${ellipsis}`;
		}
		return str + padding(width - visLen);
	}
}
