import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	detectInstall,
	readCurrentVersion,
	versionInstallPath,
	writeCurrentVersion,
	writeInstallRecord,
	wrapperScripts,
} from "../../src/update/install.js";

function tempInstall(): string {
	const root = mkdtempSync(join(tmpdir(), "wze-install-"));
	writeInstallRecord(root, join(root, "bin"));
	mkdirSync(versionInstallPath(root, "0.8.0"), { recursive: true });
	writeCurrentVersion(root, "0.8.0");
	return root;
}

describe("install detection", () => {
	it("recognizes a marked versioned install", () => {
		const root = tempInstall();
		const context = detectInstall({
			installRoot: root,
			env: {},
			platform: "linux",
			container: false,
			execPath: join(versionInstallPath(root, "0.8.0"), "dist", "surfaces", "cli", "cli.js"),
		});
		expect(context.kind).toBe("self-owned");
		expect(context.currentVersion).toBe("0.8.0");
		expect(context.installPath).toBe(versionInstallPath(root, "0.8.0"));
	});

	it("infers the install root from the versioned script path when the env is unset", () => {
		const root = tempInstall();
		const context = detectInstall({
			env: {},
			platform: "linux",
			container: false,
			execPath: join(versionInstallPath(root, "0.8.0"), "dist", "surfaces", "cli", "cli.js"),
		});
		expect(context.kind).toBe("self-owned");
		expect(context.installRoot).toBe(root);
	});

	it("treats an npm node_modules path as manager-owned", () => {
		const context = detectInstall({
			installRoot: join(tmpdir(), "does-not-exist"),
			env: {},
			platform: "linux",
			container: false,
			execPath: "/usr/lib/node_modules/@rwese/wze-websearch/dist/surfaces/cli/cli.js",
		});
		expect(context.kind).toBe("npm");
		expect(context.managerCommand).toContain("npm i -g");
	});

	it("refuses to treat a container as self-owned", () => {
		const root = tempInstall();
		const context = detectInstall({
			installRoot: root,
			env: {},
			platform: "linux",
			container: true,
			execPath: join(versionInstallPath(root, "0.8.0"), "dist", "surfaces", "cli", "cli.js"),
		});
		expect(context.kind).toBe("container");
	});

	it("does not mistake an arbitrary writable path for a self-owned install", () => {
		const root = mkdtempSync(join(tmpdir(), "wze-unmarked-"));
		const context = detectInstall({
			installRoot: root,
			env: {},
			platform: "linux",
			container: false,
			execPath: join(root, "dist", "surfaces", "cli", "cli.js"),
			cwd: root,
		});
		expect(context.kind).toBe("unknown");
	});

	it("reads current and previous versions and writes wrappers that honor them", () => {
		const root = tempInstall();
		expect(readCurrentVersion(root)).toBe("0.8.0");
		const wrappers = wrapperScripts(root);
		expect(wrappers["wze-websearch"]).toContain('version=$(cat "$root/current")');
		expect(wrappers["wze-websearch"]).toContain('export WZE_WEBSEARCH_INSTALL_ROOT="$root"');
		expect(wrappers["wze-websearch-mcp"]).toContain("surfaces/mcp/mcp.js");
		writeFileSync(join(root, "previous"), "0.7.0\n");
		expect(readFileSync(join(root, "previous"), "utf8").trim()).toBe("0.7.0");
	});
});
