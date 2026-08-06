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

/**
 * Whether this runtime may read `Response.body`.
 *
 * Expo SDK 57's native fetch finalizes its response sink without synchronizing
 * the chunk queue (expo/expo#47762). `ResponseSink.finalize` sizes a ByteBuffer
 * from the queue and then fills it from that same queue; a chunk arriving from
 * the OkHttp IO thread in between overflows the buffer and throws
 * `java.nio.BufferOverflowException` mid-download. It is a race, so it fails
 * intermittently and succeeds on retry.
 *
 * Only the browser's implementation is safe. Native therefore takes the
 * completed one-shot `arrayBuffer()` path and must never touch `body` at all —
 * merely reading the property starts the streaming state machine.
 *
 * Web builds render into a DOM and React Native does not, so `document` is the
 * discriminator. Using it keeps this module free of a `react-native` import,
 * which is what lets it run under `tsx --test`.
 */
export function canStreamResponseBody(): boolean {
  return typeof document !== 'undefined';
}

/** Download an asset to bytes, reporting progress when the stream/length allow. */
export async function downloadAsset(
  url: string,
  onProgress?: (received: number, total: number) => void,
  allowStreaming: boolean = canStreamResponseBody(),
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const total = Number(res.headers.get('content-length')) || 0;

  // Native: read the completed body in one shot without referencing res.body,
  // then report a single completion tick so the bar does not sit at zero.
  if (!allowStreaming || !onProgress) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress?.(bytes.length, total || bytes.length);
    return bytes;
  }

  // Web: a real WHATWG stream, so report incremental progress.
  const reader = res.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress(bytes.length, total || bytes.length);
    return bytes;
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
