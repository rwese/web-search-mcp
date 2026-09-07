import { Type, type Static } from "@sinclair/typebox";
import { renderMarkdown, search } from "../../index.js";

export const SearchParamsSchema = Type.Object({
	query: Type.String({ description: "Web search query" }),
	categories: Type.Optional(
		Type.Array(Type.String(), { description: "Search categories (e.g. general, images)" }),
	),
	engines: Type.Optional(
		Type.Array(Type.String(), { description: "Search engines to use (e.g. brave, wikipedia)" }),
	),
	language: Type.Optional(Type.String({ description: "Search language (e.g. en)" })),
	timeRange: Type.Optional(
		Type.Union([Type.Literal("day"), Type.Literal("month"), Type.Literal("year")], {
			description: "Restrict results to a time range",
		}),
	),
	safeSearch: Type.Optional(
		Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)], {
			description: "Safe search level: 0 off, 1 moderate, 2 strict",
		}),
	),
	pageNo: Type.Optional(Type.Integer({ description: "Result page number (1-based)" })),
	maxResults: Type.Optional(
		Type.Integer({ description: "Maximum number of results to show (default 10)" }),
	),
});

export type SearchParams = Static<typeof SearchParamsSchema>;

export type SearchToolResult = {
	content: [{ type: "text"; text: string }];
	details: {
		query: string;
		resultCount: number;
		sessionId: string;
	};
};

export type SearchToolError = {
	content: [{ type: "text"; text: string }];
	details: { error: string };
};

/** Run a search and format the tool result (shared by the pi wrapper; testable without pi). */
export async function executeSearch(params: SearchParams): Promise<SearchToolResult | SearchToolError> {
	try {
		const response = await search(params.query, {
			categories: params.categories,
			engines: params.engines,
			language: params.language,
			timeRange: params.timeRange,
			safeSearch: params.safeSearch,
			pageNo: params.pageNo,
		});
		return {
			content: [{ type: "text", text: renderMarkdown(response, params.maxResults) }],
			details: {
				query: params.query,
				resultCount: response.results.length,
				sessionId: response.sessionId,
			},
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: "text", text: `Search failed: ${message}` }],
			details: { error: message },
		};
	}
}

/** Collapsed one-liner shown when the tool result is not expanded. */
export function collapsedText(details: { resultCount?: number; query?: string; sessionId?: string }): string {
	const count = details.resultCount ?? 0;
	const query = details.query ?? "";
	const sessionId = details.sessionId ?? "";
	return (
		`→ Found ${count} result${count !== 1 ? "s" : ""} for "${query}"` +
		(sessionId ? ` (session ${sessionId})` : "")
	);
}
