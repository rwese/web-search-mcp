/** Update eligibility: newest stable release for the install's owner. */
import type { InstallContext } from "./install.js";
import { ForgejoReleaseSource, type ReleaseSource } from "./release.js";
import { isNewerVersion } from "./version.js";

export type UpdateCheck = {
  kind: InstallContext["kind"];
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  /** True when a newer release exists but this install is manager-owned. */
  managed: boolean;
  command?: string;
  installPath?: string;
  message: string;
};

export type UpdateCheckDeps = {
  releaseSource?: ReleaseSource;
  timeoutMs?: number;
};

export async function checkForUpdate(
  install: InstallContext,
  deps: UpdateCheckDeps = {},
): Promise<UpdateCheck> {
  const current = install.currentVersion;
  if (!current) {
    return {
      kind: install.kind,
      updateAvailable: false,
      managed: install.kind !== "self-owned",
      message: "cannot determine the installed version; reinstall from a release",
      ...(install.installPath ? { installPath: install.installPath } : {}),
    };
  }

  if (install.kind === "self-owned") {
    const source = deps.releaseSource ?? new ForgejoReleaseSource({ timeoutMs: deps.timeoutMs });
    const release = await source.latest();
    if (!release) {
      return {
        kind: install.kind,
        currentVersion: current,
        updateAvailable: false,
        managed: false,
        message: `no published release found for ${current}`,
        ...(install.installPath ? { installPath: install.installPath } : {}),
      };
    }
    const updateAvailable = isNewerVersion(release.version, current);
    return {
      kind: install.kind,
      currentVersion: current,
      latestVersion: release.version,
      updateAvailable,
      managed: false,
      command: "wze-websearch update",
      ...(install.installPath ? { installPath: install.installPath } : {}),
      message: updateAvailable
        ? `wze-websearch ${release.version} is available (installed ${current}); run: wze-websearch update`
        : `wze-websearch ${current} is current`,
    };
  }

  if (install.kind === "npm") {
    return {
      kind: install.kind,
      currentVersion: current,
      updateAvailable: false,
      managed: true,
      command: install.installCommand,
      message:
        "this is an npm installation; npm releases are not published. " +
        `Reinstall from a signed release: ${install.installCommand}`,
    };
  }

  return {
    kind: install.kind,
    currentVersion: current,
    updateAvailable: false,
    managed: true,
    message:
      install.kind === "container"
        ? "this install is inside a container; update the image instead of the binary"
        : "this is not a release install; nothing to update",
  };
}
