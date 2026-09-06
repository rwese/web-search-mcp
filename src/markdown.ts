import type { SearchResponse } from "./types.js";

/** Render a SearchResponse as lean, human-readable markdown. */
export function renderMarkdown(response: SearchResponse, maxResults = 10): string {
  const lines: string[] = [];
  lines.push(`**Session:** ${response.sessionId}`);
  lines.push(`## Search results for "${response.query}" (${response.results.length})`);

  const shown = response.results.slice(0, maxResults);
  if (shown.length === 0) {
    lines.push("No results found.");
  } else {
    shown.forEach((result, index) => {
      lines.push(`${index + 1}. [${result.title}](${result.url})`);
      if (result.snippet) {
        lines.push(`   ${result.snippet}`);
      }
      const meta = [result.engines.join(", "), result.category, result.publishedDate].filter(Boolean);
      if (meta.length) {
        lines.push(`   *${meta.join(" · ")}*`);
      }
    });
  }

  if (response.suggestions.length) {
    lines.push(`Suggestions: ${response.suggestions.join(", ")}`);
  }
  if (response.unresponsiveEngines.length) {
    const detail = response.unresponsiveEngines
      .map(([engine, reason]) => `${engine} (${reason})`)
      .join(", ");
    lines.push(`Unresponsive engines: ${detail}`);
  }

  return lines.join("\n");
}