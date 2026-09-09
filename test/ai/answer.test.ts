import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatOpenAI } from "@langchain/openai";
import { answerQuery, summarizeSession } from "../../src/ai/agent.js";
import type { SearchResponse } from "../../src/core/types.js";

const mocks = vi.hoisted(() => ({
	loadConfig: vi.fn(),
	openaiApiKey: vi.fn(),
	fetchInstanceConfig: vi.fn(),
	instanceCategories: vi.fn(),
	enabledEngineNames: vi.fn(),
	search: vi.fn(),
	modelInvoke: vi.fn(),
	agentInvoke: vi.fn(),
	createAgent: vi.fn(),
	tool: vi.fn(),
	modelCallLimitMiddleware: vi.fn(),
}));

vi.mock("../../src/infra/config.js", () => ({
	loadConfig: mocks.loadConfig,
	openaiApiKey: mocks.openaiApiKey,
}));
vi.mock("../../src/infra/searxng.js", () => ({
	fetchInstanceConfig: mocks.fetchInstanceConfig,
	instanceCategories: mocks.instanceCategories,
	enabledEngineNames: mocks.enabledEngineNames,
}));
vi.mock("../../src/core/search.js", () => ({ search: mocks.search }));
vi.mock("@langchain/openai", () => ({
	ChatOpenAI: class {
		invoke = mocks.modelInvoke;
	},
}));
vi.mock("langchain", () => ({
	createAgent: mocks.createAgent,
	tool: mocks.tool,
	modelCallLimitMiddleware: mocks.modelCallLimitMiddleware,
}));

const originalQuery = "Compare Alpha and Beta deployment tradeoffs";
const plan = {
	queries: ["Alpha deployment", "Beta deployment"],
	categories: ["general"],
	engines: ["wikipedia"],
	language: "en",
	timeRange: "year",
};
const summary = "Alpha and Beta differ.[^1][^4]\n\n## Sources\n[^1]: [Alpha](https://example.test/alpha/1)\n[^4]: [Beta](https://example.test/beta/1)";

function session(name: string, query: string): SearchResponse {
	return {
		sessionId: `session-${name}`,
		query,
		results: [1, 2, 3].map((n) => ({
			title: `${name} title ${n}`,
			url: `https://example.test/${name}/${n}`,
			snippet: `${name} snippet ${n}`,
			publishedDate: null,
			score: n,
			engines: ["wikipedia"],
			category: "general",
		})),
		suggestions: [`${name} suggestion`],
		answers: [],
		corrections: [],
		infoboxes: [],
		unresponsiveEngines: [],
	};
}

function agentReply(content: string) {
	return { messages: [{ getType: () => "ai", content }] };
}

function expectOverview(prompt: string, sessions: SearchResponse[]) {
	expect(prompt).toContain(`Original query: "${originalQuery}"`);
	for (const [index, entry] of sessions.entries()) {
		expect(prompt).toContain(`## Search session: ${entry.sessionId}\n### Search query: ${JSON.stringify(entry.query)}\n### Results (3 total)`);
		for (let n = 0; n < 2; n += 1) {
			expect(prompt).toContain(`${index * 3 + n + 1}. ${entry.results[n].title}\n   ${entry.results[n].url}\n   ${entry.results[n].snippet}`);
		}
		expect(prompt).not.toContain(entry.results[2].title);
		expect(prompt).not.toContain(entry.results[2].url);
		expect(prompt).not.toContain(entry.results[2].snippet);
		expect(prompt).toContain(`Suggestions: ${entry.suggestions[0]}`);
	}
	expect(prompt.match(/\.\.\. 1 more result\(s\) in the session\./g)).toHaveLength(2);
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.loadConfig.mockResolvedValue({
		searxngUrl: "https://search.example.test",
		timeoutMs: 1234,
		openai: { model: "mock-model" },
		debug: false,
	});
	mocks.openaiApiKey.mockReturnValue("mock-key");
	mocks.fetchInstanceConfig.mockResolvedValue({ engines: [] });
	mocks.instanceCategories.mockReturnValue(["general", "news"]);
	mocks.enabledEngineNames.mockReturnValue(["wikipedia", "bing"]);
	mocks.modelInvoke.mockResolvedValue({ content: JSON.stringify(plan) });
	mocks.agentInvoke.mockResolvedValue(agentReply(summary));
	mocks.createAgent.mockReturnValue({ invoke: mocks.agentInvoke });
	mocks.tool.mockImplementation((invoke, options) => ({ ...options, invoke }));
	mocks.modelCallLimitMiddleware.mockReturnValue({ name: "mock-limit" });
});

describe("answerQuery integration with mocked I/O", () => {
	it("searches every planned query with overrides before synthesis and returns sessions and deduplicated warnings", async () => {
		const sessions = plan.queries.map((query, i) => session(i === 0 ? "alpha" : "beta", query));
		sessions[0].unresponsiveEngines = [["bing", "timeout"], ["google", "blocked"]];
		sessions[1].unresponsiveEngines = [["bing", "timeout"], ["bing", "blocked"]];
		const events: string[] = [];
		mocks.search.mockImplementation(async (query: string) => {
			events.push(`start:${query}`);
			await Promise.resolve();
			events.push(`complete:${query}`);
			return sessions[plan.queries.indexOf(query)];
		});
		mocks.agentInvoke.mockImplementation(async () => {
			expect(events).toEqual(plan.queries.flatMap((query) => [`start:${query}`, `complete:${query}`]));
			events.push("synthesize");
			return agentReply(summary);
		});
		const overrides = {
			categories: ["news"], engines: ["bing"], language: "de",
			timeRange: "day" as const, safeSearch: 2 as const, pageNo: 3,
			baseUrl: "https://override.example.test", timeoutMs: 9876,
		};
		const answer = await answerQuery(originalQuery, { overrides, maxResults: 2, debug: false });

		expect(mocks.search).toHaveBeenCalledTimes(2);
		for (const [index, query] of plan.queries.entries()) {
			expect(mocks.search).toHaveBeenNthCalledWith(index + 1, query, {
				...overrides, debug: expect.objectContaining({ log: expect.any(Function) }),
			});
		}
		expect(events.at(-1)).toBe("synthesize");
		expect(mocks.fetchInstanceConfig).toHaveBeenCalledWith("https://search.example.test", 1234, { debug: expect.any(Object) });
		expectOverview(mocks.agentInvoke.mock.calls[0][0].messages[0].content, sessions);
		expect(mocks.agentInvoke).toHaveBeenCalledTimes(1);
		expect(mocks.modelInvoke).toHaveBeenCalledTimes(1);
		expect(answer).toEqual({
			query: originalQuery, sessionId: "session-alpha",
			sessions: sessions.map(({ sessionId, query }) => ({ sessionId, query })),
			plan, summary,
			unresponsiveEngines: [["bing", "timeout"], ["google", "blocked"], ["bing", "blocked"]],
		});
	});

	it.each([
		{}, { queries: [] }, { queries: [" "] }, { queries: ["Alpha", " alpha "] },
		{ queries: ["a", "b", "c", "d", "e", "f"] }, { queries: [42] },
	])("rejects an invalid plan without searching: %j", async (invalidPlan) => {
		mocks.modelInvoke.mockResolvedValue({ content: JSON.stringify(invalidPlan) });
		await expect(answerQuery(originalQuery, { debug: false })).rejects.toThrow("invalid plan");
		expect(mocks.search).not.toHaveBeenCalled();
		expect(mocks.createAgent).not.toHaveBeenCalled();
		expect(mocks.agentInvoke).not.toHaveBeenCalled();
	});

	it("propagates a later search failure without synthesizing partial sessions", async () => {
		const failure = new Error("search unavailable");
		mocks.search.mockResolvedValueOnce(session("alpha", plan.queries[0])).mockRejectedValueOnce(failure);
		await expect(answerQuery(originalQuery, { debug: false })).rejects.toBe(failure);
		expect(mocks.search).toHaveBeenCalledTimes(2);
		expect(mocks.createAgent).not.toHaveBeenCalled();
		expect(mocks.agentInvoke).not.toHaveBeenCalled();
		expect(mocks.modelInvoke).toHaveBeenCalledTimes(1);
	});
});

describe("summarizeSession integration with mocked LangChain", () => {
	it("exposes full records by global number, including entries outside each overview cap", async () => {
		const sessions = [session("alpha", plan.queries[0]), session("beta", plan.queries[1])];
		mocks.agentInvoke.mockImplementation(async () => {
			const { tools } = mocks.createAgent.mock.calls[0][0];
			expect(tools).toHaveLength(1);
			expect(tools[0].name).toBe("read_session_entry");
			for (const resultNumber of [3, 4, 6]) {
				expect(JSON.parse(await tools[0].invoke({ resultNumber }))).toEqual({
					rank: resultNumber, ...sessions.flatMap((entry) => entry.results)[resultNumber - 1],
				});
			}
			expect(await tools[0].invoke({ resultNumber: 7 })).toBe("No result #7: the sessions have 6 result(s).");
			return agentReply(summary);
		});
		await expect(summarizeSession(new ChatOpenAI(), sessions, originalQuery, { maxResults: 2 })).resolves.toBe(summary);
		expectOverview(mocks.agentInvoke.mock.calls[0][0].messages[0].content, sessions);
		expect(mocks.modelInvoke).not.toHaveBeenCalled();
	});

	it("repairs citations in one direct call with the original query and all session overviews", async () => {
		const sessions = [session("alpha", plan.queries[0]), session("beta", plan.queries[1])];
		mocks.agentInvoke.mockResolvedValue(agentReply("An uncited draft."));
		mocks.modelInvoke.mockResolvedValue({ content: summary });
		await expect(summarizeSession(new ChatOpenAI(), sessions, originalQuery, { maxResults: 2 })).resolves.toBe(summary);
		expect(mocks.modelInvoke).toHaveBeenCalledTimes(1);
		const retry = mocks.modelInvoke.mock.calls[0][0];
		expectOverview(retry, sessions);
		expect(retry).toContain("summary cites no results");
		expect(retry).toContain("Draft:\nAn uncited draft.");
		expect(mocks.createAgent).toHaveBeenCalledTimes(1);
		expect(mocks.agentInvoke).toHaveBeenCalledTimes(1);
	});

	it("returns a deterministic abstention for zero results without invoking the agent", async () => {
		const empty = { ...session("empty", originalQuery), results: [] };
		const text = await summarizeSession(new ChatOpenAI(), empty, originalQuery);
		expect(text).toContain(originalQuery);
		expect(text.toLowerCase()).toContain("enough information");
		expect(mocks.createAgent).not.toHaveBeenCalled();
		expect(mocks.agentInvoke).not.toHaveBeenCalled();
		expect(mocks.modelInvoke).not.toHaveBeenCalled();
	});

	it("returns the same abstention for multiple empty sessions without invoking the agent", async () => {
		const empties = [session("a", "first query"), session("b", "second query")].map((entry) => ({
			...entry,
			results: [],
		}));
		const text = await summarizeSession(new ChatOpenAI(), empties, originalQuery);
		expect(text).toContain(originalQuery);
		expect(text.toLowerCase()).toContain("enough information");
		expect(mocks.createAgent).not.toHaveBeenCalled();
		expect(mocks.agentInvoke).not.toHaveBeenCalled();
		expect(mocks.modelInvoke).not.toHaveBeenCalled();
	});

	it("throws without a repair call when the model-call limit terminates synthesis (nonzero results)", async () => {
		const sessions = [session("alpha", plan.queries[0]), session("beta", plan.queries[1])];
		mocks.agentInvoke.mockResolvedValue(
			agentReply("Model call limits exceeded: thread level call limit reached with 10 model calls."),
		);
		await expect(summarizeSession(new ChatOpenAI(), sessions, originalQuery)).rejects.toThrow(
			"model-call limit",
		);
		expect(mocks.agentInvoke).toHaveBeenCalledTimes(1);
		expect(mocks.modelInvoke).not.toHaveBeenCalled();
	});

	it("never lets a limit-termination reply surface with zero results (abstention short-circuits before the agent)", async () => {
		const empty = { ...session("empty", originalQuery), results: [] };
		mocks.agentInvoke.mockResolvedValue(
			agentReply("Model call limits exceeded: thread level call limit reached with 10 model calls."),
		);
		const text = await summarizeSession(new ChatOpenAI(), empty, originalQuery);
		expect(text.toLowerCase()).toContain("enough information");
		expect(text).not.toContain("Model call limits exceeded");
		expect(mocks.agentInvoke).not.toHaveBeenCalled();
		expect(mocks.modelInvoke).not.toHaveBeenCalled();
	});
});
