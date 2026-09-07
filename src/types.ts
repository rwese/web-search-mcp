/**
 * Shared domain types for the web-search core.
 *
 * The core is the deep seam every surface (CLI, MCP server, pi wrapper)
 * consumes. Types here are the normalized contract derived from the SearXNG
 * JSON API (see research/searxng-api.md) and locked by the wayfinder map.
 */
import type { DebugLogger } from "./debug.js";

/** One normalized search hit. */
export type SearchResult = {
  title: string;
  url: string;
  /** SearXNG's result summary/excerpt. */
  snippet: string;
  /** ISO date string when the engine reports one, else null. */
  publishedDate: string | null;
  score: number | null;
  /** Engines that produced this result. */
  engines: string[];
  category: string | null;
};

/** Search options accepted by the core. CLI passes everything; MCP/pi expose a subset. */
export type SearchOptions = {
  /** Overrides the configured SearXNG base URL. */
  baseUrl?: string;
  categories?: string[];
  engines?: string[];
  language?: string;
  timeRange?: TimeRange;
  safeSearch?: SafeSearch;
  pageNo?: number;
  /** Request timeout in milliseconds (default 10000). */
  timeoutMs?: number;
  /**
   * Verbose stderr logging (search requests, session writes). `true` enables
   * the default stderr logger; pass a `DebugLogger` to share one across calls.
   * Falls back to `Config.debug`, then `WEB_SEARCH_DEBUG` in the environment.
   */
  debug?: boolean | DebugLogger;
};

/** The full envelope returned by a search, minus raw per-result detail. */
export type SearchResponse = {
  query: string;
  /** 8-hex + slug id; also the on-disk session directory name. */
  sessionId: string;
  results: SearchResult[];
  suggestions: string[];
  answers: string[];
  corrections: string[];
  infoboxes: unknown[];
  /** Pairs of [engine, reason] that failed non-fatally during the search. */
  unresponsiveEngines: [string, string][];
};

export type TimeRange = "day" | "month" | "year";
export type SafeSearch = 0 | 1 | 2;

/** A stored session, loaded back from disk via readSession(). */
export type SessionRecord = {
  sessionId: string;
  query: string;
  createdAt: string;
  results: SearchResult[];
  suggestions: string[];
  answers: string[];
  corrections: string[];
  infoboxes: unknown[];
  unresponsiveEngines: [string, string][];
};

/** Base class for all errors raised by the search core. */
export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

/** A non-2xx response from SearXNG (e.g. 400 missing query, 403 disabled format). */
export class SearxngError extends SearchError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SearxngError";
    this.status = status;
  }
}

/** The request exceeded the configured timeout. */
export class SearchTimeout extends SearchError {
  constructor(message = "Search timed out") {
    super(message);
    this.name = "SearchTimeout";
  }
}

/** Network failure or 5xx from SearXNG. */
export class SearchUnavailable extends SearchError {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailable";
  }
}