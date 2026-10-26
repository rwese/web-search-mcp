/**
 * Shared updater fixtures: a self-owned install in a temp root and a signed
 * in-memory release whose archive is a real tar containing a runnable
 * `--version` probe. No network and no external signer are involved.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar } from "tar";
import { sha256 } from "../../src/update/checksum.js";
import {
	versionInstallPath,
	writeCurrentVersion,
	writeInstallRecord,
	type InstallContext,
} from "../../src/update/install.js";
import type { ReleaseAsset, ReleaseInfo, ReleaseSource } from "../../src/update/release.js";
import { releaseAssetName } from "../../src/update/updater.js";
import type { TestSigner } from "./signature.js";

const temps: string[] = [];

export async function cleanupTemps(): Promise<void> {
	await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

export async function tempDir(prefix: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), prefix));
	temps.push(path);
	return path;
}

export async function makeBundle(parent: string, version: string): Promise<string> {
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

export type FixtureRelease = {
	source: ReleaseSource;
	assetName: string;
	checksums: string;
	release: ReleaseInfo;
};

export async function fixtureRelease(
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

/** A self-owned install root with the marker, `current`, and a version dir. */
export async function makeInstall(
	current: string,
): Promise<{ root: string; install: InstallContext }> {
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
