import { describe, expect, it } from "vitest";
import { renderDoctorReport, runDoctor, type DoctorReport } from "../../src/diagnostics/doctor.js";
import type { Config } from "../../src/infra/config.js";

const CONFIG: Config = {
	searxngUrl: "https://search.example/",
	timeoutMs: 10000,
	storeDir: "/tmp/sessions",
	debug: false,
};

const INSTANCE = {
	categories: ["general", "news"],
	engines: [
		{ name: "brave", enabled: true, categories: ["general"] },
		{ name: "wikipedia", enabled: true, categories: ["general"] },
		{ name: "ghost", enabled: false, categories: ["general"] },
	],
};

function okDeps(extra: Record<string, unknown> = {}) {
	return {
		loadConfig: async () => CONFIG,
		fetchConfig: async () => INSTANCE,
		probeSearch: async () => ({ results: 3, unresponsive: 1 }),
		checkStoreDir: async () => {},
		...extra,
	};
}

describe("runDoctor", () => {
	it("passes all checks when everything is healthy (llm skipped when unconfigured)", async () => {
		const report = await runDoctor({ deps: okDeps() });
		expect(report.ok).toBe(true);
		expect(report.checks.map((c) => c.name)).toEqual([
			"config",
			"store-dir",
			"searxng",
			"engines",
			"search",
			"llm",
		]);
		expect(report.checks.every((c) => c.ok)).toBe(true);
		expect(report.checks.find((c) => c.name === "llm")?.detail).toContain("skipped");
		expect(report.checks.find((c) => c.name === "engines")?.detail).toContain("brave");
	});

	it("returns early with only a config check when config fails", async () => {
		const report = await runDoctor({
			deps: {
				loadConfig: async () => {
					throw new Error("SEARXNG_URL is not set");
				},
			},
		});
		expect(report.ok).toBe(false);
		expect(report.checks).toHaveLength(1);
		expect(report.checks[0].name).toBe("config");
		expect(report.checks[0].ok).toBe(false);
	});

	it("marks searxng, engines, and search failed when the instance is unreachable", async () => {
		const unreachable = new Error("Failed to reach SearXNG");
		const report = await runDoctor({
			deps: okDeps({
				fetchConfig: async () => {
					throw unreachable;
				},
				probeSearch: async () => {
					throw unreachable;
				},
			}),
		});
		expect(report.ok).toBe(false);
		expect(report.checks.find((c) => c.name === "searxng")?.ok).toBe(false);
		expect(report.checks.find((c) => c.name === "engines")?.detail).toContain("skipped");
		expect(report.checks.find((c) => c.name === "search")?.ok).toBe(false);
	});

	it("fails engines when the instance reports none enabled", async () => {
		const report = await runDoctor({ deps: okDeps({ fetchConfig: async () => ({}) }) });
		expect(report.ok).toBe(false);
		expect(report.checks.find((c) => c.name === "engines")?.ok).toBe(false);
	});

	it("probes the LLM endpoint when openai config is present", async () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const report = await runDoctor({
			deps: okDeps({
				loadConfig: async () => ({
					...CONFIG,
					openai: { baseUrl: "https://litellm.example/v1", model: "deepseek-v4-flash" },
				}),
				probeLlm: async () => "https://litellm.example/v1 reachable (2 model(s) listed)",
			}),
		});
		delete process.env.OPENAI_API_KEY;
		const llm = report.checks.find((c) => c.name === "llm");
		expect(llm?.ok).toBe(true);
		expect(llm?.detail).toContain("deepseek-v4-flash");
	});

	it("fails llm when the key is missing or multiline", async () => {
		const withModel = {
			loadConfig: async () => ({
				...CONFIG,
				openai: { baseUrl: "https://litellm.example/v1", model: "deepseek-v4-flash" },
			}),
		};
		delete process.env.OPENAI_API_KEY;
		const missing = await runDoctor({ deps: { ...okDeps(), ...withModel } });
		expect(missing.ok).toBe(false);
		expect(missing.checks.find((c) => c.name === "llm")?.detail).toContain("OPENAI_API_KEY is not set");

		process.env.OPENAI_API_KEY = "sk-test\nmarker-comment";
		const multiline = await runDoctor({ deps: { ...okDeps(), ...withModel } });
		delete process.env.OPENAI_API_KEY;
		expect(multiline.checks.find((c) => c.name === "llm")?.detail).toContain("newline");
	});

	it("uses openai.apiKey from the config file when the env key is unset", async () => {
		delete process.env.OPENAI_API_KEY;
		const report = await runDoctor({
			deps: okDeps({
				loadConfig: async () => ({
					...CONFIG,
					openai: {
						baseUrl: "https://litellm.example/v1",
						model: "deepseek-v4-flash",
						apiKey: "sk-file",
					},
				}),
				probeLlm: async () => "https://litellm.example/v1 reachable (2 model(s) listed)",
			}),
		});
		expect(report.checks.find((c) => c.name === "llm")?.ok).toBe(true);
	});
});

describe("renderDoctorReport", () => {
	it("renders pass/fail lines with a summary", () => {
		const report: DoctorReport = {
			ok: false,
			checks: [
				{ name: "config", ok: true, detail: "fine" },
				{ name: "searxng", ok: false, detail: "boom" },
			],
		};
		const text = renderDoctorReport(report);
		expect(text).toContain("✓ config: fine");
		expect(text).toContain("✗ searxng: boom");
		expect(text).toContain("1/2 checks passed");
	});
});
