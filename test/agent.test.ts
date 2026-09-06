import { describe, expect, it } from "vitest";
import {
	buildSessionOverview,
	extractJson,
	planQuery,
	validateFootnotes,
	validatePlan,
	modelFromConfig,
} from "../src/agent.js";
import type { Config } from "../src/config.js";
import type { SessionLike } from "../src/agent.js";

const SESSION: SessionLike = {
	sessionId: "abc12345-test",
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
					content: '```json\n{"categories": ["videos"], "engines": ["youtube"]}\n```',
				}),
			},
			"how to install kubernetes",
			["general", "videos"],
			["youtube", "wikipedia"],
		);
		expect(plan.categories).toEqual(["videos"]);
		expect(plan.engines).toEqual(["youtube"]);
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
			{ categories: ["videos", "nope"], engines: ["youtube", "ghost"], language: "en" },
			["videos"],
			["youtube"],
		);
		expect(plan).toEqual({ categories: ["videos"], engines: ["youtube"], language: "en" });
	});

	it("keeps empty picks empty (no restriction)", () => {
		const plan = validatePlan({ categories: [], engines: [] }, ["videos"], ["youtube"]);
		expect(plan.categories).toEqual([]);
		expect(plan.engines).toEqual([]);
	});
});

describe("buildSessionOverview", () => {
	it("numbers results with meta lines", () => {
		const text = buildSessionOverview(SESSION);
		expect(text).toContain("Session abc12345-test, 2 result(s):");
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

describe("modelFromConfig", () => {
	const config: Config = {
		searxngUrl: "https://search.example/",
		timeoutMs: 10000,
		storeDir: "/tmp/sessions",
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
		expect(() => modelFromConfig(config)).toThrow("OPENAI_API_KEY is not set");
	});
});
