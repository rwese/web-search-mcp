import { describe, expect, it } from "vitest";
import { createDebugLogger, type DebugLogger } from "../../src/infra/debug-logger.js";
import { debugEnabledFromEnv, resolveDebug, resolveEnvDebug } from "../../src/infra/debug-env.js";
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
	it("enables on WZE_WEBSEARCH_DEBUG=1", () => {
		expect(resolveEnvDebug({ WZE_WEBSEARCH_DEBUG: "1" })).toBe(true);
		expect(debugEnabledFromEnv({ WZE_WEBSEARCH_DEBUG: "1" })).toBe(true);
	});

	it("disables on WZE_WEBSEARCH_DEBUG=0", () => {
		expect(resolveEnvDebug({ WZE_WEBSEARCH_DEBUG: "0" })).toBe(false);
	});

	it("enables on DEBUG=*", () => {
		expect(debugEnabledFromEnv({ DEBUG: "*" })).toBe(true);
	});

	it("enables on a DEBUG list containing wze-websearch", () => {
		expect(debugEnabledFromEnv({ DEBUG: "foo,wze-websearch" })).toBe(true);
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
		expect(writes.join("")).toContain("[wze-websearch:debug] [searxng] GET x");
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
