// TypeScript twin of the firmware's prayer-time astronomy
// (InfiniTime src/components/prayer/PrayerRules.h) — it must agree with the
// firmware to the minute on the shared golden vectors (prayerTimes.test.ts).
// Drives the settings-screen preview so what the app shows is what the watch
// will show. Same PrayTimes.org-style low-precision solar model; the firmware
// runs it in f32, this twin in f64 — the golden vectors are curated away from
// half-minute boundaries so both round identically.

import { AsrMadhab, PrayerMethod } from './types';

export const PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type Prayer = (typeof PRAYERS)[number];

export interface PrayerDayTimes {
  /** minutes from local civil midnight, by prayer; undefined when not computable */
  minutes: Partial<Record<Prayer, number>>;
  /** true where the high-latitude middle-of-the-night fallback was used */
  estimated: Partial<Record<Prayer, boolean>>;
}

const METHOD_PARAMS: Record<PrayerMethod, { fajrAngle: number; ishaAngle: number; ishaAfterMaghribMin: number }> = {
  mwl: { fajrAngle: 18, ishaAngle: 17, ishaAfterMaghribMin: 0 },
  isna: { fajrAngle: 15, ishaAngle: 15, ishaAfterMaghribMin: 0 },
  egyptian: { fajrAngle: 19.5, ishaAngle: 17.5, ishaAfterMaghribMin: 0 },
  ummAlQura: { fajrAngle: 18.5, ishaAngle: 0, ishaAfterMaghribMin: 90 },
  karachi: { fajrAngle: 18, ishaAngle: 18, ishaAfterMaghribMin: 0 },
};

const degSin = (d: number) => Math.sin((d * Math.PI) / 180);
const degCos = (d: number) => Math.cos((d * Math.PI) / 180);
const degTan = (d: number) => Math.tan((d * Math.PI) / 180);
const fixAngle = (d: number) => ((d % 360) + 360) % 360;
const fixHour = (h: number) => ((h % 24) + 24) % 24;

/** Integer Julian Day Number minus 2451545 (J2000). Integer math, like the firmware. */
function daysFromJ2000(year: number, month: number, day: number): number {
  const a = Math.trunc((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const jdn =
    day + Math.trunc((153 * m + 2) / 5) + 365 * y + Math.trunc(y / 4) - Math.trunc(y / 100) + Math.trunc(y / 400) - 32045;
  return jdn - 2451545;
}

function sunAt(d: number): { declination: number; equationOfTime: number } {
  const g = fixAngle(357.529 + 0.98560028 * d);
  const q = fixAngle(280.459 + 0.98564736 * d);
  const l = fixAngle(q + 1.915 * degSin(g) + 0.02 * degSin(2 * g));
  const e = 23.439 - 0.00000036 * d;

  const declination = (Math.asin(degSin(e) * degSin(l)) * 180) / Math.PI;
  const rightAscension = fixHour(((Math.atan2(degCos(e) * degSin(l), degCos(l)) * 180) / Math.PI) / 15);
  const equationOfTime = ((q / 15 - rightAscension + 36) % 24) - 12;
  return { declination, equationOfTime };
}

function hourAngle(altitude: number, latitude: number, declination: number): number {
  const cosH = (degSin(altitude) - degSin(latitude) * degSin(declination)) / (degCos(latitude) * degCos(declination));
  if (cosH < -1 || cosH > 1) {
    return NaN;
  }
  return ((Math.acos(cosH) * 180) / Math.PI) / 15;
}

const asrAltitude = (factor: number, latitude: number, declination: number) =>
  (Math.atan(1 / (factor + degTan(Math.abs(latitude - declination)))) * 180) / Math.PI;

/**
 * Prayer times for the civil date at lat/lon (north/east positive, degrees)
 * with the local clock utcOffsetHours ahead of UTC. Semantics identical to
 * the firmware, including the middle-of-the-night fallback and the near-polar
 * past-midnight wrap (minutes are always time-of-day).
 */
export function computePrayerTimes(
  year: number,
  month: number,
  day: number,
  latDeg: number,
  lonDeg: number,
  utcOffsetHours: number,
  method: PrayerMethod,
  madhab: AsrMadhab
): PrayerDayTimes {
  const params = METHOD_PARAMS[method];
  const d0 = daysFromJ2000(year, month, day);

  let noon = 12;
  for (let pass = 0; pass < 2; pass++) {
    const sun = sunAt(d0 + (noon - utcOffsetHours) / 24);
    noon = 12 + utcOffsetHours - lonDeg / 15 - sun.equationOfTime;
  }

  const timeAt = (altitude: number, morning: boolean): number => {
    let t = noon;
    for (let pass = 0; pass < 2; pass++) {
      const sun = sunAt(d0 + (t - utcOffsetHours) / 24);
      const h = hourAngle(altitude, latDeg, sun.declination);
      if (Number.isNaN(h)) {
        return NaN;
      }
      t = morning ? noon - h : noon + h;
    }
    return t;
  };

  // Math.trunc mirrors the firmware's static_cast<int> for the rare negative
  // (pre-midnight) fallback values.
  const toMinutes = (hours: number) => ((Math.trunc(hours * 60 + 0.5) % 1440) + 1440) % 1440;

  const sunrise = timeAt(-0.833, true);
  const sunset = timeAt(-0.833, false);
  let fajr = timeAt(-params.fajrAngle, true);
  let isha = params.ishaAfterMaghribMin !== 0 ? sunset + params.ishaAfterMaghribMin / 60 : timeAt(-params.ishaAngle, false);

  const noonSun = sunAt(d0 + (noon - utcOffsetHours) / 24);
  const asr = timeAt(asrAltitude(madhab === 'hanafi' ? 2 : 1, latDeg, noonSun.declination), false);

  const result: PrayerDayTimes = { minutes: { dhuhr: toMinutes(noon) }, estimated: {} };

  if (Number.isNaN(sunrise) || Number.isNaN(sunset)) {
    return result; // polar day/night: only dhuhr is defensible
  }

  const night = 24 - (sunset - sunrise);
  if (Number.isNaN(fajr)) {
    fajr = sunrise - night / 2;
    result.estimated.fajr = true;
  }
  if (Number.isNaN(isha)) {
    isha = sunset + night / 2;
    result.estimated.isha = true;
  }

  result.minutes.fajr = toMinutes(fajr);
  result.minutes.sunrise = toMinutes(sunrise);
  if (!Number.isNaN(asr)) {
    result.minutes.asr = toMinutes(asr);
  }
  result.minutes.maghrib = toMinutes(sunset);
  result.minutes.isha = toMinutes(isha);
  return result;
}

export const formatMinutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
