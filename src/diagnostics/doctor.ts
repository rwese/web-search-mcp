/**
 * Doctor — validate the local web-search setup.
 *
 * Checks, in order: config loads (SEARXNG_URL present) → session store is
 * writable → SearXNG /config reachable → instance has enabled engines →
 * a side-effect-free /search probe (raw, no session persisted) → LLM
 * endpoint reachable when OpenAI config is present (skipped otherwise).
 *
 * The search probe deliberately bypasses the core `search()` so `--doctor`
 * never writes a session. The LLM probe only reads `{baseUrl}/models` —
 * no chat call, no token cost.
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig as defaultLoadConfig, openaiApiKey, type Config } from "../infra/config.js";
import { toLogger, type DebugLogger } from "../infra/debug.js";
import {
  enabledEngineNames,
  fetchInstanceConfig,
  instanceCategories,
  searchRaw,
  type InstanceConfig,
} from "../infra/searxng.js";
import { SearchError } from "../core/errors.js";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
};

const PROBE_QUERY = "test";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Injectable seams so tests can stub every external call. */
export type DoctorDeps = {
  loadConfig?: () => Promise<Config>;
  fetchConfig?: (baseUrl: string, timeoutMs: number) => Promise<InstanceConfig>;
  probeSearch?: (baseUrl: string, timeoutMs: number) => Promise<{ results: number; unresponsive: number }>;
  probeLlm?: (baseUrl: string, apiKey: string, timeoutMs: number) => Promise<string>;
  checkStoreDir?: (dir: string) => Promise<void>;
};

export type DoctorOptions = {
  debug?: boolean | DebugLogger;
  deps?: DoctorDeps;
};

async function defaultCheckStoreDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const probe = join(dir, ".doctor-probe");
  await writeFile(probe, "ok", "utf8");
  await unlink(probe);
}

function defaultProbeSearch(debug: DebugLogger): NonNullable<DoctorDeps["probeSearch"]> {
  return async (baseUrl, timeoutMs) => {
    const raw = await searchRaw(baseUrl, PROBE_QUERY, { debug }, timeoutMs);
    return {
      results: raw.results?.length ?? 0,
      unresponsive: raw.unresponsive_engines?.length ?? 0,
    };
  };
}

function defaultProbeLlm(debug: DebugLogger): NonNullable<DoctorDeps["probeLlm"]> {
  return async (baseUrl, apiKey, timeoutMs) => {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    debug.log("doctor", `GET ${url}`, { timeoutMs });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new SearchError(`LLM endpoint timed out after ${timeoutMs}ms`);
        }
        throw new SearchError(`Failed to reach LLM endpoint at ${baseUrl}: ${(err as Error).message}`);
      }
      if (!response.ok) {
        throw new SearchError(`LLM endpoint returned HTTP ${response.status} for GET /models`);
      }
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      const count = Array.isArray(body.data) ? body.data.length : 0;
      return `${baseUrl} reachable (${count} model(s) listed)`;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Run every setup check and return the report. Overall `ok` is true only
 * when every check passes. A failed config check returns early — nothing
 * else can run without it.
 */
export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const debug = toLogger(opts.debug);
  const deps = opts.deps ?? {};
  const checks: DoctorCheck[] = [];

  let config: Config;
  try {
    config = await (deps.loadConfig ?? defaultLoadConfig)();
    checks.push({
      name: "config",
      ok: true,
      detail: `SEARXNG_URL=${config.searxngUrl} timeout=${config.timeoutMs}ms store=${config.storeDir}`,
    });
  } catch (err) {
    checks.push({ name: "config", ok: false, detail: (err as Error).message });
    return { ok: false, checks };
  }

  try {
    await (deps.checkStoreDir ?? defaultCheckStoreDir)(config.storeDir);
    checks.push({ name: "store-dir", ok: true, detail: `${config.storeDir} writable` });
  } catch (err) {
    checks.push({ name: "store-dir", ok: false, detail: (err as Error).message });
  }

  let instance: InstanceConfig | undefined;
  try {
    const fetchConfig =
      deps.fetchConfig ?? ((baseUrl, timeoutMs) => fetchInstanceConfig(baseUrl, timeoutMs, { debug }));
    instance = await fetchConfig(config.searxngUrl, config.timeoutMs);
    const categories = instanceCategories(instance);
    const engines = enabledEngineNames(instance);
    checks.push({
      name: "searxng",
      ok: true,
      detail: `${config.searxngUrl} reachable (${categories.length} categories, ${engines.length} enabled engines)`,
    });
  } catch (err) {
    checks.push({ name: "searxng", ok: false, detail: (err as Error).message });
  }

  if (!instance) {
    checks.push({ name: "engines", ok: false, detail: "skipped (SearXNG /config unreachable)" });
  } else {
    const engines = enabledEngineNames(instance);
    checks.push(
      engines.length
        ? { name: "engines", ok: true, detail: `${engines.length} enabled: ${engines.join(", ")}` }
        : { name: "engines", ok: false, detail: "instance reports no enabled engines" },
    );
  }

  try {
    const probe = deps.probeSearch ?? defaultProbeSearch(debug);
    const { results, unresponsive } = await probe(config.searxngUrl, config.timeoutMs);
    checks.push({
      name: "search",
      ok: true,
      detail: `probe query "${PROBE_QUERY}" returned ${results} result(s) (${unresponsive} unresponsive engine(s))`,
    });
  } catch (err) {
    checks.push({ name: "search", ok: false, detail: (err as Error).message });
  }

  if (!config.openai) {
    checks.push({ name: "llm", ok: true, detail: "not configured (skipped)" });
  } else {
    const model = config.openai.model;
    const apiKey = openaiApiKey(config);
    const baseUrl = config.openai.baseUrl || OPENAI_DEFAULT_BASE_URL;
    if (!model) {
      checks.push({
        name: "llm",
        ok: false,
        detail: "No model configured. Set OPENAI_MODEL in the environment or openai.model in the XDG config file.",
      });
    } else if (!apiKey) {
      checks.push({
        name: "llm",
        ok: false,
        detail: "OPENAI_API_KEY is not set. Set it in the environment or openai.apiKey in the XDG config file.",
      });
    } else if (/\r|\n/.test(apiKey)) {
      checks.push({
        name: "llm",
        ok: false,
        detail: "OPENAI_API_KEY contains a newline (the vault secret is multiline; use only the first line).",
      });
    } else {
      try {
        const probe = deps.probeLlm ?? defaultProbeLlm(debug);
        const detail = await probe(baseUrl, apiKey, config.timeoutMs);
        checks.push({ name: "llm", ok: true, detail: `model "${model}": ${detail}` });
      } catch (err) {
        checks.push({ name: "llm", ok: false, detail: (err as Error).message });
      }
    }
  }

  debug.log("doctor", "report", { ok: checks.every((c) => c.ok), checks: checks.length });
  return { ok: checks.every((c) => c.ok), checks };
}

/** Render a DoctorReport as lean human-readable text (stdout-safe). */
export function renderDoctorReport(report: DoctorReport): string {
  const lines = ["web-search doctor"];
  for (const check of report.checks) {
    lines.push(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }
  const passed = report.checks.filter((c) => c.ok).length;
  lines.push(
    `${passed}/${report.checks.length} checks passed${report.ok ? "" : " — setup has issues"}`,
  );
  return lines.join("\n");
}
