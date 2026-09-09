/**
 * Agentic answer loop (LangChain).
 *
 * Flow for `--use-ai`: decompose the query, search each planned query via
 * the core, aggregate session overviews, then synthesize a cited answer.
 *
 * Surfaces import this module directly (`./agent.js`); it is not re-exported
 * from the package index to avoid an index <-> agent import cycle (agent
 * consumes `search()` from the core).
 */
import { createAgent, modelCallLimitMiddleware, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { randomUUID } from "node:crypto";
import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import { z } from "zod";
import type { Config } from "../infra/config.js";
import { openaiApiKey } from "../infra/config.js";
import { createDebugLogger, resolveDebug, toLogger, type DebugLogger } from "../infra/debug.js";
import {
	footnoteFixMessage,
	plannerPrompt,
	SUMMARIZER_SYSTEM_PROMPT,
	summarizerUserMessage,
} from "./prompts.js";
import { search } from "../core/search.js";
import { enabledEngineNames, fetchInstanceConfig, instanceCategories } from "../infra/searxng.js";
import type { SearchOptions, SearchResult } from "../core/types.js";
import { SearchError } from "../core/errors.js";

/** Minimal session shape the summarizer needs (SearchResponse and SessionRecord both fit). */
export type SessionLike = {
	sessionId: string;
	query: string;
	results: SearchResult[];
	suggestions: string[];
};

/** Query decomposition and shared filters. Empty filter lists = no restriction. */
export const SearchPlanSchema = z.object({
	queries: z.array(z.string().trim().min(1)).min(1).max(5)
		.refine((queries) => new Set(queries.map((query) => query.toLowerCase())).size === queries.length,
			"search queries must be unique"),
	categories: z.array(z.string()).default([]),
	engines: z.array(z.string()).default([]),
	language: z.string().optional(),
	timeRange: z.enum(["day", "month", "year"]).optional(),
});

export type SearchPlan = z.infer<typeof SearchPlanSchema>;

const DEFAULT_OVERVIEW_CAP = 10;
const DEFAULT_MODEL_CALL_LIMIT = 10;
const RECURSION_LIMIT_OFFSET = 10;
const RECURSION_LIMIT_MULTIPLIER = 4;

/**
 * Resolve the LangChain graph recursion cap for the summarizer agent.
 *
 * Precedence: explicit `recursionLimit` opt > `WEB_SEARCH_RECURSION_LIMIT`
 * env (positive integer) > `maxModelCalls * 4 + 10`. The multiplier keeps
 * the recursion cap comfortably above the model-call cap so the
 * `modelCallLimitMiddleware` thread limit fires first.
 */
export function resolveRecursionLimit(
	maxModelCalls: number,
	opts: { recursionLimit?: number; env?: Record<string, string | undefined> } = {},
): number {
	if (opts.recursionLimit !== undefined) return opts.recursionLimit;
	const raw = (opts.env ?? process.env).WEB_SEARCH_RECURSION_LIMIT;
	if (raw !== undefined && raw.trim() !== "") {
		const parsed = Number(raw);
		if (Number.isInteger(parsed) && parsed > 0) return parsed;
	}
	return maxModelCalls * RECURSION_LIMIT_MULTIPLIER + RECURSION_LIMIT_OFFSET;
}

/** Build a ChatOpenAI against the configured OpenAI-compatible endpoint.
 *
 * Stamps every LLM request with an `x-opencode-session` header so the proxy
 * (LiteLLM auto-detects `x-*-session-id`) groups one answer-loop run's calls.
 * The id is generated fresh per model (`randomUUID`) unless an explicit
 * `opts.sessionId` is passed — no external env var needed.
 */
export function modelFromConfig(config: Config, opts: { sessionId?: string } = {}): ChatOpenAI {
	const modelName = config.openai?.model;
	const apiKey = openaiApiKey(config);
	if (!modelName) {
		throw new SearchError(
			"No model configured. Set OPENAI_MODEL in the environment or openai.model in the XDG config file.",
		);
	}
	if (!apiKey) {
		throw new SearchError(
			"OPENAI_API_KEY is not set. Set it in the environment or openai.apiKey in the XDG config file.",
		);
	}
	const baseURL = config.openai?.baseUrl;
	const sessionId = opts.sessionId ?? randomUUID();
	return new ChatOpenAI({
		model: modelName,
		apiKey,
		configuration: {
			...(baseURL ? { baseURL } : {}),
			defaultHeaders: { "x-opencode-session": sessionId },
		},
	});
}

/** True when the LLM pieces `modelFromConfig` needs (model + API key) are present. */
export function isAiConfigured(config: Config): boolean {
	return Boolean(config.openai?.model && openaiApiKey(config));
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
 * Ask the model to decompose the query and pick categories/engines from the
 * instance's real lists (video intent -> video engines, encyclopedic ->
 * wikipedia, etc.). Returns the raw plan; call validatePlan() to enforce it.
 */
export async function planQuery(
	model: PlannerModel,
	query: string,
	categories: string[],
	engines: string[],
	opts: { debug?: boolean | DebugLogger } = {},
): Promise<SearchPlan> {
	const debug = toLogger(opts.debug);
	debug.log('agent', `plan "${query}"`, { categories: categories.length, engines: engines.length });
	const prompt = plannerPrompt({ query, categories, engines });
	const raw = await model.invoke(prompt);
	const text = contentToText(raw.content);
	const parsed = SearchPlanSchema.safeParse(extractJson(text));
	if (!parsed.success) {
		debug.log('agent', 'planner returned an invalid plan', { text });
		throw new SearchError(`Planner returned an invalid plan: ${parsed.error.message}`);
	}
	debug.log('agent', 'plan decided', { plan: parsed.data });
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
export function buildSessionOverview(session: SessionLike, maxResults = DEFAULT_OVERVIEW_CAP, resultOffset = 0): string {
	const lines = [
		`## Search session: ${session.sessionId}`,
		`### Search query: ${JSON.stringify(session.query)}`,
		`### Results (${session.results.length} total)`,
	];
	session.results.slice(0, maxResults).forEach((result, index) => {
		const n = resultOffset + index + 1;
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

/** Count tool calls across an agent run's messages (for debug output). */
export function countToolCalls(messages: readonly BaseMessage[]): number {
	return messages.reduce((total, message) => {
		const calls = (message as BaseMessage & { tool_calls?: unknown }).tool_calls;
		return total + (Array.isArray(calls) ? calls.length : 0);
	}, 0);
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
	if (markers.length === 0 && resultCount === 0) return errors;
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

/**
 * Synthesize persisted sessions for the original query via a tool-calling
 * agent. Overviews are grouped by session/query; global result numbers also
 * address full per-result records through read_session_entry.
 */
export async function summarizeSession(
	model: ChatOpenAI,
	session: SessionLike | SessionLike[],
	originalQuery: string,
	opts: {
		maxResults?: number;
		maxModelCalls?: number;
		recursionLimit?: number;
		debug?: boolean | DebugLogger;
	} = {},
): Promise<string> {
	const maxResults = opts.maxResults ?? DEFAULT_OVERVIEW_CAP;
	const maxModelCalls = opts.maxModelCalls ?? DEFAULT_MODEL_CALL_LIMIT;
	const debug = toLogger(opts.debug);
	const sessions = Array.isArray(session) ? session : [session];
	const results = sessions.flatMap((entry) => entry.results);
	let resultOffset = 0;
	const overview = sessions.map((entry) => {
		const text = buildSessionOverview(entry, maxResults, resultOffset);
		resultOffset += entry.results.length;
		return text;
	}).join("\n\n");
	debug.log('agent', `summarize "${originalQuery}"`, {
		sessionIds: sessions.map((entry) => entry.sessionId),
		results: results.length,
		maxResults,
		maxModelCalls,
	});

	const readEntry = tool(
		({ resultNumber }: { resultNumber: number }) => {
			debug.log('agent', `tool read_session_entry(${resultNumber})`);
			const result = results[resultNumber - 1];
			if (!result) {
				return `No result #${resultNumber}: the sessions have ${results.length} result(s).`;
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

	const userContent = summarizerUserMessage({ originalQuery, overview });

	const invokeOpts = { recursionLimit: resolveRecursionLimit(maxModelCalls, { recursionLimit: opts.recursionLimit }) };
	debug.log('agent', 'summarizer agent.invoke start', { recursionLimit: invokeOpts.recursionLimit });
	const first = await agent.invoke({ messages: [{ role: "user", content: userContent }] }, invokeOpts);
	const text = lastAiText(first.messages);
	debug.log('agent', 'summarizer agent.invoke done', {
		messages: first.messages.length,
		toolCalls: countToolCalls(first.messages),
		chars: text.length,
	});
	const errors = validateFootnotes(text, results.length);
	if (errors.length === 0) return text;
	debug.log('agent', 'footnote validation failed, retrying once', { errors });

	// One retry as a single direct call (no tool loop), so the agent cannot
	// spin on tool calls and hit the graph recursion cap while fixing format.
	const fix = await model.invoke(
		footnoteFixMessage({ originalQuery, overview, errors, draft: text }),
	);
	const fixed = contentToText(fix.content);
	debug.log('agent', 'footnote fix call done', { chars: fixed.length });
	const remaining = validateFootnotes(fixed, results.length);
	if (remaining.length > 0) {
		throw new SearchError(`AI summary failed footnote validation: ${remaining.join("; ")}`);
	}
	return fixed;
}

export type AiAnswerOptions = {
	/** Explicit search flags from the CLI; these win over the AI plan. */
	overrides?: SearchOptions;
	/** Number of top results included inline per search session (default 10). */
	maxResults?: number;
	/** Verbose stderr logging for the plan -> search -> summarize loop. */
	debug?: boolean | DebugLogger;
};

export type AiAnswer = {
	query: string;
	/** First search session, retained for existing JSON consumers. */
	sessionId: string;
	sessions: { sessionId: string; query: string }[];
	plan: SearchPlan;
	summary: string;
	unresponsiveEngines: [string, string][];
};

/**
 * Full --use-ai flow: decompose -> search each query -> aggregate -> synthesize.
 * Plan picks steer categories/engines/language/timeRange; explicit CLI
 * overrides always win over the plan.
 */
export async function answerQuery(query: string, aiOptions: AiAnswerOptions = {}): Promise<AiAnswer> {
	if (!query.trim()) {
		throw new SearchError("query must not be empty");
	}
  const { loadConfig } = await import("../infra/config.js");
	const config = await loadConfig();
	const debugOpt = aiOptions.debug;
	const debug: DebugLogger =
		typeof debugOpt === 'object'
			? debugOpt
			: createDebugLogger(resolveDebug({ debug: debugOpt, configDebug: config.debug }));
	const model = modelFromConfig(config);
	debug.log('agent', `answerQuery "${query}"`, { model: config.openai?.model });

	const instance = await fetchInstanceConfig(config.searxngUrl, config.timeoutMs, { debug });
	const categories = instanceCategories(instance);
	const engines = enabledEngineNames(instance);
	const plan = validatePlan(
		await planQuery(model, query, categories, engines, { debug }),
		categories,
		engines,
	);

	const merged: SearchOptions = {
		...(plan.categories.length ? { categories: plan.categories } : {}),
		...(plan.engines.length ? { engines: plan.engines } : {}),
		...(plan.language ? { language: plan.language } : {}),
		...(plan.timeRange ? { timeRange: plan.timeRange } : {}),
		...aiOptions.overrides,
		debug,
	};
	const responses = [];
	for (const searchQuery of plan.queries) {
		responses.push(await search(searchQuery, merged));
	}
	const summary = await summarizeSession(model, responses, query, {
		maxResults: aiOptions.maxResults,
		debug,
	});

	return {
		query,
		sessionId: responses[0].sessionId,
		sessions: responses.map((response) => ({ sessionId: response.sessionId, query: response.query })),
		plan,
		summary,
		unresponsiveEngines: responses.flatMap((response) => response.unresponsiveEngines)
			.filter(([engine, reason], index, all) =>
				all.findIndex(([otherEngine, otherReason]) => engine === otherEngine && reason === otherReason) === index),
	};
}
