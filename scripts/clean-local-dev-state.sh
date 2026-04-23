#!/usr/bin/env bash
set -euo pipefail

log() {
	printf '[clean-local-dev-state] %s\n' "$1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NATIVE_DIR=${LOCAL_DEV_NATIVE_DIR:-"$ROOT_DIR/packages/natives/native"}

REGISTRY_URL=${LOCAL_REGISTRY_URL:-${REGISTRY_URL:-http://localhost:4873}}
REGISTRY_HOST=${REGISTRY_URL#http://}
REGISTRY_HOST=${REGISTRY_HOST#https://}
REGISTRY_HOST=${REGISTRY_HOST%%/}
if [[ "$REGISTRY_HOST" == *:* ]]; then
	REGISTRY_PORT=${REGISTRY_HOST##*:}
else
	REGISTRY_PORT=4873
fi
REGISTRY_PORT=${REGISTRY_PORT:-4873}

STATE_DIR=${LOCAL_REGISTRY_STATE_DIR:-${LOCAL_REGISTRY_HOME:-$HOME/.omp/local-registry}}
PRIMARY_NATIVES_CACHE=${LOCAL_DEV_PRIMARY_NATIVES_CACHE:-"$HOME/.omp/natives"}
XDG_NATIVES_CACHE=""
if [[ -n "${XDG_DATA_HOME:-}" ]]; then
	XDG_NATIVES_CACHE=${LOCAL_DEV_XDG_NATIVES_CACHE:-"$XDG_DATA_HOME/omp/natives"}
fi

remove_path() {
	local target="$1"
	if [[ -e "$target" ]]; then
		rm -rf "$target"
		log "Removed $target"
	else
		log "Already absent: $target"
	fi
}

stop_local_registry() {
	local pids
	pids=$(lsof -ti TCP:"$REGISTRY_PORT" 2>/dev/null || true)
	if [[ -z "$pids" ]]; then
		log "No process is listening on local registry port $REGISTRY_PORT"
		return
	fi

	local pid
	for pid in $pids; do
		local args
		args=$(ps -p "$pid" -o args= 2>/dev/null || true)
		if [[ "$args" != *verdaccio* ]]; then
			log "Port $REGISTRY_PORT is in use by ${args:-pid $pid}; leaving it alone"
			continue
		fi
		log "Stopping Verdaccio pid $pid on port $REGISTRY_PORT"
		kill "$pid"
	done

	for _ in {1..10}; do
		if ! lsof -i TCP:"$REGISTRY_PORT" >/dev/null 2>&1; then
			return
		fi
		sleep 1
	done

	if lsof -i TCP:"$REGISTRY_PORT" >/dev/null 2>&1; then
		log "Port $REGISTRY_PORT is still busy after waiting"
	fi
}

remove_workspace_natives() {
	shopt -s nullglob
	local files=("$NATIVE_DIR"/*.node)
	shopt -u nullglob
	if (( ${#files[@]} == 0 )); then
		log "No workspace native .node files found under $NATIVE_DIR"
		return
	fi
	local file
	for file in "${files[@]}"; do
		rm -f "$file"
		log "Removed $file"
	done
}

remove_broken_lightningcss_store_entries() {
	shopt -s nullglob
	local entries=(
		"$ROOT_DIR"/node_modules/.bun/lightningcss@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-android-arm64@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-darwin-arm64@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-darwin-x64@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-freebsd-x64@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-linux-arm-gnueabihf@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-linux-arm64-gnu@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-linux-arm64-musl@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-linux-x64-gnu@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-linux-x64-musl@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-win32-arm64-msvc@*
		"$ROOT_DIR"/node_modules/.bun/lightningcss-win32-x64-msvc@*
	)
	shopt -u nullglob
	if (( ${#entries[@]} == 0 )); then
		log "No lightningcss Bun store entries found under $ROOT_DIR/node_modules/.bun"
		return
	fi
	local entry
	for entry in "${entries[@]}"; do
		remove_path "$entry"
	done
}

main() {
	log "Cleaning local registry state and native addon artifacts"
	stop_local_registry
	remove_path "$STATE_DIR"
	remove_workspace_natives
	remove_broken_lightningcss_store_entries
	remove_path "$PRIMARY_NATIVES_CACHE"
	if [[ -n "$XDG_NATIVES_CACHE" ]]; then
		remove_path "$XDG_NATIVES_CACHE"
	fi
	log "Done"
}

main "$@"
