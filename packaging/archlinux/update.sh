#!/usr/bin/bash
#
# Bump packaging/archlinux/PKGBUILD to the latest fork release tag,
# regenerate sha256sums, build, smoke-test, and commit.
#
# Adapted from upstream oh-my-pi's update.sh (Bin Jin) for the
# Raudbjorn/omp fork's tag pattern (v*-acp.*) and for our static
# _release_tag variable (we derive pkgver from it so we never edit
# pkgver= directly).

set -euo pipefail

msg() {
	echo "[*] $*" >&2
}

fail() {
	echo "[*] $*" >&2
	exit 1
}

cmd() {
	echo "[$] $*" >&2
	"$@"
}

confirm() {
	local reply
	local question=${1:-Continue?}

	while true; do
		read -r -p "[?] ${question} [y/N] " reply || return 1

		case "$reply" in
			[Yy] | [Yy][Ee][Ss])
				return 0
				;;
			[Nn] | [Nn][Oo] | "")
				return 1
				;;
			*)
				msg "please answer y or n"
				;;
		esac
	done
}

tmp_files=()

cleanup() {
	if ((${#tmp_files[@]})); then
		rm -f -- "${tmp_files[@]}"
	fi
}

new_tmp() {
	local tmp
	tmp="$(mktemp)" || fail "unable to create temporary file"
	tmp_files+=("$tmp")
	printf '%s\n' "$tmp"
}

trap cleanup EXIT

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$script_dir"

[[ -f PKGBUILD ]] || fail "PKGBUILD not found in ${script_dir}"
[[ -f .SRCINFO ]] || fail ".SRCINFO not found in ${script_dir}"
# Silent guard — no need to echo this routine sanity check.
git rev-parse --show-toplevel >/dev/null 2>&1 || fail "not inside a git worktree"
cmd git diff --cached --quiet || fail "git index is not clean; commit or unstage existing changes first"
cmd git diff --quiet -- PKGBUILD .SRCINFO || fail "PKGBUILD or .SRCINFO has unstaged changes; clean them up first"

# Find the latest fork release tag. We look at origin's refs so this
# works even if the local clone is behind. Sort by version, descending.
remote_url="$(cmd git config --get remote.origin.url)" || fail "no origin remote configured"
latest_ref="$(cmd git ls-remote --refs --tags --sort=-v:refname "${remote_url}" 'v*-acp.*' | awk 'NR == 1 { print $2 }')"
latest_tag="${latest_ref##*/}"

if [[ -z $latest_tag ]]; then
	fail "unable to find any v*-acp.* tags on origin"
fi

if [[ $latest_tag != v*-acp.* ]]; then
	fail "invalid fork release tag: ${latest_tag}"
fi

msg "latest fork release tag: ${latest_tag}"

current_tag="$(awk -F\' '/^_release_tag=/{print $2; exit}' PKGBUILD)"

if [[ -z $current_tag ]]; then
	fail "unable to extract _release_tag from PKGBUILD"
fi

msg "current _release_tag: ${current_tag}"

if [[ $current_tag == "$latest_tag" ]]; then
	msg "PKGBUILD already tracks the latest release"
	exit 0
fi

if ! confirm "Update _release_tag from ${current_tag} to ${latest_tag}?"; then
	msg "aborted"
	exit 0
fi

# Replace the _release_tag= line and reset pkgrel=1. A new upstream
# release should always start at pkgrel=1; if the previous release was
# rebuilt (pkgrel=2 etc.) we don't want to carry that forward.
pkgbuild_tmp="$(new_tmp)"
awk -v latest_tag="$latest_tag" '
BEGIN {
	tag_done = 0
	rel_done = 0
}
/^_release_tag=/ && !tag_done {
	print "_release_tag=\x27" latest_tag "\x27"
	tag_done = 1
	next
}
/^pkgrel=/ && !rel_done {
	print "pkgrel=1"
	rel_done = 1
	next
}
{
	print
}
END {
	exit((tag_done && rel_done) ? 0 : 1)
}
' PKGBUILD >"$pkgbuild_tmp" || fail "unable to update _release_tag/pkgrel in PKGBUILD"
cmd mv "$pkgbuild_tmp" PKGBUILD

# Regenerate checksums against the new tag's tarball.
msg "regenerating sha256sums..."
new_checksums="$(cmd makepkg -g)" || fail "failed to generate new checksums"

if [[ -z $new_checksums ]]; then
	fail "makepkg -g returned no checksum data"
fi

if [[ $new_checksums != *sums=* ]]; then
	fail "unexpected checksum output from makepkg -g"
fi

# Replace the integrity assignment block in PKGBUILD. Handles both
# single-line (`sha256sums=('hash')`) and multi-line forms emitted by
# `makepkg -g` for sources arrays — once we hit the opening assignment,
# we keep dropping continuation lines until the array's closing `)`.
pkgbuild_tmp="$(new_tmp)"
awk -v new_checksums="$new_checksums" '
function is_integrity_assignment(line) {
	return line ~ /^(b2sums|sha512sums|sha384sums|sha256sums|sha224sums|sha1sums|md5sums|cksums)(_[[:alnum:]_]+)?=/
}
BEGIN {
	replaced = 0
	in_block = 0
}
{
	if (in_block) {
		# Drop continuation lines until we eat the closing `)`.
		if ($0 ~ /\)/) {
			in_block = 0
		}
		next
	}
	if (is_integrity_assignment($0)) {
		if (!replaced) {
			print new_checksums
			replaced = 1
		}
		# If the opening line did not also close the array, swallow
		# subsequent continuation lines too.
		if ($0 !~ /\)/) {
			in_block = 1
		}
		next
	}
	print
}
END {
	exit(replaced ? 0 : 1)
}
' PKGBUILD >"$pkgbuild_tmp" || fail "unable to replace checksum block in PKGBUILD"
cmd mv "$pkgbuild_tmp" PKGBUILD

# Build the package and smoke-test the resulting binary.
cmd makepkg -f || fail "makepkg failed"

# Regenerate .SRCINFO from the now-current PKGBUILD so the AUR-style
# metadata stays in sync (pkgver, makedepends, source, checksums all
# changed). Tracked in git, so this needs to be committed alongside.
cmd makepkg --printsrcinfo >.SRCINFO || fail "failed to regenerate .SRCINFO"

# Read pkgname from the freshly-regenerated .SRCINFO. It's the canonical
# key=value form (`pkgname = omp` at column 0) and copes with PKGBUILD
# array syntax (`pkgname=('omp')`) without parsing shell quoting.
pkgname_value="$(awk '/^pkgname =/ {print $3; exit}' .SRCINFO)"
if [[ -z $pkgname_value ]]; then
	fail "unable to extract pkgname from .SRCINFO"
fi
pkg_omp="${script_dir}/pkg/${pkgname_value}/usr/bin/omp"
if [[ ! -x $pkg_omp ]]; then
	fail "expected built binary at ${pkg_omp}"
fi
cmd "$pkg_omp" --version || fail "omp --version smoke test failed"

# Stage and review.
cmd git add PKGBUILD .SRCINFO
cmd git --no-pager diff --cached

if ! confirm "Does the staged diff look good?"; then
	msg "leaving staged changes for manual review"
	exit 0
fi

cmd git commit -m "release: ${latest_tag}" || fail "git commit failed"

if confirm "Push commit to origin?"; then
	cmd git push origin || fail "git push failed"
else
	msg "commit created but not pushed"
fi
