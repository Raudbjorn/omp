#!/bin/sh
set -e

# OMP Coding Agent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/can1357/oh-my-pi/main/scripts/install.sh | sh
#
# Options:
#   --source       Install via bun (installs bun if needed)
#   --binary       Always install prebuilt binary
#   --ref <ref>    Install specific tag/commit/branch
#   -r <ref>       Shorthand for --ref

REPO="mrayden/oh-my-pi-multimodal"
PACKAGE="@oh-my-pi/pi-coding-agent"  # unused for fork; source install always clones REPO
INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"
MIN_BUN_VERSION="1.3.7"

# Parse arguments
MODE=""
REF=""
while [ $# -gt 0 ]; do
    case "$1" in
        --source)
            MODE="source"
            shift
            ;;
        --binary)
            MODE="binary"
            shift
            ;;
        --ref)
            shift
            if [ -z "$1" ]; then
                echo "Missing value for --ref"
                exit 1
            fi
            REF="$1"
            shift
            ;;
        --ref=*)
            REF="${1#*=}"
            if [ -z "$REF" ]; then
                echo "Missing value for --ref"
                exit 1
            fi
            shift
            ;;
        -r)
            shift
            if [ -z "$1" ]; then
                echo "Missing value for -r"
                exit 1
            fi
            REF="$1"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# If a ref is provided, default to source install
if [ -n "$REF" ] && [ -z "$MODE" ]; then
    MODE="source"
fi
# Fork: source without --ref defaults to main branch (no npm package for this fork)
if [ "$MODE" = "source" ] && [ -z "$REF" ]; then
    REF="main"
fi

# Check if bun is available
has_bun() {
    command -v bun >/dev/null 2>&1
}

version_ge() {
    current="$1"
    minimum="$2"

    current_major="${current%%.*}"
    current_rest="${current#*.}"
    current_minor="${current_rest%%.*}"
    current_patch="${current_rest#*.}"
    current_patch="${current_patch%%.*}"

    minimum_major="${minimum%%.*}"
    minimum_rest="${minimum#*.}"
    minimum_minor="${minimum_rest%%.*}"
    minimum_patch="${minimum_rest#*.}"
    minimum_patch="${minimum_patch%%.*}"

    if [ "$current_major" -ne "$minimum_major" ]; then
        [ "$current_major" -gt "$minimum_major" ]
        return $?
    fi

    if [ "$current_minor" -ne "$minimum_minor" ]; then
        [ "$current_minor" -gt "$minimum_minor" ]
        return $?
    fi

    [ "$current_patch" -ge "$minimum_patch" ]
}

require_bun_version() {
    version_raw=$(bun --version 2>/dev/null || true)
    if [ -z "$version_raw" ]; then
        echo "Failed to read bun version"
        exit 1
    fi

    version_clean=${version_raw%%-*}
    if ! version_ge "$version_clean" "$MIN_BUN_VERSION"; then
        echo "Bun ${MIN_BUN_VERSION} or newer is required. Current version: ${version_clean}"
        echo "Upgrade Bun at https://bun.sh/docs/installation"
        exit 1
    fi
}

# Check if git is available
has_git() {
    command -v git >/dev/null 2>&1
}

# Install bun
install_bun() {
    echo "Installing bun..."
    if command -v bash >/dev/null 2>&1; then
        curl -fsSL https://bun.sh/install | bash
    else
        echo "bash not found; attempting install with sh..."
        curl -fsSL https://bun.sh/install | sh
    fi
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    require_bun_version
}

# Check if git-lfs is available
has_git_lfs() {
    command -v git-lfs >/dev/null 2>&1
}

# Add INSTALL_DIR to shell rc files if not already present
setup_path() {
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) return 0 ;;
    esac
    LINE="export PATH=\"$INSTALL_DIR:\$PATH\""
    for RC in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
        [ -f "$RC" ] || continue
        grep -qF "$INSTALL_DIR" "$RC" 2>/dev/null && continue
        printf '\n# ompm\n%s\n' "$LINE" >> "$RC"
        echo "  Added $INSTALL_DIR to PATH in $RC"
    done
    echo "  Run: . ~/.bashrc  (or open a new terminal)"
}

# Download precompiled native addons from upstream releases.
# The .node files are Rust build artifacts not committed to git;
# building them requires the full Rust toolchain, so we pull prebuilt.
install_natives() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    case "$OS" in
        Linux)  PLATFORM="linux" ;;
        Darwin) PLATFORM="darwin" ;;
        *) echo "  Skipping natives: unsupported OS $OS"; return 0 ;;
    esac
    case "$ARCH" in
        x86_64|amd64)  ARCH_NAME="x64" ;;
        arm64|aarch64) ARCH_NAME="arm64" ;;
        *) echo "  Skipping natives: unsupported arch $ARCH"; return 0 ;;
    esac

    UPSTREAM="can1357/oh-my-pi"
    echo "Fetching latest upstream release tag for native addons..."
    LATEST=$(curl -fsSL "https://api.github.com/repos/${UPSTREAM}/releases/latest" \
        | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$LATEST" ]; then
        echo "  Warning: could not determine upstream release tag; skipping natives"
        return 0
    fi
    echo "  Upstream release: $LATEST"

    NATIVE_DIR="$OMPM_HOME/packages/natives/native"
    mkdir -p "$NATIVE_DIR"

    # x64 ships two CPU-dispatch variants; arm64 and darwin-arm64 ship one file.
    if [ "$ARCH_NAME" = "x64" ]; then
        NATIVES="pi_natives.${PLATFORM}-${ARCH_NAME}-modern.node pi_natives.${PLATFORM}-${ARCH_NAME}-baseline.node"
    else
        NATIVES="pi_natives.${PLATFORM}-${ARCH_NAME}.node"
    fi

    for NATIVE in $NATIVES; do
        URL="https://github.com/${UPSTREAM}/releases/download/${LATEST}/${NATIVE}"
        DEST="$NATIVE_DIR/$NATIVE"
        if [ -f "$DEST" ]; then
            echo "  $NATIVE already present, skipping"
            continue
        fi
        printf "  Downloading %s..." "$NATIVE"
        if curl -fsSL "$URL" -o "$DEST" 2>/dev/null; then
            echo " done"
        else
            echo " failed (non-fatal)"
            rm -f "$DEST"
        fi
    done
}


# Install via bun — source mode only (fork is a monorepo; not published to npm)
install_via_bun() {
    echo "Installing via bun..."
    if [ -n "$REF" ]; then
        if ! has_git; then
            echo "git is required for source installs"
            exit 1
        fi

        OMPM_HOME="${OMPM_HOME:-$HOME/.local/share/ompm}"
        OMPM_TMP="${OMPM_HOME}.tmp.$$"

        # Ensure temp dir is removed if we exit early (failure, Ctrl-C, etc.)
        _cleanup() { rm -rf "$OMPM_TMP"; }
        trap '_cleanup' EXIT INT TERM

        # ── Incremental update path (fast) ───────────────────────────────────────
        # If a valid git repo already lives at OMPM_HOME, try to update in-place.
        # This avoids a full re-clone on re-install or interrupted dep install.
        NEED_CLONE=1
        if [ -d "$OMPM_HOME/.git" ]; then
            echo "Existing install found at $OMPM_HOME, checking for updates..."
            if (cd "$OMPM_HOME" \
                && git fetch --depth 1 origin "$REF" >/dev/null 2>&1 \
                && git reset --hard FETCH_HEAD >/dev/null 2>&1); then
                NEED_CLONE=0
                echo "  Updated to latest $REF"
            else
                echo "  In-place update failed — will reinstall from scratch"
            fi
        fi

        # ── Full clone path (first install or recovery) ───────────────────────────
        if [ "$NEED_CLONE" = "1" ]; then
            # Clone into a temp dir so the existing install (if any) stays intact
            # until the new one is fully ready. Atomic: rm old + mv new.
            rm -rf "$OMPM_TMP"
            echo "Cloning $REPO@$REF..."
            if git clone --depth 1 --branch "$REF" \
               "https://github.com/${REPO}.git" "$OMPM_TMP" >/dev/null 2>&1; then
                :
            else
                # Shallow clone may fail for non-branch refs (commit SHAs, etc.)
                git clone "https://github.com/${REPO}.git" "$OMPM_TMP"
                (cd "$OMPM_TMP" && git checkout "$REF")
            fi

            if has_git_lfs; then
                (cd "$OMPM_TMP" && git lfs pull 2>/dev/null || true)
            fi

            if [ ! -d "$OMPM_TMP/packages/coding-agent" ]; then
                echo "Clone succeeded but packages/coding-agent not found — wrong repo?"
                exit 1
            fi

            # Atomically replace. From this point a failure leaves OMPM_HOME intact.
            rm -rf "$OMPM_HOME"
            mv "$OMPM_TMP" "$OMPM_HOME"
            trap - EXIT INT TERM  # tmp is gone; nothing left to clean up
        fi

        # ── Dependency install ────────────────────────────────────────────────────
        # Must run from monorepo root so all workspace siblings are resolved.
        # bun install is idempotent; safe to re-run on retry.
        echo "Installing workspace dependencies..."
        (cd "$OMPM_HOME" && bun install) || {
            echo ""
            echo "bun install failed. To retry:"
            echo "  cd $OMPM_HOME && bun install"
            exit 1
        }

        # ── Native addons ───────────────────────────────────────────────────────────
        install_natives

        # ── Wrapper script ──────────────────────────────────────────────────────────
        # Runs cli.ts via bun so node_modules resolution walks up to
        # $OMPM_HOME/node_modules and finds all workspace siblings.
        # Handles bun not in PATH by probing known install locations.
        mkdir -p "$INSTALL_DIR"
        WRAPPER="$INSTALL_DIR/ompm"
        WRAPPER_TMP="${WRAPPER}.tmp.$$"
        # Write atomically via tmp so a half-written wrapper is never executed
        {
            echo '#!/usr/bin/env sh'
            echo '# ompm — generated by install.sh; do not edit'
            printf 'OMPM_HOME="%s"\n' "$OMPM_HOME"
            cat << 'WRAPPER_BODY'
if command -v bun >/dev/null 2>&1; then
    _BUN=bun
elif [ -x "$HOME/.bun/bin/bun" ]; then
    _BUN="$HOME/.bun/bin/bun"
else
    echo "ompm: bun not found — install bun: curl -fsSL https://bun.sh/install | sh" >&2
    exit 1
fi
exec "$_BUN" "$OMPM_HOME/packages/coding-agent/src/cli.ts" "$@"
WRAPPER_BODY
        } > "$WRAPPER_TMP"
        chmod +x "$WRAPPER_TMP"
        mv "$WRAPPER_TMP" "$WRAPPER"

    else
        bun install -g "$PACKAGE" || {
            echo "Failed to install $PACKAGE"
            exit 1
        }
    fi

    echo ""
    echo "✓ Installed ompm to $INSTALL_DIR/ompm"
    setup_path
    echo "Run 'ompm' to get started!"
}

# Install binary from GitHub releases
install_binary() {
    # Detect platform
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux)  PLATFORM="linux" ;;
        Darwin) PLATFORM="darwin" ;;
        *)      echo "Unsupported OS: $OS"; exit 1 ;;
    esac

    case "$ARCH" in
        x86_64|amd64)  ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    BINARY="omp-${PLATFORM}-${ARCH}"
    # Get release tag
    if [ -n "$REF" ]; then
        echo "Fetching release $REF..."
        if RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${REF}"); then
            LATEST=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
        else
            echo "Release tag not found: $REF"
            echo "For branch/commit installs, use --source with --ref."
            exit 1
        fi
    else
        echo "Fetching latest release..."
        RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
        LATEST=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    fi

    if [ -z "$LATEST" ]; then
        echo "Failed to fetch release tag"
        exit 1
    fi
    echo "Using version: $LATEST"

    mkdir -p "$INSTALL_DIR"
    # Download binary
    BINARY_URL="https://github.com/${REPO}/releases/download/${LATEST}/${BINARY}"
    echo "Downloading ${BINARY}..."
    curl -fsSL "$BINARY_URL" -o "${INSTALL_DIR}/ompm"
    chmod +x "${INSTALL_DIR}/ompm"
    downloaded_native=0
    if [ "$ARCH" = "x64" ]; then
        for variant in modern baseline; do
            NATIVE_ADDON="pi_natives.${PLATFORM}-${ARCH}-${variant}.node"
            NATIVE_URL="https://github.com/${REPO}/releases/download/${LATEST}/${NATIVE_ADDON}"
            echo "Downloading ${NATIVE_ADDON}..."
            curl -fsSL "$NATIVE_URL" -o "${INSTALL_DIR}/${NATIVE_ADDON}" || {
                echo "Failed to download ${NATIVE_ADDON}"
                exit 1
            }
            downloaded_native=$((downloaded_native + 1))
        done
    else
        NATIVE_ADDON="pi_natives.${PLATFORM}-${ARCH}.node"
        NATIVE_URL="https://github.com/${REPO}/releases/download/${LATEST}/${NATIVE_ADDON}"
        echo "Downloading ${NATIVE_ADDON}..."
        curl -fsSL "$NATIVE_URL" -o "${INSTALL_DIR}/${NATIVE_ADDON}"
        downloaded_native=1
    fi
    echo ""
    echo "✓ Installed ompm to ${INSTALL_DIR}/ompm"
    echo "✓ Installed ${downloaded_native} native addon file(s) to ${INSTALL_DIR}"

    # Check if in PATH
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) echo "Run 'ompm' to get started!" ;;
        *) echo "Add ${INSTALL_DIR} to your PATH, then run 'ompm'" ;;
    esac
}

# Main logic
case "$MODE" in
    source)
        if ! has_bun; then
            install_bun
        fi
        require_bun_version
        install_via_bun
        ;;
    binary)
        install_binary
        ;;
    *)
        # Default: use bun if available, otherwise binary
        if has_bun; then
            require_bun_version
            install_via_bun
        else
            install_binary
        fi
        ;;
esac
