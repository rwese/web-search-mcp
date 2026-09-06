#!/usr/bin/env node
/**
 * web-search-mcp — MCP server entrypoint for the agent-agnostic web-search package.
 *
 * Locked by wayfinder ticket #9 (MCP server surface):
 *   - `web_search` is the only tool in the first build-out: query (required),
 *     categories, engines, language, timeRange, safeSearch, pageNo, maxResults
 *     (default 10). Returns lean markdown (session id + top-N results).
 *   - no flag = stdio transport; `--http [port]` / PORT env = streamable HTTP
 *     on /mcp (Express + cors, one McpServer + transport per session).
 *   - backend config via loadConfig() (env + XDG); no CLI flags for the
 *     backend. Implemented against @modelcontextprotocol/sdk 1.30.0
 *     (v1 monolith; server.registerTool, not server.tool()).
 */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { renderMarkdown, search } from "./index.js";
import { version } from "./version.js";

loadDotenv({ path: `${process.cwd()}/.env` });

const SERVER_NAME = "web-search-mcp";
const DEFAULT_PORT = 3000;
const MAX_RESULTS_DEFAULT = 10;
const MAX_RESULTS_LIMIT = 50;

function registerTools(server: McpServer): void {
	server.registerTool(
		"web_search",
		{
			title: "Web Search",
			description:
				"Search the web via SearXNG and return the top results. Returns a lean readable " +
				"summary: session id, then title/url/snippet/engine/category for each result.",
			inputSchema: z.object({
				query: z.string().min(1).describe("the search query"),
				categories: z.array(z.string()).optional().describe("result categories, e.g. general, news"),
				engines: z.array(z.string()).optional().describe("specific search engines to use"),
				language: z.string().optional().describe("language code, e.g. en, de"),
				timeRange: z
					.enum(["day", "month", "year"])
					.optional()
					.describe("only results from this time range"),
				safeSearch: z
					.union([z.literal(0), z.literal(1), z.literal(2)])
					.optional()
					.describe("safesearch level"),
				pageNo: z.number().int().positive().optional().describe("result page number"),
				maxResults: z
					.number()
					.int()
					.positive()
					.max(MAX_RESULTS_LIMIT)
					.optional()
					.describe(`max results in the summary (default ${MAX_RESULTS_DEFAULT})`),
			}),
		},
		async ({ query, maxResults, ...options }) => {
			try {
				const response = await search(query, options);
				return {
					content: [
						{
							type: "text" as const,
							text: renderMarkdown(response, maxResults ?? MAX_RESULTS_DEFAULT),
						},
					],
				};
			} catch (err) {
				return {
					isError: true,
					content: [{ type: "text" as const, text: `web_search failed: ${(err as Error).message}` }],
				};
			}
		},
	);
}

async function runStdio(): Promise<void> {
	const server = new McpServer({ name: SERVER_NAME, version });
	registerTools(server);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

type HttpSession = {
	transport: StreamableHTTPServerTransport;
	server: McpServer;
};

function runHttp(port: number): void {
	const app = express();
	app.use(cors());
	app.use(express.json());

	const sessions = new Map<string, HttpSession>();

	function getSessionId(req: express.Request): string | undefined {
		const header = req.headers["mcp-session-id"];
		const value = Array.isArray(header) ? header[0] : header;
		return value && sessions.has(value) ? value : undefined;
	}

	app.post("/mcp", async (req, res) => {
		const existing = getSessionId(req);
		if (existing) {
			await sessions.get(existing)?.transport.handleRequest(req, res, req.body);
			return;
		}
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (sid) => {
				const server = new McpServer({ name: SERVER_NAME, version });
				registerTools(server);
				sessions.set(sid, { transport, server });
				void server.connect(transport);
			},
		});
		await transport.handleRequest(req, res, req.body);
	});

	app.get("/mcp", async (req, res) => {
		const existing = getSessionId(req);
		if (!existing) {
			res.status(404).end();
			return;
		}
		await sessions.get(existing)?.transport.handleRequest(req, res);
	});

	app.delete("/mcp", (req, res) => {
		const header = req.headers["mcp-session-id"];
		const value = Array.isArray(header) ? header[0] : header;
		if (value) {
			sessions.delete(value);
		}
		res.status(200).end();
	});

	app.listen(port, () => {
		process.stderr.write(`${SERVER_NAME} listening on http://localhost:${port}/mcp\n`);
	});
}

const httpIndex = process.argv.indexOf("--http");
if (httpIndex >= 0) {
	const portArg = process.argv[httpIndex + 1];
	const port =
		portArg && /^\d+$/.test(portArg) ? Number(portArg) : Number(process.env.PORT) || DEFAULT_PORT;
	runHttp(port);
} else {
	await runStdio();
}
