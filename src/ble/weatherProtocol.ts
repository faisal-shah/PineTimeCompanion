// Byte-level encoder for InfiniTime's SimpleWeatherService (the fork's
// SimpleWeatherService.{h,cpp}). Pure functions over Uint8Array — tested against
// golden vectors (weatherProtocol.test.ts). Two message types share the one
// write characteristic, discriminated by byte[0]. All little-endian; temperatures
// are centidegrees Celsius (21.5°C -> 2150); the watch converts to °F itself.

export const WEATHER_SERVICE_UUID = '00050000-78fc-48fe-8e23-433b3a1942d0';
export const WEATHER_CHAR_UUID = '00050001-78fc-48fe-8e23-433b3a1942d0';

export const MAX_FORECAST_DAYS = 5;
const LOCATION_BYTES = 32;

// InfiniTime SimpleWeatherService::Icons.
export const WeatherIcon = {
  clear: 0,
  fewClouds: 1,
  scattered: 2,
  broken: 3,
  shower: 4,
  rain: 5,
  thunder: 6,
  snow: 7,
  mist: 8,
  unknown: 255,
} as const;

export interface CurrentWeather {
  timestamp: number; // unix seconds; the watch drops weather older than 24h
  temp: number; // centidegrees C
  min: number;
  max: number;
  icon: number;
  location?: string; // <=32 UTF-8 bytes; stored but not shown on the watch
  sunrise?: number; // minutes into the day, -1 unknown, -2 no sunrise
  sunset?: number;
}

export interface ForecastDay {
  min: number; // centidegrees C
  max: number;
  icon: number;
}

function i16le(value: number, b: Uint8Array, off: number): void {
  const v = value < 0 ? value + 0x10000 : value;
  b[off] = v & 0xff;
  b[off + 1] = (v >> 8) & 0xff;
}

function u64le(value: number, b: Uint8Array, off: number): void {
  let v = BigInt(Math.floor(value));
  for (let i = 0; i < 8; i++) {
    b[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Map an Open-Meteo WMO weather-interpretation code to the watch's icon enum. */
export function wmoToIcon(code: number): number {
  if (code === 0) return WeatherIcon.clear;
  if (code === 1) return WeatherIcon.fewClouds;
  if (code === 2) return WeatherIcon.scattered;
  if (code === 3) return WeatherIcon.broken;
  if (code === 45 || code === 48) return WeatherIcon.mist;
  if (code >= 51 && code <= 67) return WeatherIcon.rain; // drizzle + rain (incl. freezing)
  if (code >= 71 && code <= 77) return WeatherIcon.snow;
  if (code >= 80 && code <= 82) return WeatherIcon.shower; // rain showers
  if (code === 85 || code === 86) return WeatherIcon.snow;
  if (code >= 95 && code <= 99) return WeatherIcon.thunder;
  return WeatherIcon.unknown;
}

/** Current-weather message (type 0, version 1) — 53 bytes. */
export function encodeCurrentWeather(w: CurrentWeather): Uint8Array {
  const b = new Uint8Array(53);
  b[0] = 0; // message type: current
  b[1] = 1; // version
  u64le(w.timestamp, b, 2);
  i16le(Math.round(w.temp), b, 10);
  i16le(Math.round(w.min), b, 12);
  i16le(Math.round(w.max), b, 14);
  if (w.location) {
    const loc = new TextEncoder().encode(w.location).slice(0, LOCATION_BYTES);
    b.set(loc, 16); // remaining bytes stay 0 (the watch NUL-terminates)
  }
  b[48] = w.icon & 0xff;
  i16le(w.sunrise ?? -1, b, 49);
  i16le(w.sunset ?? -1, b, 51);
  return b;
}

/** Forecast message (type 1, version 0) — 11 + 5*nbDays bytes, nbDays <= 5. */
export function encodeForecast(timestamp: number, days: ForecastDay[]): Uint8Array {
  const n = Math.min(days.length, MAX_FORECAST_DAYS);
  const b = new Uint8Array(11 + n * 5);
  b[0] = 1; // message type: forecast
  b[1] = 0; // version
  u64le(timestamp, b, 2);
  b[10] = n;
  for (let i = 0; i < n; i++) {
    const o = 11 + i * 5;
    i16le(Math.round(days[i].min), b, o);
    i16le(Math.round(days[i].max), b, o + 2);
    b[o + 4] = days[i].icon & 0xff;
  }
  return b;
}
