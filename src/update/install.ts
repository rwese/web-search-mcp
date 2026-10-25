/**
 * Install layout and ownership detection.
 *
 * A self-owned install is a versioned directory tree the updater owns:
 *
 *   $XDG_DATA_HOME/wze-websearch/install/
 *     install.json          ownership marker written by the installer/updater
 *     current               text file holding the active version
 *     previous              text file holding the rollback version
 *     update.lock           exclusive update lock
 *     versions/<version>/   dist/, node_modules/, package.json
 *
 * `~/.local/bin/wze-websearch` and `wze-websearch-mcp` are wrappers that read
 * `current`; swapping that one file changes the running version. The layout
 * deliberately avoids symlinks so it works on Windows without elevation.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { version as packageVersion } from "../version.js";
import { parseVersion } from "./version.js";

export type InstallKind = "self-owned" | "npm" | "development" | "container" | "unknown";

/** Process environment shape; avoids leaning on the NodeJS namespace in lint. */
export type Env = Record<string, string | undefined>;

type Platform = typeof process.platform;

export type InstallRecord = {
  schema: 1;
  kind: "self-owned";
  installRoot: string;
  binDir: string;
  createdAt: string;
};

export type InstallContext = {
  kind: InstallKind;
  execPath: string;
  installRoot: string;
  binDir: string;
  /** Active version, when it can be read. */
  currentVersion?: string;
  /** Version directory for a self-owned install. */
  installPath?: string;
  /** Command the owner of a managed install expects users to run. */
  managerCommand?: string;
};

export type DetectOptions = {
  execPath?: string;
  installRoot?: string;
  binDir?: string;
  cwd?: string;
  platform?: Platform;
  env?: Env;
  container?: boolean;
};

function xdgDataHome(env: Env): string {
  return env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

function defaultInstallRoot(
  platform: Platform = process.platform,
  env: Env = process.env,
): string {
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "wze-websearch", "install");
  }
  return join(xdgDataHome(env), "wze-websearch", "install");
}

function defaultBinDir(
  platform: Platform = process.platform,
  env: Env = process.env,
): string {
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "wze-websearch", "bin");
  }
  return join(homedir(), ".local", "bin");
}

/** Infer the install root from a versioned script path, without trusting cwd. */
function inferInstallRoot(execPath: string): string | undefined {
  const marker = `${sep}versions${sep}`;
  const index = execPath.indexOf(marker);
  return index > 0 ? execPath.slice(0, index) : undefined;
}

export function resolveInstallRoot(env: Env = process.env, execPath?: string): string {
  return (
    env.WZE_WEBSEARCH_INSTALL_ROOT ||
    (execPath ? inferInstallRoot(execPath) : undefined) ||
    defaultInstallRoot(process.platform, env)
  );
}

function resolveBinDir(env: Env = process.env): string {
  return env.WZE_WEBSEARCH_BIN_DIR || defaultBinDir(process.platform, env);
}

export function readInstallRecord(root: string): InstallRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "install.json"), "utf8")) as Partial<InstallRecord>;
    if (parsed.schema !== 1 || parsed.kind !== "self-owned") return undefined;
    return {
      schema: 1,
      kind: "self-owned",
      installRoot: typeof parsed.installRoot === "string" ? parsed.installRoot : root,
      binDir: typeof parsed.binDir === "string" ? parsed.binDir : resolveBinDir(),
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function writeInstallRecord(root: string, binDir: string): void {
  mkdirSync(root, { recursive: true });
  const record: InstallRecord = {
    schema: 1,
    kind: "self-owned",
    installRoot: root,
    binDir,
    createdAt: new Date().toISOString(),
  };
  writeAtomic(join(root, "install.json"), `${JSON.stringify(record, null, 2)}\n`, 0o644);
}

export function readCurrentVersion(root: string): string | undefined {
  try {
    const value = readFileSync(join(root, "current"), "utf8").trim();
    return parseVersion(value) ? value.replace(/^v/, "") : undefined;
  } catch {
    return undefined;
  }
}

export function readPreviousVersion(root: string): string | undefined {
  try {
    const value = readFileSync(join(root, "previous"), "utf8").trim();
    return parseVersion(value) ? value.replace(/^v/, "") : undefined;
  } catch {
    return undefined;
  }
}

export function versionInstallPath(root: string, version: string): string {
  return join(root, "versions", version);
}

function executablePath(): string {
  const script = process.argv[1];
  if (!script) return "";
  try {
    return realpathSync(script);
  } catch {
    return resolve(script);
  }
}

function isInside(parent: string, child: string): boolean {
  const base = resolve(parent) + sep;
  const target = resolve(child);
  return target === resolve(parent) || target.startsWith(base);
}

function looksLikeNpmInstall(execPath: string, env: Env): boolean {
  return (
    execPath.split(sep).includes("node_modules") ||
    execPath.includes(`${sep}_npx${sep}`) ||
    env.npm_config_global === "true"
  );
}

function looksLikeDevelopment(execPath: string, cwd: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { name?: string };
    return pkg.name === "@rwese/wze-websearch" && isInside(cwd, execPath);
  } catch {
    return false;
  }
}

/** Resolve how this process was installed, and therefore who may update it. */
export function detectInstall(options: DetectOptions = {}): InstallContext {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? executablePath();
  const root = resolve(options.installRoot ?? resolveInstallRoot(env, execPath));
  const record = readInstallRecord(root);
  const installedVersion = readCurrentVersion(root);
  const binDir = options.binDir ?? record?.binDir ?? resolveBinDir(env);
  const container =
    options.container ?? (platform !== "win32" && (existsSync("/.dockerenv") || Boolean(env.KUBERNETES_SERVICE_HOST)));

  const base = { execPath, installRoot: root, binDir };

  if (container) {
    return { ...base, kind: "container", ...(installedVersion ? { currentVersion: installedVersion } : {}) };
  }

  if (record && execPath && isInside(join(root, "versions"), execPath)) {
    return {
      ...base,
      kind: "self-owned",
      ...(installedVersion
        ? { currentVersion: installedVersion, installPath: versionInstallPath(root, installedVersion) }
        : {}),
    };
  }

  if (looksLikeNpmInstall(execPath, env)) {
    return {
      ...base,
      kind: "npm",
      currentVersion: packageVersion,
      managerCommand: "npm i -g @rwese/wze-websearch",
    };
  }

  if (looksLikeDevelopment(execPath, options.cwd ?? process.cwd())) {
    return { ...base, kind: "development", currentVersion: packageVersion };
  }

  // A marker plus a readable current version is positive ownership evidence,
  // even when the process was launched through an unusual path.
  if (record && installedVersion) {
    return {
      ...base,
      kind: "self-owned",
      currentVersion: installedVersion,
      installPath: versionInstallPath(root, installedVersion),
    };
  }

  return { ...base, kind: "unknown" };
}

function writeAtomic(path: string, content: string, mode = 0o644): void {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, content, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}

export function writeCurrentVersion(root: string, version: string): void {
  writeAtomic(join(root, "current"), `${version}\n`);
}

export function writePreviousVersion(root: string, version: string): void {
  writeAtomic(join(root, "previous"), `${version}\n`);
}

export function wrapperScripts(root: string): Record<string, string> {
  const cli = join("versions", "$VERSION", "dist", "surfaces", "cli", "cli.js");
  const mcp = join("versions", "$VERSION", "dist", "surfaces", "mcp", "mcp.js");
  const sh = (entry: string): string =>
    [
      "#!/bin/sh",
      `root="\${WZE_WEBSEARCH_INSTALL_ROOT:-${root}}"`,
      'export WZE_WEBSEARCH_INSTALL_ROOT="$root"',
      'version=$(cat "$root/current")',
      `exec node "$root/${entry.replace("$VERSION", '${version}')}" "$@"`,
      "",
    ].join("\n");
  const cmd = (entry: string): string =>
    [
      "@echo off",
      "setlocal",
      `if not defined WZE_WEBSEARCH_INSTALL_ROOT set "WZE_WEBSEARCH_INSTALL_ROOT=${root}"`,
      'set /p VERSION=<"%WZE_WEBSEARCH_INSTALL_ROOT%\\current"',
      `node "%WZE_WEBSEARCH_INSTALL_ROOT%\\${entry.replace("$VERSION", "%VERSION%")}" %*`,
      "",
    ].join("\r\n");
  return {
    "wze-websearch": sh(cli),
    "wze-websearch.cmd": cmd(cli),
    "wze-websearch-mcp": sh(mcp),
    "wze-websearch-mcp.cmd": cmd(mcp),
  };
}

/** Write the bin wrappers that read `current`. Returns the written paths. */
// fallow-ignore-next-line unused-export
export function installWrappers(root: string, binDir: string): string[] {
  mkdirSync(binDir, { recursive: true });
  const written: string[] = [];
  for (const [name, content] of Object.entries(wrapperScripts(root))) {
    const path = join(binDir, name);
    writeAtomic(path, content, name.endsWith(".cmd") ? 0o644 : 0o755);
    written.push(path);
  }
  return written;
}
