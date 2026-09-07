/**
 * Debug logging for the web-search core.
 *
 * All debug output goes to stderr (never stdout) so stdout stays
 * machine-readable. Enable via `SearchOptions.debug`, `Config.debug`,
 * the `--debug` CLI flag, or `WEB_SEARCH_DEBUG=1` in the environment.
 * Secrets (API keys) are never logged — callers must not pass them in
 * logged `data`.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const MAX_DATA_CHARS = 2000;

export type DebugLogger = {
	enabled: boolean;
	log(section: string, message: string, data?: unknown): void;
};

function parseTruthy(value: string | undefined): boolean {
	if (!value) return false;
	return TRUTHY.has(value.trim().toLowerCase());
}

/** True when the environment requests debug output. */
export function debugEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean {
	return resolveEnvDebug(env) ?? false;
}

/** The raw env debug flag: true/false when explicitly set, undefined when unset. */
export function resolveEnvDebug(env: Record<string, string | undefined> = process.env): boolean | undefined {
	const raw = env.WEB_SEARCH_DEBUG;
	if (raw !== undefined && raw.trim() !== '') {
		return parseTruthy(raw);
	}
	const debug = env.DEBUG || '';
	if (!debug.trim()) return undefined;
	if (debug === '*' || debug.split(',').some((part) => part.trim().toLowerCase().includes('web-search'))) {
		return true;
	}
	return undefined;
}

/**
 * Resolve whether debug is on: explicit option wins, then the loaded
 * config value, then the environment.
 */
export function resolveDebug(opts: { debug?: boolean; configDebug?: boolean } = {}): boolean {
	if (opts.debug !== undefined) return opts.debug;
	if (opts.configDebug !== undefined) return opts.configDebug;
	return debugEnabledFromEnv();
}

function truncate(text: string, maxChars = MAX_DATA_CHARS): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}… (truncated ${text.length - maxChars} chars)`;
}

function formatData(data: unknown): string {
	if (data === undefined) return '';
	try {
		const raw = typeof data === 'string' ? data : JSON.stringify(data);
		return truncate(raw ?? String(data));
	} catch {
		return truncate(String(data));
	}
}

const noopLogger: DebugLogger = {
	enabled: false,
	log: () => {},
};

/** Create a stderr logger; a disabled logger is a no-op. */
export function createDebugLogger(enabled: boolean): DebugLogger {
	if (!enabled) return noopLogger;
	return {
		enabled: true,
		log(section: string, message: string, data?: unknown): void {
			const suffix = data === undefined ? '' : ` ${formatData(data)}`;
			process.stderr.write(`[web-search:debug] [${section}] ${message}${suffix}\n`);
		},
	};
}

/** Normalize a `debug` option (boolean or shared logger) into a logger. */
export function toLogger(debug?: boolean | DebugLogger): DebugLogger {
	if (!debug) return noopLogger;
	if (typeof debug === 'boolean') return createDebugLogger(true);
	return debug;
}
