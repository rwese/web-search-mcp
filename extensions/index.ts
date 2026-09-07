import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { collapsedText, executeSearch, SearchParamsSchema } from "../src/surfaces/pi/tool.js";

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

		renderResult(result: any, { expanded }: { expanded: boolean; isPartial?: boolean }, theme: any) {
			const textContent = result.content.find((c: any) => c.type === "text");
			const text = textContent?.text ?? "";
			if (expanded) return renderExpanded(text, theme);
			return new Text(theme.fg("muted", collapsedText(result.details ?? {})), 0, 0);
		},
	});
}
/* eslint-enable @typescript-eslint/no-explicit-any */
