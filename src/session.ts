import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SearchResult, SessionRecord } from "./types.js";
import { SearchError } from "./types.js";

const HEX_LEN = 8;
const SLUG_MAX = 40;
const RESULT_SLUG_MAX = 60;

/** A searchable, filesystem-safe slug: lowercase alnum, hyphens, length-capped. */
export function slugify(value: string, maxLength: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "query";
}

/** Random hex string, used for session and result ids. */
export function hexId(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

/** `8-hex + "-" + query slug`, e.g. `3f9a2c7e-what-is-kubernetes`. */
export function createSessionId(query: string): string {
  return `${hexId(HEX_LEN)}-${slugify(query, SLUG_MAX)}`;
}

function resultFileName(index: number, result: SearchResult): string {
  const id = hexId(HEX_LEN);
  const slug = slugify(result.title, RESULT_SLUG_MAX);
  return `${index.toString().padStart(3, "0")}-${id}-${slug}.json`;
}

export type StoredResult = SearchResult & { rank: number };

/** Write one search session to disk. Creates <storeRoot>/<sessionId>/. */
export async function writeSession(
  storeRoot: string,
  sessionId: string,
  session: {
    query: string;
    createdAt: string;
    results: SearchResult[];
    suggestions: string[];
    answers: string[];
    corrections: string[];
    infoboxes: unknown[];
    unresponsiveEngines: [string, string][];
  },
): Promise<void> {
  const dir = join(storeRoot, sessionId);
  await mkdir(dir, { recursive: true });

  const { results, ...meta } = session;
  await writeFile(
    join(dir, "session.json"),
    JSON.stringify({ sessionId, ...meta }, null, 2),
    "utf8",
  );

  await Promise.all(
    results.map((result, index) => {
      const record: StoredResult = { ...result, rank: index };
      return writeFile(join(dir, resultFileName(index, result)), JSON.stringify(record, null, 2), "utf8");
    }),
  );
}

type StoredMeta = {
  sessionId?: string;
  query?: string;
  createdAt?: string;
  suggestions?: string[];
  answers?: string[];
  corrections?: string[];
  infoboxes?: unknown[];
  unresponsiveEngines?: [string, string][];
};

/** Read a persisted session back from disk and rebuild it into a SessionRecord. */
export async function readSession(sessionId: string, storeRoot: string): Promise<SessionRecord> {
  const dir = join(storeRoot, sessionId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    throw new SearchError(`No such session: ${sessionId} (looked in ${storeRoot})`);
  }

  const metaRaw = await readFile(join(dir, "session.json"), "utf8");
  const meta = JSON.parse(metaRaw) as StoredMeta;

  const records: StoredResult[] = [];
  for (const file of files) {
    if (file === "session.json") continue;
    records.push(JSON.parse(await readFile(join(dir, file), "utf8")) as StoredResult);
  }
  records.sort((a, b) => a.rank - b.rank);
  const results: SearchResult[] = records.map((record) => ({
    title: record.title,
    url: record.url,
    snippet: record.snippet,
    publishedDate: record.publishedDate,
    score: record.score,
    engines: record.engines,
    category: record.category,
  }));

  return {
    sessionId,
    query: meta.query ?? "",
    createdAt: meta.createdAt ?? "",
    results,
    suggestions: meta.suggestions ?? [],
    answers: meta.answers ?? [],
    corrections: meta.corrections ?? [],
    infoboxes: meta.infoboxes ?? [],
    unresponsiveEngines: meta.unresponsiveEngines ?? [],
  };
}