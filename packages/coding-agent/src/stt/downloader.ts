import { $which, logger } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import { resolvePython } from "./transcriber";

export interface DownloadProgress {
	stage: string;
	percent?: number;
}

export interface EnsureOptions {
	backend?: string;
	modelName?: string;
	onProgress?: (progress: DownloadProgress) => void;
}

// ── Recording tool ─────────────────────────────────────────────────

async function ensureRecordingTool(options?: EnsureOptions): Promise<void> {
	if ($which("sox")) return;
	if ($which("ffmpeg")) return;
	if (process.platform === "linux" && $which("arecord")) return;

	// Windows: PowerShell mciSendString is always available as fallback
	if (process.platform === "win32") {
		// Try to get ffmpeg for better quality, but don't block on failure
		options?.onProgress?.({ stage: "Trying to install FFmpeg via winget..." });
		const result = await $`winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements`
			.quiet()
			.nothrow();
		if (result.exitCode === 0) {
			logger.debug("FFmpeg installed via winget");
		}
		return;
	}

	throw new Error(
		"No audio recording tool found. Install SoX: sudo apt install sox, or FFmpeg: sudo apt install ffmpeg",
	);
}

// ── Python whisper ─────────────────────────────────────────────────

async function ensurePythonWhisper(options?: EnsureOptions): Promise<void> {
	const pythonCmd = resolvePython();
	if (!pythonCmd) {
		throw new Error("Python not found. Install Python 3.8+ from https://python.org");
	}

	const isFaster = options?.backend === "faster-whisper";
	const importCheck = isFaster ? "from faster_whisper import WhisperModel" : "import whisper";

	const check = Bun.spawnSync([pythonCmd, "-c", importCheck], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (check.exitCode === 0) return;

	const pkgName = isFaster ? "faster-whisper" : "openai-whisper";
	options?.onProgress?.({ stage: `Installing ${pkgName} (this may take a few minutes)...` });
	logger.debug(`Installing ${pkgName} via pip`);

	if (isFaster) {
		// Install faster-whisper without av/numba — we load WAV via Python's wave module,
		// and av requires FFmpeg dev libs that are unavailable on many aarch64 systems.
		const nodeps = await $`${pythonCmd} -m pip install -q --no-deps faster-whisper`.quiet().nothrow();
		if (nodeps.exitCode !== 0) {
			const stderr = nodeps.stderr.toString().trim();
			throw new Error(`Failed to install faster-whisper: ${stderr.split("\n").pop()}`);
		}
		// Install only the runtime deps we actually use (no av, no numba)
		const deps = await $`${pythonCmd} -m pip install -q ctranslate2 tokenizers huggingface_hub numpy`
			.quiet()
			.nothrow();
		if (deps.exitCode !== 0) {
			const stderr = deps.stderr.toString().trim();
			logger.warn(`Some faster-whisper deps failed to install: ${stderr.split("\n").pop()}`);
		}
	} else {
		const install = await $`${pythonCmd} -m pip install -q openai-whisper`.quiet().nothrow();
		if (install.exitCode !== 0) {
			const stderr = install.stderr.toString().trim();
			throw new Error(`Failed to install openai-whisper: ${stderr.split("\n").pop()}`);
		}
	}
	logger.debug(`${pkgName} installed successfully`);
}

// ── Public API ─────────────────────────────────────────────────────

export async function ensureSTTDependencies(options?: EnsureOptions): Promise<void> {
	await ensureRecordingTool(options);
	await ensurePythonWhisper(options);
}
