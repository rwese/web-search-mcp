# Releases and self-updates

`wze-websearch` is distributed only as signed Forgejo release installs. npm is
**not** a publication channel: `package.json` is private, and the package is not
published. A self-owned release install is a versioned directory tree managed by
`scripts/install.sh` and `wze-websearch update`; only that install kind is
replaced in place. If the updater detects an existing npm installation, it
leaves it untouched and tells the user to reinstall from a signed release.

## Contract

- Version identity: git tag `vX.Y.Z`, package/executable `X.Y.Z`; only stable
  `MAJOR.MINOR.PATCH` releases are eligible.
- Target/asset: one portable `any` archive,
  `wze-websearch_<version>_any.tar.gz`, containing `wze-websearch/` with
  `dist/`, `node_modules/` (production, no optional/native deps), and
  `package.json`. Node.js >= 20 is required at runtime.
- Authentication: the release workflow signs `SHA256SUMS` with the dedicated
  SSH release key in the `file-release` namespace. The updater pins the public
  key in `src/update/trust.ts`, verifies the signature, then the archive
  checksum, then runs the staged executable's `--version`. A checksum alone
  would detect corruption, not a hostile publisher.
- Publication boundary: the release is created as a draft, every asset is
  uploaded, and the draft is published only after all assets verify. Published
  bytes for a version are immutable; a same-named asset with different bytes
  aborts the release.
- Extraction: only regular files/directories under `wze-websearch/`; absolute
  paths, traversal, backslashes, links, and special files abort.

## Package manager

Development, CI, and every `package.json` script use **pnpm**, pinned to one
version by `packageManager` in `package.json` (`pnpm@11.25.0`); the release
workflow reads that field instead of hardcoding a version, so local, CI, and
release builds cannot drift. `pnpm-workspace.yaml` exists only to hold pnpm 11
settings — there is no `packages:` field and this is not a monorepo — and
`pnpm-lock.yaml` is the dev lockfile. Its `strictDepBuilds: false` keeps
unapproved dependency postinstall scripts a warning instead of the pnpm 11
default hard error (`ERR_PNPM_IGNORED_BUILDS`), which aborted the release
workflow at `pnpm install`; we intentionally do not run those scripts.

The one exception is the release staging step in `scripts/release.sh`: it runs
`npm ci --omit=dev`
inside the staging directory because the archive must contain a flat,
symlink-free `node_modules/`, and pnpm's linked store layout is rejected by the
archive contract. That is why `package-lock.json` is committed and must be
bumped with `package.json` (the pnpm lockfile does not record the project
version). Do not "fix" that `npm ci` to pnpm without changing the archive
layout and the updater's link rejection in the same change.

## Trust root

- Public key and principal: `.forgejo/allowed_signers` and
  `src/update/trust.ts` (`wze-websearch-release`).
- Private key: cold-at vault `wze-websearch/release-signing-key`, and Forgejo
  repository secret `RELEASE_SIGNING_KEY` (multiline private key). Read it with
  `gopass show -n wze-websearch/release-signing-key`; `gopass show -o` returns
  only the first line and stores an unusable secret.
- Publishing token: org secret `RELEASE_TOKEN`; falls back to the workflow
  token (`GITEA_TOKEN`) and fails with a `tea actions secrets create` hint when
  neither exists.

To rotate: add the new public key to both trust files, publish one release
signed with the new key, then remove the old key after installed clients have
had time to update. Never replace a published `SHA256SUMS`/archive with
different bytes.

## Release steps

1. Bump `package.json`, `package-lock.json`, and `src/version.ts` together in a
   reviewed commit; update the release notes.
2. Create a signed annotated tag: `git tag -s v0.8.0 -m "v0.8.0: ..."`.
3. Push the commit and tag.
4. The tag push runs `.forgejo/workflows/release.yml`. It checks out the exact
   annotated tag object, verifies its signature against
   `.forgejo/allowed_signers`, runs `pnpm validate`, builds the portable
   bundle, smoke-tests the executable extracted from the archive, writes
   `BUILDINFO.txt`, signs `SHA256SUMS`, uploads a draft, verifies every asset,
   and publishes.
5. A manual dispatch is verify-only by default; set `publish=true` to publish
   an already-verified tag. A publish-only retry must reuse the same tag and
   build, never a different commit.
6. Humans use the same entry point:
   `scripts/release.sh 0.8.0` (verify) or
   `scripts/release.sh 0.8.0 --publish`.

## Install layout

```
${XDG_DATA_HOME:-~/.local/share}/wze-websearch/install/
  install.json          self-owned marker (ownership evidence)
  current               active version (text, swapped atomically)
  previous              rollback version
  update.lock           exclusive updater lock
  update-check.stamp    last background check (throttles to one per 24 h)
  versions/<version>/   dist/, node_modules/, package.json
~/.local/bin/wze-websearch      wrapper, reads `current`
~/.local/bin/wze-websearch-mcp  wrapper, reads `current`
```

Wrappers avoid symlinks so Windows needs no elevation. `WZE_WEBSEARCH_INSTALL_ROOT`
and `WZE_WEBSEARCH_BIN_DIR` override the paths. The updater refuses containers,
read-only installs, unmarked paths, and npm installs; it never uses sudo.

## Updater surface

- `wze-websearch update --check` — 0 current, 10 update available, 1 error;
  `--json` emits the structured check.
- `wze-websearch update` — lock, re-read current version, refuse downgrades
  (unless `--allow-downgrade`), verify, stage, probe, swap, probe again, prune.
- `wze-websearch update --rollback` — swap to the recorded `previous` version
  after probing it.
- Background check — after CLI searches and `--doctor`, and once at MCP
  startup. TTY-independent: a headless host (MCP over stdio, CI) has no
  terminal to read a notice, so the helper applies a verified release itself
  under the same lock/signature/checksum/probe ordering as `update`. The
  running process keeps its old version until restart. Throttled to one check
  per 24 h per install root by `update-check.stamp` (the marker is written
  before the spawn, so a burst of MCP starts cannot race the release API).
  Silent on a failed check; one stderr line after an applied update, and one
  when an available update could not be applied. `WZE_WEBSEARCH_NO_UPDATE_CHECK=1`
  disables it, and the detached helper sets `WZE_WEBSEARCH_UPDATE_BACKGROUND=1`
  to avoid recursion.

## Network budgets

- The release list keeps a 10 s budget; that is an API call, not a body.
- One asset download gets `max(60 s, size / 128 KiB/s)`, so the ~22 MB
  portable archive is not held to an API-call wall clock. Budgets live in
  `src/update/release.ts` (`downloadBudgetMs`).
- `fetchWithTimeout` (`src/infra/fetch-timeout.ts`) runs the response handler
  under the same abort signal as the request. An abort while streaming the
  body maps to the caller's timeout error, e.g.
  `timed out trying to download wze-websearch_0.8.1_any.tar.gz after 172712ms;
  retry the update, or reinstall from a signed release`, instead of escaping
  as a raw `AbortError` (`unexpected error: This operation was aborted`).
  Errors the handler raises itself pass through unchanged.

## Tests

`test/update/` covers SSHSIG verification, version ordering, archive traversal,
checksum failures, untrusted keys, lock contention, successful update,
downgrade refusal, and rollback. Updater tests build fixture tar archives and
sign them with a throwaway Ed25519 key; no network or external signer is used.
`test/update/release.test.ts` and `test/infra/fetch-timeout.test.ts` pin the
download budgets and the timeout mapping for both the request and the body-read
phase, using injected `fetch` fakes.
