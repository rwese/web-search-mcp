import { describe, expect, it } from "vitest";
import {
	buildSessionOverview,
	extractJson,
	isAiConfigured,
	planQuery,
	resolveRecursionLimit,
	validateFootnotes,
	validatePlan,
	modelFromConfig,
} from "../../src/ai/agent.js";
import type { Config } from "../../src/infra/config.js";
import type { SessionLike } from "../../src/ai/agent.js";

const SESSION: SessionLike = {
	sessionId: "abc12345-test",
	query: "kubernetes",
	results: [
		{
			title: "Kubernetes docs",
			url: "https://kubernetes.io/docs/",
			snippet: "Production-grade orchestration.",
			publishedDate: "2024-01-01T00:00:00Z",
			score: 0.9,
			engines: ["wikipedia"],
			category: "general",
		},
		{
			title: "K8s video",
			url: "https://video.example/k8s",
			snippet: "A walkthrough.",
			publishedDate: null,
			score: null,
			engines: ["youtube"],
			category: "videos",
		},
	],
	suggestions: ["kubernetes tutorial"],
};

describe("extractJson", () => {
	it("parses a fenced JSON block", () => {
		const out = extractJson('```json\n{"categories": ["videos"]}\n```');
		expect(out).toEqual({ categories: ["videos"] });
	});

	it("parses JSON embedded in prose", () => {
		const out = extractJson('Here you go: {"engines": ["youtube"]} cheers');
		expect(out).toEqual({ engines: ["youtube"] });
	});

	it("throws when there is no JSON object", () => {
		expect(() => extractJson("no json here")).toThrow("did not return a JSON object");
	});

	it("throws on invalid JSON", () => {
		expect(() => extractJson("{not json}")).toThrow("invalid JSON");
	});
});

describe("planQuery", () => {
	it("returns a validated plan from fenced model output", async () => {
		const plan = await planQuery(
			{
				invoke: async () => ({
					content: '```json\n{"queries": [" kubernetes installation ", "kubernetes setup tutorial"], "categories": ["videos"], "engines": ["youtube"]}\n```',
				}),
			},
			"how to install kubernetes",
			["general", "videos"],
			["youtube", "wikipedia"],
		);
		expect(plan.categories).toEqual(["videos"]);
		expect(plan.engines).toEqual(["youtube"]);
		expect(plan.queries).toEqual(["kubernetes installation", "kubernetes setup tutorial"]);
	});

	it("throws SearchError on an invalid plan", async () => {
		await expect(
			planQuery(
				{ invoke: async () => ({ content: '{"categories": [42]}' }) },
				"q",
				["general"],
				["wikipedia"],
			),
		).rejects.toThrow("invalid plan");
	});
});

describe("validatePlan", () => {
	it("drops picks the instance does not have", () => {
		const plan = validatePlan(
			{ queries: ["q"], categories: ["videos", "nope"], engines: ["youtube", "ghost"], language: "en" },
			["videos"],
			["youtube"],
		);
		expect(plan).toEqual({ queries: ["q"], categories: ["videos"], engines: ["youtube"], language: "en" });
	});

	it("keeps empty picks empty (no restriction)", () => {
		const plan = validatePlan({ queries: ["q"], categories: [], engines: [] }, ["videos"], ["youtube"]);
		expect(plan.categories).toEqual([]);
		expect(plan.engines).toEqual([]);
	});
});

describe("buildSessionOverview", () => {
	it("numbers results with meta lines", () => {
		const text = buildSessionOverview(SESSION);
		expect(text).toContain("## Search session: abc12345-test");
		expect(text).toContain('### Search query: "kubernetes"');
		expect(text).toContain("### Results (2 total)");
		expect(text).toContain("1. Kubernetes docs");
		expect(text).toContain("https://kubernetes.io/docs/");
		expect(text).toContain("(wikipedia · general · 2024-01-01T00:00:00Z)");
		expect(text).toContain("Suggestions: kubernetes tutorial");
	});

	it("caps the overview and notes the remainder", () => {
		const text = buildSessionOverview(SESSION, 1);
		expect(text).toContain("... 1 more result(s) in the session.");
	});
});

describe("validateFootnotes", () => {
	const good = [
		"Kubernetes is an orchestrator.[^1]",
		"",
		"## Sources",
		"",
		"[^1]: [Kubernetes docs](https://kubernetes.io/docs/)",
	].join("\n");

	it("accepts a fully cited summary", () => {
		expect(validateFootnotes(good, 2)).toEqual([]);
	});

	it("flags a summary with no citations", () => {
		const errors = validateFootnotes("Kubernetes is great.", 2);
		expect(errors.some((e) => e.includes("cites no results"))).toBe(true);
	});

	it("flags dangling markers", () => {
		const errors = validateFootnotes(`${good}\nExtra claim.[^9]`, 2);
		expect(errors.some((e) => e.includes("[^9] has no matching result"))).toBe(true);
	});

	it("flags missing Sources section", () => {
		const errors = validateFootnotes("Kubernetes is an orchestrator.[^1]", 1);
		expect(errors.some((e) => e.includes("no Sources section"))).toBe(true);
	});

	it("flags a cited marker without a Sources entry", () => {
		const errors = validateFootnotes(
			"First.[^1] Second.[^2]\n\n## Sources\n\n[^1]: [A](https://a.example/)",
			2,
		);
		expect(errors.some((e) => e.includes("[^2] is cited but has no Sources entry"))).toBe(true);
	});

	it("accepts **Sources** and bare Sources headings", () => {
		const bold = good.replace("## Sources", "**Sources**");
		expect(validateFootnotes(bold, 2)).toEqual([]);
		const bare = good.replace("## Sources", "Sources");
		expect(validateFootnotes(bare, 2)).toEqual([]);
	});
});

describe("isAiConfigured", () => {
	const base: Config = {
		searxngUrl: "https://search.example/",
		timeoutMs: 10000,
		storeDir: "/tmp/sessions",
		debug: false,
	};

	it("is false without openai config", () => {
		delete process.env.OPENAI_API_KEY;
		expect(isAiConfigured(base)).toBe(false);
	});

	it("is false with a model but no key", () => {
		delete process.env.OPENAI_API_KEY;
		expect(isAiConfigured({ ...base, openai: { model: "m" } })).toBe(false);
	});

	it("is true with a model and an env key", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		try {
			expect(isAiConfigured({ ...base, openai: { model: "m" } })).toBe(true);
		} finally {
			delete process.env.OPENAI_API_KEY;
		}
	});

	it("is true with a model and a config-file key", () => {
		delete process.env.OPENAI_API_KEY;
		expect(isAiConfigured({ ...base, openai: { model: "m", apiKey: "sk-file" } })).toBe(true);
	});
});

describe("resolveRecursionLimit", () => {
	it("scales with maxModelCalls (* 4 + 10)", () => {
		expect(resolveRecursionLimit(10, { env: {} })).toBe(50);
	});

	it("prefers WEB_SEARCH_RECURSION_LIMIT over the computed default", () => {
		expect(resolveRecursionLimit(10, { env: { WEB_SEARCH_RECURSION_LIMIT: "80" } })).toBe(80);
	});

	it("ignores a non-numeric env value", () => {
		expect(resolveRecursionLimit(10, { env: { WEB_SEARCH_RECURSION_LIMIT: "lots" } })).toBe(50);
	});

	it("ignores a non-positive env value", () => {
		expect(resolveRecursionLimit(10, { env: { WEB_SEARCH_RECURSION_LIMIT: "0" } })).toBe(50);
	});

	it("prefers an explicit opt over the env", () => {
		expect(
			resolveRecursionLimit(10, { recursionLimit: 42, env: { WEB_SEARCH_RECURSION_LIMIT: "80" } }),
		).toBe(42);
	});
});

describe("modelFromConfig", () => {
	const config: Config = {
		searxngUrl: "https://search.example/",
		timeoutMs: 10000,
		storeDir: "/tmp/sessions",
		debug: false,
		openai: { baseUrl: "https://litellm.example/v1", model: "deepseek-v4-flash" },
	};

	it("builds a model when model + env key are present", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const model = modelFromConfig(config);
		expect(model).toBeDefined();
		delete process.env.OPENAI_API_KEY;
	});

	it("throws when no model is configured", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		expect(() =>
			modelFromConfig({ ...config, openai: undefined }),
		).toThrow("No model configured");
		delete process.env.OPENAI_API_KEY;
	});

	it("throws when OPENAI_API_KEY is missing", () => {
		delete process.env.OPENAI_API_KEY;
		expect(() => modelFromConfig({ ...config, openai: { ...config.openai } })).toThrow(
			"OPENAI_API_KEY is not set",
		);
	});

	it("falls back to openai.apiKey from the config file", () => {
		delete process.env.OPENAI_API_KEY;
		const model = modelFromConfig({
			...config,
			openai: { ...config.openai, apiKey: "sk-file" },
		});
		expect(model).toBeDefined();
	});

	it("prefers OPENAI_API_KEY over the config file value", () => {
		process.env.OPENAI_API_KEY = "sk-env";
		const model = modelFromConfig({
			...config,
			openai: { ...config.openai, apiKey: "sk-file" },
		});
		expect(model.apiKey).toBe("sk-env");
		delete process.env.OPENAI_API_KEY;
	});

	it("stamps a generated x-opencode-session by default", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const model = modelFromConfig(config);
		const headers = model.clientConfig.defaultHeaders as Record<string, string>;
		expect(headers["x-opencode-session"]).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		delete process.env.OPENAI_API_KEY;
	});

	it("generates a fresh id per model", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const first = modelFromConfig(config).clientConfig.defaultHeaders as Record<string, string>;
		const second = modelFromConfig(config).clientConfig.defaultHeaders as Record<string, string>;
		expect(first["x-opencode-session"]).not.toBe(second["x-opencode-session"]);
		delete process.env.OPENAI_API_KEY;
	});

	it("prefers an explicit sessionId over the generated one", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const model = modelFromConfig(config, { sessionId: "ses_explicit" });
		expect(model.clientConfig.defaultHeaders).toMatchObject({
			"x-opencode-session": "ses_explicit",
		});
		delete process.env.OPENAI_API_KEY;
	});
});
