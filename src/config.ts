import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SearchError } from "./types.js";

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
 * before the process starts. The config file holds non-secret values only —
 * API keys stay in the environment.
 */
export type Config = {
  searxngUrl: string;
  timeoutMs: number;
  storeDir: string;
  openai?: {
    baseUrl?: string;
    model?: string;
  };
};

export type ConfigFile = {
  searxngUrl?: string;
  timeoutMs?: number;
  storeDir?: string;
  openai?: {
    baseUrl?: string;
    model?: string;
  };
};

export const DEFAULT_TIMEOUT_MS = 10000;

function xdgConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "web-search", "config.json");
}

function xdgDataDir(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

export function defaultStoreDir(): string {
  return join(xdgDataDir(), "web-search", "sessions");
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

export async function loadConfig(): Promise<Config> {
  const file = await readConfigFile();

  const searxngUrl = process.env.SEARXNG_URL || file.searxngUrl;
  if (!searxngUrl) {
    throw new SearchError(
      "SEARXNG_URL is not set. Set it in the environment or in the XDG config file " +
        "($XDG_CONFIG_HOME/web-search/config.json).",
    );
  }

  const timeoutRaw = process.env.SEARXNG_TIMEOUT_MS || file.timeoutMs;
  const timeoutMs =
    timeoutRaw === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw) || DEFAULT_TIMEOUT_MS;

  return {
    searxngUrl,
    timeoutMs,
    storeDir: file.storeDir || defaultStoreDir(),
    openai:
      file.openai || process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL
        ? {
            baseUrl: process.env.OPENAI_BASE_URL || file.openai?.baseUrl,
            model: process.env.OPENAI_MODEL || file.openai?.model,
          }
        : undefined,
  };
}