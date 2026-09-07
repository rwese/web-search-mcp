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
