import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRelease, fetchReleases, downloadAsset, canStreamResponseBody } from './githubReleases';

const release = (over: Partial<Record<string, unknown>> = {}) => ({
  tag_name: '1.16.0',
  name: 'InfiniTime 1.16.0',
  prerelease: false,
  published_at: '2024-01-01T00:00:00Z',
  assets: [
    { name: 'pinetime-mcuboot-app-dfu-1.16.0.zip', browser_download_url: 'https://x/dfu.zip' },
    { name: 'infinitime-resources-1.16.0.zip', browser_download_url: 'https://x/res.zip' },
    { name: 'pinetime-app.img', browser_download_url: 'https://x/img' },
  ],
  ...over,
});

test('mapRelease strips the v prefix and picks the dfu + resources assets', () => {
  const r = mapRelease(release({ tag_name: 'v1.16.0' }) as never);
  assert.equal(r.version, '1.16.0');
  assert.equal(r.dfuUrl, 'https://x/dfu.zip');
  assert.equal(r.resourcesUrl, 'https://x/res.zip');
});

test('mapRelease leaves urls undefined when an asset kind is absent', () => {
  const r = mapRelease(release({ assets: [{ name: 'notes.txt', browser_download_url: 'https://x/n' }] }) as never);
  assert.equal(r.dfuUrl, undefined);
  assert.equal(r.resourcesUrl, undefined);
});

test('fetchReleases keeps only installable releases and reports 404 clearly', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([release(), release({ tag_name: '0.9', assets: [] })]), { status: 200 })) as typeof fetch;
    const list = await fetchReleases('faisal-shah/InfiniTime');
    assert.equal(list.length, 1); // the assetless one is dropped
    assert.equal(list[0].version, '1.16.0');

    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await assert.rejects(fetchReleases('who/what'), /not found/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('downloadAsset buffers bytes and reports progress when streamed (web)', async () => {
  const orig = globalThis.fetch;
  try {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.enqueue(new Uint8Array([4, 5]));
        c.close();
      },
    });
    globalThis.fetch = (async () => new Response(body, { status: 200, headers: { 'content-length': '5' } })) as typeof fetch;
    const seen: number[] = [];
    const bytes = await downloadAsset('https://x/dfu.zip', (recv) => seen.push(recv), true);
    assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
    assert.deepEqual(seen, [3, 5]);
  } finally {
    globalThis.fetch = orig;
  }
});

// Expo SDK 57's native fetch races in its response sink (expo/expo#47762) and
// throws java.nio.BufferOverflowException. Reading the property at all starts
// the streaming state machine, so the guarantee under test is "never touched",
// not "not iterated".
test('downloadAsset never touches response.body on native', async () => {
  const orig = globalThis.fetch;
  try {
    let bodyTouched = false;
    const payload = new Uint8Array([9, 8, 7, 6]);
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '4' }),
      arrayBuffer: async () => payload.buffer.slice(0),
      get body(): ReadableStream<Uint8Array> | null {
        bodyTouched = true;
        throw new Error('native must not read response.body');
      },
    })) as unknown as typeof fetch;

    const seen: Array<[number, number]> = [];
    const bytes = await downloadAsset('https://x/dfu.zip', (recv, total) => seen.push([recv, total]), false);

    assert.equal(bodyTouched, false, 'response.body must never be accessed on native');
    assert.deepEqual([...bytes], [9, 8, 7, 6]);
    assert.deepEqual(seen, [[4, 4]], 'buffered path still reports one completion tick');
  } finally {
    globalThis.fetch = orig;
  }
});

test('downloadAsset defaults to the safe buffered path off the web', async () => {
  // No DOM under tsx --test, so the default must resolve to native/buffered.
  assert.equal(canStreamResponseBody(), false);

  const orig = globalThis.fetch;
  try {
    let bodyTouched = false;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '2' }),
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      get body(): ReadableStream<Uint8Array> | null {
        bodyTouched = true;
        return null;
      },
    })) as unknown as typeof fetch;

    const bytes = await downloadAsset('https://x/res.zip', () => {});
    assert.equal(bodyTouched, false, 'the default must not reach for response.body');
    assert.deepEqual([...bytes], [1, 2]);
  } finally {
    globalThis.fetch = orig;
  }
});
