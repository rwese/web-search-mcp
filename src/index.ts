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
export type { DebugLogger } from "./infra/debug-logger.js";
export { createDebugLogger } from "./infra/debug-logger.js";
export { resolveDebug } from "./infra/debug-env.js";
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
export { SearchError, SearxngError, SearchTimeout, SearchUnavailable, SearchVolumeExhausted } from "./core/errors.js";
export { checkForUpdate } from "./update/checker.js";
export type { UpdateCheck, UpdateCheckDeps } from "./update/checker.js";
export { detectInstall, resolveInstallRoot } from "./update/install.js";
export type { InstallContext, InstallKind } from "./update/install.js";
export { performUpdate } from "./update/updater.js";
export type { UpdateOptions, UpdateResult } from "./update/updater.js";
export { UpdateBusy, UpdateError, UpdateUnsupported } from "./update/errors.js";
