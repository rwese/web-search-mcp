#!/usr/bin/env bash
# Bootstrap a self-owned wze-websearch install from signed Forgejo releases.
#
#   curl -fsSL https://git.void.cold.at/ai-factory/wze-websearch/raw/branch/main/scripts/install.sh | sh
#   WZE_WEBSEARCH_VERSION=0.8.0 scripts/install.sh
#
# Requires Node.js >= 20, curl, jq, tar, gzip, sha256sum, and ssh-keygen.
# Installs to $XDG_DATA_HOME/wze-websearch/install (or ~/.local/share/...)
# and writes wrappers to ~/.local/bin. Never uses sudo.
set -euo pipefail

SERVER="${WZE_WEBSEARCH_SERVER:-https://git.void.cold.at}"
REPO="${WZE_WEBSEARCH_REPO:-ai-factory/wze-websearch}"
API="$SERVER/api/v1/repos/$REPO"
INSTALL_ROOT="${WZE_WEBSEARCH_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/wze-websearch/install}"
BIN_DIR="${WZE_WEBSEARCH_BIN_DIR:-$HOME/.local/bin}"
RELEASE_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHeqGDJAqSVRpHrWfam2lsecAEXZ471HrcbQQoY4t2xW wze-websearch-release"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

for tool in node curl jq tar gzip sha256sum ssh-keygen; do
  command -v "$tool" >/dev/null || die "$tool is required"
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || die "Node.js >= 20 is required (found $(node --version))"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "${WZE_WEBSEARCH_VERSION:-}" ]]; then
  TAG="v${WZE_WEBSEARCH_VERSION#v}"
  RELEASE="$(curl -fsSL "$API/releases/tags/$TAG")" || die "release $TAG not found"
else
  RELEASES="$(curl -fsSL "$API/releases?limit=50")" || die "could not read the release list"
  RELEASE="$(jq -c '[.[] | select((.draft|not) and (.prerelease|not)) | select(.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))] | sort_by(.tag_name | ltrimstr("v") | split(".") | map(tonumber)) | last // empty' <<<"$RELEASES")"
  [[ -n "$RELEASE" ]] || die "no stable release is published"
  TAG="$(jq -r '.tag_name' <<<"$RELEASE")"
fi
VERSION="${TAG#v}"
ASSET="wze-websearch_${VERSION}_any.tar.gz"

asset_url() {
  jq -r --arg name "$1" '.assets[] | select(.name==$name) | .browser_download_url' <<<"$RELEASE"
}

log "downloading $ASSET"
for name in "$ASSET" BUILDINFO.txt SHA256SUMS SHA256SUMS.sig; do
  url="$(asset_url "$name")"
  [[ -n "$url" && "$url" != null ]] || die "release $TAG is missing $name"
  curl -fsSL "$url" -o "$WORK/$name" || die "failed to download $name"
done

log "verifying signature and checksums"
printf 'wze-websearch-release %s\n' "$RELEASE_KEY" > "$WORK/allowed_signers"
ssh-keygen -Y verify -f "$WORK/allowed_signers" -I wze-websearch-release -n file-release \
  -s "$WORK/SHA256SUMS.sig" < "$WORK/SHA256SUMS" >/dev/null \
  || die "SHA256SUMS signature is not valid for the pinned release key"
(
  cd "$WORK"
  sha256sum -c SHA256SUMS >/dev/null
) || die "artifact checksum mismatch"

log "extracting and checking version"
mkdir -p "$WORK/extract"
tar -xzf "$WORK/$ASSET" -C "$WORK/extract"
EXTRACTED="$WORK/extract/wze-websearch"
[[ -d "$EXTRACTED" ]] || die "archive is missing wze-websearch/"
ACTUAL="$(node "$EXTRACTED/dist/surfaces/cli/cli.js" --version | awk '{print $2}')"
[[ "$ACTUAL" == "$VERSION" ]] || die "archive reports $ACTUAL, expected $VERSION"

mkdir -p "$INSTALL_ROOT/versions" "$BIN_DIR"
CURRENT="$(cat "$INSTALL_ROOT/current" 2>/dev/null || true)"
if [[ -n "$CURRENT" && "$CURRENT" != "$VERSION" ]]; then
  older="$(node -e '
    const [a,b]=process.argv.slice(1).map(v=>v.split(".").map(Number));
    process.stdout.write(a[0]<b[0]||a[0]===b[0]&&(a[1]<b[1]||a[1]===b[1]&&a[2]<b[2])?"1":"0");
  ' "$VERSION" "$CURRENT")"
  if [[ "$older" == "1" && "${WZE_WEBSEARCH_ALLOW_DOWNGRADE:-0}" != 1 ]]; then
    die "refusing to downgrade $CURRENT -> $VERSION (set WZE_WEBSEARCH_ALLOW_DOWNGRADE=1 to override)"
  fi
fi

TARGET="$INSTALL_ROOT/versions/$VERSION"
rm -rf "$TARGET"
mv "$EXTRACTED" "$TARGET"

node --input-type=module - "$TARGET" "$INSTALL_ROOT" "$BIN_DIR" "$VERSION" "$CURRENT" <<'NODE'
import { pathToFileURL } from "node:url";
const [target, root, binDir, version, current] = process.argv.slice(2);
const mod = await import(pathToFileURL(`${target}/dist/update/install.js`).href);
mod.writeInstallRecord(root, binDir);
mod.installWrappers(root, binDir);
if (current) mod.writePreviousVersion(root, current);
mod.writeCurrentVersion(root, version);
NODE

printf 'Installed wze-websearch %s\n' "$VERSION"
printf '  version: %s\n' "$TARGET"
printf '  current: %s/current\n' "$INSTALL_ROOT"
printf '  binaries: %s/wze-websearch, %s/wze-websearch-mcp\n' "$BIN_DIR" "$BIN_DIR"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '\nAdd %s to PATH to use the wrappers.\n' "$BIN_DIR" ;;
esac
printf '\nUpdate later with: wze-websearch update\n'
