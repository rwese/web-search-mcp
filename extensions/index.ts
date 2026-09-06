import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { search, renderMarkdown } from "../src/index.js";

const SearchParamsSchema = Type.Object({
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderExpanded(text: string, theme: any): Text {
    const output = text
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");
    return new Text(`\n${output}`, 0, 0);
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            "Search the web via SearXNG. Returns relevant results with summaries, saved to a search session.",
        promptSnippet: "Search the web, find information online, or look up something on the internet",
        parameters: SearchParamsSchema,

        renderCall(args, theme, _context) {
            const text = new Text("", 0, 0);
            text.setText(
                theme.fg("toolTitle", theme.bold("web_search ")) +
                    theme.fg("muted", `"${args.query}"`),
            );
            return text;
        },

        async execute(_toolCallId, params, _signal, onUpdate, _ctx: ExtensionContext) {
            onUpdate?.({ content: [{ type: "text", text: "Searching the web..." }], details: {} });

            try {
                const response = await search(params.query, {
                    categories: params.categories,
                    engines: params.engines,
                    language: params.language,
                    timeRange: params.timeRange,
                    safeSearch: params.safeSearch,
                    pageNo: params.pageNo,
                });
                const text = renderMarkdown(response, params.maxResults);
                return {
                    content: [{ type: "text", text }],
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
        },

        renderResult(result: any, { expanded }: { expanded: boolean; isPartial?: boolean }, theme: any) {
            const textContent = result.content.find((c: any) => c.type === "text");
            const text = textContent?.text ?? "";
            const resultCount = result.details?.resultCount ?? 0;
            const query = result.details?.query ?? "";
            const sessionId = result.details?.sessionId ?? "";

            return expanded
                ? renderExpanded(text, theme)
                : new Text(
                      theme.fg(
                          "muted",
                          `→ Found ${resultCount} result${resultCount !== 1 ? "s" : ""} for "${query}"` +
                              (sessionId ? ` (session ${sessionId})` : ""),
                      ),
                      0,
                      0,
                  );
        },
    });
}
/* eslint-enable @typescript-eslint/no-explicit-any */