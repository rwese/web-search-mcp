/**
 * Release archive extraction.
 *
 * The archive is a trust boundary. Only regular files and directories under
 * the single declared top-level `wze-websearch/` directory are accepted:
 * absolute paths, `..` traversal, backslash paths, links, and special files
 * abort the extraction into a disposable staging directory.
 */
import { mkdir, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { x as extractTar } from "tar";
import { UpdateError } from "./errors.js";

const ARCHIVE_ROOT = "wze-websearch";
const ALLOWED_TYPES = new Set(["File", "OldFile", "Directory"]);

export function assertSafeEntry(rawPath: string, type: string): string {
  if (!ALLOWED_TYPES.has(type)) {
    throw new UpdateError(`archive contains unsupported entry type ${type} for ${rawPath}`);
  }
  if (!rawPath || rawPath.includes("\0") || rawPath.includes("\\")) {
    throw new UpdateError(`archive contains an unsafe path: ${JSON.stringify(rawPath)}`);
  }
  if (rawPath.startsWith("/") || /^[A-Za-z]:/.test(rawPath)) {
    throw new UpdateError(`archive contains an absolute path: ${rawPath}`);
  }
  const normalized = posix.normalize(rawPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new UpdateError(`archive contains a traversal path: ${rawPath}`);
  }
  if (normalized !== ARCHIVE_ROOT && !normalized.startsWith(`${ARCHIVE_ROOT}/`)) {
    throw new UpdateError(`archive member is outside ${ARCHIVE_ROOT}/: ${rawPath}`);
  }
  return normalized;
}

export type ExtractArchiveOptions = {
  archivePath: string;
  /** Parent directory that will contain `wze-websearch/`. */
  destination: string;
};

/** Extract to `destination/wze-websearch`; returns that root. */
export async function extractReleaseArchive(options: ExtractArchiveOptions): Promise<string> {
  await mkdir(options.destination, { recursive: true });
  try {
    await extractTar({
      file: options.archivePath,
      cwd: options.destination,
      strict: true,
      preservePaths: false,
      onentry: (entry) => {
        assertSafeEntry(entry.path, entry.type);
      },
    });
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError(`failed to extract release archive: ${(err as Error).message}`);
  }
  const root = join(options.destination, ARCHIVE_ROOT);
  return root;
}

export async function removeStaging(destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true });
}
