/** Typed errors raised by the web-search core. */
export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

/** A non-2xx response from SearXNG (e.g. 400 missing query, 403 disabled format). */
export class SearxngError extends SearchError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SearxngError";
    this.status = status;
  }
}

/** The request exceeded the configured timeout. */
export class SearchTimeout extends SearchError {
  constructor(message = "Search timed out") {
    super(message);
    this.name = "SearchTimeout";
  }
}

/** Network failure or 5xx from SearXNG. */
export class SearchUnavailable extends SearchError {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailable";
  }
}

/**
 * The summarizer agent's follow-up `search` budget is spent. Surfaces as
 * HTTP 429 (Too Many Requests) on the MCP/HTTP transports.
 */
export class SearchVolumeExhausted extends SearchError {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "SearchVolumeExhausted";
  }
}
