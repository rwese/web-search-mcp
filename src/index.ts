/**
 * Package barrel — re-exports only, no logic.
 *
 * Surfaces (CLI, MCP server, pi wrapper) consume the core through here.
 * The AI loop (`ai/agent.js`) is imported directly so the barrel never
 * forms a cycle with it.
 */
export { search } from "./core/search.js";
export { readSession } from "./core/session.js";
export { renderMarkdown } from "./core/markdown.js";
export { renderDoctorReport, runDoctor } from "./diagnostics/doctor.js";
export type {
  DoctorCheck,
  DoctorDeps,
  DoctorOptions,
  DoctorReport,
} from "./diagnostics/doctor.js";
export type { DebugLogger } from "./infra/debug.js";
export { createDebugLogger, resolveDebug } from "./infra/debug.js";
export type { Config, ConfigFile } from "./infra/config.js";
export { defaultStoreDir, loadConfig, openaiApiKey } from "./infra/config.js";
export type {
  SafeSearch,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SessionRecord,
  TimeRange,
} from "./core/types.js";
export { SearchError, SearxngError, SearchTimeout, SearchUnavailable } from "./core/errors.js";
