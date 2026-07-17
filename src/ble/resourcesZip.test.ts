import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { parseResourcesArchive, parentDirs } from './resourcesZip';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

test('parses resources.json into files (with bytes) and obsolete paths', () => {
  const zip = zipSync({
    'resources.json': enc({
      resources: [
        { filename: 'lv_font_dots_40.bin', path: '/fonts/lv_font_dots_40.bin' },
        { filename: 'logo.bin', path: '/images/logo.bin' },
      ],
      obsolete_files: [{ path: '/old.bin', since: '1.11.0' }],
    }),
    'lv_font_dots_40.bin': new Uint8Array([1, 2, 3]),
    'logo.bin': new Uint8Array([9, 8]),
  });
  const archive = parseResourcesArchive(zip);
  assert.equal(archive.files.length, 2);
  assert.deepEqual([...archive.files[0].data], [1, 2, 3]);
  assert.equal(archive.files[0].path, '/fonts/lv_font_dots_40.bin');
  assert.deepEqual(archive.obsolete, ['/old.bin']);
});

test('rejects a zip without resources.json', () => {
  const zip = zipSync({ 'x.bin': new Uint8Array([1]) });
  assert.throws(() => parseResourcesArchive(zip), /resources\.json missing/);
});

test('rejects when a named resource is absent from the zip', () => {
  const zip = zipSync({
    'resources.json': enc({ resources: [{ filename: 'gone.bin', path: '/fonts/gone.bin' }] }),
  });
  assert.throws(() => parseResourcesArchive(zip), /missing gone\.bin/);
});

test('parentDirs yields unique dirs shallow-to-deep', () => {
  assert.deepEqual(parentDirs(['/fonts/a.bin', '/fonts/b.bin', '/images/deep/c.bin']), [
    '/fonts',
    '/images',
    '/images/deep',
  ]);
});
