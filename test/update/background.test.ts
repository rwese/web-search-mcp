import { describe, expect, it } from "vitest";
import { backgroundCheckEnabled } from "../../src/update/background.js";
import { checkForUpdate } from "../../src/update/checker.js";
import type { InstallContext } from "../../src/update/install.js";

const install: InstallContext = {
	kind: "self-owned",
	execPath: "/tmp/install/versions/0.8.0/dist/surfaces/cli/cli.js",
	installRoot: "/tmp/install",
	binDir: "/tmp/bin",
	currentVersion: "0.8.0",
	installPath: "/tmp/install/versions/0.8.0",
};

describe("update checks", () => {
	it("is TTY-only, cache-free, and opt-out", () => {
		expect(backgroundCheckEnabled({}, true)).toBe(true);
		expect(backgroundCheckEnabled({}, false)).toBe(false);
		expect(backgroundCheckEnabled({ WZE_WEBSEARCH_NO_UPDATE_CHECK: "1" }, true)).toBe(false);
		expect(backgroundCheckEnabled({ WZE_WEBSEARCH_UPDATE_BACKGROUND: "1" }, true)).toBe(false);
	});

	it("reports a newer self-owned release with the update command", async () => {
		const check = await checkForUpdate(install, {
			releaseSource: {
				latest: async () => ({ version: "0.9.0", tag: "v0.9.0", assets: [] }),
				download: async () => Buffer.alloc(0),
			},
		});
		expect(check.updateAvailable).toBe(true);
		expect(check.command).toBe("wze-websearch update");
		expect(check.message).toContain("0.9.0");
	});

	it("reports an npm-managed install with the package manager command, not a swap", async () => {
		const check = await checkForUpdate(
			{ ...install, kind: "npm", managerCommand: "npm i -g @rwese/wze-websearch" },
			{ npmSource: { latest: async () => "0.9.0" } },
		);
		expect(check.updateAvailable).toBe(true);
		expect(check.managed).toBe(true);
		expect(check.command).toBe("npm i -g @rwese/wze-websearch");
	});
});
