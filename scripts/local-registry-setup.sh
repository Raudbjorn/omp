#!/usr/bin/env bash
set -euo pipefail

log() {
	printf '[local-registry] %s\n' "$1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_PACKAGE_JSON="$ROOT_DIR/package.json"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.local-registry"
FALLBACK_ENV_FILE="$ROOT_DIR/.env"
ENV_FILE=${LOCAL_REGISTRY_ENV_FILE:-}

select_env_file() {
	if [[ -n "${ENV_FILE:-}" ]]; then
		if [[ -r "$ENV_FILE" ]]; then
			return
		fi
		echo "LOCAL_REGISTRY_ENV_FILE set to '$ENV_FILE' but not readable" >&2
		exit 1
	fi
	if [[ -r "$DEFAULT_ENV_FILE" ]]; then
		ENV_FILE="$DEFAULT_ENV_FILE"
	elif [[ -r "$FALLBACK_ENV_FILE" ]]; then
		ENV_FILE="$FALLBACK_ENV_FILE"
	fi
}

export_kv_line() {
	local line="$1"
	line="${line%$'\r'}"
	local trimmed="${line#${line%%[![:space:]]*}}"
	trimmed="${trimmed%${trimmed##*[![:space:]]}}"
	[[ -z "$trimmed" ]] && return
	if [[ ${trimmed:0:1} == "#" ]]; then
		return
	fi
	line="$trimmed"
	if [[ "$line" == export* ]]; then
		line=${line#export }
	fi
	if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
		local key="${BASH_REMATCH[1]}"
		local value="${BASH_REMATCH[2]}"
		value="${value#${value%%[![:space:]]*}}"
		value="${value%${value##*[![:space:]]}}"
		if [[ ${value:0:1} == '"' && ${value: -1} == '"' ]]; then
			value=${value:1:-1}
		elif [[ ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
			value=${value:1:-1}
		fi
		export "$key=$value"
	fi
}

load_env_file() {
	local env_path="$1"
	while IFS= read -r line || [[ -n "$line" ]]; do
		export_kv_line "$line"
	done < <(cat "$env_path")
}

select_env_file
if [[ -n "${ENV_FILE:-}" ]]; then
	log "Loading registry secrets from ${ENV_FILE}"
	load_env_file "$ENV_FILE"
fi

REGISTRY_URL=${LOCAL_REGISTRY_URL:-${REGISTRY_URL:-http://localhost:4873}}
REGISTRY_HOST=${REGISTRY_URL#http://}
REGISTRY_HOST=${REGISTRY_HOST#https://}
REGISTRY_HOST=${REGISTRY_HOST%%/}
if [[ "$REGISTRY_HOST" == *:* ]]; then
	REGISTRY_HOSTNAME=${REGISTRY_HOST%%:*}
	REGISTRY_PORT=${REGISTRY_HOST##*:}
else
	REGISTRY_HOSTNAME=${REGISTRY_HOST}
	REGISTRY_PORT=4873
fi
REGISTRY_HOSTNAME=${REGISTRY_HOSTNAME:-localhost}
REGISTRY_PORT=${REGISTRY_PORT:-4873}
LOCAL_BUILD_ID=${LOCAL_BUILD_ID:-${LOCAL_REGISTRY_BUILD_ID:-local.$(date +%y%m%d-%H%M%S)}}
PUBLISH_TAG=${PUBLISH_TAG:-${LOCAL_REGISTRY_TAG:-local}}
STATE_DIR=${LOCAL_REGISTRY_STATE_DIR:-${LOCAL_REGISTRY_HOME:-$HOME/.omp/local-registry}}
STORAGE_DIR="$STATE_DIR/storage"
HTPASSWD_FILE="$STATE_DIR/htpasswd"
CONFIG_FILE="$STATE_DIR/config.yaml"
LOG_FILE="$STATE_DIR/verdaccio.log"
PACKAGES=(utils natives tui ai agent stats coding-agent)
declare -A PACKAGE_NAME_BY_DIR=()
declare -A PACKAGE_NEW_VERSION=()
declare -a BACKUPS=()
VERDACCIO_PID=""

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

setup_state_dir() {
	mkdir -p "$STATE_DIR"
	mkdir -p "$STORAGE_DIR"
	rm -f "$HTPASSWD_FILE"
}

write_config() {
	cat >"$CONFIG_FILE" <<EOF
storage: $STORAGE_DIR
max_body_size: 100mb

auth:
  htpasswd:
    file: $HTPASSWD_FILE

uplinks:
  npmjs:
    url: https://registry.npmjs.org/

packages:
  "@oh-my-pi/*":
    access: \$all
    publish: \$all
    unpublish: \$all
  "**":
    access: \$all
    publish: \$authenticated
    proxy: npmjs
EOF
}

ensure_verdaccio() {
	if ! command -v verdaccio >/dev/null 2>&1; then
		log "Installing Verdaccio globally via Bun"
		bun add -g verdaccio >/dev/null
	fi
}

start_verdaccio() {
	local pids
	pids=$(lsof -ti TCP:"$REGISTRY_PORT" 2>/dev/null || true)
	if [[ -n "$pids" ]]; then
		local pid
		for pid in $pids; do
			local args
			args=$(ps -p "$pid" -o args= 2>/dev/null || true)
			if [[ "$args" != *verdaccio* ]]; then
				echo "Port $REGISTRY_PORT is in use by ${args:-pid $pid}. Stop it or set REGISTRY_URL." >&2
				exit 1
			fi
		done
		log "Stopping existing Verdaccio on port $REGISTRY_PORT"
		kill $pids
		for _ in {1..10}; do
			if ! lsof -i TCP:"$REGISTRY_PORT" >/dev/null 2>&1; then
				break
			fi
			sleep 1
		done
	fi
	write_config
	log "Starting Verdaccio on ${REGISTRY_HOSTNAME}:${REGISTRY_PORT}"
	nohup "$(bun pm bin -g)/verdaccio" --listen "${REGISTRY_HOSTNAME}:${REGISTRY_PORT}" --config "$CONFIG_FILE" >"$LOG_FILE" 2>&1 &
	VERDACCIO_PID=$!
	for _ in {1..30}; do
		sleep 1
		if lsof -i TCP:"$REGISTRY_PORT" >/dev/null 2>&1; then
			return
		fi
		if ! kill -0 "$VERDACCIO_PID" >/dev/null 2>&1; then
			break
		fi
	done
	echo "Failed to start Verdaccio" >&2
	exit 1
}

cleanup() {
	local exit_code=$?
	for entry in "${BACKUPS[@]}"; do
		IFS='|' read -r pkg_file backup <<<"$entry"
		if [[ -f "$backup" ]]; then
			cp "$backup" "$pkg_file"
			rm -f "$backup"
		fi
	done
	exit "$exit_code"
}

trap cleanup EXIT INT TERM

normalize_fork_local_base_version() {
	local version=$1
	version=${version%%+*}
	if [[ "$version" =~ ^(.+)-local([.-].*)?$ ]]; then
		printf '%s\n' "${BASH_REMATCH[1]}"
	else
		printf '%s\n' "$version"
	fi
}

parse_package_metadata() {
	local pkg_dir pkg_json pkg_name pkg_version base_version new_version
	for pkg_dir in "${PACKAGES[@]}"; do
		pkg_json="$ROOT_DIR/packages/$pkg_dir/package.json"
		pkg_name=$(bun -e 'const path = process.argv[2]; if (!path) process.exit(1); const pkg = JSON.parse(await Bun.file(path).text()); console.log(pkg.name);' "$pkg_json")
		pkg_version=$(bun -e 'const path = process.argv[2]; if (!path) process.exit(1); const pkg = JSON.parse(await Bun.file(path).text()); console.log(pkg.version);' "$pkg_json")
		base_version=$(normalize_fork_local_base_version "$pkg_version")
		new_version="${base_version}-${LOCAL_BUILD_ID}"
		PACKAGE_NAME_BY_DIR["$pkg_dir"]="$pkg_name"
		PACKAGE_NEW_VERSION["$pkg_name"]="$new_version"
	done
}

backup_package_json() {
	local file=$1
	local backup
	backup=$(mktemp)
	cp "$file" "$backup"
	BACKUPS+=("$file|$backup")
}

patch_package_json() {
	local pkg_dir=$1
	local pkg_name=${PACKAGE_NAME_BY_DIR[$pkg_dir]}
	local pkg_version=${PACKAGE_NEW_VERSION[$pkg_name]}
	local pkg_json="$ROOT_DIR/packages/$pkg_dir/package.json"
	local root_package_json="$ROOT_PACKAGE_JSON"
	local -a map_args=()
	local name
	for name in "${!PACKAGE_NEW_VERSION[@]}"; do
		map_args+=("$name" "${PACKAGE_NEW_VERSION[$name]}")
	done
	backup_package_json "$pkg_json"
	# shellcheck disable=SC2016
	bun -e 'const args = process.argv.slice(2);
const [pkgPath, rootPackagePath, newVersion, ...rest] = args;
const pkg = JSON.parse(await Bun.file(pkgPath).text());
const rootPackage = JSON.parse(await Bun.file(rootPackagePath).text());
const catalog = rootPackage.workspaces?.catalog;
if (!catalog || typeof catalog !== "object") {
	throw new Error(`Missing workspaces.catalog in ${rootPackagePath}`);
}
const map = new Map();
for (let i = 0; i < rest.length; i += 2) {
	map.set(rest[i], rest[i + 1]);
}
pkg.version = newVersion;
for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
	const deps = pkg[section];
	if (!deps) continue;
	for (const key of Object.keys(deps)) {
		const replacement = map.get(key);
		if (replacement) {
			deps[key] = replacement;
		} else if (deps[key] === "catalog:") {
			const catalogVersion = catalog[key];
			if (typeof catalogVersion !== "string") {
				throw new Error(`Missing catalog version for ${key} in ${rootPackagePath}`);
			}
			deps[key] = catalogVersion;
		} else if (typeof deps[key] === "string" && deps[key].startsWith("workspace:")) {
			deps[key] = deps[key].replace(/^workspace:/, "");
		}
	}
}
await Bun.write(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
' "$pkg_json" "$root_package_json" "$pkg_version" "${map_args[@]}"
}

create_user_token() {
	local payload token response
	payload=$(jq -n --arg name "$NPM_USER" --arg password "$NPM_PASS" --arg email "$NPM_EMAIL" \
		'{name:$name,password:$password,email:$email}')
	response=$(curl -sSf -X PUT -H 'content-type: application/json' --data "$payload" "${REGISTRY_URL}/-/user/org.couchdb.user:${NPM_USER}")
	token=$(printf '%s' "$response" | bun -e 'const text = await Bun.stdin.text(); try { const data = JSON.parse(text); if (data && typeof data.token === "string") { process.stdout.write(data.token); } } catch (err) { process.exit(1); }')
	if [[ -z "$token" ]]; then
		echo "Failed to obtain Verdaccio auth token" >&2
		exit 1
	fi
	npm config set "@oh-my-pi:registry" "$REGISTRY_URL" >/dev/null
	npm config set "//${REGISTRY_HOST}/:_authToken" "$token" >/dev/null
	npm config set "//${REGISTRY_HOST}/:_auth" "$(printf '%s:%s' "$NPM_USER" "$NPM_PASS" | base64)" >/dev/null
}

publish_packages() {
	local pkg_dir pkg_name pkg_version
	for pkg_dir in "${PACKAGES[@]}"; do
		pkg_name=${PACKAGE_NAME_BY_DIR[$pkg_dir]}
		pkg_version=${PACKAGE_NEW_VERSION[$pkg_name]}
		log "Publishing ${pkg_name}@${pkg_version}"
		patch_package_json "$pkg_dir"
		( cd "$ROOT_DIR/packages/$pkg_dir" && npm publish --registry "$REGISTRY_URL" --tag "$PUBLISH_TAG" )
	done
}

install_cli() {
	local version=${PACKAGE_NEW_VERSION["@oh-my-pi/pi-coding-agent"]}
	log "Installing @oh-my-pi/pi-coding-agent@${version}"
	# ensure Bun doesn't serve stale metadata for the scoped packages
	bun pm cache rm >/dev/null
	bun install -g --registry "$REGISTRY_URL" "@oh-my-pi/pi-coding-agent@${version}"
}

main() {
	require_command bun
	require_command npm
	require_command curl
	require_command lsof
	require_command jq
	setup_state_dir
	ensure_verdaccio
	start_verdaccio
	NPM_USER=${LOCAL_REGISTRY_USERNAME:-${NPM_USER:-scott}}
	NPM_PASS=${LOCAL_REGISTRY_PASSWORD:-${NPM_PASS:-pass123}}
	NPM_EMAIL=${LOCAL_REGISTRY_EMAIL:-${NPM_EMAIL:-scott@example.com}}
	create_user_token
	parse_package_metadata
	publish_packages
	install_cli
	log "Done. Verdaccio log: $LOG_FILE"
}

main "$@"
