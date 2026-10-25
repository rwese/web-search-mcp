/**
 * Release version parsing and comparison.
 *
 * Release tags carry a leading `v` (`v0.8.0`); artifacts and the executable
 * report the bare version (`0.8.0`). Only stable `MAJOR.MINOR.PATCH` releases
 * are eligible for updates. A pre-release suffix is parsed so malformed tags
 * can be rejected without guessing, but the release pipeline never publishes
 * one.
 */
export type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
};

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(raw.trim());
  if (!match) return undefined;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    ...(prerelease ? { prerelease } : {}),
  };
}

/** True when the string is a stable, eligible release version. */
export function isStableVersion(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed !== undefined && parsed.prerelease === undefined;
}

/** Compare `a` with `b`: negative when older, 0 when equal, positive when newer. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** True when `candidate` is a strict upgrade over `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  return compareVersions(next, installed) > 0;
}
