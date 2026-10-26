import { readFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	backgroundCheckEnabled,
	CHECK_INTERVAL_MS,
	claimCheckWindow,
	runBackgroundCheck,
} from "../../src/update/background.js";
import { checkForUpdate } from "../../src/update/checker.js";
import type { InstallContext } from "../../src/update/install.js";
import { versionInstallPath } from "../../src/update/install.js";
import { cleanupTemps, fixtureRelease, makeInstall } from "./fixture.js";
import { makeTestSigner } from "./signature.js";

afterEach(cleanupTemps);

const npmInstall: InstallContext = {
	kind: "npm",
	execPath: "/tmp/node_modules/wze-websearch/dist/surfaces/cli/cli.js",
	installRoot: "/tmp/install",
	binDir: "/tmp/bin",
	currentVersion: "0.8.0",
};

describe("update checks", () => {
	it("runs without a TTY and is opt-out via the environment", () => {
		expect(backgroundCheckEnabled({})).toBe(true);
		expect(backgroundCheckEnabled({ WZE_WEBSEARCH_NO_UPDATE_CHECK: "1" })).toBe(false);
		expect(backgroundCheckEnabled({ WZE_WEBSEARCH_UPDATE_BACKGROUND: "1" })).toBe(false);
	});

	it("reports a newer self-owned release with the update command", async () => {
		const install: InstallContext = {
			kind: "self-owned",
			execPath: "/tmp/install/versions/0.8.0/dist/surfaces/cli/cli.js",
			installRoot: "/tmp/install",
			binDir: "/tmp/bin",
			currentVersion: "0.8.0",
			installPath: "/tmp/install/versions/0.8.0",
		};
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

	it("tells npm installs to reinstall from a signed release instead of using npm", async () => {
		const check = await checkForUpdate({
			...npmInstall,
			installCommand: "curl -fsSL https://example/install.sh | sh",
		});
		expect(check.updateAvailable).toBe(false);
		expect(check.managed).toBe(true);
		expect(check.message).toContain("npm releases are not published");
		expect(check.command).toContain("install.sh");
	});
});

describe("check throttle", () => {
	it("claims one window per interval, headless included", async () => {
		const { root, install } = await makeInstall("0.8.0");
		const stamp = join(root, "update-check.stamp");

		expect(claimCheckWindow(install)).toBe(true);
		expect(await readFile(stamp, "utf8")).toContain("T");
		expect(claimCheckWindow(install)).toBe(false);

		const stale = Date.now() - CHECK_INTERVAL_MS - 1000;
		await utimes(stamp, new Date(stale), new Date(stale));
		expect(claimCheckWindow(install)).toBe(true);
	});

	it("never marks installs it cannot update", () => {
		expect(claimCheckWindow(npmInstall)).toBe(false);
	});
});

describe("background self-update", () => {
	it("applies a signed release headlessly and reports the transition", async () => {
		const signer = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer);
		const lines: string[] = [];

		const result = await runBackgroundCheck(install, {
			releaseSource: fixture.source,
			trustedKeys: [signer.trustedLine],
			log: (line) => lines.push(line),
		});

		expect(result?.update?.status).toBe("updated");
		expect((await readFile(join(root, "current"), "utf8")).trim()).toBe("0.8.1");
		expect(await readFile(join(versionInstallPath(root, "0.8.1"), "package.json"), "utf8")).toContain(
			"0.8.1",
		);
		expect(lines.join("")).toContain("0.7.0 -> 0.8.1");
	});

	it("stays silent when the install is current", async () => {
		const signer = makeTestSigner();
		const { install } = await makeInstall("0.8.1");
		const fixture = await fixtureRelease("0.8.1", signer);
		const lines: string[] = [];

		const result = await runBackgroundCheck(install, {
			releaseSource: fixture.source,
			trustedKeys: [signer.trustedLine],
			log: (line) => lines.push(line),
		});

		expect(result?.check.updateAvailable).toBe(false);
		expect(result?.update).toBeUndefined();
		expect(lines).toEqual([]);
	});

	it("logs the reason an available update could not be applied", async () => {
		const signer = makeTestSigner();
		const attacker = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer, { signer: attacker });
		const lines: string[] = [];

		const result = await runBackgroundCheck(install, {
			releaseSource: fixture.source,
			trustedKeys: [signer.trustedLine],
			log: (line) => lines.push(line),
		});

		expect(result?.update).toBeUndefined();
		expect((await readFile(join(root, "current"), "utf8")).trim()).toBe("0.7.0");
		expect(lines.join("")).toContain("background update failed");
		expect(lines.join("")).toContain("untrusted key");
		expect(await readFile(join(root, "update.log"), "utf8")).toContain("untrusted key");
	});

	it("keeps a log for headless hosts with no inherited stderr", async () => {
		const signer = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer);

		await runBackgroundCheck(install, {
			releaseSource: fixture.source,
			trustedKeys: [signer.trustedLine],
		});

		expect(await readFile(join(root, "update.log"), "utf8")).toContain("updated 0.7.0 -> 0.8.1");
	});

	it("never touches an install it does not own", async () => {		const check = await runBackgroundCheck(npmInstall, {
			releaseSource: {
				latest: async () => ({ version: "9.9.9", tag: "v9.9.9", assets: [] }),
				download: async () => Buffer.alloc(0),
			},
		});
		expect(check?.update).toBeUndefined();
		expect(check?.check.updateAvailable).toBe(false);
	});
});
