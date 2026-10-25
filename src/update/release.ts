/**
 * Release sources: signed Forgejo releases for self-owned installs, and the
 * npm registry for package-manager installs.
 *
 * Forgejo drives the binary path. npm is only a read-only version source:
 * the updater never writes files owned by npm.
 */
import { fetchWithTimeout } from "../infra/fetch-timeout.js";
import { UpdateError } from "./errors.js";
import { isStableVersion, parseVersion } from "./version.js";

const FORGEJO_BASE_URL = "https://git.void.cold.at";
const RELEASE_REPO = "ai-factory/wze-websearch";
const NPM_PACKAGE = "@rwese/wze-websearch";

export type ReleaseAsset = {
  name: string;
  url: string;
  size?: number;
};

export type ReleaseInfo = {
  version: string;
  tag: string;
  assets: ReleaseAsset[];
  notes?: string;
};

export type ReleaseSource = {
  latest(): Promise<ReleaseInfo | undefined>;
  download(asset: ReleaseAsset): Promise<Buffer>;
};

export type ReleaseClientOptions = {
  baseUrl?: string;
  repo?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type ForgejoRelease = {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
};

function stableReleaseVersion(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const bare = tag.replace(/^v/, "");
  return isStableVersion(bare) ? bare : undefined;
}

function pickLatest(releases: ReleaseInfo[]): ReleaseInfo | undefined {
  return releases.sort((a, b) => {
    const left = parseVersion(a.version);
    const right = parseVersion(b.version);
    if (!left || !right) return 0;
    return (
      right.major - left.major || right.minor - left.minor || right.patch - left.patch
    );
  })[0];
}

export class ForgejoReleaseSource implements ReleaseSource {
  private readonly baseUrl: string;
  private readonly repo: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ReleaseClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.WZE_WEBSEARCH_RELEASE_API ?? FORGEJO_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.repo = options.repo ?? RELEASE_REPO;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async latest(): Promise<ReleaseInfo | undefined> {
    const url = `${this.baseUrl}/api/v1/repos/${this.repo}/releases?limit=50`;
    const releases = await this.json<ForgejoRelease[]>(url);
    const candidates: ReleaseInfo[] = [];
    for (const release of releases) {
      if (release.draft || release.prerelease) continue;
      const version = stableReleaseVersion(release.tag_name);
      if (!version) continue;
      candidates.push({
        version,
        tag: release.tag_name as string,
        ...(release.body ? { notes: release.body } : {}),
        assets: (release.assets ?? [])
          .filter((asset) => asset.name && asset.browser_download_url)
          .map((asset) => ({
            name: asset.name as string,
            url: asset.browser_download_url as string,
            ...(typeof asset.size === "number" ? { size: asset.size } : {}),
          })),
      });
    }
    return pickLatest(candidates);
  }

  download(asset: ReleaseAsset): Promise<Buffer> {
    return this.bytes(asset.url, `download ${asset.name}`);
  }

  private async json<T>(url: string): Promise<T> {
    const text = await this.bytes(url, "read the release list");
    try {
      return JSON.parse(text.toString("utf8")) as T;
    } catch {
      throw new UpdateError("release API returned invalid JSON");
    }
  }

  private bytes(url: string, what: string): Promise<Buffer> {
    return fetchWithTimeout(
      url,
      {
        timeoutMs: this.timeoutMs,
        init: { headers: { Accept: "application/json" } },
        mapError: (error, kind) =>
          new UpdateError(
            kind === "timeout"
              ? `timed out trying to ${what} after ${this.timeoutMs}ms`
              : `failed to ${what}: ${error.message}`,
          ),
      },
      async (response) => {
        if (!response.ok) {
          throw new UpdateError(`failed to ${what}: HTTP ${response.status}`);
        }
        return Buffer.from(await response.arrayBuffer());
      },
    );
  }
}

export type NpmVersionSourceOptions = {
  registry?: string;
  timeoutMs?: number;
};

/** Read-only npm version lookup for manager-owned installs. */
export class NpmVersionSource {
  private readonly registry: string;
  private readonly timeoutMs: number;

  constructor(options: NpmVersionSourceOptions = {}) {
    this.registry = (options.registry ?? process.env.WZE_WEBSEARCH_NPM_REGISTRY ?? "https://registry.npmjs.org").replace(
      /\/+$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  latest(): Promise<string | undefined> {
    const url = `${this.registry}/${NPM_PACKAGE.replace("/", "%2F")}/latest`;
    return fetchWithTimeout(
      url,
      {
        timeoutMs: this.timeoutMs,
        mapError: (error, kind) =>
          new UpdateError(
            kind === "timeout"
              ? `timed out reading the npm registry after ${this.timeoutMs}ms`
              : `failed to read the npm registry: ${error.message}`,
          ),
      },
      async (response) => {
        if (!response.ok) throw new UpdateError(`npm registry returned HTTP ${response.status}`);
        const body = (await response.json()) as { version?: string };
        return body.version && isStableVersion(body.version) ? body.version : undefined;
      },
    );
  }
}
