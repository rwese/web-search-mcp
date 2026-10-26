/**
 * Background update check and headless self-update.
 *
 * Detached and TTY-independent: it runs after CLI searches and once at MCP
 * startup whether or not stderr is a terminal. A headless host (MCP over
 * stdio, an editor task, CI) has nobody to read a notice, so the helper
 * applies a verified release itself instead of only reporting one; the
 * running process keeps its old version until restart because the bin
 * wrappers resolve `current` on launch.
 *
 * Throttled by `update-check.stamp` in the install root so short-lived MCP
 * processes do not each hit the release API, silent on any check failure, and
 * silent unless an applied update changes something. It never blocks or fails
 * the foreground command.
 * What it reports is appended to `update.log` in the install root and, when
 * stderr is a terminal, also printed there; a headless helper is spawned with
 * no inherited stdio so an MCP host closing its pipes cannot kill it or turn
 * a write into an uncaught EPIPE.
 * `WZE_WEBSEARCH_NO_UPDATE_CHECK=1` disables it; the detached helper marks
 * itself with `WZE_WEBSEARCH_UPDATE_BACKGROUND=1` to avoid recursion.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkForUpdate, type UpdateCheck } from "./checker.js";
import { detectInstall, type Env, type InstallContext } from "./install.js";
import { performUpdate, type UpdateDeps, type UpdateResult } from "./updater.js";

const NO_UPDATE_CHECK_ENV = "WZE_WEBSEARCH_NO_UPDATE_CHECK";
const BACKGROUND_ENV = "WZE_WEBSEARCH_UPDATE_BACKGROUND";
const STAMP_FILE = "update-check.stamp";
const LOG_FILE = "update.log";

/** Minimum time between background checks, per install root. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function backgroundCheckEnabled(env: Env = process.env): boolean {
  return env[NO_UPDATE_CHECK_ENV] !== "1" && env[BACKGROUND_ENV] !== "1";
}

function stampPath(install: InstallContext): string | undefined {
  return install.kind === "self-owned" ? join(install.installRoot, STAMP_FILE) : undefined;
}

/**
 * Claim the throttle window. Returns false while the recorded check is still
 * fresh, or when the install root cannot be marked. The marker is written
 * before the spawn so a burst of MCP starts cannot all race the release API.
 */
export function claimCheckWindow(install: InstallContext, now: number = Date.now()): boolean {
  const path = stampPath(install);
  if (!path) return false;
  try {
    if (now - statSync(path).mtimeMs < CHECK_INTERVAL_MS) return false;
  } catch {
    // No marker yet: this process may claim the window.
  }
  try {
    mkdirSync(install.installRoot, { recursive: true });
    writeFileSync(path, `${new Date(now).toISOString()}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Locate the CLI script without importing the CLI surface (no module cycle). */
function cliScriptPath(install: InstallContext): string | undefined {
  if (install.kind === "self-owned" && install.currentVersion) {
    return join(
      install.installRoot,
      "versions",
      install.currentVersion,
      "dist",
      "surfaces",
      "cli",
      "cli.js",
    );
  }
  return undefined;
}

/**
 * Start the detached helper. Called by entrypoints after parsing, never by the
 * helper itself. A terminal gets the helper's stderr so the update line lands
 * in front of the user; a headless host gets no inherited stdio at all, so the
 * helper survives its parent and never writes into a closing log pipe. The
 * line then lands in `update.log` instead.
 */
export function maybeCheckForUpdatesInBackground(install: InstallContext = detectInstall()): void {
  if (!backgroundCheckEnabled()) return;
  const cliScript = cliScriptPath(install);
  if (!cliScript) return;
  if (!claimCheckWindow(install)) return;

  try {
    const child = spawn(process.execPath, [cliScript, "update", "--background"], {
      detached: true,
      stdio: process.stderr.isTTY === true ? ["ignore", "ignore", "inherit"] : "ignore",
      env: { ...process.env, [BACKGROUND_ENV]: "1" },
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // A background convenience must never affect the foreground command.
  }
}

export type BackgroundDeps = UpdateDeps & {
  /** Extra sink for the outcome line; `update.log` is always written. */
  log?: (line: string) => void;
};

/** Write one line to stderr without ever throwing into the caller. */
function note(line: string): void {
  try {
    process.stderr.write(line);
  } catch {
    // The host may already have closed its log pipe.
  }
}

/**
 * Build the reporter: `update.log` always, stderr only on a terminal. The log
 * is what an MCP or CI operator can inspect after a headless update.
 */
function makeNote(install: InstallContext): (line: string) => void {
  const logPath = install.kind === "self-owned" ? join(install.installRoot, LOG_FILE) : undefined;
  return (line) => {
    if (logPath) {
      try {
        appendFileSync(logPath, `${new Date().toISOString()} ${line}`, { mode: 0o600 });
      } catch {
        // Logging is best-effort; never mask the update outcome.
      }
    }
    if (process.stderr.isTTY === true) note(line);
  };
}

/**
 * A detached helper outlives the process that spawned it, so its stderr can
 * point at a pipe nobody reads any more. Without a listener that EPIPE is an
 * uncaught exception in the helper.
 */
function guardClosedLogPipe(): void {
  if (process.env[BACKGROUND_ENV] !== "1") return;
  process.stderr.on("error", () => {});
}

export type BackgroundResult = {
  check: UpdateCheck;
  update?: UpdateResult;
};

/**
 * Run one check, and apply the release when it is a self-owned install.
 * Returns undefined when the check itself failed; an update failure is logged
 * because an operator needs the reason, then treated as "no update".
 */
export async function runBackgroundCheck(
  install: InstallContext = detectInstall(),
  deps: BackgroundDeps = {},
): Promise<BackgroundResult | undefined> {
  guardClosedLogPipe();
  const note = makeNote(install);
  const log = deps.log
    ? (line: string) => {
        deps.log?.(line);
        note(line);
      }
    : note;

  let check: UpdateCheck;
  try {
    check = await checkForUpdate(install, deps);
  } catch {
    return undefined;
  }

  if (!check.updateAvailable || install.kind !== "self-owned") return { check };

  try {
    const update = await performUpdate({ install, ...deps });
    if (update.status === "updated") {
      log(
        `wze-websearch updated ${update.from} -> ${update.to}; restart to use ${update.to}\n`,
      );
    }
    return { check, update };
  } catch (err) {
    log(`wze-websearch background update failed: ${(err as Error).message}\n`);
    return { check };
  }
}
