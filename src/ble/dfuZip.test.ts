import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { parseDfuArchive } from './dfuZip';

function buildArchive(manifest: unknown, bin: Uint8Array, dat: Uint8Array, binName = 'pinetime-mcuboot-app-image-1.16.0.bin', datName = 'pinetime-mcuboot-app-image-1.16.0.dat') {
  return zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    [binName]: bin,
    [datName]: dat,
  });
}

const goodManifest = {
  manifest: {
    application: {
      bin_file: 'pinetime-mcuboot-app-image-1.16.0.bin',
      dat_file: 'pinetime-mcuboot-app-image-1.16.0.dat',
      init_packet_data: { firmware_crc16: 42087 },
    },
  },
};

test('parses bin, dat, crc16 and version from a DFU archive', () => {
  const bin = new Uint8Array([1, 2, 3, 4, 5]);
  const dat = new Uint8Array([0x52, 0x00, 0xff, 0xff]);
  const archive = parseDfuArchive(buildArchive(goodManifest, bin, dat));
  assert.deepEqual([...archive.binFile], [...bin]);
  assert.deepEqual([...archive.datFile], [...dat]);
  assert.equal(archive.crc16, 42087);
  assert.equal(archive.version, '1.16.0');
});

test('rejects a zip without manifest.json', () => {
  const zip = zipSync({ 'foo.bin': new Uint8Array([1]) });
  assert.throws(() => parseDfuArchive(zip), /manifest\.json missing/);
});

test('rejects a manifest missing bin_file/dat_file', () => {
  const zip = buildArchive({ manifest: { application: {} } }, new Uint8Array([1]), new Uint8Array([2]));
  assert.throws(() => parseDfuArchive(zip), /missing application/);
});

test('rejects when the named bin/dat is absent from the zip', () => {
  const manifest = {
    manifest: { application: { bin_file: 'missing.bin', dat_file: 'x.dat', init_packet_data: { firmware_crc16: 1 } } },
  };
  const zip = zipSync({
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'x.dat': new Uint8Array([1]),
  });
  assert.throws(() => parseDfuArchive(zip), /missing missing\.bin/);
});
