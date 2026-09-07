#!/usr/bin/env node
/**
 * web-search CLI — search entrypoint for the agent-agnostic web-search package.
 *
 * Locked by wayfinder ticket #8 (CLI surface):
 *   - bare `web-search "<query>"` = search; `--session <id>` = retrieve a
 *     persisted session (mutually exclusive with a query).
 *   - flags: --categories/--engines (csv), --language, --time-range
 *     (day|month|year), --safesearch (0|1|2), --page, --json, --help.
 *   - markdown default shows top 10; --json emits the full SearchResponse.
 *   - --doctor validates the setup (config, SearXNG, engines, LLM) and
 *     exits 0 only when every check passes.
 *   - exit 0 = ok (even empty results), 1 = runtime error, 2 = usage.
 */
import { config as loadDotenv } from "dotenv";
import type { SearchResponse, SessionRecord } from "../../index.js";
import { loadConfig, readSession, renderMarkdown, search, SearchError } from "../../index.js";
import type { AiAnswer } from "../../ai/agent.js";
import { answerQuery, modelFromConfig, summarizeSession } from "../../ai/agent.js";
import { renderDoctorReport, runDoctor } from "../../diagnostics/doctor.js";
import { parseArgs, USAGE, type ParsedArgs } from "./args.js";

loadDotenv({ path: `${process.cwd()}/.env` });

const MARKDOWN_DISPLAY_CAP = 10;

function printUsage(): void {
	process.stdout.write(`${USAGE}\n`);
}

function warnUnresponsive(response: { unresponsiveEngines: [string, string][] }): void {
	for (const [engine, reason] of response.unresponsiveEngines) {
		process.stderr.write(`warning: engine ${engine} unresponsive (${reason})\n`);
	}
}

async function run(): Promise<number> {
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`error: ${(err as Error).message}\n\n${USAGE}\n`);
		return 2;
	}

	if (parsed.help) {
		printUsage();
		return 0;
	}

	if (parsed.doctor) {
		const report = await runDoctor({ ...(parsed.debug ? { debug: true } : {}) });
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		} else {
			process.stdout.write(`${renderDoctorReport(report)}\n`);
		}
		return report.ok ? 0 : 1;
	}

	if (parsed.sessionId) {
		try {
			const config = await loadConfig();
			const record: SessionRecord = await readSession(parsed.sessionId, config.storeDir);
			if (parsed.useAi) {
				const model = modelFromConfig(config);
				const summary = await summarizeSession(model, record, record.query);
				if (parsed.json) {
					const payload = { ...record, summary };
					process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
				} else {
					process.stdout.write(`${summary}\n`);
				}
				return 0;
			}
			const response: SearchResponse = { ...record };
			if (parsed.json) {
				process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
			} else {
				process.stdout.write(`${renderMarkdown(response, MARKDOWN_DISPLAY_CAP)}\n`);
			}
			return 0;
		} catch (err) {
			const message =
				err instanceof SearchError ? err.message : `unexpected error: ${(err as Error).message}`;
			process.stderr.write(`error: ${message}\n`);
			return 1;
		}
	}

	if (parsed.useAi) {
		try {
			const hasOverrides = Object.keys(parsed.options).length > 0;
			const answer: AiAnswer = await answerQuery(parsed.query as string, {
				...(hasOverrides ? { overrides: parsed.options } : {}),
				...(parsed.debug ? { debug: true } : {}),
			});
			for (const [engine, reason] of answer.unresponsiveEngines) {
				process.stderr.write(`warning: engine ${engine} unresponsive (${reason})\n`);
			}
			if (parsed.json) {
				process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
			} else {
				process.stdout.write(`**Session:** ${answer.sessionId}\n\n${answer.summary}\n`);
			}
			return 0;
		} catch (err) {
			const message =
				err instanceof SearchError ? err.message : `unexpected error: ${(err as Error).message}`;
			process.stderr.write(`error: ${message}\n`);
			return 1;
		}
	}

	try {
		const response = await search(parsed.query as string, {
			...parsed.options,
			...(parsed.debug ? { debug: true } : {}),
		});
		warnUnresponsive(response);
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
		} else {
			process.stdout.write(`${renderMarkdown(response, MARKDOWN_DISPLAY_CAP)}\n`);
		}
		return 0;
	} catch (err) {
		const message = err instanceof SearchError ? err.message : `unexpected error: ${(err as Error).message}`;
		process.stderr.write(`error: ${message}\n`);
		return 1;
	}
}

const code = await run();
process.exitCode = code;
