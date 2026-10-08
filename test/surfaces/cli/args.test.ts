import { describe, expect, it } from "vitest";
import { parseArgs } from "../../../src/surfaces/cli/args.js";

describe("parseArgs", () => {
	it("parses a bare query", () => {
		const parsed = parseArgs(["hello", "world"]);
		expect(parsed.query).toBe("hello world");
		expect(parsed.options).toEqual({});
	});

	it("treats a query that collides with Object.prototype keys as a positional", () => {
		// Regression guard: flag lookup tables must not read inherited keys.
		expect(parseArgs(["constructor"]).query).toBe("constructor");
		expect(parseArgs(["toString", "--json"])).toMatchObject({ query: "toString", json: true });
		expect(parseArgs(["--language", "en", "valueOf"]).query).toBe("valueOf");
	});
});
