import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";

const LIVE_RELOAD_DEBOUNCE_MS = 150;
const SKILL_FILE_NAME = "SKILL.md";

export type OmpLiveReloadMode = "omp" | "none";

export interface OmpLiveReloadState {
	mode: OmpLiveReloadMode;
	projectDir: string;
	userAgentDir: string;
}

export interface OmpLiveReloadCallbacks {
	onRefreshRequested: (reason: "commands" | "skills" | "roots") => Promise<void>;
	onErrorStateChanged: (message: string | undefined) => void;
}

/**
 * OMP live-reload watcher orchestration.
 *
 * Key API goal: keep filesystem watch lifecycle and failure tracking in one place,
 * so interactive mode only provides refresh + UI callbacks.
 */
export class OmpLiveReloadController {
	#callbacks: OmpLiveReloadCallbacks;
	#state: OmpLiveReloadState;
	#watchers: fs.FSWatcher[] = [];
	#pendingRefreshTimer: NodeJS.Timeout | undefined = undefined;
	#rootProbeTimer: NodeJS.Timeout | undefined = undefined;
	#refreshInFlight = false;
	#queuedRefreshReason: "commands" | "skills" | "roots" | undefined = undefined;
	#errorMessage: string | undefined = undefined;
	#knownProjectRootExists = false;
	#knownUserRootExists = false;

	constructor(callbacks: OmpLiveReloadCallbacks, initialState: OmpLiveReloadState) {
		this.#callbacks = callbacks;
		this.#state = initialState;
	}

	async configure(nextState: OmpLiveReloadState): Promise<void> {
		this.#state = nextState;
		await this.#updateKnownRootState();
		await this.rebind({ triggerRefresh: false });
		this.#restartRootProbe();
	}

	async rebind(options: { triggerRefresh: boolean }): Promise<void> {
		this.#disposeWatchers();
		if (this.#state.mode === "none") {
			this.#setError(undefined);
			return;
		}

		try {
			const watchers = await this.#createWatchers();
			this.#watchers = watchers;
			this.#setError(undefined);
			if (options.triggerRefresh) {
				this.#queueRefresh("roots");
			}
		} catch (error) {
			this.#disposeWatchers();
			this.#setError(this.#formatWatcherError(error));
		}
	}

	dispose(): void {
		if (this.#rootProbeTimer) {
			clearInterval(this.#rootProbeTimer);
			this.#rootProbeTimer = undefined;
		}
		this.#disposeWatchers();
		if (this.#pendingRefreshTimer) {
			clearTimeout(this.#pendingRefreshTimer);
			this.#pendingRefreshTimer = undefined;
		}
		this.#queuedRefreshReason = undefined;
	}

	async #createWatchers(): Promise<fs.FSWatcher[]> {
		const watchers: fs.FSWatcher[] = [];
		const projectRoot = path.join(this.#state.projectDir, ".omp");
		const userRoot = this.#state.userAgentDir;

		watchers.push(
			this.#watchPath(this.#state.projectDir, (eventType, filename) => {
				if (this.#matchesEntry(filename, ".omp")) {
					void this.rebind({ triggerRefresh: true });
					return;
				}
				if (eventType === "rename" && this.#matchesEntry(filename, path.basename(projectRoot))) {
					void this.rebind({ triggerRefresh: true });
				}
			}),
		);

		const userParentDir = path.dirname(userRoot);
		watchers.push(
			this.#watchPath(userParentDir, (_eventType, filename) => {
				if (this.#matchesEntry(filename, path.basename(userRoot))) {
					void this.rebind({ triggerRefresh: true });
				}
			}),
		);

		for (const root of [projectRoot, userRoot]) {
			if (!(await this.#isDirectory(root))) {
				continue;
			}

			watchers.push(
				this.#watchPath(root, (_eventType, filename) => {
					if (this.#matchesEntry(filename, "commands") || this.#matchesEntry(filename, "skills")) {
						void this.rebind({ triggerRefresh: true });
					}
				}),
			);

			const commandsDir = path.join(root, "commands");
			if (await this.#isDirectory(commandsDir)) {
				watchers.push(
					this.#watchPath(commandsDir, () => {
						this.#queueRefresh("commands");
					}),
				);
			}

			const skillsDir = path.join(root, "skills");
			if (!(await this.#isDirectory(skillsDir))) {
				continue;
			}

			watchers.push(
				this.#watchPath(skillsDir, () => {
					void this.rebind({ triggerRefresh: true });
				}),
			);

			const skillDirectories = await this.#listChildDirectories(skillsDir);
			for (const skillDirectory of skillDirectories) {
				watchers.push(
					this.#watchPath(skillDirectory, (_eventType, filename) => {
						if (!filename || this.#matchesEntry(filename, SKILL_FILE_NAME)) {
							this.#queueRefresh("skills");
						}
					}),
				);
			}
		}

		return watchers;
	}

	#watchPath(
		targetPath: string,
		onEvent: (eventType: string, filename: string | Buffer | null) => void,
	): fs.FSWatcher {
		const watcher = fs.watch(targetPath, (eventType, filename) => {
			onEvent(eventType, filename);
		});
		watcher.on("error", error => {
			this.#setError(this.#formatWatcherError(error));
		});
		return watcher;
	}

	#queueRefresh(reason: "commands" | "skills" | "roots"): void {
		this.#queuedRefreshReason = reason;
		if (this.#pendingRefreshTimer) {
			clearTimeout(this.#pendingRefreshTimer);
		}
		this.#pendingRefreshTimer = setTimeout(() => {
			this.#pendingRefreshTimer = undefined;
			void this.#flushRefresh();
		}, LIVE_RELOAD_DEBOUNCE_MS);
	}

	async #flushRefresh(): Promise<void> {
		if (this.#refreshInFlight) {
			return;
		}
		this.#refreshInFlight = true;
		try {
			while (this.#queuedRefreshReason) {
				const reason = this.#queuedRefreshReason;
				this.#queuedRefreshReason = undefined;
				await this.#callbacks.onRefreshRequested(reason);
			}
		} catch (error) {
			logger.warn("OMP live-reload refresh failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.#refreshInFlight = false;
		}
	}

	#matchesEntry(filename: string | Buffer | null, expected: string): boolean {
		if (!filename) {
			return true;
		}
		const normalized = filename instanceof Buffer ? filename.toString("utf8") : filename;
		return normalized === expected;
	}

	async #listChildDirectories(dirPath: string): Promise<string[]> {
		try {
			const entries = await fsp.readdir(dirPath, { withFileTypes: true });
			return entries.filter(entry => entry.isDirectory()).map(entry => path.join(dirPath, entry.name));
		} catch (error) {
			if (isEnoent(error)) {
				return [];
			}
			throw error;
		}
	}

	async #isDirectory(dirPath: string): Promise<boolean> {
		try {
			const stats = await fsp.stat(dirPath);
			return stats.isDirectory();
		} catch (error) {
			if (isEnoent(error)) {
				return false;
			}
			throw error;
		}
	}

	#setError(message: string | undefined): void {
		if (this.#errorMessage === message) {
			return;
		}
		this.#errorMessage = message;
		this.#callbacks.onErrorStateChanged(message);
	}

	#formatWatcherError(error: unknown): string {
		const code =
			typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
		const detail = error instanceof Error ? error.message : String(error);
		if (code === "ENOSPC") {
			return "OMP live reload failed (ENOSPC): inotify watch limit reached. Increase fs.inotify.max_user_watches, then run /reload.";
		}
		return `OMP live reload failed${code ? ` (${code})` : ""}: ${detail}. Fix watcher access, then run /reload.`;
	}

	#disposeWatchers(): void {
		for (const watcher of this.#watchers) {
			try {
				watcher.close();
			} catch {
				// Ignore close failures during teardown.
			}
		}
		this.#watchers = [];
	}

	#restartRootProbe(): void {
		if (this.#rootProbeTimer) {
			clearInterval(this.#rootProbeTimer);
			this.#rootProbeTimer = undefined;
		}
		if (this.#state.mode === "none") {
			return;
		}
		this.#rootProbeTimer = setInterval(() => {
			void this.#checkRootStateChanges();
		}, 750);
	}

	async #checkRootStateChanges(): Promise<void> {
		const previousProject = this.#knownProjectRootExists;
		const previousUser = this.#knownUserRootExists;
		await this.#updateKnownRootState();
		if (previousProject !== this.#knownProjectRootExists || previousUser !== this.#knownUserRootExists) {
			await this.rebind({ triggerRefresh: true });
		}
	}

	async #updateKnownRootState(): Promise<void> {
		const projectRoot = path.join(this.#state.projectDir, ".omp");
		const userRoot = this.#state.userAgentDir;
		this.#knownProjectRootExists = await this.#isDirectory(projectRoot);
		this.#knownUserRootExists = await this.#isDirectory(userRoot);
	}
}
