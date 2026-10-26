import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateBusy, UpdateError } from "../../src/update/errors.js";
import { versionInstallPath, writePreviousVersion } from "../../src/update/install.js";
import { performUpdate } from "../../src/update/updater.js";
import {
	cleanupTemps,
	fixtureRelease,
	makeBundle,
	makeInstall,
	tempDir,
} from "./fixture.js";
import { makeTestSigner } from "./signature.js";

afterEach(cleanupTemps);

describe("performUpdate", () => {
	it("verifies and installs a signed release, recording the previous version", async () => {
		const signer = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer);
		const result = await performUpdate({
			install,
			releaseSource: fixture.source,
			trustedKeys: [signer.trustedLine],
		});
		expect(result).toMatchObject({ status: "updated", from: "0.7.0", to: "0.8.1" });
		expect((await readFile(join(root, "current"), "utf8")).trim()).toBe("0.8.1");
		expect((await readFile(join(root, "previous"), "utf8")).trim()).toBe("0.7.0");
		expect(await readFile(join(versionInstallPath(root, "0.8.1"), "package.json"), "utf8")).toContain(
			"0.8.1",
		);
	});

	it("leaves the install untouched when the signature is from an untrusted key", async () => {
		const signer = makeTestSigner();
		const attacker = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer, { signer: attacker });
		await expect(
			performUpdate({ install, releaseSource: fixture.source, trustedKeys: [signer.trustedLine] }),
		).rejects.toThrow(/untrusted key/);
		expect((await readFile(join(root, "current"), "utf8")).trim()).toBe("0.7.0");
		await expect(readFile(join(versionInstallPath(root, "0.8.1"), "package.json"))).rejects.toThrow();
	});

	it("leaves the install untouched when the archive checksum is wrong", async () => {
		const signer = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer, { tamperArchive: true });
		await expect(
			performUpdate({ install, releaseSource: fixture.source, trustedKeys: [signer.trustedLine] }),
		).rejects.toThrow(/checksum mismatch/);
		expect((await readFile(join(root, "current"), "utf8")).trim()).toBe("0.7.0");
	});

	it("reports current instead of reinstalling the same version", async () => {
		const signer = makeTestSigner();
		const { install } = await makeInstall("0.8.1");
		const fixture = await fixtureRelease("0.8.1", signer);
		const result = await performUpdate({
			install,
			releaseSource: fixture.source,
			trustedKeys: [signer.trustedLine],
		});
		expect(result.status).toBe("current");
	});

	it("refuses a downgrade unless explicitly allowed", async () => {
		const signer = makeTestSigner();
		const { install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.6.0", signer);
		await expect(
			performUpdate({ install, releaseSource: fixture.source, trustedKeys: [signer.trustedLine] }),
		).rejects.toThrow(UpdateError);
	});

	it("rejects a concurrent update while the lock exists", async () => {
		const signer = makeTestSigner();
		const { root, install } = await makeInstall("0.7.0");
		const fixture = await fixtureRelease("0.8.1", signer);
		await writeFile(join(root, "update.lock"), "123\n");
		await expect(
			performUpdate({ install, releaseSource: fixture.source, trustedKeys: [signer.trustedLine] }),
		).rejects.toBeInstanceOf(UpdateBusy);
	});

	it("rolls back to the recorded previous version", async () => {
		const { root, install } = await makeInstall("0.8.1");
		const built = await makeBundle(await tempDir("wze-prev-"), "0.7.0");
		await rename(built, versionInstallPath(root, "0.7.0"));
		writePreviousVersion(root, "0.7.0");
		const result = await performUpdate({ install, rollback: true });
		expect(result).toMatchObject({ status: "rolled-back", from: "0.8.1", to: "0.7.0" });
		expect((await readFile(join(root, "current"), "utf8")).trim()).toBe("0.7.0");
		expect((await readFile(join(root, "previous"), "utf8")).trim()).toBe("0.8.1");
	});
});
