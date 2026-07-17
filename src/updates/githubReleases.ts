// Discover installable releases from a GitHub repo. A release is usable here if
// it carries a firmware DFU zip (pinetime-mcuboot-app-dfu-*.zip) and/or an
// external-resources zip (infinitime-resources-*.zip) as assets. We surface the
// download URLs; dfuZip.ts / resourcesZip.ts parse the bytes once downloaded.

export interface Release {
  version: string; // tag with any leading "v" stripped, e.g. "1.16.0"
  tag: string;
  name: string;
  prerelease: boolean;
  publishedAt: string;
  dfuUrl?: string; // firmware image archive
  resourcesUrl?: string; // external-resources archive
}

interface GhAsset {
  name: string;
  browser_download_url: string;
}
interface GhRelease {
  tag_name: string;
  name: string | null;
  prerelease: boolean;
  published_at: string;
  assets: GhAsset[];
}

const DFU_ASSET_RE = /app-dfu.*\.zip$/i;
const RESOURCES_ASSET_RE = /resources.*\.zip$/i;

export function mapRelease(r: GhRelease): Release {
  const dfu = r.assets.find((a) => DFU_ASSET_RE.test(a.name));
  const resources = r.assets.find((a) => RESOURCES_ASSET_RE.test(a.name));
  return {
    version: r.tag_name.replace(/^v/i, ''),
    tag: r.tag_name,
    name: r.name || r.tag_name,
    prerelease: r.prerelease,
    publishedAt: r.published_at,
    dfuUrl: dfu?.browser_download_url,
    resourcesUrl: resources?.browser_download_url,
  };
}

/** Fetch releases for "owner/repo", newest first, keeping only installable ones. */
export async function fetchReleases(repo: string): Promise<Release[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? `Repository "${repo}" not found` : `GitHub API error ${res.status}`);
  }
  const raw = (await res.json()) as GhRelease[];
  return raw.map(mapRelease).filter((r) => r.dfuUrl || r.resourcesUrl);
}

/** Download an asset to bytes, reporting progress when the stream/length allow. */
export async function downloadAsset(url: string, onProgress?: (received: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const total = Number(res.headers.get('content-length')) || 0;

  // Stream for progress where supported (browsers); RN often lacks a readable
  // body, so fall back to a single buffered read.
  const reader = onProgress && res.body ? res.body.getReader() : undefined;
  if (!reader) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
