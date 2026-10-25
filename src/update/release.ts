/**
 * Signed Forgejo releases for self-owned installs. npm is not a publication
 * channel for this project; npm-detected installs are told to reinstall from a
 * signed release rather than checked against a stale registry version.
 */
import { fetchWithTimeout } from "../infra/fetch-timeout.js";
import { UpdateError } from "./errors.js";
import { isStableVersion, parseVersion } from "./version.js";

const FORGEJO_BASE_URL = "https://git.void.cold.at";
const RELEASE_REPO = "ai-factory/wze-websearch";

/** Budget for the release-list API call: a small JSON response. */
const DEFAULT_LIST_TIMEOUT_MS = 10000;
/** Floor for one asset download, so a tiny checksum file is not given less. */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60000;
/**
 * Slowest per-asset throughput we still call healthy. The portable archive is
 * ~22 MB, so a wall-clock budget that fits an API call would abort a live
 * transfer on a slow link; large assets earn a size-aware extension instead.
 */
const MIN_DOWNLOAD_BYTES_PER_SECOND = 128 * 1024;
/** What a failed asset transfer tells the user to do next. */
const RETRY_HINT = "retry the update, or reinstall from a signed release";

/**
 * Wall-clock budget for one asset: `floorMs` for small files, extended in
 * proportion to `sizeBytes` for bodies too large to finish at
 * `MIN_DOWNLOAD_BYTES_PER_SECOND` within the floor.
 */
export function downloadBudgetMs(
  sizeBytes: number | undefined,
  floorMs: number = DEFAULT_DOWNLOAD_TIMEOUT_MS,
): number {
  if (!sizeBytes || sizeBytes <= 0) return floorMs;
  return Math.max(floorMs, Math.ceil((sizeBytes * 1000) / MIN_DOWNLOAD_BYTES_PER_SECOND));
}

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
  /** Budget for the release-list API call. */
  timeoutMs?: number;
  /** Floor for a single asset download; large assets get a size-aware extension. */
  downloadTimeoutMs?: number;
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
  private readonly downloadTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ReleaseClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.WZE_WEBSEARCH_RELEASE_API ?? FORGEJO_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.repo = options.repo ?? RELEASE_REPO;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
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
    return this.bytes(
      asset.url,
      `download ${asset.name}`,
      downloadBudgetMs(asset.size, this.downloadTimeoutMs),
      RETRY_HINT,
    );
  }

  private async json<T>(url: string): Promise<T> {
    const text = await this.bytes(url, "read the release list", this.timeoutMs);
    try {
      return JSON.parse(text.toString("utf8")) as T;
    } catch {
      throw new UpdateError("release API returned invalid JSON");
    }
  }

  private bytes(url: string, what: string, timeoutMs: number, hint?: string): Promise<Buffer> {
    return fetchWithTimeout(
      url,
      {
        timeoutMs,
        fetchImpl: this.fetchImpl,
        init: { headers: { Accept: "application/json" } },
        mapError: (error, kind) =>
          new UpdateError(
            kind === "timeout"
              ? `timed out trying to ${what} after ${timeoutMs}ms${hint ? `; ${hint}` : ""}`
              : `failed to ${what}: ${error.message}${hint ? `; ${hint}` : ""}`,
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
