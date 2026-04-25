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
cmd git rev-parse --show-toplevel >/dev/null || fail "not inside a git worktree"
cmd git diff --cached --quiet || fail "git index is not clean; commit or unstage existing changes first"
cmd git diff --quiet -- PKGBUILD || fail "PKGBUILD has unstaged changes; clean them up first"

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

# Replace the _release_tag= line.
pkgbuild_tmp="$(new_tmp)"
awk -v latest_tag="$latest_tag" '
BEGIN {
	updated = 0
}
/^_release_tag=/ && !updated {
	print "_release_tag=\x27" latest_tag "\x27"
	updated = 1
	next
}
{
	print
}
END {
	exit(updated ? 0 : 1)
}
' PKGBUILD >"$pkgbuild_tmp" || fail "unable to update _release_tag in PKGBUILD"
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

# Replace the integrity assignment block in PKGBUILD.
pkgbuild_tmp="$(new_tmp)"
awk -v new_checksums="$new_checksums" '
function is_integrity_assignment(line) {
	return line ~ /^(b2sums|sha512sums|sha384sums|sha256sums|sha224sums|sha1sums|md5sums|cksums)(_[[:alnum:]_]+)?=/
}
BEGIN {
	replaced = 0
}
{
	if (is_integrity_assignment($0)) {
		if (!replaced) {
			print new_checksums
			replaced = 1
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

# pkgver in the built package may differ from latest_tag (we strip 'v'
# and replace '-' with '.'), so find the binary by path. -maxdepth 4
# matches pkg/<pkgname>/usr/bin/omp; -print -quit stops on first hit.
pkg_omp="$(find pkg -maxdepth 4 -path '*/usr/bin/omp' -executable -print -quit)"
if [[ -z $pkg_omp ]]; then
	fail "could not locate built omp binary under pkg/"
fi
cmd "$pkg_omp" --version || fail "omp --version smoke test failed"

# Stage and review.
cmd git add PKGBUILD
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
