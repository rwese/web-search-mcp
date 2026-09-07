import type { SearchOptions, SearchResponse } from "./types.js";
import { loadConfig } from "./config.js";
import { createDebugLogger, resolveDebug, type DebugLogger } from "./debug.js";
import { normalizeResult, searchRaw, type RawSearchResult } from "./searxng.js";
import { createSessionId, writeSession } from "./session.js";

/**
 * Perform a web search and persist it as a session.
 *
 * Config comes from the environment + XDG config file (see config.ts), with
 * per-call overrides via `options`. Every search writes a session directory
 * under the configured store root, keyed by the returned sessionId.
 */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const config = await loadConfig();
  const baseUrl = options.baseUrl || config.searxngUrl;
  const timeoutMs = options.timeoutMs || config.timeoutMs;
  const debugOpt = options.debug;
  const debug: DebugLogger =
    typeof debugOpt === 'object'
      ? debugOpt
      : createDebugLogger(resolveDebug({ debug: debugOpt, configDebug: config.debug }));
  const effective = { ...options, debug };

  debug.log('search', `query "${query}" -> ${baseUrl}`);
  const raw = await searchRaw(baseUrl, query, effective, timeoutMs);

  const results = (raw.results ?? []).map((result: RawSearchResult) => normalizeResult(result));

  const sessionId = createSessionId(query);
  const createdAt = new Date().toISOString();
  const envelope = {
    suggestions: raw.suggestions ?? [],
    answers: raw.answers ?? [],
    corrections: raw.corrections ?? [],
    infoboxes: raw.infoboxes ?? [],
    unresponsiveEngines: raw.unresponsive_engines ?? [],
  };

  await writeSession(config.storeDir, sessionId, {
    query,
    createdAt,
    results,
    ...envelope,
  });
  debug.log('search', `session ${sessionId} persisted`, {
    storeDir: config.storeDir,
    resultCount: results.length,
    unresponsiveEngines: envelope.unresponsiveEngines,
  });

  return {
    query,
    sessionId,
    results,
    ...envelope,
  };
}

export { readSession } from "./session.js";
export { renderMarkdown } from "./markdown.js";
export type { DebugLogger } from "./debug.js";
export { createDebugLogger, resolveDebug } from "./debug.js";
export type {
  Config,
  ConfigFile,
} from "./config.js";
export { defaultStoreDir, loadConfig } from "./config.js";
export type {
  SafeSearch,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SessionRecord,
  TimeRange,
} from "./types.js";
export {
  SearchError,
  SearxngError,
  SearchTimeout,
  SearchUnavailable,
} from "./types.js";