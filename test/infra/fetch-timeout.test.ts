import { describe, expect, it } from "vitest";
import { fetchWithTimeout, type FetchFailureKind } from "../../src/infra/fetch-timeout.js";

function mapError(error: Error, kind: FetchFailureKind): Error {
	return new Error(`${kind}: ${error.message}`);
}

function abortError(): DOMException {
	return new DOMException("This operation was aborted", "AbortError");
}

/** A response whose body rejects the way an aborted `arrayBuffer()` does. */
function stalled(signal: AbortSignal | null): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			signal?.addEventListener("abort", () => controller.error(abortError()));
		},
	});
	return new Response(body, { status: 200 });
}

function consume(response: Response): Promise<ArrayBuffer> {
	return response.arrayBuffer();
}

describe("fetchWithTimeout", () => {
	it("maps a timeout while connecting", async () => {
		const fetchImpl: typeof fetch = (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(abortError()));
			});

		await expect(
			fetchWithTimeout("https://example.invalid/slow", { timeoutMs: 10, mapError, fetchImpl }, consume),
		).rejects.toThrow(/^timeout: /);
	});

	it("maps an abort during the body read instead of leaking AbortError", async () => {
		const fetchImpl: typeof fetch = async (_input, init) => stalled(init?.signal ?? null);

		await expect(
			fetchWithTimeout("https://example.invalid/asset", { timeoutMs: 10, mapError, fetchImpl }, consume),
		).rejects.toThrow(/^timeout: /);
	});

	it("maps a network failure during the body read", async () => {
		const fetchImpl: typeof fetch = async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.error(new TypeError("terminated"));
					},
				}),
				{ status: 200 },
			);

		await expect(
			fetchWithTimeout("https://example.invalid/asset", { timeoutMs: 1000, mapError, fetchImpl }, consume),
		).rejects.toThrow(/^network: terminated$/);
	});

	it("passes the response handler's own errors through untouched", async () => {
		const domainError = new Error("HTTP 404");
		const fetchImpl: typeof fetch = async () => new Response("nope", { status: 404 });

		await expect(
			fetchWithTimeout(
				"https://example.invalid/asset",
				{ timeoutMs: 1000, mapError, fetchImpl },
				async () => {
					throw domainError;
				},
			),
		).rejects.toBe(domainError);
	});
});
