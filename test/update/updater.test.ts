import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../../src/update/checksum.js";
import { UpdateBusy, UpdateError } from "../../src/update/errors.js";
import {
	versionInstallPath,
	writeCurrentVersion,
	writeInstallRecord,
	writePreviousVersion,
	type InstallContext,
} from "../../src/update/install.js";
import type { ReleaseAsset, ReleaseInfo, ReleaseSource } from "../../src/update/release.js";
import { performUpdate, releaseAssetName } from "../../src/update/updater.js";
import { makeTestSigner, type TestSigner } from "./signature.js";

const temps: string[] = [];

afterEach(async () => {
	await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), prefix));
	temps.push(path);
	return path;
}

async function makeBundle(parent: string, version: string): Promise<string> {
	const root = join(parent, "wze-websearch");
	const cliDir = join(root, "dist", "surfaces", "cli");
	await mkdir(cliDir, { recursive: true });
	await writeFile(
		join(cliDir, "cli.js"),
		`if (process.argv.includes("--version")) { process.stdout.write("wze-websearch ${version}\\n"); process.exit(0); }\n`,
	);
	await writeFile(join(root, "package.json"), JSON.stringify({ name: "@rwese/wze-websearch", version }));
	await writeFile(join(root, "README.md"), "fixture\n");
	return root;
}

async function archiveFor(version: string): Promise<Buffer> {
	const parent = await tempDir("wze-bundle-");
	await makeBundle(parent, version);
	const archivePath = join(parent, releaseAssetName(version));
	await createTar({ gzip: true, cwd: parent, file: archivePath, portable: true }, ["wze-websearch"]);
	return readFile(archivePath);
}

type FixtureRelease = {
	source: ReleaseSource;
	assetName: string;
	checksums: string;
	release: ReleaseInfo;
};

async function fixtureRelease(
	version: string,
	signer: TestSigner,
	options: { tamperArchive?: boolean; signer?: TestSigner } = {},
): Promise<FixtureRelease> {
	const assetName = releaseAssetName(version);
	const archive = await archiveFor(version);
	const checksums = `${sha256(archive)}  ${assetName}\n`;
	const signingKey = options.signer ?? signer;
	const signature = signingKey.sign(checksums);
	const assets: ReleaseAsset[] = [
		{ name: assetName, url: `https://example.invalid/${assetName}` },
		{ name: "SHA256SUMS", url: "https://example.invalid/SHA256SUMS" },
		{ name: "SHA256SUMS.sig", url: "https://example.invalid/SHA256SUMS.sig" },
	];
	const payloads = new Map<string, Buffer>([
		[assetName, options.tamperArchive ? Buffer.concat([archive, Buffer.from("x")]) : archive],
		["SHA256SUMS", Buffer.from(checksums)],
		["SHA256SUMS.sig", Buffer.from(signature)],
	]);
	const release: ReleaseInfo = { version, tag: `v${version}`, assets };
	return {
		assetName,
		checksums,
		release,
		source: {
			latest: async () => release,
			download: async (asset) => {
				const payload = payloads.get(asset.name);
				if (!payload) throw new Error(`missing fixture asset ${asset.name}`);
				return payload;
			},
		},
	};
}

async function makeInstall(current: string): Promise<{ root: string; install: InstallContext }> {
	const root = await tempDir("wze-self-");
	writeInstallRecord(root, join(root, "bin"));
	await mkdir(join(root, "versions"), { recursive: true });
	writeCurrentVersion(root, current);
	return {
		root,
		install: {
			kind: "self-owned",
			execPath: join(versionInstallPath(root, current), "dist", "surfaces", "cli", "cli.js"),
			installRoot: root,
			binDir: join(root, "bin"),
			currentVersion: current,
			installPath: versionInstallPath(root, current),
		},
	};
}

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
