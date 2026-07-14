// Golden-vector tests for the Prayer Service settings blob
// (InfiniTime doc/PrayerService.md). Run with npm test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePrayerSettings, encodePrayerSettings, PRAYER_SETTINGS_SIZE } from './prayerProtocol';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('encode: Chicago-ish, ISNA, Hanafi, alerts on', () => {
  // lat 41.88 -> 4188 = 0x105c; lon -87.63 -> -8763 = 0xddc5; UTC-5 -> -20 = 0xec
  const b = encodePrayerSettings({
    method: 'isna',
    asrMadhab: 'hanafi',
    alertsEnabled: true,
    latE2: 4188,
    lonE2: -8763,
    utcOffsetQuarters: -20,
  });
  assert.equal(b.length, PRAYER_SETTINGS_SIZE);
  assert.equal(hex(b), '010101015c10c5ddec');
});

test('encode: Mecca, Umm al-Qura, Standard, alerts off', () => {
  // lat 21.42 -> 2142 = 0x085e; lon 39.83 -> 3983 = 0x0f8f; UTC+3 -> 12 = 0x0c
  const b = encodePrayerSettings({
    method: 'ummAlQura',
    asrMadhab: 'standard',
    alertsEnabled: false,
    latE2: 2142,
    lonE2: 3983,
    utcOffsetQuarters: 12,
  });
  assert.equal(hex(b), '010300005e088f0f0c');
});

test('extreme offsets survive the round trip', () => {
  for (const q of [-48, 56]) {
    const s = { method: 'mwl' as const, asrMadhab: 'standard' as const, alertsEnabled: true, latE2: -9000, lonE2: 18000, utcOffsetQuarters: q };
    assert.deepEqual(decodePrayerSettings(encodePrayerSettings(s)), s);
  }
});

test('round trip preserves negative coordinates exactly', () => {
  const s = {
    method: 'karachi' as const,
    asrMadhab: 'hanafi' as const,
    alertsEnabled: false,
    latE2: -3387, // Sydney
    lonE2: 15121,
    utcOffsetQuarters: 40,
  };
  assert.deepEqual(decodePrayerSettings(encodePrayerSettings(s)), s);
});

test('decode rejects wrong length and version', () => {
  assert.throws(() => decodePrayerSettings(new Uint8Array(8)));
  const bad = encodePrayerSettings({ method: 'mwl', asrMadhab: 'standard', alertsEnabled: false, latE2: 0, lonE2: 0, utcOffsetQuarters: 0 });
  bad[0] = 2;
  assert.throws(() => decodePrayerSettings(bad));
});

test('encode rejects out-of-range values', () => {
  const base = { method: 'mwl' as const, asrMadhab: 'standard' as const, alertsEnabled: true, latE2: 0, lonE2: 0, utcOffsetQuarters: 0 };
  assert.throws(() => encodePrayerSettings({ ...base, latE2: 9001 }));
  assert.throws(() => encodePrayerSettings({ ...base, lonE2: -18001 }));
  assert.throws(() => encodePrayerSettings({ ...base, utcOffsetQuarters: 57 }));
});
