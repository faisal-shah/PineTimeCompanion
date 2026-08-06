#!/usr/bin/env -S npx tsx
// End-to-end check against REAL published firmware assets.
//
// The unit tests fake fetch, so they prove the branch logic but not that the
// shipped archives actually parse. This downloads the real InfiniTime release
// assets through the same downloadAsset() the app uses — once on the native
// (buffered) path and once on the web (streamed) path — and asserts both return
// byte-identical content that the DFU/resources parsers accept.
//
//   npx tsx scripts/release-asset-check.ts [tag]     # default: v2.0.2
//
// Network access required. Not part of `npm test`.

import { createHash } from 'node:crypto';
import { fetchReleases, downloadAsset } from '../src/updates/githubReleases';
import { parseDfuArchive } from '../src/ble/dfuZip';
import { parseResourcesArchive } from '../src/ble/resourcesZip';

async function main() {
  const TAG = process.argv[2] ?? 'v2.0.2';
  const REPO = 'faisal-shah/InfiniTime';

  let failures = 0;
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok:  ' : 'FAIL:'} ${what}`);
    if (!ok) failures++;
  };
  const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

  const releases = await fetchReleases(REPO);
  const rel = releases.find((r) => r.tag === TAG);
  if (!rel) {
    console.error(`no release ${TAG} with installable assets in ${REPO}`);
    process.exit(1);
  }
  check(!!rel.dfuUrl, `${TAG} exposes a firmware DFU asset`);
  check(!!rel.resourcesUrl, `${TAG} exposes a resources asset`);

  // The size GitHub reports for each asset, to compare the download against.
  const api = (await (await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`)).json()) as {
    assets: { name: string; size: number; browser_download_url: string }[];
  };
  const sizeOf = (url: string) => api.assets.find((a) => a.browser_download_url === url)?.size ?? -1;

  async function bothPaths(url: string, label: string): Promise<Uint8Array> {
    const nativeTicks: Array<[number, number]> = [];
    const native = await downloadAsset(url, (r, t) => nativeTicks.push([r, t]), false);

    const webTicks: Array<[number, number]> = [];
    const web = await downloadAsset(url, (r, t) => webTicks.push([r, t]), true);

    const expected = sizeOf(url);
    check(native.length === expected, `${label}: native download is the published size (${native.length} vs ${expected} B)`);
    check(web.length === expected, `${label}: web download is the published size (${web.length} B)`);
    check(sha256(native) === sha256(web), `${label}: native and web bytes are identical (sha256 ${sha256(native).slice(0, 16)}…)`);
    check(nativeTicks.length === 1, `${label}: native reports one completion tick (${nativeTicks.length})`);
    check(
      nativeTicks[0]?.[0] === native.length,
      `${label}: native tick reports the full length (${nativeTicks[0]?.[0]} of ${native.length})`,
    );
    check(webTicks.length >= 1, `${label}: web reports incremental progress (${webTicks.length} ticks)`);
    check(
      webTicks[webTicks.length - 1]?.[0] === web.length,
      `${label}: web progress ends at the full length (${webTicks[webTicks.length - 1]?.[0]} of ${web.length})`,
    );
    return native;
  }

  // --- firmware ---
  const dfuBytes = await bothPaths(rel.dfuUrl!, 'firmware');
  const dfu = parseDfuArchive(dfuBytes);
  check(dfu.binFile.length > 0, `firmware archive parses to an MCUBoot image (${dfu.binFile.length} B)`);
  check(dfu.datFile.length > 0, `firmware archive carries an init packet (${dfu.datFile.length} B)`);
  check(dfu.version === TAG.replace(/^v/, ''), `firmware image version matches the tag (${dfu.version})`);
  check(Number.isInteger(dfu.crc16), `manifest carries a firmware_crc16 (${dfu.crc16})`);

  // --- resources ---
  const resBytes = await bothPaths(rel.resourcesUrl!, 'resources');
  const res = parseResourcesArchive(resBytes);
  check(res.files.length > 0, `resources archive parses to files (${res.files.length})`);
  check(
    res.files.every((f) => f.data.length > 0 && f.path.startsWith('/')),
    'every resource entry has an absolute watch path and content',
  );
  console.log(`     resources: ${res.files.map((f) => f.path).join(', ')}`);

  console.log(`\n${failures === 0 ? `RELEASE ASSET CHECK PASS (${TAG})` : `RELEASE ASSET CHECK FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
