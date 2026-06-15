import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { settings } from "../../config/settings";
import type { BuiltinSlashCommandSpec } from "../../slash-commands/builtin-registry";
import { ensureSupportedImageInput, loadImageInput } from "../../utils/image-loading";

type CaptureMode = "selection" | "full";

type CaptureTool = {
	binary: string;
	buildArgs: (mode: CaptureMode, outPath: string) => string[];
};

const MACOS_TOOL: CaptureTool = {
	binary: "screencapture",
	buildArgs: (mode, outPath) => (mode === "selection" ? ["-i", "-x", outPath] : ["-x", outPath]),
};

const WAYLAND_GRIM: CaptureTool = {
	binary: "grim",
	buildArgs: (_mode, outPath) => [outPath],
};

const WAYLAND_GRIM_SLURP: CaptureTool = {
	binary: "sh",
	buildArgs: (_mode, outPath) => ["-c", `grim -g "$(slurp)" ${JSON.stringify(outPath)}`],
};

const X11_SCROT: CaptureTool = {
	binary: "scrot",
	buildArgs: (mode, outPath) => (mode === "selection" ? ["-s", outPath] : [outPath]),
};

const X11_GNOME: CaptureTool = {
	binary: "gnome-screenshot",
	buildArgs: (mode, outPath) => (mode === "selection" ? ["-a", "-f", outPath] : ["-f", outPath]),
};

async function which(binary: string): Promise<boolean> {
	const proc = Bun.spawn(["which", binary], { stdout: "ignore", stderr: "ignore" });
	const code = await proc.exited;
	return code === 0;
}

async function pickTool(mode: CaptureMode): Promise<CaptureTool | null> {
	const platform = os.platform();
	if (platform === "darwin") return MACOS_TOOL;
	if (platform !== "linux") return null;

	if (process.env.WAYLAND_DISPLAY) {
		const grim = await which("grim");
		if (!grim) return null;
		if (mode === "selection") {
			const slurp = await which("slurp");
			return slurp ? WAYLAND_GRIM_SLURP : WAYLAND_GRIM;
		}
		return WAYLAND_GRIM;
	}

	if (await which("scrot")) return X11_SCROT;
	if (await which("gnome-screenshot")) return X11_GNOME;
	return null;
}

async function captureScreenshot(mode: CaptureMode, cwd: string): Promise<string | null> {
	const tool = await pickTool(mode);
	if (!tool) return null;

	const outPath = path.join(os.tmpdir(), `omp-screenshot-${Date.now()}.png`);
	const args = tool.buildArgs(mode, outPath);

	const proc = Bun.spawn([tool.binary, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		cwd,
	});
	const code = await proc.exited;

	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		logger.debug("screenshot: capture failed", { tool: tool.binary, code, stderr });
		return null;
	}

	const file = Bun.file(outPath);
	if (!(await file.exists()) || file.size === 0) return null;
	return outPath;
}

export const screenshotSlashCommand: BuiltinSlashCommandSpec = {
	name: "screenshot",
	description: "Capture a desktop screenshot and attach it to your message",
	aliases: ["screen"],
	allowArgs: true,
	inlineHint: "[full|selection]",
	handle: async (command, runtime) => {
		const arg = command.args.trim().toLowerCase();
		const mode: CaptureMode = arg === "full" || arg === "f" ? "full" : "selection";

		const cwd = runtime.ctx.session.sessionManager.getCwd();
		runtime.ctx.showStatus(mode === "selection" ? "Select a region…" : "Capturing screen…");

		let capturedPath: string | null;
		try {
			capturedPath = await captureScreenshot(mode, cwd);
		} catch (error) {
			logger.debug("screenshot: spawn error", {
				error: error instanceof Error ? error.message : String(error),
			});
			runtime.ctx.showWarning("Screenshot failed (capture tool errored)");
			return;
		}

		if (!capturedPath) {
			runtime.ctx.showWarning(
				os.platform() === "linux"
					? "No screenshot tool found (install grim+slurp, scrot, or gnome-screenshot)"
					: "Screenshot capture failed or cancelled",
			);
			return;
		}

		try {
			const loaded = await loadImageInput({
				path: capturedPath,
				cwd,
				autoResize: settings.get("images.autoResize"),
			});
			if (!loaded) {
				runtime.ctx.showWarning("Screenshot saved but could not be loaded as image");
				return;
			}

			const supported = await ensureSupportedImageInput({
				type: "image",
				data: loaded.data,
				mimeType: loaded.mimeType,
			});
			if (!supported) {
				runtime.ctx.showWarning(`Unsupported screenshot format: ${loaded.mimeType}`);
				return;
			}

			runtime.ctx.pendingImages.push({
				type: "image",
				data: supported.data,
				mimeType: supported.mimeType,
			});
			const imageNum = runtime.ctx.pendingImages.length;
			runtime.ctx.editor.insertText(`[Image #${imageNum}] `);
			runtime.ctx.ui.requestRender();
			runtime.ctx.showStatus(`Attached screenshot #${imageNum}`);
		} catch (error) {
			logger.debug("screenshot: load error", {
				error: error instanceof Error ? error.message : String(error),
			});
			runtime.ctx.showWarning("Screenshot loaded but failed to attach");
		}
	},
};
