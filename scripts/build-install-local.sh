#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UTILS_PACKAGE_JSON="$REPO_ROOT/packages/utils/package.json"
OMP_DIST_BINARY="$REPO_ROOT/packages/coding-agent/dist/omp"
INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"
VIEWER_DIST_BINARY="$REPO_ROOT/packages/agent-session-viewer/dist/agent-session-viewer"
VIEWER_PACKAGE_JSON="$REPO_ROOT/packages/agent-session-viewer/package.json"

case "$(uname -s)" in
	Linux)
		PLATFORM="linux"
		;;
	Darwin)
		PLATFORM="darwin"
		;;
	*)
		echo "Unsupported OS: $(uname -s)" >&2
		exit 1
		;;
esac

case "$(uname -m)" in
	x86_64|amd64)
		ARCH="x64"
		;;
	arm64|aarch64)
		ARCH="arm64"
		;;
	*)
		echo "Unsupported architecture: $(uname -m)" >&2
		exit 1
		;;
esac
NATIVE_DIR="$REPO_ROOT/packages/natives/native"
TMP_BACKUP="$(mktemp "${TMPDIR:-/tmp}/omp-utils-package.XXXXXX")"
BACKUP_READY=0
declare -a NATIVE_CANDIDATES=()
declare -a NATIVE_ADDON_FILES=()
if [ "$ARCH" = "x64" ]; then
	NATIVE_CANDIDATES+=("$NATIVE_DIR/pi_natives.${PLATFORM}-${ARCH}-modern.node")
	NATIVE_CANDIDATES+=("$NATIVE_DIR/pi_natives.${PLATFORM}-${ARCH}-baseline.node")
else
	NATIVE_CANDIDATES+=("$NATIVE_DIR/pi_natives.${PLATFORM}-${ARCH}.node")
fi

install_file_atomic() {
	local source_path="$1"
	local destination_path="$2"
	local temp_path="${destination_path}.tmp.$$"

	cp "$source_path" "$temp_path"
	mv -f "$temp_path" "$destination_path"
}

ensure_native_addons() {
	echo "Building native addon artifacts via packages/natives"
	(
		cd "$REPO_ROOT"
		bun --cwd=packages/natives run build
	)
}

generate_viewer_assets() {
	if [ ! -f "$REPO_ROOT/packages/coding-agent/scripts/generate-viewer-bundle.ts" ]; then
		echo "Skipping viewer asset generation (script not present on this branch)"
		return
	fi
	echo "Generating viewer assets via packages/coding-agent"
	(
		cd "$REPO_ROOT"
		bun --cwd=packages/coding-agent run scripts/generate-viewer-bundle.ts
	)
}

has_viewer_package() {
	[ -f "$VIEWER_PACKAGE_JSON" ]
}

collect_native_addons() {
	NATIVE_ADDON_FILES=()
	for candidate in "${NATIVE_CANDIDATES[@]}"; do
		if [ -f "$candidate" ]; then
			NATIVE_ADDON_FILES+=("$candidate")
		fi
	done
}


cleanup() {
	local exit_code=$?

	if [ "$BACKUP_READY" = "1" ] && [ -f "$TMP_BACKUP" ]; then
		cp "$TMP_BACKUP" "$UTILS_PACKAGE_JSON"
	fi
	rm -f "$TMP_BACKUP" 2>/dev/null || true

	exit "$exit_code"
}

cp "$UTILS_PACKAGE_JSON" "$TMP_BACKUP"
BACKUP_READY=1
trap cleanup EXIT INT TERM HUP

echo "Patching version in packages/utils/package.json to +local-{yymmdd-hhmmss}"
LOCAL_SUFFIX="local-$(date +%y%m%d-%H%M%S)"
UTILS_PACKAGE_JSON="$UTILS_PACKAGE_JSON" LOCAL_SUFFIX="$LOCAL_SUFFIX" bun -e '
const file = Bun.env.UTILS_PACKAGE_JSON;
if (!file) throw new Error("UTILS_PACKAGE_JSON not set");

const packageJson = await Bun.file(file).json() as Record<string, unknown>;
const version = String(packageJson.version ?? "");
if (!version) throw new Error("packages/utils/package.json missing version");
const buildStrippedVersion = version.split("+")[0];
const baseVersion = buildStrippedVersion.replace(/-local[-.].*$/, "");

const suffix = Bun.env.LOCAL_SUFFIX;
packageJson.version = `${baseVersion}+${suffix}`;

await Bun.write(file, `${JSON.stringify(packageJson, null, "\t")}\n`);
'

ensure_native_addons
generate_viewer_assets


echo "Building binaries"
(
	cd "$REPO_ROOT"
	bun --cwd=packages/coding-agent run build
	if has_viewer_package; then
		bun --cwd=packages/agent-session-viewer run build
	else
		echo "Skipping agent-session-viewer build (package manifest not present on this branch)"
	fi
)

if [ ! -f "$OMP_DIST_BINARY" ]; then
	echo "Built binary not found: $OMP_DIST_BINARY" >&2
	exit 1
fi

collect_native_addons
if [ "${#NATIVE_ADDON_FILES[@]}" -eq 0 ]; then
	echo "Native addon not found. Expected one of:" >&2
	for candidate in "${NATIVE_CANDIDATES[@]}"; do
		echo "  - $candidate" >&2
	done
	exit 1
fi
mkdir -p "$INSTALL_DIR"
install_file_atomic "$OMP_DIST_BINARY" "$INSTALL_DIR/omp"
chmod +x "$INSTALL_DIR/omp"
if has_viewer_package; then
	if [ ! -f "$VIEWER_DIST_BINARY" ]; then
		echo "Built binary not found: $VIEWER_DIST_BINARY" >&2
		exit 1
	fi
	install_file_atomic "$VIEWER_DIST_BINARY" "$INSTALL_DIR/agent-session-viewer"
	chmod +x "$INSTALL_DIR/agent-session-viewer"
fi
for addon in "${NATIVE_ADDON_FILES[@]}"; do
	install_file_atomic "$addon" "$INSTALL_DIR/$(basename "$addon")"
done

echo "Installed binary: $INSTALL_DIR/omp"
if has_viewer_package; then
	echo "Installed binary: $INSTALL_DIR/agent-session-viewer"
fi
for addon in "${NATIVE_ADDON_FILES[@]}"; do
	echo "Installed native addon: $INSTALL_DIR/$(basename "$addon")"
done

if [[ "${SKIP_LOCAL_REGISTRY_SYNC:-0}" != "1" ]]; then
	echo "Publishing workspace packages to local registry"
	if ! "$SCRIPT_DIR/local-registry-setup.sh"; then
		echo "Local registry setup failed" >&2
		exit 1
	fi
else
	echo "Skipping local registry sync (SKIP_LOCAL_REGISTRY_SYNC=1)"
fi
