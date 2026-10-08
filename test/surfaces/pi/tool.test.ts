import { Text } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import {
	collapsedText,
	renderExpandedResult,
	renderSearchResult,
	type RenderTheme,
} from "../../../src/surfaces/pi/tool.js";

/** A theme that tags each formatted span with its color name, so calls are observable. */
const theme: RenderTheme = {
	fg: (name, text) => `{${name}}${text}`,
};

/** Flatten a rendered Text component to its plain (theme-tagged) string. */
function textOf(component: Text): string {
	return component
		.render(200)
		.map((line) => line.trimEnd())
		.join("\n");
}

describe("collapsedText", () => {
	it("uses the singular for exactly one result", () => {
		expect(collapsedText({ resultCount: 1, query: "kubernetes", sessionId: "abc-kubernetes" })).toBe(
			'→ Found 1 result for "kubernetes" (session abc-kubernetes)',
		);
	});

	it("uses the plural for zero and many results", () => {
		expect(collapsedText({ resultCount: 0, query: "x" })).toBe('→ Found 0 results for "x"');
		expect(collapsedText({ resultCount: 7, query: "x" })).toBe('→ Found 7 results for "x"');
	});

	it("omits the session suffix when no session id is present", () => {
		expect(collapsedText({ resultCount: 2, query: "x" })).toBe('→ Found 2 results for "x"');
	});

	it("falls back to empty fields when details are missing", () => {
		expect(collapsedText({})).toBe('→ Found 0 results for ""');
	});
});

describe("renderExpandedResult", () => {
	it("prefixes a blank line and themes every line", () => {
		expect(textOf(renderExpandedResult("# Title\nbody line", theme))).toBe(
			"\n{toolOutput}# Title\n{toolOutput}body line",
		);
	});

	it("preserves a single line with the leading blank line", () => {
		expect(textOf(renderExpandedResult("only", theme))).toBe("\n{toolOutput}only");
	});
});

describe("renderSearchResult", () => {
	it("renders the collapsed one-liner using the muted color", () => {
		const text = renderSearchResult(
			{
				content: [{ type: "text", text: "full markdown" }],
				details: { resultCount: 1, query: "kubernetes", sessionId: "abc-kubernetes" },
			},
			{ expanded: false },
			theme,
		);
		expect(textOf(text)).toBe(
			'{muted}→ Found 1 result for "kubernetes" (session abc-kubernetes)',
		);
	});

	it("renders expanded text content using the tool output color", () => {
		const text = renderSearchResult(
			{
				content: [{ type: "text", text: "# Title\nbody line" }],
				details: { resultCount: 1, query: "kubernetes", sessionId: "abc-kubernetes" },
			},
			{ expanded: true },
			theme,
		);
		expect(textOf(text)).toBe("\n{toolOutput}# Title\n{toolOutput}body line");
	});

	it("falls back to empty expanded output when no text content is present", () => {
		const text = renderSearchResult(
			{ content: [{ type: "image", text: undefined }], details: { resultCount: 3, query: "x" } },
			{ expanded: true },
			theme,
		);
		expect(textOf(text)).toBe("\n{toolOutput}");
	});

	it("falls back to empty collapsed details when none are provided", () => {
		const text = renderSearchResult({ content: [] }, { expanded: false }, theme);
		expect(textOf(text)).toBe('{muted}→ Found 0 results for ""');
	});
});
