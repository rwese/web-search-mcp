import type { SafeSearch, SearchOptions, TimeRange } from "../../core/types.js";
import { version } from "../../version.js";

export const USAGE = `wze-websearch ${version} — SearXNG-backed web search

Usage:
  wze-websearch "<query>" [flags]
  wze-websearch --session <id> [--json]
  wze-websearch --doctor [--json]
  wze-websearch --default-config
  wze-websearch --help
  wze-websearch --version

Flags:
  --categories <csv>   restrict to categories (e.g. general,news)
  --engines <csv>      restrict to engines (e.g. wikipedia,google)
  --language <code>    e.g. en, de
  --time-range <x>     day | month | year
  --safesearch <0|1|2> 0 off, 1 moderate, 2 strict
  --page <n>           result page (search: next SearXNG page; --session: page of stored results)
  --session <id>       show a persisted search session instead of searching
  --use-ai             answer via the LangChain agentic loop (plan -> search -> summarize);
                       the default when the LLM is configured (see README)
  --no-ai              list raw results instead of the AI answer (opt out of the default)
  --debug              verbose stderr logging (search requests, AI loop, tool use)
  --doctor             validate setup: config, SearXNG, engines, probe search, LLM
  --default-config     print default config JSON; config file path goes to stderr
  --json               structured output (default: markdown)
  --help               show this help
  --version            print the version and exit

Exit codes: 0 ok (even empty results; for --doctor: all checks passed), 1 runtime error (or --doctor found issues), 2 usage.`;

export type ParsedArgs = {
	help?: boolean;
	version?: boolean;
	query?: string;
	sessionId?: string;
	json?: boolean;
	useAi?: boolean;
	noAi?: boolean;
	debug?: boolean;
	doctor?: boolean;
	defaultConfig?: boolean;
	options: SearchOptions;
};

/** Boolean flags and the `ParsedArgs` field each one sets. */
type BooleanFlag = "help" | "version" | "json" | "useAi" | "noAi" | "debug" | "doctor" | "defaultConfig";

/** Working accumulator; positionals feed the joined query at the end. */
type ArgState = ParsedArgs & { positionals: string[] };

type ValueHandler = (state: ArgState, flag: string, value: string) => void;

const BOOLEAN_FLAGS: Record<string, BooleanFlag | undefined> = {
	"--help": "help",
	"--version": "version",
	"--json": "json",
	"--use-ai": "useAi",
	"--no-ai": "noAi",
	"--debug": "debug",
	"--doctor": "doctor",
	"--default-config": "defaultConfig",
};

const TIME_RANGES = ["day", "month", "year"] as const;

const splitCsv = (value: string): string[] =>
	value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

function fail(message: string): never {
	throw new Error(message);
}

function parseEnum<T extends string>(flag: string, value: string, allowed: readonly T[]): T {
	if ((allowed as readonly string[]).includes(value)) {
		return value as T;
	}
	fail(`flag ${flag} must be one of ${allowed.join(" | ")}, got "${value}"`);
}

function parseTimeRange(flag: string, value: string): TimeRange {
	return parseEnum(flag, value, TIME_RANGES);
}

function parseSafeSearch(flag: string, value: string): SafeSearch {
	const level = Number(value);
	if (level !== 0 && level !== 1 && level !== 2) {
		fail(`flag ${flag} must be one of 0 | 1 | 2, got "${value}"`);
	}
	return level as SafeSearch;
}

function parsePage(flag: string, value: string): number {
	const page = Number(value);
	if (!Number.isInteger(page) || page < 1) {
		fail(`flag ${flag} must be a positive integer, got "${value}"`);
	}
	return page;
}

const VALUE_FLAGS: Record<string, ValueHandler | undefined> = {
	"--categories": (state, _flag, value) => {
		state.options.categories = splitCsv(value);
	},
	"--engines": (state, _flag, value) => {
		state.options.engines = splitCsv(value);
	},
	"--language": (state, _flag, value) => {
		state.options.language = value;
	},
	"--time-range": (state, flag, value) => {
		state.options.timeRange = parseTimeRange(flag, value);
	},
	"--safesearch": (state, flag, value) => {
		state.options.safeSearch = parseSafeSearch(flag, value);
	},
	"--page": (state, flag, value) => {
		state.options.pageNo = parsePage(flag, value);
	},
	"--session": (state, _flag, value) => {
		state.sessionId = value;
	},
};

function hasSearchFlags(args: ParsedArgs): boolean {
	return Object.keys(args.options).length > 0;
}

function rejectDefaultConfigConflicts(args: ParsedArgs): void {
	const conflicts = [
		args.query,
		args.sessionId,
		args.version,
		args.doctor,
		args.json,
		args.debug,
		args.useAi,
		args.noAi,
		hasSearchFlags(args),
	];
	if (args.defaultConfig && conflicts.some(Boolean)) {
		fail("--default-config takes no query or other flags except --help");
	}
}

function rejectVersionConflicts(args: ParsedArgs): void {
	const conflicts = [args.query, args.sessionId, args.doctor, args.useAi, args.noAi, hasSearchFlags(args)];
	if (args.version && conflicts.some(Boolean)) {
		fail("--version takes no query, --session, --doctor, --use-ai, --no-ai, or search flags");
	}
}

function rejectDoctorConflicts(args: ParsedArgs): void {
	const conflicts = [args.query, args.sessionId, args.useAi, args.noAi, hasSearchFlags(args)];
	if (args.doctor && conflicts.some(Boolean)) {
		fail("--doctor takes no query, --session, --use-ai, --no-ai, or search flags");
	}
}

function validateArgs(args: ParsedArgs): void {
	rejectDefaultConfigConflicts(args);
	rejectVersionConflicts(args);
	rejectDoctorConflicts(args);
	if (args.useAi && args.noAi) {
		fail("pass either --use-ai or --no-ai, not both");
	}
	if (args.query && args.sessionId) {
		fail("pass either a query or --session <id>, not both");
	}
	const targets = [args.help, args.version, args.doctor, args.defaultConfig, args.query, args.sessionId];
	if (!targets.some(Boolean)) {
		fail("missing query");
	}
}

export function parseArgs(argv: string[]): ParsedArgs {
	const state: ArgState = { options: {}, positionals: [] };

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const booleanFlag = Object.hasOwn(BOOLEAN_FLAGS, arg) ? BOOLEAN_FLAGS[arg] : undefined;
		if (booleanFlag !== undefined) {
			state[booleanFlag] = true;
			continue;
		}
		const parseValue = Object.hasOwn(VALUE_FLAGS, arg) ? VALUE_FLAGS[arg] : undefined;
		if (parseValue === undefined) {
			if (arg.startsWith("-")) {
				fail(`unknown flag ${arg}`);
			}
			state.positionals.push(arg);
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined) {
			fail(`flag ${arg} needs a value`);
		}
		i += 1;
		parseValue(state, arg, value);
	}

	const { positionals, ...rest } = state;
	const query = positionals.join(" ").trim() || undefined;
	const args: ParsedArgs = { ...rest, query };
	validateArgs(args);
	return args;
}
