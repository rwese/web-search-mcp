/** SHA256SUMS parsing and artifact checksum verification. */
import { createHash } from "node:crypto";
import { UpdateError } from "./errors.js";

export type ChecksumEntry = { hash: string; name: string };

/** Parse `sha256sum` output (`<hex>  <name>` or `<hex> *<name>`). */
export function parseChecksums(raw: string): ChecksumEntry[] {
  const entries: ChecksumEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) entries.push({ hash: match[1].toLowerCase(), name: match[2].trim() });
  }
  return entries;
}

export function checksumFor(raw: string, name: string): string | undefined {
  return parseChecksums(raw).find((entry) => entry.name === name)?.hash;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Throws unless `data` matches the checksum declared for `name`. */
export function verifyChecksum(raw: string, name: string, data: Buffer): void {
  const expected = checksumFor(raw, name);
  if (!expected) throw new UpdateError(`SHA256SUMS has no entry for ${name}`);
  const actual = sha256(data);
  if (actual !== expected) {
    throw new UpdateError(`checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
}
