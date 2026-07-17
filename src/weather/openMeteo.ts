// Fetch current conditions + a 5-day forecast from Open-Meteo (free, no API key,
// HTTPS — matches the app's no-signup ethos). Maps the response into the
// watch-wire shapes from weatherProtocol.ts (centidegrees Celsius + icon enum).

import { CurrentWeather, ForecastDay, wmoToIcon } from '../ble/weatherProtocol';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    sunrise: string[];
    sunset: string[];
  };
}

export interface WeatherData {
  current: CurrentWeather;
  forecast: ForecastDay[]; // day 0 = today, then the next days
}

const centi = (c: number) => Math.round(c * 100);

/** "2026-07-17T06:12" -> minutes into the day, or -1 if unparseable. */
function minutesIntoDay(iso: string | undefined): number {
  const m = iso && /T(\d\d):(\d\d)/.exec(iso);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset',
    forecast_days: '5',
    timezone: 'auto',
  });
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) {
    throw new Error(`Weather service error (${res.status})`);
  }
  const j = (await res.json()) as OpenMeteoResponse;
  const d = j.daily;

  const current: CurrentWeather = {
    timestamp: Math.floor(Date.now() / 1000),
    temp: centi(j.current.temperature_2m),
    min: centi(d.temperature_2m_min[0]),
    max: centi(d.temperature_2m_max[0]),
    icon: wmoToIcon(j.current.weather_code),
    sunrise: minutesIntoDay(d.sunrise?.[0]),
    sunset: minutesIntoDay(d.sunset?.[0]),
  };

  const forecast: ForecastDay[] = d.time.map((_, i) => ({
    min: centi(d.temperature_2m_min[i]),
    max: centi(d.temperature_2m_max[i]),
    icon: wmoToIcon(d.weather_code[i]),
  }));

  return { current, forecast };
}
