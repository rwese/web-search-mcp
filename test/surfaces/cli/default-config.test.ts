import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, xdgConfigPath } from "../../../src/infra/config.js";
import { parseArgs } from "../../../src/surfaces/cli/args.js";

vi.mock("dotenv", () => ({ config: vi.fn() }));

let root: string | undefined;
const originalExitCode = process.exitCode;
const originalArgv = process.argv;

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	process.argv = originalArgv;
	process.exitCode = originalExitCode;
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("--default-config", () => {
	it.each([false, true])("prints reusable defaults independent of existing configuration (env overrides: %s)", async (overrides) => {
		root = await mkdtemp(join(tmpdir(), "wze-websearch-default-config-"));
		vi.stubEnv("XDG_CONFIG_HOME", root);
		vi.stubEnv("XDG_DATA_HOME", join(root, "data"));
		for (const key of ["SEARXNG_URL", "SEARXNG_TIMEOUT_MS", "WZE_WEBSEARCH_DEBUG", "DEBUG", "WZE_WEBSEARCH_MAX_RESULTS", "WZE_WEBSEARCH_MAX_AGENT_SEARCHES", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"]) {
			vi.stubEnv(key, "");
		}
		if (overrides) {
			vi.stubEnv("SEARXNG_URL", "https://private.example.com");
			vi.stubEnv("OPENAI_API_KEY", "private-key");
			vi.stubEnv("WZE_WEBSEARCH_MAX_RESULTS", "42");
		}
		await mkdir(join(root, "wze-websearch"));
		// Generating defaults must work even if the current config cannot be parsed.
		await writeFile(xdgConfigPath(), "invalid JSON");
		process.argv = ["node", "wze-websearch", "--default-config"];
		const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		vi.resetModules();
		await import("../../../src/surfaces/cli/cli.js");

		const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
		const config = JSON.parse(output);
		expect(process.exitCode).toBe(0);
		expect(config).toEqual({
			searxngUrl: "",
			timeoutMs: 10000,
			storeDir: join(root, "data", "wze-websearch", "sessions"),
			debug: false,
			maxResults: 15,
			maxAgentSearches: 10,
			openai: { baseUrl: "", model: "", apiKey: "" },
		});
		expect(stderr.mock.calls).toEqual([[`Config file: ${xdgConfigPath()}\n`]]);
		expect(stdout.mock.invocationCallOrder[0]).toBeLessThan(stderr.mock.invocationCallOrder[0]);

		vi.stubEnv("SEARXNG_URL", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("WZE_WEBSEARCH_MAX_RESULTS", "");
		config.searxngUrl = "https://search.example.com";
		await writeFile(xdgConfigPath(), JSON.stringify(config));
		expect(await loadConfig()).toEqual(config);
	});

	it("uses the home config directory when XDG_CONFIG_HOME is unset", () => {
		vi.stubEnv("XDG_CONFIG_HOME", "");
		expect(xdgConfigPath()).toBe(join(homedir(), ".config", "wze-websearch", "config.json"));
	});

	it.each([
		["query"], ["--session", "id"], ["--doctor"], ["--version"],
		["--use-ai"], ["--no-ai"], ["--json"], ["--debug"], ["--page", "2"],
	])("rejects conflicting arguments: %s", (...args) => {
		expect(() => parseArgs(["--default-config", ...args])).toThrow("--default-config takes no query or other flags except --help");
	});
});
