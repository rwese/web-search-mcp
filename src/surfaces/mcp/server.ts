import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderMarkdown, search } from "../../index.js";

export const MAX_RESULTS_DEFAULT = 10;
export const MAX_RESULTS_LIMIT = 50;

/** Register the `search` tool — the only tool in the first build-out. */
export function registerTools(server: McpServer): void {
	server.registerTool(
		"search",
		{
			title: "Web Search",
			description: "Search the web for relevant and recent information.",
			inputSchema: z.object({
				query: z.string().min(1).describe("the search query"),
				categories: z.array(z.string()).optional().describe("result categories, e.g. general, news"),
				engines: z.array(z.string()).optional().describe("specific search engines to use (default: all available engines)"),
				language: z.string().optional().describe("language code, e.g. en, de"),
				timeRange: z
					.enum(["day", "month", "year"])
					.optional()
					.describe("only results from this time range (e.g. day for news from the last 24h)"),
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
					content: [{ type: "text" as const, text: `search failed: ${(err as Error).message}` }],
				};
			}
		},
	);
}
