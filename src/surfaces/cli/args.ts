import type { SearchOptions } from "../../core/types.js";

export const USAGE = `web-search — SearXNG-backed web search

Usage:
  web-search "<query>" [flags]
  web-search --session <id> [--json]
  web-search --doctor [--json]
  web-search --help

Flags:
  --categories <csv>   restrict to categories (e.g. general,news)
  --engines <csv>      restrict to engines (e.g. wikipedia,google)
  --language <code>    e.g. en, de
  --time-range <x>     day | month | year
  --safesearch <0|1|2> 0 off, 1 moderate, 2 strict
  --page <n>           result page number
  --session <id>       show a persisted search session instead of searching
  --use-ai             answer via the LangChain agentic loop (plan -> search -> summarize)
  --debug              verbose stderr logging (search requests, AI loop, tool use)
  --doctor             validate setup: config, SearXNG, engines, probe search, LLM
  --json               structured output (default: markdown)
  --help               show this help

Exit codes: 0 ok (even empty results; for --doctor: all checks passed), 1 runtime error (or --doctor found issues), 2 usage.`;

export type ParsedArgs = {
	help?: boolean;
	query?: string;
	sessionId?: string;
	json?: boolean;
	useAi?: boolean;
	debug?: boolean;
	doctor?: boolean;
	options: SearchOptions;
};

const FLAG_KEYS: Record<string, keyof SearchOptions | "json" | "session" | "useAi" | "debug" | "doctor"> = {
	"--categories": "categories",
	"--engines": "engines",
	"--language": "language",
	"--time-range": "timeRange",
	"--safesearch": "safeSearch",
	"--page": "pageNo",
	"--json": "json",
	"--session": "session",
	"--use-ai": "useAi",
	"--debug": "debug",
	"--doctor": "doctor",
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

export function parseArgs(argv: string[]): ParsedArgs {
	const options: SearchOptions = {};
	const positionals: string[] = [];
	let help = false;
	let json = false;
	let useAi = false;
	let debug = false;
	let doctor = false;
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
		if (arg === "--use-ai") {
			useAi = true;
			continue;
		}
		if (arg === "--debug") {
			debug = true;
			continue;
		}
		if (arg === "--doctor") {
			doctor = true;
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
	if (doctor && (query || sessionId || useAi || Object.keys(options).length > 0)) {
		fail("--doctor takes no query, --session, --use-ai, or search flags");
	}
	if (query && sessionId) {
		fail("pass either a query or --session <id>, not both");
	}
	if (!help && !doctor && !query && !sessionId) {
		fail("missing query");
	}

	return { help, query, sessionId, json, useAi, debug, doctor, options };
}
