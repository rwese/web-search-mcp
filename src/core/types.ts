/**
 * Shared domain types for the web-search core.
 *
 * The core is the deep seam every surface (CLI, MCP server, pi wrapper)
 * consumes. Types here are the normalized contract derived from the SearXNG
 * JSON API (see research/searxng-api.md) and locked by the wayfinder map.
 */
import type { DebugLogger } from "../infra/debug.js";

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
}