/**
 * Debug logger for the wze-websearch core.
 *
 * All debug output goes to stderr (never stdout) so stdout stays
 * machine-readable. Secrets (API keys) are never logged — callers must not
 * pass them in logged `data`. Enablement is resolved separately in
 * `debug-env.ts`.
 */

const MAX_DATA_CHARS = 2000;

export type DebugLogger = {
	enabled: boolean;
	log(section: string, message: string, data?: unknown): void;
};

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
			process.stderr.write(`[wze-websearch:debug] [${section}] ${message}${suffix}\n`);
		},
	};
}

/** Normalize a `debug` option (boolean or shared logger) into a logger. */
export function toLogger(debug?: boolean | DebugLogger): DebugLogger {
	if (!debug) return noopLogger;
	if (typeof debug === 'boolean') return createDebugLogger(true);
	return debug;
}
