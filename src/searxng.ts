import type { SearchOptions, SearchResult } from "./types.js";
import { SearxngError, SearchTimeout, SearchUnavailable } from "./types.js";

/** Raw result shape as returned by the SearXNG JSON API. */
export type RawSearchResult = {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  engines?: string[];
  score?: number;
  category?: string;
  publishedDate?: string;
  pubdate?: string;
  [key: string]: unknown;
};

/** Raw top-level envelope as returned by the SearXNG JSON API. */
export type RawSearchResponse = {
  query?: string;
  results?: RawSearchResult[];
  answers?: string[];
  corrections?: string[];
  infoboxes?: unknown[];
  suggestions?: string[];
  unresponsive_engines?: [string, string][];
  [key: string]: unknown;
};

function toString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

/** Normalize one raw SearXNG result into the shared SearchResult contract. */
export function normalizeResult(raw: RawSearchResult): SearchResult {
  return {
    title: toString(raw.title) || "Untitled",
    url: toString(raw.url),
    snippet: toString(raw.content),
    publishedDate: toString(raw.publishedDate || raw.pubdate) || null,
    score: toNumber(raw.score),
    engines: toStringArray(raw.engines || raw.engine).filter(Boolean),
    category: toString(raw.category) || null,
  };
}

/** Build the /search query string for the given options (SearXNG snake_case params). */
export function buildQueryParams(query: string, options: SearchOptions): URLSearchParams {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "json");
  if (options.categories?.length) params.set("categories", options.categories.join(","));
  if (options.engines?.length) params.set("engines", options.engines.join(","));
  if (options.language) params.set("language", options.language);
  if (options.timeRange) params.set("time_range", options.timeRange);
  if (options.safeSearch !== undefined) params.set("safesearch", String(options.safeSearch));
  if (options.pageNo !== undefined && options.pageNo > 0) params.set("pageno", String(options.pageNo));
  return params;
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Query the SearXNG JSON API and return the raw response.
 * Engine failures are non-fatal on SearXNG's side; they surface in
 * `unresponsive_engines` and are passed through to the caller as data.
 */
export async function searchRaw(
  baseUrl: string,
  query: string,
  options: SearchOptions,
  timeoutMs: number,
): Promise<RawSearchResponse> {
  const url = new URL("/search", baseUrl.replace(/\/+$/, ""));
  url.search = buildQueryParams(query, options).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new SearchTimeout(`Search timed out after ${timeoutMs}ms`);
      }
      throw new SearchUnavailable(`Failed to reach SearXNG at ${baseUrl}: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const message = await parseError(response);
      if (response.status >= 500) {
        throw new SearchUnavailable(`SearXNG returned HTTP ${response.status}: ${message}`);
      }
      throw new SearxngError(message, response.status);
    }

    const raw = (await response.json()) as RawSearchResponse;
    if (!raw || !Array.isArray(raw.results)) {
      throw new SearxngError("SearXNG returned an unexpected response shape", response.status);
    }
    return raw;
  } finally {
    clearTimeout(timer);
  }
}