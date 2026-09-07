import { describe, expect, it } from "vitest";
import { normalizeResult, buildQueryParams, type RawSearchResult } from "../src/searxng.js";
import { renderMarkdown } from "../src/markdown.js";
import { slugify, createSessionId } from "../src/session.js";
import type { SearchResponse } from "../src/types.js";

describe("normalizeResult", () => {
    it("maps raw SearXNG fields to the SearchResult contract", () => {
        const raw: RawSearchResult = {
            title: "Kubernetes",
            url: "https://kubernetes.io/",
            content: "Production-grade container orchestration.",
            publishedDate: "2024-01-01T00:00:00Z",
            score: 0.95,
            engines: ["brave", "wikipedia"],
            category: "general",
        };
        expect(normalizeResult(raw)).toEqual({
            title: "Kubernetes",
            url: "https://kubernetes.io/",
            snippet: "Production-grade container orchestration.",
            publishedDate: "2024-01-01T00:00:00Z",
            score: 0.95,
            engines: ["brave", "wikipedia"],
            category: "general",
        });
    });

    it("handles missing fields with safe defaults", () => {
        const normalized = normalizeResult({});
        expect(normalized.title).toBe("Untitled");
        expect(normalized.url).toBe("");
        expect(normalized.snippet).toBe("");
        expect(normalized.publishedDate).toBeNull();
        expect(normalized.score).toBeNull();
        expect(normalized.engines).toEqual([]);
        expect(normalized.category).toBeNull();
    });

    it("falls back pubdate to publishedDate", () => {
        const normalized = normalizeResult({ pubdate: "2023-05-05" });
        expect(normalized.publishedDate).toBe("2023-05-05");
    });
});

describe("buildQueryParams", () => {
    it("always sets q and format=json", () => {
        const params = buildQueryParams("hello", {});
        expect(params.get("q")).toBe("hello");
        expect(params.get("format")).toBe("json");
    });

    it("maps camelCase options to snake_case SearXNG params", () => {
        const params = buildQueryParams("test", {
            categories: ["general", "images"],
            engines: ["brave"],
            language: "en",
            timeRange: "year",
            safeSearch: 1,
            pageNo: 2,
        });
        expect(params.get("categories")).toBe("general,images");
        expect(params.get("engines")).toBe("brave");
        expect(params.get("language")).toBe("en");
        expect(params.get("time_range")).toBe("year");
        expect(params.get("safesearch")).toBe("1");
        expect(params.get("pageno")).toBe("2");
    });
});

describe("renderMarkdown", () => {
    const response: SearchResponse = {
        query: "kubernetes",
        sessionId: "3f9a2c7e-what-is-kubernetes",
        results: [
            {
                title: "Kubernetes",
                url: "https://kubernetes.io/",
                snippet: "Orchestration.",
                publishedDate: "2024-01-01",
                score: 0.9,
                engines: ["brave"],
                category: "general",
            },
        ],
        suggestions: ["kubernetes tutorial"],
        answers: [],
        corrections: [],
        infoboxes: [],
        unresponsiveEngines: [["startpage", "CAPTCHA"]],
    };

    it("includes the session line", () => {
        expect(renderMarkdown(response)).toContain("**Session:** 3f9a2c7e-what-is-kubernetes");
    });

    it("renders a numbered result with title, url, snippet and meta", () => {
        const md = renderMarkdown(response);
        expect(md).toContain("## Search results for \"kubernetes\" (1)");
        expect(md).toContain("1. [Kubernetes](https://kubernetes.io/)");
        expect(md).toContain("Orchestration.");
        expect(md).toContain("*Engines: brave · Category: general · Published: 2024-01-01*");
    });

	it("omits unresponsive engines (stderr-only diagnostics, never stdout)", () => {
		const md = renderMarkdown(response);
		expect(md).not.toContain("Unresponsive engines");
		expect(md).not.toContain("startpage");
	});

    it("caps the results at maxResults", () => {
        const many: SearchResponse = {
            ...response,
            results: Array.from({ length: 20 }, (_, i) => ({
                title: `R${i}`,
                url: `https://example.com/${i}`,
                snippet: "",
                publishedDate: null,
                score: null,
                engines: [],
                category: null,
            })),
        };
        const md = renderMarkdown(many, 10);
        expect(md).toContain("(20)");
        expect(md).toContain("10. [R9]");
        expect(md).not.toContain("11. [R10]");
    });

    it("renders an empty-result message", () => {
        const empty: SearchResponse = { ...response, results: [] };
        expect(renderMarkdown(empty)).toContain("No results found.");
    });
});

describe("session ids", () => {
    it("slugifies a query into an id suffix", () => {
        expect(slugify("What is Kubernetes?", 40)).toBe("what-is-kubernetes");
        expect(createSessionId("hello world")).toMatch(/^[0-9a-f]{8}-hello-world$/);
    });
});