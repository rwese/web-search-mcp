/**
 * Prompt templates for the agentic answer loop.
 *
 * Pure string builders — no model calls, no I/O. `ai/agent.ts` renders
 * these and passes the text to the model; tests and surfaces can render
 * them directly to preview or lock the wording.
 */

/** Variables for the planner prompt. */
export type PlannerPromptVars = {
	query: string;
	categories: string[];
	engines: string[];
};

/**
 * Ask the model to steer the search: pick categories/engines from the
 * instance's real lists. The model must answer with a single JSON object.
 */
export function plannerPrompt(vars: PlannerPromptVars): string {
	const { query, categories, engines } = vars;
	return [
		"You steer a web search. Given the user query, pick the SearXNG categories",
		"and engines that best fit its intent (e.g. video/how-to intent -> video engines,",
		"encyclopedic intent -> wikipedia, code intent -> code-related engines).",
		`Available categories: ${categories.join(", ") || "(none)"}`,
		`Available engines: ${engines.join(", ") || "(none)"}`,
		"Rules: use ONLY names from the lists above; an empty array means no restriction;",
		'language is an ISO code (e.g. "en") or omitted; timeRange is day, month, year, or omitted.',
		"Respond with a single JSON object and nothing else, e.g.:",
		'{"categories": ["videos"], "engines": ["youtube"], "language": "en"}',
		"",
		`User query: "${query}"`,
	].join("\n");
}

/**
 * System prompt for the tool-calling summarizer: answer ONLY from the
 * provided results, cite every externally verifiable claim with [^n], and
 * end with a Sources section.
 */
export const SUMMARIZER_SYSTEM_PROMPT = [
	"You are a research summarizer. Answer the user's original query using ONLY the provided search results.",
	"Rules:",
	"- Base every externally verifiable claim on the results. Never add facts from your own knowledge.",
	"- Cite each externally verifiable claim with a footnote marker [^n], where n is the 1-based result number from the session overview.",
	'- End with a "Sources" section listing every cited result as `[^n]: [title](url)`.',
	"- Use the read_session_entry tool to inspect a full result record whenever a snippet is not enough.",
	"- If the results do not contain enough information to answer, say so plainly instead of guessing.",
].join("\n");

/** Variables for the summarizer's user message. */
export type SummarizerPromptVars = {
	originalQuery: string;
	/** Numbered session listing from `buildSessionOverview`. */
	overview: string;
};

/** User message pairing the original query with the session overview. */
export function summarizerUserMessage(vars: SummarizerPromptVars): string {
	return [
		`Original query: "${vars.originalQuery}"`,
		"",
		vars.overview,
		"",
		"Summarize the results as an answer to the original query, with footnotes.",
	].join("\n");
}

/** Variables for the footnote-repair retry. */
export type FootnoteFixPromptVars = {
	/** Violation strings from `validateFootnotes`. */
	errors: string[];
	/** The draft summary that failed validation. */
	draft: string;
};

/** Repair instructions: keep facts, fix ONLY the listed footnote problems. */
export function footnoteFixPrompt(vars: FootnoteFixPromptVars): string {
	return [
		"Rewrite the following draft as a correct summary.",
		"Keep its facts and citations; fix ONLY the footnote problems:",
		...vars.errors.map((e) => `- ${e}`),
		"",
		"Draft:",
		vars.draft,
	].join("\n");
}

/** Variables for the full single-call footnote-repair message. */
export type FootnoteFixMessageVars = SummarizerPromptVars & FootnoteFixPromptVars;

/**
 * Full message for the footnote-repair retry: system rules + original
 * query + session context + repair instructions. Sent as one direct model
 * call (no tool loop) so the agent cannot spin on tool calls while fixing
 * format.
 */
export function footnoteFixMessage(vars: FootnoteFixMessageVars): string {
	return (
		`${SUMMARIZER_SYSTEM_PROMPT}\n\n` +
		`Original query: "${vars.originalQuery}"\n\n` +
		`Session context:\n${vars.overview}\n\n` +
		footnoteFixPrompt({ errors: vars.errors, draft: vars.draft })
	);
}
