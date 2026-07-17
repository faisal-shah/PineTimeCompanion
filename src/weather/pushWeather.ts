// Resolve a location and push fresh weather to a watch. Location comes from the
// watch's prayer coordinates when set (most accurate for where the watch is),
// else the phone's GPS. Best-effort: callers on the sync path swallow failures.

import * as Location from 'expo-location';
import { Watch } from '../model/types';
import { makeTransport } from '../ble/transportFactory';
import { writeWeather } from '../ble/syncManager';
import { fetchWeather, WeatherData } from './openMeteo';

export async function resolveWeatherLocation(watch: Watch): Promise<{ lat: number; lon: number }> {
  const ps = watch.prayerSettings;
  if (ps && (ps.latE2 !== 0 || ps.lonE2 !== 0)) {
    return { lat: ps.latE2 / 100, lon: ps.lonE2 / 100 };
  }
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location access is needed to fetch weather (or set a location in Prayer times).');
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}

/** Fetch current weather + forecast for the watch's location and push it. */
export async function pushWeather(watch: Watch): Promise<WeatherData> {
  if (!watch.deviceId) {
    throw new Error('Pair this watch first.');
  }
  const { lat, lon } = await resolveWeatherLocation(watch);
  const data = await fetchWeather(lat, lon);
  await writeWeather(makeTransport(watch.deviceId), watch.deviceId, data.current, data.forecast);
  return data;
}
