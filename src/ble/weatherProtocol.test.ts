import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCurrentWeather, encodeForecast, wmoToIcon, WeatherIcon } from './weatherProtocol';

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const i16 = (b: Uint8Array, o: number) => (u16(b, o) >= 0x8000 ? u16(b, o) - 0x10000 : u16(b, o));

test('encodeCurrentWeather lays out the 53-byte current message (type 0, v1)', () => {
  const b = encodeCurrentWeather({ timestamp: 1000, temp: 2150, min: 1800, max: 2500, icon: 5, location: 'SF', sunrise: 400, sunset: 1200 });
  assert.equal(b.length, 53);
  assert.equal(b[0], 0); // current
  assert.equal(b[1], 1); // version
  // timestamp u64 LE = 1000
  assert.equal(b[2], 0xe8);
  assert.equal(b[3], 0x03);
  assert.deepEqual([...b.subarray(4, 10)], [0, 0, 0, 0, 0, 0]);
  assert.equal(u16(b, 10), 2150); // temp centidegrees
  assert.equal(u16(b, 12), 1800); // min
  assert.equal(u16(b, 14), 2500); // max
  assert.deepEqual([...b.subarray(16, 18)], [0x53, 0x46]); // "SF"
  assert.equal(b[18], 0); // location NUL padding
  assert.equal(b[48], 5); // icon
  assert.equal(u16(b, 49), 400); // sunrise
  assert.equal(u16(b, 51), 1200); // sunset
});

test('negative temps and default sunrise/sunset encode as int16 / -1', () => {
  const b = encodeCurrentWeather({ timestamp: 0, temp: -550, min: -1200, max: 300, icon: 7 });
  assert.equal(i16(b, 10), -550);
  assert.equal(i16(b, 12), -1200);
  assert.equal(i16(b, 49), -1); // sunrise default unknown
  assert.equal(i16(b, 51), -1); // sunset default unknown
});

test('encodeForecast lays out the header + per-day records (type 1, v0)', () => {
  const days = [
    { min: 1000, max: 2000, icon: 0 },
    { min: 1100, max: 2100, icon: 3 },
  ];
  const b = encodeForecast(5000, days);
  assert.equal(b.length, 11 + 2 * 5);
  assert.equal(b[0], 1); // forecast
  assert.equal(b[1], 0); // version
  assert.equal(b[2], 0x88); // ts 5000 = 0x1388
  assert.equal(b[3], 0x13);
  assert.equal(b[10], 2); // nbDays
  assert.equal(i16(b, 11), 1000);
  assert.equal(i16(b, 13), 2000);
  assert.equal(b[15], 0);
  assert.equal(i16(b, 16), 1100);
  assert.equal(b[20], 3);
});

test('forecast caps at 5 days', () => {
  const days = Array.from({ length: 8 }, () => ({ min: 0, max: 0, icon: 0 }));
  const b = encodeForecast(0, days);
  assert.equal(b[10], 5);
  assert.equal(b.length, 11 + 5 * 5);
});

test('wmoToIcon maps WMO codes to the watch icon enum', () => {
  assert.equal(wmoToIcon(0), WeatherIcon.clear);
  assert.equal(wmoToIcon(2), WeatherIcon.scattered);
  assert.equal(wmoToIcon(3), WeatherIcon.broken);
  assert.equal(wmoToIcon(48), WeatherIcon.mist);
  assert.equal(wmoToIcon(63), WeatherIcon.rain);
  assert.equal(wmoToIcon(75), WeatherIcon.snow);
  assert.equal(wmoToIcon(81), WeatherIcon.shower);
  assert.equal(wmoToIcon(95), WeatherIcon.thunder);
  assert.equal(wmoToIcon(200), WeatherIcon.unknown);
});
