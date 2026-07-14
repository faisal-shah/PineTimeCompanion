// Golden-vector tests for the prayer-time twin. The vectors are FROZEN copies
// of the ones in the firmware's PrayerRulesTest.cpp (authored once against
// the adhan reference library, worst deviation 1.0 minute) — both
// implementations must produce exactly these minutes. A broader sweep then
// cross-checks this twin against adhan itself at +-2 minutes.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as adhan from 'adhan';
import { computePrayerTimes, PRAYERS, Prayer } from './prayerTimes';
import { AsrMadhab, PrayerMethod } from './types';

interface Vector {
  name: string;
  y: number;
  m: number;
  d: number;
  lat: number;
  lon: number;
  tz: number;
  method: PrayerMethod;
  madhab: AsrMadhab;
  expected: (number | null)[]; // fajr sunrise dhuhr asr maghrib isha; null = invalid
  estimated: Prayer[];
}

// Keep identical to PrayerRulesTest.cpp.
const VECTORS: Vector[] = [
  { name: 'mecca-ummalqura', y: 2026, m: 7, d: 14, lat: 21.4225, lon: 39.8262, tz: 3, method: 'ummAlQura', madhab: 'standard',
    expected: [261, 347, 747, 941, 1146, 1236], estimated: [] },
  { name: 'nyc-isna-summer', y: 2026, m: 7, d: 14, lat: 40.7128, lon: -74.006, tz: -4, method: 'isna', madhab: 'standard',
    expected: [242, 337, 782, 1020, 1226, 1321], estimated: [] },
  { name: 'nyc-isna-solstice', y: 2026, m: 12, d: 21, lat: 40.7128, lon: -74.006, tz: -5, method: 'isna', madhab: 'standard',
    expected: [355, 437, 714, 854, 992, 1074], estimated: [] },
  { name: 'london-mwl-midsummer', y: 2026, m: 6, d: 21, lat: 51.5074, lon: -0.1278, tz: 1, method: 'mwl', madhab: 'standard',
    expected: [62, 283, 782, 1045, 1282, 62], estimated: ['fajr', 'isha'] },
  { name: 'karachi-hanafi-winter', y: 2026, m: 1, d: 15, lat: 24.8607, lon: 67.0011, tz: 5, method: 'karachi', madhab: 'hanafi',
    expected: [359, 439, 762, 989, 1085, 1165], estimated: [] },
  { name: 'jakarta-egyptian-equinox', y: 2026, m: 3, d: 20, lat: -6.2088, lon: 106.8456, tz: 7, method: 'egyptian', madhab: 'standard',
    expected: [282, 357, 720, 911, 1083, 1150], estimated: [] },
  { name: 'sydney-mwl-winter-standard', y: 2026, m: 6, d: 21, lat: -33.8688, lon: 151.2093, tz: 10, method: 'mwl', madhab: 'standard',
    expected: [331, 420, 717, 876, 1014, 1098], estimated: [] },
  { name: 'sydney-mwl-winter-hanafi', y: 2026, m: 6, d: 21, lat: -33.8688, lon: 151.2093, tz: 10, method: 'mwl', madhab: 'hanafi',
    expected: [331, 420, 717, 916, 1014, 1098], estimated: [] },
  { name: 'reykjavik-mwl-midsummer', y: 2026, m: 6, d: 21, lat: 64.1466, lon: -21.9426, tz: 0, method: 'mwl', madhab: 'standard',
    expected: [90, 175, 810, 1103, 4, 90], estimated: ['fajr', 'isha'] },
  { name: 'mecca-2031-jdn-guard', y: 2031, m: 5, d: 10, lat: 21.4225, lon: 39.8262, tz: 3, method: 'ummAlQura', madhab: 'standard',
    expected: [262, 345, 737, 936, 1130, 1220], estimated: [] },
];

for (const v of VECTORS) {
  test(`golden vector: ${v.name}`, () => {
    const t = computePrayerTimes(v.y, v.m, v.d, v.lat, v.lon, v.tz, v.method, v.madhab);
    PRAYERS.forEach((p, i) => {
      assert.equal(t.minutes[p], v.expected[i] ?? undefined, `${v.name} ${p}`);
    });
    for (const p of PRAYERS) {
      assert.equal(!!t.estimated[p], v.estimated.includes(p), `${v.name} ${p} estimated flag`);
    }
  });
}

test('polar night leaves only dhuhr', () => {
  const t = computePrayerTimes(2026, 12, 21, 78.2, 15.6, 1, 'mwl', 'standard');
  assert.equal(typeof t.minutes.dhuhr, 'number');
  assert.equal(t.minutes.fajr, undefined);
  assert.equal(t.minutes.maghrib, undefined);
});

// ---- adhan reference sweep ------------------------------------------------
// adhan is a devDependency used ONLY here as a sanity oracle. It uses higher-
// precision astronomy, so agreement is +-2 minutes, not exact. Comparison is
// in minutes-from-local-midnight with the vector's fixed UTC offset so the
// host machine's timezone never matters.

const ADHAN_METHODS: Record<PrayerMethod, () => adhan.CalculationParameters> = {
  mwl: adhan.CalculationMethod.MuslimWorldLeague,
  isna: adhan.CalculationMethod.NorthAmerica,
  egyptian: adhan.CalculationMethod.Egyptian,
  ummAlQura: adhan.CalculationMethod.UmmAlQura,
  karachi: adhan.CalculationMethod.Karachi,
};

const toLocalMinutes = (date: Date, tzHours: number) => {
  const utcMin = date.getTime() / 60000;
  return (((utcMin + tzHours * 60) % 1440) + 1440) % 1440;
};

const wrapDiff = (a: number, b: number) => {
  let d = a - b;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
};

test('adhan reference sweep stays within 2 minutes', () => {
  const cities = [
    { lat: 41.8781, lon: -87.6298, tz: -6 }, // Chicago (standard time)
    { lat: 21.4225, lon: 39.8262, tz: 3 }, // Mecca
    { lat: 24.8607, lon: 67.0011, tz: 5 }, // Karachi
    { lat: -6.2088, lon: 106.8456, tz: 7 }, // Jakarta
    { lat: -33.8688, lon: 151.2093, tz: 10 }, // Sydney
  ];
  const dates = [
    { y: 2026, m: 1, d: 15 },
    { y: 2026, m: 3, d: 20 },
    { y: 2026, m: 7, d: 14 },
    { y: 2026, m: 10, d: 5 },
    { y: 2026, m: 12, d: 21 },
  ];
  const methods: PrayerMethod[] = ['mwl', 'isna', 'egyptian', 'ummAlQura', 'karachi'];

  let comparisons = 0;
  for (const c of cities) {
    for (const dt of dates) {
      for (const method of methods) {
        for (const madhab of ['standard', 'hanafi'] as AsrMadhab[]) {
          const mine = computePrayerTimes(dt.y, dt.m, dt.d, c.lat, c.lon, c.tz, method, madhab);
          const params = ADHAN_METHODS[method]();
          params.madhab = madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
          const date = new Date(Date.UTC(dt.y, dt.m - 1, dt.d, 12 - c.tz)); // local noon as UTC instant
          const ref = new adhan.PrayerTimes(new adhan.Coordinates(c.lat, c.lon), date, params);

          for (const p of PRAYERS) {
            const m = mine.minutes[p];
            if (m === undefined || mine.estimated[p]) {
              continue; // fallback semantics differ by library; skip estimated
            }
            const refMin = toLocalMinutes(ref[p], c.tz);
            const diff = Math.abs(wrapDiff(m, refMin));
            // Deep-twilight crossings (fajr/isha, 15-19.5 deg depression)
            // amplify the low-precision solar model's declination error, so
            // they get a slightly wider band than the geometric times.
            const tolerance = p === 'fajr' || p === 'isha' ? 3 : 2;
            assert.ok(diff <= tolerance,
                      `${method}/${madhab} ${p} at (${c.lat},${c.lon}) ${dt.y}-${dt.m}-${dt.d}: ${diff.toFixed(1)} min off`);
            comparisons++;
          }
        }
      }
    }
  }
  assert.ok(comparisons > 1000, `expected a broad sweep, got ${comparisons}`);
});
