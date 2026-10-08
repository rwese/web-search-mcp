/**
 * Shared `fetch` plumbing for the outbound HTTP calls (SearXNG and the doctor's
 * LLM probe): an `AbortController` whose signal aborts after `timeoutMs`, with
 * the timer always cleared once the response handler settles.
 *
 * Callers map the two failure modes to their own domain errors via `mapError`
 * and keep handling their own non-2xx cases, because those map to different
 * error types per caller.
 */
export type FetchFailureKind = "timeout" | "network";

export type FetchWithTimeoutOptions = {
  timeoutMs: number;
  /** Map a thrown `fetch` error (or abort) to the caller's domain error. */
  mapError: (error: Error, kind: FetchFailureKind) => Error;
  /** Extra `fetch` init; the helper supplies the abort signal. */
  init?: Omit<NonNullable<Parameters<typeof fetch>[1]>, "signal">;
};

/**
 * Run `fetch` under a timeout, then hand the response to `onResponse` before
 * the timer is cleared. The helper owns the controller/timer/fetch/finally
 * plumbing; the caller owns error mapping and response handling.
 */
export async function fetchWithTimeout<T>(
  url: URL | string,
  options: FetchWithTimeoutOptions,
  onResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...options.init, signal: controller.signal });
    } catch (err) {
      const error = err as Error;
      throw options.mapError(error, error.name === "AbortError" ? "timeout" : "network");
    }
    return await onResponse(response);
  } finally {
    clearTimeout(timer);
  }
}
