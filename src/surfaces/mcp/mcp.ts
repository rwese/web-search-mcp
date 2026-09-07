#!/usr/bin/env node
/**
 * web-search-mcp — MCP server entrypoint for the agent-agnostic web-search package.
 *
 * Locked by wayfinder ticket #9 (MCP server surface):
 *   - `search` is the only tool in the first build-out: query (required),
 *     categories, engines, language, timeRange, safeSearch, pageNo, maxResults
 *     (default 10). Returns lean markdown (session id + top-N results).
 *   - no flag = stdio transport; `--http [port]` / PORT env = streamable HTTP
 *     on /mcp (Express + cors, one McpServer + transport per session).
 *   - backend config via loadConfig() (env + XDG); no CLI flags for the
 *     backend. Implemented against @modelcontextprotocol/sdk 1.30.0
 *     (v1 monolith; server.registerTool, not server.tool()).
 */
import { config as loadDotenv } from "dotenv";
import { DEFAULT_PORT } from "./constants.js";
import { runHttp } from "./http.js";
import { runStdio } from "./stdio.js";

loadDotenv({ path: `${process.cwd()}/.env` });

const httpIndex = process.argv.indexOf("--http");
if (httpIndex >= 0) {
	const portArg = process.argv[httpIndex + 1];
	const port =
		portArg && /^\d+$/.test(portArg) ? Number(portArg) : Number(process.env.PORT) || DEFAULT_PORT;
	runHttp(port);
} else {
	await runStdio();
}
