# Releases and self-updates

`wze-websearch` has two distribution paths with different owners:

- **npm** (`@rwese/wze-websearch`) — npm owns the installation. The updater may
  read the registry version, but it never writes files there; it prints the
  `npm i -g` command.
- **Self-owned release install** — a versioned directory tree managed by
  `scripts/install.sh` and `wze-websearch update`. Only this install kind is
  replaced in place.

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

## Trust root

- Public key and principal: `.forgejo/allowed_signers` and
  `src/update/trust.ts` (`wze-websearch-release`).
- Private key: cold-at vault `wze-websearch/release-signing-key`, and Forgejo
  repository secret `RELEASE_SIGNING_KEY` (multiline private key).
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
  versions/<version>/   dist/, node_modules/, package.json
~/.local/bin/wze-websearch      wrapper, reads `current`
~/.local/bin/wze-websearch-mcp  wrapper, reads `current`
```

Wrappers avoid symlinks so Windows needs no elevation. `WZE_WEBSEARCH_INSTALL_ROOT`
and `WZE_WEBSEARCH_BIN_DIR` override the paths. The updater refuses containers,
read-only installs, unmarked paths, and npm-managed installs; it never uses
sudo.

## Updater surface

- `wze-websearch update --check` — 0 current, 10 update available, 1 error;
  `--json` emits the structured check.
- `wze-websearch update` — lock, re-read current version, refuse downgrades
  (unless `--allow-downgrade`), verify, stage, probe, swap, probe again, prune.
- `wze-websearch update --rollback` — swap to the recorded `previous` version
  after probing it.
- Background check — after CLI searches and `--doctor`, and once at MCP
  startup. TTY-only, cache-free, silent on failure, one stderr line when a
  newer release exists. `WZE_WEBSEARCH_NO_UPDATE_CHECK=1` disables it.

## Tests

`test/update/` covers SSHSIG verification, version ordering, archive traversal,
checksum failures, untrusted keys, lock contention, successful update,
downgrade refusal, and rollback. Updater tests build fixture tar archives and
sign them with a throwaway Ed25519 key; no network or external signer is used.
