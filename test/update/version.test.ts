import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion, isStableVersion, parseVersion } from "../../src/update/version.js";

describe("release versions", () => {
	it("parses tags with and without v", () => {
		expect(parseVersion("v0.8.1")).toMatchObject({ major: 0, minor: 8, patch: 1 });
		expect(parseVersion("0.8.1")).toMatchObject({ major: 0, minor: 8, patch: 1 });
		expect(parseVersion("v1.2")).toBeUndefined();
	});

	it("accepts only stable versions as update candidates", () => {
		expect(isStableVersion("0.8.0")).toBe(true);
		expect(isStableVersion("0.8.0-rc.1")).toBe(false);
		expect(isStableVersion("v0.8.0")).toBe(true);
	});

	it("orders versions numerically, not lexically", () => {
		expect(compareVersions(parseVersion("0.10.0")!, parseVersion("0.9.9")!)).toBeGreaterThan(0);
		expect(compareVersions(parseVersion("1.0.0")!, parseVersion("1.0.0")!)).toBe(0);
		expect(isNewerVersion("0.8.1", "0.8.0")).toBe(true);
		expect(isNewerVersion("0.8.0", "0.8.0")).toBe(false);
	});
});
