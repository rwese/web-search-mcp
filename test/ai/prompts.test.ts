import { describe, expect, it } from "vitest";
import {
	footnoteFixMessage,
	footnoteFixPrompt,
	plannerPrompt,
	SUMMARIZER_SYSTEM_PROMPT,
	summarizerUserMessage,
} from "../../src/ai/prompts.js";

describe("plannerPrompt", () => {
	it("renders the steering prompt with the live lists", () => {
		expect(
			plannerPrompt({ query: "how to install kubernetes", categories: ["general", "videos"], engines: ["youtube"] }),
		).toBe(
			[
				"You steer a web search. Given the user query, pick the SearXNG categories",
				"and engines that best fit its intent (e.g. video/how-to intent -> video engines,",
				"encyclopedic intent -> wikipedia, code intent -> code-related engines).",
				"Available categories: general, videos",
				"Available engines: youtube",
				"Rules: use ONLY names from the lists above; an empty array means no restriction;",
				'language is an ISO code (e.g. "en") or omitted; timeRange is day, month, year, or omitted.',
				"Respond with a single JSON object and nothing else, e.g.:",
				'{"categories": ["videos"], "engines": ["youtube"], "language": "en"}',
				"",
				'User query: "how to install kubernetes"',
			].join("\n"),
		);
	});

	it("marks empty lists as (none)", () => {
		const text = plannerPrompt({ query: "q", categories: [], engines: [] });
		expect(text).toContain("Available categories: (none)");
		expect(text).toContain("Available engines: (none)");
	});
});

describe("summarizer prompts", () => {
	it("locks the system prompt wording", () => {
		expect(SUMMARIZER_SYSTEM_PROMPT).toBe(
			[
				"You are a research summarizer. Answer the user's original query using ONLY the provided search results.",
				"Rules:",
				"- Base every externally verifiable claim on the results. Never add facts from your own knowledge.",
				"- Cite each externally verifiable claim with a footnote marker [^n], where n is the 1-based result number from the session overview.",
				'- End with a "Sources" section listing every cited result as `[^n]: [title](url)`.',
				"- Use the read_session_entry tool to inspect a full result record whenever a snippet is not enough.",
				"- If the results do not contain enough information to answer, say so plainly instead of guessing.",
			].join("\n"),
		);
	});

	it("pairs the query with the session overview", () => {
		expect(summarizerUserMessage({ originalQuery: "what is k8s?", overview: "Session abc, 1 result(s):" })).toBe(
			['Original query: "what is k8s?"', "", "Session abc, 1 result(s):", "", "Summarize the results as an answer to the original query, with footnotes."].join(
				"\n",
			),
		);
	});
});

describe("footnote-fix prompts", () => {
	const errors = ["footnote [^9] has no matching result (session has 2 result(s))"];
	const draft = "A claim.[^9]";

	it("lists each violation as a bullet under the draft", () => {
		expect(footnoteFixPrompt({ errors, draft })).toBe(
			[
				"Rewrite the following draft as a correct summary.",
				"Keep its facts and citations; fix ONLY the footnote problems:",
				"- footnote [^9] has no matching result (session has 2 result(s))",
				"",
				"Draft:",
				"A claim.[^9]",
			].join("\n"),
		);
	});

	it("assembles the full single-call repair message", () => {
		const message = footnoteFixMessage({
			originalQuery: "what is k8s?",
			overview: "Session abc, 2 result(s):",
			errors,
			draft,
		});
		expect(message).toBe(
			`${SUMMARIZER_SYSTEM_PROMPT}\n\nOriginal query: "what is k8s?"\n\nSession context:\nSession abc, 2 result(s):\n\n${footnoteFixPrompt({ errors, draft })}`,
		);
	});
});
