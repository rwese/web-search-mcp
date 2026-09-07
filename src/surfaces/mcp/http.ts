import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { SERVER_NAME } from "./constants.js";
import { registerTools } from "./server.js";
import { version } from "../../version.js";

type HttpSession = {
	transport: StreamableHTTPServerTransport;
	server: McpServer;
};

/** Streamable HTTP transport on /mcp (Express + cors, one server per session). */
export function runHttp(port: number): void {
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
