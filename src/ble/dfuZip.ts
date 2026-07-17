// Parse an InfiniTime DFU archive (pinetime-mcuboot-app-dfu-*.zip) into the two
// blobs the Legacy-DFU transfer needs. The zip is the Nordic/adafruit-nrfutil
// format: manifest.json names the application `.bin` (the MCUBoot image, sent
// verbatim) and `.dat` (the init packet carrying firmware_crc16). The watch
// does the CRC check itself from the .dat, so we only extract, not validate.

import { unzipSync } from 'fflate';

export interface DfuArchive {
  binFile: Uint8Array; // MCUBoot application image, streamed in 20-byte chunks
  datFile: Uint8Array; // init packet (device type/rev/version + softdevice + crc16)
  crc16: number; // firmware_crc16 from the manifest (informational; watch re-derives)
  version?: string; // parsed from the bin filename when present (e.g. 1.16.0)
}

interface Manifest {
  manifest?: {
    application?: {
      bin_file?: string;
      dat_file?: string;
      init_packet_data?: { firmware_crc16?: number };
    };
  };
}

export function parseDfuArchive(zipBytes: Uint8Array): DfuArchive {
  const files = unzipSync(zipBytes);
  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) {
    throw new Error('Not a DFU archive: manifest.json missing');
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest;
  const app = manifest.manifest?.application;
  if (!app?.bin_file || !app?.dat_file) {
    throw new Error('DFU manifest missing application bin_file / dat_file');
  }
  const binFile = files[app.bin_file];
  const datFile = files[app.dat_file];
  if (!binFile || !datFile) {
    throw new Error(`DFU archive missing ${!binFile ? app.bin_file : app.dat_file}`);
  }
  const version = /-((?:\d+\.){2}\d+)\.bin$/.exec(app.bin_file)?.[1];
  return { binFile, datFile, crc16: app.init_packet_data?.firmware_crc16 ?? 0, version };
}
