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
 *   - exit 0 = ok (even empty results), 1 = runtime error, 2 = usage.
 */
import { config as loadDotenv } from "dotenv";
import type { SearchOptions, SearchResponse, SessionRecord } from "./index.js";
import { loadConfig, readSession, renderMarkdown, search, SearchError } from "./index.js";

loadDotenv({ path: `${process.cwd()}/.env` });

const MARKDOWN_DISPLAY_CAP = 10;

const USAGE = `web-search — SearXNG-backed web search

Usage:
  web-search "<query>" [flags]
  web-search --session <id> [--json]
  web-search --help

Flags:
  --categories <csv>   restrict to categories (e.g. general,news)
  --engines <csv>      restrict to engines (e.g. wikipedia,google)
  --language <code>    e.g. en, de
  --time-range <x>     day | month | year
  --safesearch <0|1|2> 0 off, 1 moderate, 2 strict
  --page <n>           result page number
  --session <id>       show a persisted search session instead of searching
  --json               structured output (default: markdown)
  --help               show this help

Exit codes: 0 ok (even empty results), 1 runtime error, 2 usage.`;

type ParsedArgs = {
	help?: boolean;
	query?: string;
	sessionId?: string;
	json?: boolean;
	options: SearchOptions;
};

const FLAG_KEYS: Record<string, keyof SearchOptions | "json" | "session"> = {
	"--categories": "categories",
	"--engines": "engines",
	"--language": "language",
	"--time-range": "timeRange",
	"--safesearch": "safeSearch",
	"--page": "pageNo",
	"--json": "json",
	"--session": "session",
};

function fail(message: string): never {
	throw new Error(message);
}

function parseEnum<T extends string>(flag: string, value: string, allowed: readonly T[]): T {
	if ((allowed as readonly string[]).includes(value)) {
		return value as T;
	}
	fail(`flag ${flag} must be one of ${allowed.join(" | ")}, got "${value}"`);
}

function parseArgs(argv: string[]): ParsedArgs {
	const options: SearchOptions = {};
	const positionals: string[] = [];
	let help = false;
	let json = false;
	let sessionId: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--help") {
			help = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		const key = FLAG_KEYS[arg];
		if (!key) {
			if (arg.startsWith("-")) {
				fail(`unknown flag ${arg}`);
			}
			positionals.push(arg);
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined) {
			fail(`flag ${arg} needs a value`);
		}
		i += 1;
		switch (key) {
			case "categories":
			case "engines":
				options[key] = value
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean);
				break;
			case "language":
				options.language = value;
				break;
			case "timeRange":
				options.timeRange = parseEnum(arg, value, ["day", "month", "year"] as const);
				break;
			case "safeSearch": {
				const level = Number(value);
				if (level !== 0 && level !== 1 && level !== 2) {
					fail(`flag ${arg} must be one of 0 | 1 | 2, got "${value}"`);
				}
				options.safeSearch = level;
				break;
			}
			case "pageNo": {
				const page = Number(value);
				if (!Number.isInteger(page) || page < 1) {
					fail(`flag ${arg} must be a positive integer, got "${value}"`);
				}
				options.pageNo = page;
				break;
			}
			case "session":
				sessionId = value;
				break;
			default:
				fail(`unknown flag ${arg}`);
		}
	}

	const query = positionals.join(" ").trim() || undefined;
	if (query && sessionId) {
		fail("pass either a query or --session <id>, not both");
	}
	if (!help && !query && !sessionId) {
		fail("missing query");
	}

	return { help, query, sessionId, json, options };
}

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

	if (parsed.sessionId) {
		try {
			const config = await loadConfig();
			const record: SessionRecord = await readSession(parsed.sessionId, config.storeDir);
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

	try {
		const response = await search(parsed.query as string, parsed.options);
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
