/**
 * Debug-flag resolution from the environment.
 *
 * Enable via `WEB_SEARCH_DEBUG=1`, or a `DEBUG` namespace entry such as
 * `DEBUG=*` or `DEBUG=web-search`. An explicit option or loaded config value
 * wins over the environment (see `resolveDebug`).
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);

/** `*` (all namespaces) or any `DEBUG` entry mentioning web-search. */
const DEBUG_NAMESPACE_MATCH = /^\*$|web-search/i;

/** Whether a conventional `DEBUG` namespace value selects web-search. */
function debugNamespaceMatches(debug: string | undefined): boolean {
	return DEBUG_NAMESPACE_MATCH.test(debug ?? '');
}

/** The raw env debug flag: true/false when explicitly set, undefined when unset. */
export function resolveEnvDebug(env: Record<string, string | undefined> = process.env): boolean | undefined {
	const raw = env.WEB_SEARCH_DEBUG;
	if (raw !== undefined && raw.trim() !== '') {
		return TRUTHY.has(raw.trim().toLowerCase());
	}
	if (debugNamespaceMatches(env.DEBUG)) return true;
	return undefined;
}

/** True when the environment requests debug output. */
export function debugEnabledFromEnv(env: Record<string, string | undefined> = process.env): boolean {
	return resolveEnvDebug(env) ?? false;
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
