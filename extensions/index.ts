import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
	executeSearch,
	renderSearchResult,
	SearchParamsSchema,
	type RenderableSearchResult,
	type RenderTheme,
} from "../src/surfaces/pi/tool.js";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "search",
		label: "Web Search",
		description:
			"Search the web via SearXNG. Returns relevant results with summaries, saved to a search session.",
		promptSnippet: "Search the web, find information online, or look up something on the internet",
		parameters: SearchParamsSchema,

		renderCall(args, theme, _context) {
			const text = new Text("", 0, 0);
			text.setText(
				theme.fg("toolTitle", theme.bold("search ")) +
					theme.fg("muted", `"${args.query}"`),
			);
			return text;
		},

		async execute(_toolCallId, params, _signal, onUpdate, _ctx: ExtensionContext) {
			onUpdate?.({ content: [{ type: "text", text: "Searching the web..." }], details: {} });
			return await executeSearch(params);
		},

		renderResult(
			result: RenderableSearchResult,
			{ expanded }: { expanded: boolean; isPartial?: boolean },
			theme: RenderTheme,
		) {
			return renderSearchResult(result, { expanded }, theme);
		},
	});
}
