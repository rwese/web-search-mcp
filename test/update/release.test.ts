import { describe, expect, it } from "vitest";
import { UpdateError } from "../../src/update/errors.js";
import { ForgejoReleaseSource, downloadBudgetMs } from "../../src/update/release.js";

const ARCHIVE = "wze-websearch_0.8.1_any.tar.gz";
const BASE_URL = "https://example.invalid";

/** A response whose body rejects the way an aborted `arrayBuffer()` does. */
function stalled(signal: AbortSignal | null): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			signal?.addEventListener("abort", () =>
				controller.error(new DOMException("This operation was aborted", "AbortError")),
			);
		},
	});
	return new Response(body, { status: 200 });
}

const stallingFetch: typeof fetch = async (_input, init) => stalled(init?.signal ?? null);

/** A body that fails with an abort immediately, so budget assertions need no waiting. */
const abortingFetch: typeof fetch = async () =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new DOMException("This operation was aborted", "AbortError"));
			},
		}),
		{ status: 200 },
	);

describe("downloadBudgetMs", () => {
	it("uses the floor for small or unknown sizes", () => {
		expect(downloadBudgetMs(undefined, 60000)).toBe(60000);
		expect(downloadBudgetMs(0, 60000)).toBe(60000);
		expect(downloadBudgetMs(512, 60000)).toBe(60000);
	});

	it("extends the budget for the large portable archive", () => {
		const archiveSize = 22_637_692;
		expect(downloadBudgetMs(archiveSize, 60000)).toBeGreaterThan(100_000);
	});

	it("never shrinks an explicit floor", () => {
		expect(downloadBudgetMs(1024, 5_000_000)).toBe(5_000_000);
	});
});

describe("ForgejoReleaseSource", () => {
	it("reports an aborted download as a timeout naming the asset", async () => {
		const source = new ForgejoReleaseSource({
			baseUrl: BASE_URL,
			fetchImpl: stallingFetch,
			downloadTimeoutMs: 20,
		});

		await expect(source.download({ name: ARCHIVE, url: `${BASE_URL}/${ARCHIVE}` })).rejects.toThrow(
			/timed out trying to download wze-websearch_0\.8\.1_any\.tar\.gz after 20ms; retry the update/,
		);
	});

	it("budgets a large asset by size, not by the API timeout", async () => {
		const source = new ForgejoReleaseSource({
			baseUrl: BASE_URL,
			fetchImpl: abortingFetch,
			timeoutMs: 10,
			downloadTimeoutMs: 20,
		});
		const size = 22_637_692;

		const failure = await source
			.download({ name: ARCHIVE, url: `${BASE_URL}/${ARCHIVE}`, size })
			.then(() => undefined, (err: Error) => err);

		expect(failure).toBeInstanceOf(UpdateError);
		expect(failure?.message).toContain(`after ${downloadBudgetMs(size, 20)}ms`);
	});

	it("keeps HTTP failures as domain errors", async () => {
		const source = new ForgejoReleaseSource({
			baseUrl: BASE_URL,
			fetchImpl: async () => new Response("missing", { status: 404 }),
		});

		await expect(source.download({ name: ARCHIVE, url: `${BASE_URL}/${ARCHIVE}` })).rejects.toThrow(
			"failed to download wze-websearch_0.8.1_any.tar.gz: HTTP 404",
		);
	});

	it("reports an unreadable release list as an update error", async () => {
		const source = new ForgejoReleaseSource({
			baseUrl: BASE_URL,
			fetchImpl: async () => new Response("not json", { status: 200 }),
		});

		await expect(source.latest()).rejects.toThrow("release API returned invalid JSON");
	});
});
