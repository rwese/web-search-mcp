import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatOpenAI } from "@langchain/openai";
import { answerQuery } from "../../src/ai/agent.js";
import type { ProgressEvent } from "../../src/ai/agent.js";
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
	DEFAULT_MAX_RESULTS: 15,
	DEFAULT_MAX_AGENT_SEARCHES: 10,
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

const plan = {
	queries: ["Alpha deployment", "Beta deployment"],
	categories: ["general"],
	engines: ["wikipedia"],
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
		suggestions: [],
		answers: [],
		corrections: [],
		infoboxes: [],
		unresponsiveEngines: [],
	};
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
	mocks.agentInvoke.mockResolvedValue({
		messages: [{ getType: () => "ai", content: summary }],
	});
	mocks.createAgent.mockReturnValue({ invoke: mocks.agentInvoke });
	mocks.tool.mockImplementation((invoke, options) => ({ ...options, invoke }));
	mocks.modelCallLimitMiddleware.mockReturnValue({ name: "mock-limit" });
	const sessions = plan.queries.map((query, i) => session(i === 0 ? "alpha" : "beta", query));
	mocks.search.mockImplementation(async (query: string) => sessions[plan.queries.indexOf(query)]);
});

describe("answerQuery progress events", () => {
	it("emits planning, plan-decided, and per-search events in order", async () => {
		const events: ProgressEvent[] = [];
		await answerQuery("Compare Alpha and Beta", {
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(events.slice(0, 5)).toEqual([
			{ step: "planning" },
			{ step: "plan-decided", queries: ["Alpha deployment", "Beta deployment"] },
			{ step: "searching", index: 1, total: 2, query: "Alpha deployment" },
			{
				step: "searched",
				index: 1,
				total: 2,
				query: "Alpha deployment",
				sessionId: "session-alpha",
				resultCount: 3,
			},
			{ step: "searching", index: 2, total: 2, query: "Beta deployment" },
		]);
		expect(events.slice(-3)).toEqual([
			{
				step: "searched",
				index: 2,
				total: 2,
				query: "Beta deployment",
				sessionId: "session-beta",
				resultCount: 3,
			},
			{ step: "synthesizing" },
			{ step: "done", sessionCount: 2, resultCount: 6 },
		]);
	});

	it("emits synthesizing and done around stored-session summarization", async () => {
		const { summarizeSession } = await import("../../src/ai/agent.js");
		mocks.agentInvoke.mockResolvedValue({
			messages: [{ getType: () => "ai", content: "Alpha deploys well.[^1]\n\n## Sources\n[^1]: [Alpha title 1](https://example.test/alpha/1)" }],
		});
		const model = new ChatOpenAI();
		const events: ProgressEvent[] = [];
		await summarizeSession(model, session("alpha", "Alpha deployment"), "Alpha deployment", {
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(events).toEqual([{ step: "synthesizing" }, { step: "done", sessionCount: 1, resultCount: 3 }]);
	});
});
