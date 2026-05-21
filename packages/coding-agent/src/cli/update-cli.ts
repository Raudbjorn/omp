/**
 * Update CLI command handler.
 *
 * Handles `omp update` to check for and install updates.
 * Uses bun if available, otherwise downloads binary from GitHub releases.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { $which, APP_NAME, isEnoent, VERSION } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import chalk from "chalk";
import { theme } from "../modes/theme/theme";

const REPO = "Raudbjorn/omp";
// Upstream repo kept as reference: can1357/oh-my-pi
const PACKAGE = "@oh-my-pi/pi-coding-agent"; // unused for source installs; kept for bun/binary fallback

interface ReleaseInfo {
	tag: string;
	version: string;
}

/**
 * Parse update subcommand arguments.
 * Returns undefined if not an update command.
 */
export function parseUpdateArgs(args: string[]): { force: boolean; check: boolean } | undefined {
	if (args.length === 0 || args[0] !== "update") {
		return undefined;
	}

	return {
		force: args.includes("--force") || args.includes("-f"),
		check: args.includes("--check") || args.includes("-c"),
	};
}

async function getBunGlobalBinDir(): Promise<string | undefined> {
	if (!$which("bun")) return undefined;
	try {
		const result = await $`bun pm bin -g`.quiet().nothrow();
		if (result.exitCode !== 0) return undefined;
		const output = result.text().trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}

function normalizePathForComparison(filePath: string): string {
	const normalized = path.normalize(filePath);
	if (process.platform === "win32") return normalized.toLowerCase();
	return normalized;
}

function tryRealpath(p: string): string | undefined {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return undefined;
	}
}

function isPathInDirectoryLexical(filePath: string, directoryPath: string): boolean {
	const normalizedPath = normalizePathForComparison(path.resolve(filePath));
	const normalizedDirectory = normalizePathForComparison(path.resolve(directoryPath));
	const relativePath = path.relative(normalizedDirectory, normalizedPath);
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isPathInDirectory(filePath: string, directoryPath: string): boolean {
	if (isPathInDirectoryLexical(filePath, directoryPath)) return true;
	// Layer realpath resolution on top of the lexical guard. On Windows, ~/.bun
	// is a junction when Bun is installed via Scoop, so `bun pm bin -g` and the
	// PATH-resolved omp path can refer to the same directory through different
	// strings. path.resolve does not traverse junctions/symlinks; realpath does.
	// Resolve the file's parent directory to tolerate the file itself not yet
	// existing (e.g. a fresh install path) while still catching link-traversed
	// equality once the directory exists.
	const fileDir = tryRealpath(path.dirname(path.resolve(filePath)));
	const dirReal = tryRealpath(path.resolve(directoryPath));
	if (!fileDir || !dirReal) return false;
	const resolvedFile = path.join(fileDir, path.basename(filePath));
	return isPathInDirectoryLexical(resolvedFile, dirReal);
}

type UpdateTarget = { method: "bun" } | { method: "binary"; path: string } | { method: "source"; home: string };

/**
 * Reads OMP_HOME from the wrapper script to determine the source install directory.
 * Returns undefined if the binary is not a source-install wrapper.
 */
export function readSourceHome(): string | undefined {
	const wrapperPath = resolveOmpPath();
	if (!wrapperPath) return undefined;
	try {
		const content = fs.readFileSync(wrapperPath, "utf-8");
		const match = content.match(/OMP_HOME="([^"]+)"/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

function resolveUpdateMethod(ompPath: string, bunBinDir: string | undefined): "bun" | "binary" {
	if (!bunBinDir) return "binary";
	return isPathInDirectory(ompPath, bunBinDir) ? "bun" : "binary";
}

export function _resolveUpdateMethodForTest(ompPath: string, bunBinDir: string | undefined): "bun" | "binary" {
	return resolveUpdateMethod(ompPath, bunBinDir);
}

async function resolveUpdateTarget(): Promise<UpdateTarget> {
	// Source install: wrapper contains OMP_HOME — use git-based update
	const sourceHome = readSourceHome();
	if (sourceHome) return { method: "source", home: sourceHome };

	// Fallback: bun-global or binary install
	const bunBinDir = await getBunGlobalBinDir();
	const ompPath = resolveOmpPath();
	if (ompPath) {
		const method = resolveUpdateMethod(ompPath, bunBinDir);
		if (method === "bun") return { method };
		return { method: "binary", path: ompPath };
	}
	if (bunBinDir) return { method: "bun" };
	throw new Error(`Could not resolve ${APP_NAME} binary path in PATH`);
}

/**
 * Get the latest release info from the npm registry.
 * Uses npm instead of GitHub API to avoid unauthenticated rate limiting.
 */
async function getLatestRelease(): Promise<ReleaseInfo> {
	const response = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`);
	if (!response.ok) {
		throw new Error(`Failed to fetch release info: ${response.statusText}`);
	}

	const data = (await response.json()) as { version: string };
	const version = data.version;
	const tag = `v${version}`;

	return {
		tag,
		version,
	};
}

/**
 * Compare semver versions. Returns:
 * - negative if a < b
 * - 0 if a == b
 * - positive if a > b
 */
function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);

	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] || 0;
		const nb = pb[i] || 0;
		if (na !== nb) return na - nb;
	}
	return 0;
}

/**
 * Get the appropriate binary name for this platform.
 */
function getBinaryName(): string {
	const platform = process.platform;
	const arch = process.arch;

	let os: string;
	switch (platform) {
		case "linux":
			os = "linux";
			break;
		case "darwin":
			os = "darwin";
			break;
		case "win32":
			os = "windows";
			break;
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}

	let archName: string;
	switch (arch) {
		case "x64":
			archName = "x64";
			break;
		case "arm64":
			archName = "arm64";
			break;
		default:
			throw new Error(`Unsupported architecture: ${arch}`);
	}

	if (os === "windows") {
		return `${APP_NAME}-${os}-${archName}.exe`;
	}
	return `${APP_NAME}-${os}-${archName}`;
}

/**
 * Resolve the path that `omp` maps to in the user's PATH.
 */
function resolveOmpPath(): string | undefined {
	return $which(APP_NAME) ?? undefined;
}

/**
 * Run the resolved omp binary and check if it reports the expected version.
 */
async function verifyInstalledVersion(
	expectedVersion: string,
): Promise<{ ok: boolean; actual?: string; path?: string }> {
	const ompPath = resolveOmpPath();
	if (!ompPath) return { ok: false };
	try {
		const result = await $`${ompPath} --version`.quiet().nothrow();
		if (result.exitCode !== 0) return { ok: false, path: ompPath };
		const output = result.text().trim();
		// Output format: "omp/X.Y.Z" (APP_NAME/VERSION);
		const match = output.match(/\/(\d+\.\d+\.\d+)/);
		const actual = match?.[1];
		return { ok: actual === expectedVersion, actual, path: ompPath };
	} catch {
		return { ok: false, path: ompPath };
	}
}

/**
 * Print post-update verification result.
 */
async function printVerification(expectedVersion: string): Promise<void> {
	const result = await verifyInstalledVersion(expectedVersion);
	if (result.ok) {
		console.log(chalk.green(`\n${theme.status.success} Updated to ${expectedVersion}`));
		return;
	}
	if (result.actual) {
		console.log(
			chalk.yellow(
				`\nWarning: ${APP_NAME} at ${result.path} still reports ${result.actual} (expected ${expectedVersion})`,
			),
		);
	} else {
		console.log(
			chalk.yellow(`\nWarning: could not verify updated version${result.path ? ` at ${result.path}` : ""}`),
		);
	}
	console.log(
		chalk.yellow(
			`You may need to reinstall: curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh | sh`,
		),
	);
}

/**
 * Update via bun package manager.
 */
async function updateViaBun(expectedVersion: string): Promise<void> {
	console.log(chalk.dim("Updating via bun..."));
	const result = await $`bun install -g ${PACKAGE}@${expectedVersion}`.nothrow();
	if (result.exitCode !== 0) {
		throw new Error(`bun install failed with exit code ${result.exitCode}`);
	}

	await printVerification(expectedVersion);
}

/**
 * Download a release binary to a target path, replacing an existing file.
 */
async function updateViaBinaryAt(targetPath: string, expectedVersion: string): Promise<void> {
	const binaryName = getBinaryName();
	const tag = `v${expectedVersion}`;
	const url = `https://github.com/${REPO}/releases/download/${tag}/${binaryName}`;

	const tempPath = `${targetPath}.new`;
	const backupPath = `${targetPath}.bak`;
	console.log(chalk.dim(`Downloading ${binaryName}…`));

	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok || !response.body) {
		throw new Error(`Download failed: ${response.statusText}`);
	}
	const fileStream = fs.createWriteStream(tempPath, { mode: 0o755 });
	await pipeline(response.body, fileStream);

	console.log(chalk.dim("Installing update..."));
	try {
		try {
			await fs.promises.unlink(backupPath);
		} catch (err) {
			if (!isEnoent(err)) throw err;
		}
		await fs.promises.rename(targetPath, backupPath);
		await fs.promises.rename(tempPath, targetPath);
		await fs.promises.unlink(backupPath);

		await printVerification(expectedVersion);
		console.log(chalk.dim(`Restart ${APP_NAME} to use the new version`));
	} catch (err) {
		if (fs.existsSync(backupPath) && !fs.existsSync(targetPath)) {
			await fs.promises.rename(backupPath, targetPath);
		}
		if (fs.existsSync(tempPath)) {
			await fs.promises.unlink(tempPath);
		}
		throw err;
	}
}

/**
 * Run the update command.
 */
/**
 * Update a source install: git pull on OMP_HOME, reinstall deps.
 */
async function runSourceUpdate(home: string, opts: { force: boolean; check: boolean }): Promise<void> {
	console.log(chalk.dim(`Source install at: ${home}`));
	console.log(chalk.dim(`Checking for updates on ${REPO}@main...`));

	const fetch = await $`git -C ${home} fetch --depth 1 origin main`.nothrow();
	if (fetch.exitCode !== 0) {
		console.error(chalk.red("Failed to reach GitHub — check your connection"));
		process.exit(1);
	}

	const countOut = await $`git -C ${home} rev-list HEAD..FETCH_HEAD --count`.quiet().nothrow();
	const newCommits = parseInt(countOut.stdout.toString().trim() || "0", 10);

	if (newCommits === 0 && !opts.force) {
		console.log(chalk.green(`${theme.status.success} Already up to date`));
		return;
	}

	if (newCommits > 0) {
		console.log(chalk.cyan(`${newCommits} new commit(s) available`));
	} else {
		console.log(chalk.yellow("Forcing reinstall"));
	}

	if (opts.check) return;

	await $`git -C ${home} reset --hard FETCH_HEAD`.quiet();

	console.log(chalk.dim("Installing updated dependencies..."));
	const install = await $`bun install --cwd ${home}`.nothrow();
	if (install.exitCode !== 0) {
		console.error(chalk.red(`bun install failed — retry with: cd ${home} && bun install`));
		process.exit(1);
	}

	console.log(chalk.green(`\n${theme.status.success} Updated successfully`));
	console.log(chalk.dim(`Restart ${APP_NAME} to use the new version`));
}

export async function runUpdateCommand(opts: { force: boolean; check: boolean }): Promise<void> {
	console.log(chalk.dim(`Current version: ${VERSION}`));

	let target: UpdateTarget;
	try {
		target = await resolveUpdateTarget();
	} catch (err) {
		console.error(chalk.red(`Failed to resolve update target: ${err}`));
		process.exit(1);
	}

	// Source installs bypass npm version check — track git commits instead
	if (target.method === "source") {
		await runSourceUpdate(target.home, opts);
		return;
	}

	// bun/binary path: check npm registry for new version
	let release: ReleaseInfo;
	try {
		release = await getLatestRelease();
	} catch (err) {
		console.error(chalk.red(`Failed to check for updates: ${err}`));
		process.exit(1);
	}

	const comparison = compareVersions(release.version, VERSION);
	if (comparison <= 0 && !opts.force) {
		console.log(chalk.green(`${theme.status.success} Already up to date`));
		return;
	}
	if (comparison > 0) {
		console.log(chalk.cyan(`New version available: ${release.version}`));
	} else {
		console.log(chalk.yellow(`Forcing reinstall of ${release.version}`));
	}
	if (opts.check) return;

	try {
		if (target.method === "bun") {
			await updateViaBun(release.version);
		} else {
			await updateViaBinaryAt(target.path, release.version);
		}
	} catch (err) {
		console.error(chalk.red(`Update failed: ${err}`));
		process.exit(1);
	}
}

/**
 * Print update command help.
 */
export function printUpdateHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} update`)} - Check for and install updates

${chalk.bold("Usage:")}
  ${APP_NAME} update [options]

${chalk.bold("Options:")}
  -c, --check   Check for updates without installing
  -f, --force   Force reinstall even if up to date

${chalk.bold("Examples:")}
  ${APP_NAME} update           Update to latest version
  ${APP_NAME} update --check   Check if updates are available
  ${APP_NAME} update --force   Force reinstall
`);
}
