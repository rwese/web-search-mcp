#!/usr/bin/env bash
# Build, verify, sign, and optionally publish one release.
#
# This is the single release entry point used by Forgejo Actions and humans:
#
#   scripts/release.sh 0.8.0                 # build + verify, no upload
#   scripts/release.sh 0.8.0 --publish       # build + verify + upload
#
# The tagged tree must be clean, signed, and checked out; the version is the
# package version without its `v` prefix.
set -euo pipefail

usage() {
  echo "usage: $0 <version> [--publish]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
VERSION="${1#v}"
shift
PUBLISH=false
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=true ;;
    *) usage ;;
  esac
done

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "error: version must be stable MAJOR.MINOR.PATCH, got '$VERSION'" >&2
  exit 1
}

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
TAG="v$VERSION"
ASSET="wze-websearch_${VERSION}_any.tar.gz"
ALLOWED_SIGNERS="$ROOT/.forgejo/allowed_signers"
SERVER="${GITHUB_SERVER_URL:-https://git.void.cold.at}"
SERVER="${SERVER%/}"
REPO="${GITHUB_REPOSITORY:-ai-factory/wze-websearch}"
API="$SERVER/api/v1/repos/$REPO"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required"
command -v pnpm >/dev/null || die "pnpm is required"
command -v npm >/dev/null || die "npm is required"
command -v node >/dev/null || die "node is required"
command -v jq >/dev/null || die "jq is required"
command -v curl >/dev/null || die "curl is required"
command -v tar >/dev/null || die "tar is required"
command -v gzip >/dev/null || die "gzip is required"
command -v sha256sum >/dev/null || die "sha256sum is required"

log "checking tree and signed tag $TAG"
STATUS="$(git status --porcelain --untracked-files=all)"
if [[ -n "$STATUS" ]]; then
  printf 'dirty tree:\n%s\n' "$STATUS" >&2
  die "tracked/untracked tree is not clean"
fi
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "tag $TAG does not exist"
[[ "$(git rev-list -n 1 "refs/tags/$TAG")" == "$(git rev-parse HEAD)" ]] || die "tag $TAG does not point at HEAD"
[[ "$(git cat-file -t "refs/tags/$TAG")" == "tag" ]] || die "tag $TAG is not an annotated tag object"
git -c gpg.ssh.allowedSignersFile="$ALLOWED_SIGNERS" verify-tag "$TAG" >/dev/null \
  || die "tag $TAG has no valid signature in .forgejo/allowed_signers"

if [[ ! -x node_modules/.bin/tsgo ]]; then
  log "installing dependencies (frozen lockfile)"
  pnpm install --frozen-lockfile --store-dir "${PNPM_STORE_DIR:-${TMPDIR:-/tmp}/wze-pnpm-store}"
fi

log "running quality gates"
pnpm validate

log "building application"
pnpm build

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/wze-websearch"
mkdir -p "$STAGE"
cp package.json package-lock.json README.md LICENSE "$STAGE/"

log "installing production dependencies (portable set)"
(
  cd "$STAGE"
  npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
  rm -f package-lock.json
  find node_modules -type d -name .bin -prune -exec rm -rf {} +
)
cp -R dist "$STAGE/dist"
if [[ -n "$(find "$STAGE" -type l -print -quit)" ]]; then
  die "release tree contains symlinks; the updater rejects link members"
fi

log "writing BUILDINFO and archive"
NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
UNAME="$(uname -srm || true)"
cat > "$WORK/BUILDINFO.txt" <<EOF
name: wze-websearch
version: $VERSION
tag: $TAG
commit: $(git rev-parse HEAD)
tag-verified: yes (.forgejo/allowed_signers)
node: $NODE_VERSION
npm: $NPM_VERSION
build-host: ${UNAME:-unknown}
assets-smoke-tested: $ASSET
archive-format: tar+gzip, fixed mtime/owner/order
EOF

tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
  -C "$WORK" -cf - wze-websearch | gzip -n > "$WORK/$ASSET"

log "smoke-testing the executable extracted from the archive"
SMOKE="$WORK/smoke"
mkdir -p "$SMOKE"
tar -xzf "$WORK/$ASSET" -C "$SMOKE"
[[ -d "$SMOKE/wze-websearch" ]] || die "archive is missing wze-websearch/"
ACTUAL="$(node "$SMOKE/wze-websearch/dist/surfaces/cli/cli.js" --version | awk '{print $2}')"
[[ "$ACTUAL" == "$VERSION" ]] || die "archive reports $ACTUAL, expected $VERSION"
[[ "$(node -e 'const p=require(process.argv[1]);process.stdout.write(p.version)' "$SMOKE/wze-websearch/package.json")" == "$VERSION" ]] \
  || die "archive package.json version mismatch"

log "checksumming and signing SHA256SUMS"
(
  cd "$WORK"
  sha256sum "$ASSET" BUILDINFO.txt > SHA256SUMS
)

sign_checksums() {
  local key_file="${RELEASE_SIGNING_KEY_FILE:-}"
  if [[ -z "$key_file" && -n "${RELEASE_SIGNING_KEY:-}" ]]; then
    key_file="$WORK/release-signing-key"
    printf '%s\n' "$RELEASE_SIGNING_KEY" > "$key_file"
    chmod 600 "$key_file"
  fi
  [[ -n "$key_file" && -f "$key_file" ]] || die "RELEASE_SIGNING_KEY or RELEASE_SIGNING_KEY_FILE is required to sign"
  ssh-keygen -Y sign -f "$key_file" -n file-release "$WORK/SHA256SUMS" >/dev/null
  ssh-keygen -Y verify -f "$ALLOWED_SIGNERS" -I wze-websearch-release -n file-release \
    -s "$WORK/SHA256SUMS.sig" < "$WORK/SHA256SUMS" >/dev/null
}

if [[ "$PUBLISH" == true ]]; then
  command -v ssh-keygen >/dev/null || die "ssh-keygen is required to sign releases"
  log "signing SHA256SUMS"
  sign_checksums
else
  if [[ -n "${RELEASE_SIGNING_KEY_FILE:-}${RELEASE_SIGNING_KEY:-}" ]]; then
    command -v ssh-keygen >/dev/null || die "ssh-keygen is required to sign releases"
    log "signing SHA256SUMS (local key present)"
    sign_checksums
  else
    log "no signing key supplied; verify-only artifact left unsigned"
  fi
fi

if [[ "$PUBLISH" != true ]]; then
  log "verify-only complete: $WORK/$ASSET"
  echo "artifacts: $WORK" >&2
  trap - EXIT
  exit 0
fi

TOKEN="${RELEASE_TOKEN:-${GITEA_TOKEN:-}}"
[[ -n "$TOKEN" ]] || die "missing RELEASE_TOKEN (or GITEA_TOKEN); create it with: tea actions secrets create RELEASE_TOKEN --stdin --repo $REPO"
AUTH=(-H "Authorization: token $TOKEN")

api() {
  local method="$1" url="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl --fail-with-body -sS -X "$method" "${AUTH[@]}" \
      -H "Content-Type: application/json" --data "$data" "$url"
  else
    curl --fail-with-body -sS -X "$method" "${AUTH[@]}" "$url"
  fi
}

log "creating or realigning the draft release $TAG"
# The tag-by-name endpoint hides drafts; list and filter so a retry after a
# failed upload finds and repairs the existing draft.
RELEASES="$(api GET "$API/releases?limit=50")"
EXISTING="$(jq -c --arg tag "$TAG" '[.[] | select(.tag_name == $tag)][0] // empty' <<<"$RELEASES")"
NOTES="$(git tag -l --format='%(contents:subject)' "$TAG"; printf '\n'; git tag -l --format='%(contents:body)' "$TAG")"
BODY_JSON="$(printf '%s' "$NOTES" | jq -Rs .)"

if ! jq -e '.id' >/dev/null 2>&1 <<<"$EXISTING"; then
  RELEASE_JSON="$(jq -nc --arg tag "$TAG" --arg name "$TAG" --argjson body "$BODY_JSON" \
    '{tag_name:$tag,name:$name,body:$body,draft:true,prerelease:false}')"
  RELEASE="$(api POST "$API/releases" "$RELEASE_JSON")"
else
  RELEASE="$EXISTING"
  if [[ "$(jq -r '.draft // false' <<<"$RELEASE")" != true ]]; then
    log "release is already published; checking its assets"
    ASSETS="$(api GET "$API/releases/$(jq -r '.id' <<<"$RELEASE")/assets")"
    for name in "$ASSET" BUILDINFO.txt SHA256SUMS SHA256SUMS.sig; do
      url="$(jq -r --arg name "$name" '.[] | select(.name==$name) | .browser_download_url' <<<"$ASSETS")"
      [[ -n "$url" && "$url" != null ]] || die "published release $TAG is missing $name; refusing to top it up"
      curl -fsSL "${AUTH[@]}" "$url" -o "$WORK/published-$name"
      [[ "$(sha256sum "$WORK/published-$name" | cut -d' ' -f1)" == "$(sha256sum "$WORK/$name" | cut -d' ' -f1)" ]] \
        || die "published asset $name differs from the build; published bytes are immutable"
    done
    log "published release $TAG already matches this build"
    trap - EXIT
    exit 0
  fi
  RELEASE="$(api PATCH "$API/releases/$(jq -r '.id' <<<"$RELEASE")" \
    "$(jq -nc --argjson body "$BODY_JSON" '{body:$body}')")"
fi

RELEASE_ID="$(jq -r '.id' <<<"$RELEASE")"
[[ -n "$RELEASE_ID" && "$RELEASE_ID" != null ]] || die "could not determine release id"

upload_asset() {
  local name="$1"
  local existing url
  existing="$(api GET "$API/releases/$RELEASE_ID/assets" | jq -r --arg name "$name" '.[] | select(.name==$name) | .browser_download_url')"
  if [[ -n "$existing" && "$existing" != null ]]; then
    curl -fsSL "${AUTH[@]}" "$existing" -o "$WORK/existing-$name"
    [[ "$(sha256sum "$WORK/existing-$name" | cut -d' ' -f1)" == "$(sha256sum "$WORK/$name" | cut -d' ' -f1)" ]] \
      || die "asset $name already exists with different bytes; refusing to replace a version's artifact"
    log "asset $name already present with identical bytes"
    return
  fi
  log "uploading $name"
  curl --fail-with-body -sS -X POST "${AUTH[@]}" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$WORK/$name" \
    "$API/releases/$RELEASE_ID/assets?name=$(printf '%s' "$name" | jq -sRr @uri)" >/dev/null
}

for name in "$ASSET" BUILDINFO.txt SHA256SUMS SHA256SUMS.sig; do
  upload_asset "$name"
done

log "verifying every published asset against the build"
ASSETS="$(api GET "$API/releases/$RELEASE_ID/assets")"
for name in "$ASSET" BUILDINFO.txt SHA256SUMS SHA256SUMS.sig; do
  url="$(jq -r --arg name "$name" '.[] | select(.name==$name) | .browser_download_url' <<<"$ASSETS")"
  [[ -n "$url" && "$url" != null ]] || die "asset $name is missing after upload"
  curl -fsSL "${AUTH[@]}" "$url" -o "$WORK/verify-$name"
  [[ "$(sha256sum "$WORK/verify-$name" | cut -d' ' -f1)" == "$(sha256sum "$WORK/$name" | cut -d' ' -f1)" ]] \
    || die "uploaded asset $name does not match the build"
done

log "publishing release $TAG"
api PATCH "$API/releases/$RELEASE_ID" '{"draft":false}' >/dev/null
log "release $TAG published"
