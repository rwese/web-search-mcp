/**
 * Background update check.
 *
 * TTY-only and cache-free by design: a detached helper checks the release
 * source for this invocation and prints at most one stderr line. It never
 * writes installed files, never writes cache, and stays silent on any
 * failure. `WZE_WEBSEARCH_NO_UPDATE_CHECK=1` disables it.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { checkForUpdate, type UpdateCheck, type UpdateCheckDeps } from "./checker.js";
import { detectInstall, type Env, type InstallContext } from "./install.js";

const NO_UPDATE_CHECK_ENV = "WZE_WEBSEARCH_NO_UPDATE_CHECK";
const BACKGROUND_ENV = "WZE_WEBSEARCH_UPDATE_BACKGROUND";

export function backgroundCheckEnabled(
  env: Env = process.env,
  stderrIsTTY: boolean = Boolean(process.stderr.isTTY),
): boolean {
  return stderrIsTTY && env[NO_UPDATE_CHECK_ENV] !== "1" && env[BACKGROUND_ENV] !== "1";
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
 * Start the detached checker. Called by entrypoints after parsing, never by
 * the helper itself. The child inherits stderr so the notice lands on the
 * user's terminal even if the parent exits first.
 */
export function maybeCheckForUpdatesInBackground(install: InstallContext = detectInstall()): void {
  if (!backgroundCheckEnabled()) return;
  const cliScript = cliScriptPath(install);
  if (!cliScript) return;

  try {
    const child = spawn(process.execPath, [cliScript, "update", "--check", "--background"], {
      detached: true,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, [BACKGROUND_ENV]: "1" },
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // A background convenience must never affect the foreground command.
  }
}

/** Run one check and print only a positive result. Used by `--background`. */
export async function runBackgroundCheck(
  install: InstallContext = detectInstall(),
  deps: UpdateCheckDeps = {},
): Promise<UpdateCheck | undefined> {
  try {
    const check = await checkForUpdate(install, deps);
    if (check.updateAvailable) process.stderr.write(`${check.message}\n`);
    return check;
  } catch {
    return undefined;
  }
}
