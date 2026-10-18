/**
 * Debug-flag resolution from the environment.
 *
 * Enable via `WZE_WEBSEARCH_DEBUG=1`, or a `DEBUG` namespace entry such as
 * `DEBUG=*` or `DEBUG=wze-websearch`. An explicit option or loaded config value
 * wins over the environment (see `resolveDebug`).
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);

/** `*` (all namespaces) or any `DEBUG` entry mentioning wze-websearch. */
const DEBUG_NAMESPACE_MATCH = /^\*$|wze-websearch/i;

/** Whether a conventional `DEBUG` namespace value selects wze-websearch. */
function debugNamespaceMatches(debug: string | undefined): boolean {
	return DEBUG_NAMESPACE_MATCH.test(debug ?? '');
}

/** The raw env debug flag: true/false when explicitly set, undefined when unset. */
export function resolveEnvDebug(env: Record<string, string | undefined> = process.env): boolean | undefined {
	const raw = env.WZE_WEBSEARCH_DEBUG;
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
