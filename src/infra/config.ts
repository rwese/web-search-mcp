import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SearchError } from "../core/errors.js";
import { resolveEnvDebug } from "./debug-env.js";

/**
 * Configuration resolution, per the wayfinder map (config schema & precedence).
 *
 * Sources, highest precedence first:
 *   1. environment variables (SEARXNG_URL, SEARXNG_TIMEOUT_MS, OPENAI_*)
 *   2. XDG config file   $XDG_CONFIG_HOME/web-search/config.json
 *                        (fallback ~/.config/web-search/config.json)
 *   3. defaults
 *
 * The core never loads dotenv itself; the CLI/MCP entrypoints load `$PWD/.env`
 * before the process starts. The XDG config file may hold `openai.apiKey` as
 * a fallback when OPENAI_API_KEY is unset — keep the file mode 0600.
 */
export type Config = {
  searxngUrl: string;
  timeoutMs: number;
  storeDir: string;
  /** Verbose stderr logging. Set by WEB_SEARCH_DEBUG (env wins), else the config file. */
  debug: boolean;
  /**
   * Display cap: how many results render in markdown overviews and MCP/pi
   * summaries. Set by WEB_SEARCH_MAX_RESULTS (env wins), else the config
   * file, else 15. Never truncates the persisted session.
   */
  maxResults: number;
  /**
   * Budget for the summarizer agent's follow-up `search` tool calls per
   * summarize run. Set by WEB_SEARCH_MAX_AGENT_SEARCHES (env wins), else
   * the config file, else 10.
   */
  maxAgentSearches: number;
  openai?: {
    baseUrl?: string;
    model?: string;
    /** OPENAI_API_KEY wins when set; otherwise the config file value. */
    apiKey?: string;
  };
};

export type ConfigFile = {
  searxngUrl?: string;
  timeoutMs?: number;
  storeDir?: string;
  debug?: boolean;
  maxResults?: number;
  maxAgentSearches?: number;
  openai?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  };
};

const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_MAX_RESULTS = 15;
export const DEFAULT_MAX_AGENT_SEARCHES = 10;

function positiveInt(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function xdgConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "web-search", "config.json");
}

function xdgDataDir(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

export function defaultStoreDir(): string {
  return join(xdgDataDir(), "web-search", "sessions");
}

/** Built-in configuration template, independent of existing config and credentials. */
export function defaultConfig(): ConfigFile {
  return {
    searxngUrl: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    storeDir: defaultStoreDir(),
    debug: false,
    maxResults: DEFAULT_MAX_RESULTS,
    maxAgentSearches: DEFAULT_MAX_AGENT_SEARCHES,
    openai: { baseUrl: "", model: "", apiKey: "" },
  };
}

async function readConfigFile(): Promise<ConfigFile> {
  const file = xdgConfigPath();
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as ConfigFile;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return {};
    }
    throw new SearchError(`Failed to parse config file ${file}: ${(err as Error).message}`);
  }
}

/** Resolve the SearXNG URL: env wins, else the config file; fail fast when unset. */
function resolveSearxngUrl(file: ConfigFile): string {
  const searxngUrl = process.env.SEARXNG_URL || file.searxngUrl;
  if (!searxngUrl) {
    throw new SearchError(
      "SEARXNG_URL is not set. Set it in the environment or in the XDG config file " +
        "($XDG_CONFIG_HOME/web-search/config.json).",
    );
  }
  return searxngUrl;
}

/** Resolve the request timeout: env wins, else the config file, else the default. */
function resolveTimeoutMs(file: ConfigFile): number {
  const timeoutRaw = process.env.SEARXNG_TIMEOUT_MS || file.timeoutMs;
  return timeoutRaw === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw) || DEFAULT_TIMEOUT_MS;
}

function resolveMaxResults(file: ConfigFile): number {
  return (
    positiveInt(process.env.WEB_SEARCH_MAX_RESULTS) ??
    positiveInt(file.maxResults) ??
    DEFAULT_MAX_RESULTS
  );
}

function resolveMaxAgentSearches(file: ConfigFile): number {
  return (
    positiveInt(process.env.WEB_SEARCH_MAX_AGENT_SEARCHES) ??
    positiveInt(file.maxAgentSearches) ??
    DEFAULT_MAX_AGENT_SEARCHES
  );
}

/** Resolve the OpenAI block: env wins per field, else the config file, else undefined. */
function resolveOpenAi(file: ConfigFile): Config["openai"] {
  const fromFile = file.openai ?? {};
  const baseUrl = process.env.OPENAI_BASE_URL || fromFile.baseUrl;
  const model = process.env.OPENAI_MODEL || fromFile.model;
  const apiKey = process.env.OPENAI_API_KEY || fromFile.apiKey;
  if (!file.openai && !baseUrl && !model && !apiKey) return undefined;
  return { baseUrl, model, apiKey };
}

export async function loadConfig(): Promise<Config> {
  const file = await readConfigFile();

  return {
    searxngUrl: resolveSearxngUrl(file),
    timeoutMs: resolveTimeoutMs(file),
    storeDir: file.storeDir || defaultStoreDir(),
    debug: resolveEnvDebug() ?? file.debug ?? false,
    maxResults: resolveMaxResults(file),
    maxAgentSearches: resolveMaxAgentSearches(file),
    openai: resolveOpenAi(file),
  };
}

/** Resolve the OpenAI API key: OPENAI_API_KEY wins, else the config file value. */
export function openaiApiKey(config: Config): string | undefined {
  return process.env.OPENAI_API_KEY || config.openai?.apiKey;
}
