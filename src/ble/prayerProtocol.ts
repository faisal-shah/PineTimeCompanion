// Byte-level encoder/decoder for the InfiniTime Prayer Service settings blob
// (doc/PrayerService.md in the InfiniTime fork). Pure functions over
// Uint8Array — no BLE, no React Native — tested against golden vectors
// (prayerProtocol.test.ts). The same 9 bytes are the BLE characteristic
// value, the watch's /.system/prayer.dat and this app's canonical form.

import { AsrMadhab, PrayerMethod, PrayerSettings } from '../model/types';

export const PRAYER_SERVICE_UUID = '00070000-78fc-48fe-8e23-433b3a1942d0';
export const PRAYER_SETTINGS_CHAR_UUID = '00070001-78fc-48fe-8e23-433b3a1942d0';

export const PRAYER_SETTINGS_SIZE = 9;
export const PRAYER_SETTINGS_VERSION = 1;

const METHOD_CODES: Record<PrayerMethod, number> = { mwl: 0, isna: 1, egyptian: 2, ummAlQura: 3, karachi: 4 };
const METHODS: PrayerMethod[] = ['mwl', 'isna', 'egyptian', 'ummAlQura', 'karachi'];
const MADHAB_CODES: Record<AsrMadhab, number> = { standard: 0, hanafi: 1 };
const MADHABS: AsrMadhab[] = ['standard', 'hanafi'];

function i16le(value: number): [number, number] {
  const v = value < 0 ? value + 0x10000 : value;
  return [v & 0xff, (v >> 8) & 0xff];
}

function readI16le(bytes: Uint8Array, offset: number): number {
  const v = bytes[offset] | (bytes[offset + 1] << 8);
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** Settings the app writes; editedAt is app-local and never on the wire. */
export type WireSettings = Omit<PrayerSettings, 'editedAt'>;

export function encodePrayerSettings(s: WireSettings): Uint8Array {
  if (s.latE2 < -9000 || s.latE2 > 9000 || s.lonE2 < -18000 || s.lonE2 > 18000) {
    throw new Error('coordinates out of range');
  }
  if (s.utcOffsetQuarters < -48 || s.utcOffsetQuarters > 56) {
    throw new Error('UTC offset out of range');
  }
  const b = new Uint8Array(PRAYER_SETTINGS_SIZE);
  b[0] = PRAYER_SETTINGS_VERSION;
  b[1] = METHOD_CODES[s.method];
  b[2] = MADHAB_CODES[s.asrMadhab];
  b[3] = s.alertsEnabled ? 0x01 : 0x00;
  [b[4], b[5]] = i16le(Math.round(s.latE2));
  [b[6], b[7]] = i16le(Math.round(s.lonE2));
  b[8] = s.utcOffsetQuarters < 0 ? s.utcOffsetQuarters + 0x100 : s.utcOffsetQuarters;
  return b;
}

export function decodePrayerSettings(bytes: Uint8Array): WireSettings {
  if (bytes.length !== PRAYER_SETTINGS_SIZE || bytes[0] !== PRAYER_SETTINGS_VERSION) {
    throw new Error(`unexpected prayer settings blob (${bytes.length} bytes, version ${bytes[0]})`);
  }
  const method = METHODS[bytes[1]];
  const asrMadhab = MADHABS[bytes[2]];
  if (method === undefined || asrMadhab === undefined) {
    throw new Error('unknown method or madhab');
  }
  return {
    method,
    asrMadhab,
    alertsEnabled: (bytes[3] & 0x01) !== 0,
    latE2: readI16le(bytes, 4),
    lonE2: readI16le(bytes, 6),
    utcOffsetQuarters: bytes[8] >= 0x80 ? bytes[8] - 0x100 : bytes[8],
  };
}
