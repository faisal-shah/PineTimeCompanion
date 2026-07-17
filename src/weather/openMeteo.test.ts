import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeather } from './openMeteo';
import { WeatherIcon } from '../ble/weatherProtocol';

const SAMPLE = {
  current: { temperature_2m: 21.5, weather_code: 3 },
  daily: {
    time: ['2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21'],
    temperature_2m_max: [25.4, 26.1, 24.0, 23.5, 22.2],
    temperature_2m_min: [15.1, 16.0, 14.8, 13.9, 13.0],
    weather_code: [3, 61, 0, 95, 71],
    sunrise: ['2026-07-17T06:05', '2026-07-18T06:06', '2026-07-19T06:07', '2026-07-20T06:08', '2026-07-21T06:09'],
    sunset: ['2026-07-17T20:30', '2026-07-18T20:29', '2026-07-19T20:28', '2026-07-20T20:27', '2026-07-21T20:26'],
  },
};

test('fetchWeather maps Open-Meteo into centidegrees + icon enum', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify(SAMPLE), { status: 200 })) as typeof fetch;
    const w = await fetchWeather(37.77, -122.42);

    assert.equal(w.current.temp, 2150); // 21.5°C -> centidegrees
    assert.equal(w.current.min, 1510);
    assert.equal(w.current.max, 2540);
    assert.equal(w.current.icon, WeatherIcon.broken); // wmo 3
    assert.equal(w.current.sunrise, 6 * 60 + 5); // 06:05 -> minutes
    assert.equal(w.current.sunset, 20 * 60 + 30);

    assert.equal(w.forecast.length, 5);
    assert.equal(w.forecast[1].max, 2610);
    assert.equal(w.forecast[1].icon, WeatherIcon.rain); // wmo 61
    assert.equal(w.forecast[3].icon, WeatherIcon.thunder); // wmo 95
    assert.equal(w.forecast[4].icon, WeatherIcon.snow); // wmo 71
  } finally {
    globalThis.fetch = orig;
  }
});

test('fetchWeather throws on a non-ok response', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await assert.rejects(fetchWeather(0, 0), /Weather service error \(500\)/);
  } finally {
    globalThis.fetch = orig;
  }
});
