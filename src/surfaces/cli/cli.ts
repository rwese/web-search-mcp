#!/usr/bin/env node
/**
 * wze-websearch CLI — search entrypoint for the agent-agnostic wze-websearch package.
 *
 * Locked by wayfinder ticket #8 (CLI surface):
 *   - bare `wze-websearch "<query>"` = search; `--session <id>` = retrieve a
 *     persisted session (mutually exclusive with a query).
 *   - flags: --categories/--engines (csv), --language, --time-range
 *     (day|month|year), --safesearch (0|1|2), --page, --json, --help, --version.
 *   - markdown default shows 15 per page; --page pages stored results on
 *     --session (and asks SearXNG for the next page on a live search);
 *     --json emits the full SearchResponse.
 *   - AI is the default for a query when the LLM is configured (model +
 *     API key); --no-ai forces raw results, --use-ai forces the AI answer.
 *   - AI markdown prints the session id plus a `--session <id>` re-read hint
 *     so the raw results stay reviewable; --session stays raw unless --use-ai.
 *   - --doctor validates the setup (config, SearXNG, engines, LLM) and
 *     exits 0 only when every check passes.
 *   - exit 0 = ok (even empty results), 1 = runtime error, 2 = usage.
 */
import { config as loadDotenv } from "dotenv";
import type { Config, SearchResponse, SessionRecord } from "../../index.js";
import { loadConfig, readSession, renderMarkdown, search, SearchError } from "../../index.js";
import type { AiAnswer } from "../../ai/agent.js";
import { answerQuery, isAiConfigured, modelFromConfig, summarizeSession } from "../../ai/agent.js";
import { renderDoctorReport, runDoctor } from "../../diagnostics/doctor.js";
import { parseArgs, USAGE, type ParsedArgs } from "./args.js";
import { createProgressReporter } from "./progress.js";
import { version } from "../../version.js";
import { defaultConfig, xdgConfigPath } from "../../infra/config.js";

loadDotenv({ path: `${process.cwd()}/.env` });

function printUsage(): void {
	process.stdout.write(`${USAGE}\n`);
}

function warnUnresponsive(response: { unresponsiveEngines: [string, string][] }): void {
	for (const [engine, reason] of response.unresponsiveEngines) {
		process.stderr.write(`warning: engine ${engine} unresponsive (${reason})\n`);
	}
}

/** Report a runtime failure as `error: <message>` and return exit code 1. */
function failRuntime(err: unknown): number {
	const message = err instanceof SearchError ? err.message : `unexpected error: ${(err as Error).message}`;
	process.stderr.write(`error: ${message}\n`);
	return 1;
}

function handleHelp(): number {
	printUsage();
	return 0;
}

function handleVersion(): number {
	process.stdout.write(`wze-websearch ${version}\n`);
	return 0;
}

function handleDefaultConfig(): number {
	process.stdout.write(`${JSON.stringify(defaultConfig(), null, 2)}\n`);
	process.stderr.write(`Config file: ${xdgConfigPath()}\n`);
	return 0;
}

async function handleDoctor(parsed: ParsedArgs): Promise<number> {
	const report = await runDoctor({ ...(parsed.debug ? { debug: true } : {}) });
	if (parsed.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		process.stdout.write(`${renderDoctorReport(report)}\n`);
	}
	return report.ok ? 0 : 1;
}

/** `--use-ai` short-circuits; otherwise AI is the default when the LLM is configured. */
async function resolveRunAi(parsed: ParsedArgs): Promise<boolean | "error"> {
	if (parsed.useAi) return true;
	try {
		return isAiConfigured(await loadConfig());
	} catch (err) {
		failRuntime(err);
		return "error";
	}
}

async function renderSessionSummary(
	parsed: ParsedArgs,
	config: Config,
	record: SessionRecord,
): Promise<void> {
	const model = modelFromConfig(config);
	const progress = createProgressReporter({ json: parsed.json });
	const followUpSessions: SearchResponse[] = [];
	const summary = await summarizeSession(model, record, record.query, {
		maxResults: config.maxResults,
		maxAgentSearches: config.maxAgentSearches,
		followUpSessions,
		onProgress: (event) => progress.report(event),
	});
	if (parsed.json) {
		const payload = {
			...record,
			summary,
			...(followUpSessions.length
				? { followUpSessions: followUpSessions.map(({ sessionId, query }) => ({ sessionId, query })) }
				: {}),
		};
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
	} else {
		const extra = followUpSessions
			.map((session) => `\n\n**Session:** ${session.sessionId}\nSearch query: ${JSON.stringify(session.query)}\n\nRaw results: wze-websearch --session ${session.sessionId}`)
			.join("");
		process.stdout.write(
			`**Session:** ${record.sessionId}\n\n${summary}\n\nRaw results: wze-websearch --session ${record.sessionId}${extra}\n`,
		);
	}
}

async function handleSession(parsed: ParsedArgs, sessionId: string): Promise<number> {
	try {
		const config = await loadConfig();
		const record: SessionRecord = await readSession(sessionId, config.storeDir);
		if (parsed.useAi) {
			await renderSessionSummary(parsed, config, record);
		} else {
			const response: SearchResponse = { ...record };
			if (parsed.json) {
				process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
			} else {
				process.stdout.write(
					`${renderMarkdown(response, config.maxResults, parsed.options.pageNo ?? 1)}\n`,
				);
			}
		}
		return 0;
	} catch (err) {
		return failRuntime(err);
	}
}

async function handleAiQuery(parsed: ParsedArgs): Promise<number> {
	try {
		const hasOverrides = Object.keys(parsed.options).length > 0;
		const progress = createProgressReporter({ json: parsed.json });
		const answer: AiAnswer = await answerQuery(parsed.query as string, {
			...(hasOverrides ? { overrides: parsed.options } : {}),
			...(parsed.debug ? { debug: true } : {}),
			onProgress: (event) => progress.report(event),
		});
		warnUnresponsive(answer);
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(answer, null, 2)}\n`);
		} else {
			process.stdout.write(
				`${answer.sessions.map((session) => `**Session:** ${session.sessionId}\nSearch query: ${JSON.stringify(session.query)}`).join("\n\n")}\n\n${answer.summary}\n\n${answer.sessions.map((session) => `Raw results: wze-websearch --session ${session.sessionId}`).join("\n")}\n`,
			);
		}
		return 0;
	} catch (err) {
		return failRuntime(err);
	}
}

async function handleRawSearch(parsed: ParsedArgs): Promise<number> {
	try {
		const query = parsed.query as string;
		const progress = createProgressReporter({ json: parsed.json });
		progress.report({ step: "searching", index: 1, total: 1, query });
		const config = await loadConfig();
		const response = await search(query, {
			...parsed.options,
			...(parsed.debug ? { debug: true } : {}),
		});
		progress.report({
			step: "searched",
			index: 1,
			total: 1,
			query,
			sessionId: response.sessionId,
			resultCount: response.results.length,
		});
		warnUnresponsive(response);
		if (parsed.json) {
			process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
		} else {
			process.stdout.write(`${renderMarkdown(response, config.maxResults)}\n`);
		}
		return 0;
	} catch (err) {
		return failRuntime(err);
	}
}

/**
 * Query path: explicit --use-ai forces the AI answer; otherwise the AI answer
 * is the default when the LLM is configured (model + API key) and --no-ai opts
 * out to raw results. --session stays raw (handled above).
 */
async function handleQuery(parsed: ParsedArgs): Promise<number> {
	if (!parsed.sessionId && !parsed.noAi) {
		const runAi = await resolveRunAi(parsed);
		if (runAi === "error") return 1;
		if (runAi) return handleAiQuery(parsed);
	}
	return handleRawSearch(parsed);
}

async function run(): Promise<number> {
	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`error: ${(err as Error).message}\n\n${USAGE}\n`);
		return 2;
	}

	if (parsed.help) return handleHelp();
	if (parsed.version) return handleVersion();
	if (parsed.defaultConfig) return handleDefaultConfig();
	if (parsed.doctor) return await handleDoctor(parsed);

	const sessionId = parsed.sessionId;
	if (sessionId) return await handleSession(parsed, sessionId);

	return await handleQuery(parsed);
}

const code = await run();
process.exitCode = code;
