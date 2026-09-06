/**
 * Agentic answer loop (LangChain).
 *
 * Flow for `--use-ai`: understand the query (planner constrained to the
 * instance's real categories/engines from /config) → search via the core
 * (session persisted as usual) → summarize via a tool-calling agent that
 * reads the session, with footnote validation on the final text.
 *
 * Surfaces import this module directly (`./agent.js`); it is not re-exported
 * from the package index to avoid an index <-> agent import cycle (agent
 * consumes `search()` from the core).
 */
import { createAgent, modelCallLimitMiddleware, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import { z } from "zod";
import type { Config } from "./config.js";
import { search } from "./index.js";
import { enabledEngineNames, fetchInstanceConfig, instanceCategories } from "./searxng.js";
import type { SearchOptions, SearchResult } from "./types.js";
import { SearchError } from "./types.js";

/** Minimal session shape the summarizer needs (SearchResponse and SessionRecord both fit). */
export type SessionLike = {
	sessionId: string;
	results: SearchResult[];
	suggestions: string[];
};

/** Steering plan the model returns for a query. Empty lists = no restriction. */
export const SearchPlanSchema = z.object({
	categories: z.array(z.string()).default([]),
	engines: z.array(z.string()).default([]),
	language: z.string().optional(),
	timeRange: z.enum(["day", "month", "year"]).optional(),
});

export type SearchPlan = z.infer<typeof SearchPlanSchema>;

const DEFAULT_OVERVIEW_CAP = 10;
const DEFAULT_MODEL_CALL_LIMIT = 10;

/** Build a ChatOpenAI against the configured OpenAI-compatible endpoint. */
export function modelFromConfig(config: Config): ChatOpenAI {
	const modelName = config.openai?.model;
	const apiKey = process.env.OPENAI_API_KEY;
	if (!modelName) {
		throw new SearchError(
			"No model configured. Set OPENAI_MODEL in the environment or openai.model in the XDG config file.",
		);
	}
	if (!apiKey) {
		throw new SearchError(
			"OPENAI_API_KEY is not set. API keys stay in the environment, never in the config file.",
		);
	}
	const baseURL = config.openai?.baseUrl;
	return new ChatOpenAI({
		model: modelName,
		apiKey,
		...(baseURL ? { configuration: { baseURL } } : {}),
	});
}

/** A model interface narrow enough to unit-test the planner with a stub. */
export type PlannerModel = {
	invoke(prompt: string): Promise<{ content: unknown }>;
};

/** Extract the first JSON object from model text (strips ``` fences + prose). */
export function extractJson(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = (fenced ? fenced[1] : text).trim();
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new SearchError("Planner did not return a JSON object");
	}
	try {
		return JSON.parse(candidate.slice(start, end + 1));
	} catch (err) {
		throw new SearchError(`Planner returned invalid JSON: ${(err as Error).message}`);
	}
}

/**
 * Ask the model to steer the search: pick categories/engines from the
 * instance's real lists (video intent -> video engines, encyclopedic ->
 * wikipedia, etc.). Returns the raw plan; call validatePlan() to enforce it.
 */
export async function planQuery(
	model: PlannerModel,
	query: string,
	categories: string[],
	engines: string[],
): Promise<SearchPlan> {
	const prompt = [
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
	const raw = await model.invoke(prompt);
	const text = contentToText(raw.content);
	const parsed = SearchPlanSchema.safeParse(extractJson(text));
	if (!parsed.success) {
		throw new SearchError(`Planner returned an invalid plan: ${parsed.error.message}`);
	}
	return parsed.data;
}

/** Drop plan picks the instance does not actually have. Empty stays empty (= defaults). */
export function validatePlan(
	plan: SearchPlan,
	validCategories: string[],
	validEngines: string[],
): SearchPlan {
	return {
		...plan,
		categories: plan.categories.filter((c) => validCategories.includes(c)),
		engines: plan.engines.filter((e) => validEngines.includes(e)),
	};
}

/** Render the numbered session overview the summarizer reasons over. */
export function buildSessionOverview(session: SessionLike, maxResults = DEFAULT_OVERVIEW_CAP): string {
	const lines = [
		`Session ${session.sessionId}, ${session.results.length} result(s):`,
	];
	session.results.slice(0, maxResults).forEach((result, index) => {
		const n = index + 1;
		const meta = [result.engines.join("+"), result.category, result.publishedDate]
			.filter(Boolean)
			.join(" · ");
		lines.push(`${n}. ${result.title}`);
		lines.push(`   ${result.url}`);
		if (result.snippet) lines.push(`   ${result.snippet}`);
		if (meta) lines.push(`   (${meta})`);
	});
	if (session.results.length > maxResults) {
		lines.push(`... ${session.results.length - maxResults} more result(s) in the session.`);
	}
	if (session.suggestions.length) {
		lines.push(`Suggestions: ${session.suggestions.join("; ")}`);
	}
	return lines.join("\n");
}

/** Plain-text rendering of a model message's content. */
export function contentToText(content: MessageContent | unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (typeof block === "string") return block;
				if (block && typeof block === "object" && "text" in block) {
					return String((block as { text: unknown }).text);
				}
				return JSON.stringify(block);
			})
			.join("");
	}
	return String(content ?? "");
}

/** Text of the last AI message in an agent run. */
export function lastAiText(messages: readonly BaseMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if (messages[i].getType() === "ai") {
			return contentToText(messages[i].content);
		}
	}
	return "";
}

const FOOTNOTE_RE = /\[\^(\d+)\]/g;

/**
 * Validate [^n] footnotes against the session: no dangling markers, no
 * uncited summaries, and a Sources section backing every marker.
 * Returns a list of violations (empty = valid).
 */
export function validateFootnotes(summary: string, resultCount: number): string[] {
	const errors: string[] = [];
	const markers = [...summary.matchAll(FOOTNOTE_RE)].map((m) => Number(m[1]));
	if (markers.length === 0 && resultCount > 0) {
		errors.push("summary cites no results; every externally verifiable claim needs a [^n] citation");
		return errors;
	}
	for (const n of markers) {
		if (n < 1 || n > resultCount) {
			errors.push(`footnote [^${n}] has no matching result (session has ${resultCount} result(s))`);
		}
	}
	if (!/^(?:#{1,3}\s*|\*\*)?sources(?:\*\*)?\s*:?\s*$/im.test(summary)) {
		errors.push("summary has footnotes but no Sources section");
		return errors;
	}
	const defs = new Set(
		[...summary.matchAll(/^\s*\[\^(\d+)\]:/gm)].map((m) => Number(m[1])),
	);
	for (const n of new Set(markers)) {
		if (n >= 1 && n <= resultCount && !defs.has(n)) {
			errors.push(`footnote [^${n}] is cited but has no Sources entry`);
		}
	}
	return errors;
}

const SUMMARIZER_SYSTEM_PROMPT = [
	"You are a research summarizer. Answer the user's original query using ONLY the provided search results.",
	"Rules:",
	"- Base every externally verifiable claim on the results. Never add facts from your own knowledge.",
	"- Cite each externally verifiable claim with a footnote marker [^n], where n is the 1-based result number from the session overview.",
	'- End with a "Sources" section listing every cited result as `[^n]: [title](url)`.',
	"- Use the read_session_entry tool to inspect a full result record whenever a snippet is not enough.",
	"- If the results do not contain enough information to answer, say so plainly instead of guessing.",
].join("\n");

/**
 * Summarize a persisted session for the original query via a tool-calling
 * agent. The agent sees the session overview inline and can pull full
 * per-result records through read_session_entry.
 */
export async function summarizeSession(
	model: ChatOpenAI,
	session: SessionLike,
	originalQuery: string,
	opts: { maxResults?: number; maxModelCalls?: number } = {},
): Promise<string> {
	const maxResults = opts.maxResults ?? DEFAULT_OVERVIEW_CAP;
	const maxModelCalls = opts.maxModelCalls ?? DEFAULT_MODEL_CALL_LIMIT;
	const overview = buildSessionOverview(session, maxResults);

	const readEntry = tool(
		({ resultNumber }: { resultNumber: number }) => {
			const result = session.results[resultNumber - 1];
			if (!result) {
				return `No result #${resultNumber}: the session has ${session.results.length} result(s).`;
			}
			return JSON.stringify({ rank: resultNumber, ...result }, null, 2);
		},
		{
			name: "read_session_entry",
			description:
				"Read the full stored record of one search result by its 1-based number from the session overview.",
			schema: z.object({
				resultNumber: z.number().int().min(1).describe("1-based result number from the session overview"),
			}),
		},
	);

	const agent = createAgent({
		model,
		tools: [readEntry],
		systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
		middleware: [modelCallLimitMiddleware({ threadLimit: maxModelCalls, exitBehavior: "end" })],
	});

	const userContent = [
		`Original query: "${originalQuery}"`,
		"",
		overview,
		"",
		"Summarize the results as an answer to the original query, with footnotes.",
	].join("\n");

	const invokeOpts = { recursionLimit: maxModelCalls * 3 + 10 };
	const first = await agent.invoke({ messages: [{ role: "user", content: userContent }] }, invokeOpts);
	const text = lastAiText(first.messages);
	const errors = validateFootnotes(text, session.results.length);
	if (errors.length === 0) return text;

	// One retry as a single direct call (no tool loop), so the agent cannot
	// spin on tool calls and hit the graph recursion cap while fixing format.
	const fixPrompt = [
		"Rewrite the following draft as a correct summary.",
		"Keep its facts and citations; fix ONLY the footnote problems:",
		...errors.map((e) => `- ${e}`),
		"",
		"Draft:",
		text,
	].join("\n");
	const fix = await model.invoke(
		`${SUMMARIZER_SYSTEM_PROMPT}\n\nOriginal query: "${originalQuery}"\n\nSession context:\n${overview}\n\n${fixPrompt}`,
	);
	const fixed = contentToText(fix.content);
	const remaining = validateFootnotes(fixed, session.results.length);
	if (remaining.length > 0) {
		throw new SearchError(`AI summary failed footnote validation: ${remaining.join("; ")}`);
	}
	return fixed;
}

export type AiAnswerOptions = {
	/** Explicit search flags from the CLI; these win over the AI plan. */
	overrides?: SearchOptions;
	maxResults?: number;
};

export type AiAnswer = {
	query: string;
	sessionId: string;
	plan: SearchPlan;
	summary: string;
	unresponsiveEngines: [string, string][];
};

/**
 * Full --use-ai flow: plan -> search (session persisted) -> summarize.
 * Plan picks steer categories/engines/language/timeRange; explicit CLI
 * overrides always win over the plan.
 */
export async function answerQuery(query: string, aiOptions: AiAnswerOptions = {}): Promise<AiAnswer> {
	if (!query.trim()) {
		throw new SearchError("query must not be empty");
	}
	const { loadConfig } = await import("./config.js");
	const config = await loadConfig();
	const model = modelFromConfig(config);

	const instance = await fetchInstanceConfig(config.searxngUrl, config.timeoutMs);
	const categories = instanceCategories(instance);
	const engines = enabledEngineNames(instance);
	const plan = validatePlan(await planQuery(model, query, categories, engines), categories, engines);

	const merged: SearchOptions = {
		...(plan.categories.length ? { categories: plan.categories } : {}),
		...(plan.engines.length ? { engines: plan.engines } : {}),
		...(plan.language ? { language: plan.language } : {}),
		...(plan.timeRange ? { timeRange: plan.timeRange } : {}),
		...aiOptions.overrides,
	};
	const response = await search(query, merged);
	const summary = await summarizeSession(model, response, query, { maxResults: aiOptions.maxResults });

	return {
		query,
		sessionId: response.sessionId,
		plan,
		summary,
		unresponsiveEngines: response.unresponsiveEngines,
	};
}
