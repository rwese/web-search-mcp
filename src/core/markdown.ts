import { DEFAULT_MAX_RESULTS } from "../infra/config.js";
import type { SearchResponse } from "./types.js";

/** Render a SearchResponse as lean, human-readable markdown (stdout-safe).
 *
 * Pages over `response.results` with `pageNo` (1-based, page size =
 * `maxResults`); result numbers stay global across pages. When the results
 * span more than one page a footer is appended — `Showing X of Y page Z, to
 * get further results: web-search --session <id> --page <Z+1>`.
 *
 * Diagnostics such as unresponsive engines are intentionally NOT rendered
 * here: all warnings go to stderr (CLI) and never pollute stdout, which
 * stays machine-readable. The full envelope including `unresponsiveEngines`
 * remains available via `--json` and the persisted session.
 */
export function renderMarkdown(
	response: SearchResponse,
	maxResults = DEFAULT_MAX_RESULTS,
	pageNo = 1,
): string {
	const lines: string[] = [];
	lines.push(`**Session:** ${response.sessionId}`);
	lines.push(`## Search results for "${response.query}" (${response.results.length})`);

	const totalPages = Math.max(1, Math.ceil(response.results.length / maxResults));
	const page = Math.min(Math.max(1, Math.floor(pageNo)), totalPages);
	const start = (page - 1) * maxResults;
	const shown = response.results.slice(start, start + maxResults);
	if (shown.length === 0) {
		lines.push("No results found.");
	} else {
		shown.forEach((result, index) => {
			lines.push(`${start + index + 1}. [${result.title}](${result.url})`);
			if (result.snippet) {
				lines.push(`   ${result.snippet}`);
			}
			const meta: string[] = [];
			if (result.engines.length) {
				meta.push(`Engines: ${result.engines.join(", ")}`);
			}
			if (result.category) {
				meta.push(`Category: ${result.category}`);
			}
			if (result.publishedDate) {
				meta.push(`Published: ${result.publishedDate}`);
			}
			if (meta.length) {
				lines.push(`   *${meta.join(" · ")}*`);
			}
		});
	}

	if (response.suggestions.length) {
		lines.push(`Suggestions: ${response.suggestions.join(", ")}`);
	}

	if (totalPages > 1) {
		const further =
			page < totalPages
				? `, to get further results: web-search --session ${response.sessionId} --page ${page + 1}`
				: "";
		lines.push(`Showing ${shown.length} of ${response.results.length} page ${page}${further}`);
	}

	return lines.join("\n");
}