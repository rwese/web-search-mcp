import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { version } from "../src/version.js";

describe("version", () => {
	it("mirrors package.json (bins report the published version)", () => {
		const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
			version: string;
		};
		expect(version).toBe(pkg.version);
	});
});
