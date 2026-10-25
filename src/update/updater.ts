/**
 * Self-owned install updater.
 *
 * Order is deliberate: lock → re-read installed state → authenticate the
 * release metadata → verify checksum → extract to staging → run the staged
 * executable's version probe → swap `current` → probe the installed version.
 * Any failure before the swap leaves the working install untouched.
 */
import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  extractReleaseArchive,
  removeStaging,
} from "./archive.js";
import { verifyChecksum } from "./checksum.js";
import {
  readCurrentVersion,
  readInstallRecord,
  readPreviousVersion,
  versionInstallPath,
  writeCurrentVersion,
  writePreviousVersion,
  type InstallContext,
} from "./install.js";
import { UpdateBusy, UpdateError, UpdateUnsupported } from "./errors.js";
import {
  ForgejoReleaseSource,
  type ReleaseSource,
} from "./release.js";
import { verifySshSignature } from "./ssh-signature.js";
import { RELEASE_PUBLIC_KEYS } from "./trust.js";
import { compareVersions, isNewerVersion, parseVersion } from "./version.js";

const runFile = promisify(execFile);
const VERSION_PROBE = join("dist", "surfaces", "cli", "cli.js");

export function releaseAssetName(version: string): string {
  return `wze-websearch_${version}_any.tar.gz`;
}

export type UpdateResult = {
  status: "updated" | "current" | "rolled-back";
  from?: string;
  to?: string;
  installPath?: string;
  previousVersion?: string;
};

export type UpdateDeps = {
  releaseSource?: ReleaseSource;
  trustedKeys?: readonly string[];
  timeoutMs?: number;
};

export type UpdateOptions = UpdateDeps & {
  install: InstallContext;
  allowDowngrade?: boolean;
  rollback?: boolean;
};

function scriptFor(versionRoot: string): string {
  return join(versionRoot, VERSION_PROBE);
}

async function probeVersion(versionRoot: string): Promise<string> {
  try {
    const { stdout } = await runFile(process.execPath, [scriptFor(versionRoot), "--version"], {
      timeout: 20000,
      env: { ...process.env, WZE_WEBSEARCH_NO_UPDATE_CHECK: "1" },
    });
    return stdout.trim().replace(/^wze-websearch\s+/, "");
  } catch (err) {
    throw new UpdateError(`staged executable failed its version probe: ${(err as Error).message}`);
  }
}

async function assertVersion(versionRoot: string, expected: string): Promise<void> {
  const actual = await probeVersion(versionRoot);
  if (actual !== expected) {
    throw new UpdateError(`staged executable reports ${actual}, expected ${expected}`);
  }
  try {
    const pkg = JSON.parse(await readFile(join(versionRoot, "package.json"), "utf8")) as {
      version?: string;
    };
    if (pkg.version !== expected) {
      throw new UpdateError(`archive package.json reports ${pkg.version}, expected ${expected}`);
    }
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError(`archive has no readable package.json: ${(err as Error).message}`);
  }
}

type Lock = { release: () => Promise<void> };

async function acquireLock(root: string): Promise<Lock> {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, "update.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (err) {
    if ((err as { code?: string }).code === "EEXIST") {
      throw new UpdateBusy(`another update is in progress (lock: ${lockPath})`);
    }
    throw err;
  }
  await handle.writeFile(`${process.pid}\n`);
  return {
    release: async () => {
      await handle.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
    },
  };
}

async function writableInstallRoot(root: string): Promise<void> {
  const record = readInstallRecord(root);
  if (!record) {
    throw new UpdateUnsupported(
      `no self-owned install marker at ${join(root, "install.json")}; use the release installer`,
    );
  }
  try {
    await access(root, constants.W_OK);
  } catch {
    throw new UpdateUnsupported(`install directory is not writable: ${root}`);
  }
}

async function stageArchive(
  root: string,
  archive: Buffer,
  version: string,
): Promise<{ stagedRoot: string; stagingParent: string }> {
  const stagingParent = join(root, "versions", `.staging-${process.pid}-${Date.now()}`);
  const archivePath = join(stagingParent, `${releaseAssetName(version)}.download`);
  await mkdir(stagingParent, { recursive: true });
  await writeFile(archivePath, archive, { mode: 0o600 });
  const extractDir = join(stagingParent, "extract");
  const stagedRoot = await extractReleaseArchive({ archivePath, destination: extractDir });
  await removeStaging(archivePath);
  await assertVersion(stagedRoot, version);
  return { stagedRoot, stagingParent };
}

async function installVersion(
  root: string,
  stagedRoot: string,
  stagingParent: string,
  version: string,
): Promise<{ installedPath: string; replacedExisting: boolean }> {
  const installedPath = versionInstallPath(root, version);
  const replacedExisting = existsSync(installedPath);
  if (replacedExisting) {
    const current = await probeVersion(installedPath).catch(() => undefined);
    if (current === version) {
      await removeStaging(stagingParent);
      return { installedPath, replacedExisting };
    }
    await rm(installedPath, { recursive: true, force: true });
  }
  await mkdir(join(root, "versions"), { recursive: true });
  await rename(stagedRoot, installedPath);
  await removeStaging(stagingParent);
  return { installedPath, replacedExisting };
}

async function pruneVersions(root: string, keep: Set<string>): Promise<void> {
  const versionsDir = join(root, "versions");
  try {
    const entries = await readdir(versionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".staging-")) continue;
      if (!keep.has(entry.name)) {
        await rm(join(versionsDir, entry.name), { recursive: true, force: true });
      }
    }
  } catch {
    // Pruning is best-effort; the active install has already been verified.
  }
}

async function rollback(options: UpdateOptions, root: string): Promise<UpdateResult> {
  const current = readCurrentVersion(root);
  const previous = readPreviousVersion(root);
  if (!current || !previous) {
    throw new UpdateError("no previous version is recorded; cannot roll back");
  }
  const previousPath = versionInstallPath(root, previous);
  if (!existsSync(previousPath)) {
    throw new UpdateError(`previous version directory is missing: ${previousPath}`);
  }
  await assertVersion(previousPath, previous);
  writeCurrentVersion(root, previous);
  writePreviousVersion(root, current);
  const verified = await probeVersion(previousPath).catch(() => undefined);
  if (verified !== previous) {
    writeCurrentVersion(root, current);
    writePreviousVersion(root, previous);
    throw new UpdateError("rollback executable failed its version probe; restored the previous state");
  }
  return {
    status: "rolled-back",
    from: current,
    to: previous,
    installPath: previousPath,
  };
}

export async function performUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const { install } = options;
  if (install.kind !== "self-owned") {
    throw new UpdateUnsupported(
      install.kind === "npm" && install.installCommand
        ? `this is an npm installation; npm releases are not published. Reinstall from a signed release: ${install.installCommand}`
        : "this is not a self-owned release install; nothing to update",
    );
  }
  const root = install.installRoot;
  await writableInstallRoot(root);

  const lock = await acquireLock(root);
  try {
    const current = readCurrentVersion(root);
    if (!current) throw new UpdateError(`cannot read the installed version from ${join(root, "current")}`);
    if (options.rollback) return await rollback(options, root);

    const source = options.releaseSource ?? new ForgejoReleaseSource({ timeoutMs: options.timeoutMs });
    const release = await source.latest();
    if (!release) throw new UpdateError("no stable release is published");
    const target = release.version;

    if (target === current) {
      return { status: "current", from: current, to: current, installPath: versionInstallPath(root, current) };
    }
    const currentParsed = parseVersion(current);
    const targetParsed = parseVersion(target);
    if (!currentParsed || !targetParsed) throw new UpdateError(`invalid version pair ${current} -> ${target}`);
    if (compareVersions(targetParsed, currentParsed) < 0 && !options.allowDowngrade) {
      throw new UpdateError(
        `refusing to downgrade ${current} -> ${target}; pass --allow-downgrade to override`,
      );
    }
    if (!options.allowDowngrade && !isNewerVersion(target, current)) {
      throw new UpdateError(`refusing non-upgrade ${current} -> ${target}`);
    }

    const assetName = releaseAssetName(target);
    const asset = release.assets.find((candidate) => candidate.name === assetName);
    const checksumsAsset = release.assets.find((candidate) => candidate.name === "SHA256SUMS");
    const signatureAsset = release.assets.find((candidate) => candidate.name === "SHA256SUMS.sig");
    if (!asset) throw new UpdateError(`release ${target} has no ${assetName}`);
    if (!checksumsAsset) throw new UpdateError(`release ${target} has no SHA256SUMS`);
    if (!signatureAsset) throw new UpdateError(`release ${target} has no SHA256SUMS.sig`);

    const [checksums, signature] = await Promise.all([
      source.download(checksumsAsset),
      source.download(signatureAsset),
    ]);
    verifySshSignature({
      message: checksums,
      signature,
      trustedKeys: options.trustedKeys ?? RELEASE_PUBLIC_KEYS,
    });

    const archive = await source.download(asset);
    verifyChecksum(checksums.toString("utf8"), assetName, archive);

    const { stagedRoot, stagingParent } = await stageArchive(root, archive, target);
    let installedPath: string;
    try {
      ({ installedPath } = await installVersion(root, stagedRoot, stagingParent, target));
    } catch (err) {
      await removeStaging(stagingParent);
      throw err;
    }

    const priorPrevious = readPreviousVersion(root);
    writePreviousVersion(root, current);
    writeCurrentVersion(root, target);
    try {
      await assertVersion(installedPath, target);
    } catch (err) {
      writeCurrentVersion(root, current);
      if (priorPrevious) writePreviousVersion(root, priorPrevious);
      else await rm(join(root, "previous"), { force: true });
      throw new UpdateError(`installed version failed verification; restored ${current}: ${(err as Error).message}`);
    }

    await pruneVersions(root, new Set([target, current]));
    return { status: "updated", from: current, to: target, installPath: installedPath };
  } finally {
    await lock.release();
  }
}
