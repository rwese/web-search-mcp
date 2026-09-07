import { describe, expect, it } from "vitest";
import {
	createDebugLogger,
	debugEnabledFromEnv,
	resolveDebug,
	resolveEnvDebug,
	type DebugLogger,
} from "../../src/infra/debug.js";
import { countToolCalls } from "../../src/ai/agent.js";

describe("resolveDebug", () => {
	it("option wins over config and env", () => {
		expect(resolveDebug({ debug: true, configDebug: false })).toBe(true);
		expect(resolveDebug({ debug: false, configDebug: true })).toBe(false);
	});

	it("falls back to config when no option is given", () => {
		expect(resolveDebug({ configDebug: true })).toBe(true);
		expect(resolveDebug({ configDebug: false })).toBe(false);
	});

	it("falls back to the environment when neither is set", () => {
		expect(resolveDebug({})).toBe(false);
	});
});

describe("resolveEnvDebug / debugEnabledFromEnv", () => {
	it("enables on WEB_SEARCH_DEBUG=1", () => {
		expect(resolveEnvDebug({ WEB_SEARCH_DEBUG: "1" })).toBe(true);
		expect(debugEnabledFromEnv({ WEB_SEARCH_DEBUG: "1" })).toBe(true);
	});

	it("disables on WEB_SEARCH_DEBUG=0", () => {
		expect(resolveEnvDebug({ WEB_SEARCH_DEBUG: "0" })).toBe(false);
	});

	it("enables on DEBUG=*", () => {
		expect(debugEnabledFromEnv({ DEBUG: "*" })).toBe(true);
	});

	it("enables on a DEBUG list containing web-search", () => {
		expect(debugEnabledFromEnv({ DEBUG: "foo,web-search" })).toBe(true);
	});

	it("leaves an empty env undefined", () => {
		expect(resolveEnvDebug({})).toBeUndefined();
	});
});

describe("createDebugLogger", () => {
	it("is a no-op when disabled", () => {
		const logger = createDebugLogger(false);
		expect(logger.enabled).toBe(false);
		expect(() => logger.log("x", "y")).not.toThrow();
	});

	it("writes a prefixed line to stderr when enabled", () => {
		const writes: string[] = [];
		const original = process.stderr.write;
		process.stderr.write = (chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		};
		try {
			const logger = createDebugLogger(true);
			logger.log("searxng", "GET x", { query: "hi" });
		} finally {
			process.stderr.write = original;
		}
		expect(writes.join("")).toContain("[web-search:debug] [searxng] GET x");
		expect(writes.join("")).toContain('"query":"hi"');
	});

	it("truncates very large data payloads", () => {
		const writes: string[] = [];
		const original = process.stderr.write;
		process.stderr.write = (chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		};
		try {
			createDebugLogger(true).log("x", "big", "a".repeat(5000));
		} finally {
			process.stderr.write = original;
		}
		expect(writes.join("").length).toBeLessThan(3000);
		expect(writes.join("")).toContain("truncated");
	});
});

describe("countToolCalls", () => {
	it("counts tool_calls across messages", () => {
		const messages = [
			{ getType: () => "ai", content: "", tool_calls: [{ id: "1" }, { id: "2" }] },
			{ getType: () => "tool", content: "" },
			{ getType: () => "ai", content: "" },
		] as unknown as Parameters<typeof countToolCalls>[0];
		expect(countToolCalls(messages)).toBe(2);
	});

	it("returns 0 when there are no tool calls", () => {
		const messages = [{ getType: () => "ai", content: "" }] as unknown as Parameters<
			typeof countToolCalls
		>[0];
		expect(countToolCalls(messages)).toBe(0);
	});
});
