import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME } from "./constants.js";
import { registerTools } from "./server.js";
import { version } from "../../version.js";

/** Stdio transport: one McpServer, no flags needed. */
export async function runStdio(): Promise<void> {
	const server = new McpServer({ name: SERVER_NAME, version });
	registerTools(server);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
