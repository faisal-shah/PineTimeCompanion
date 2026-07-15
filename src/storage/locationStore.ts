// Persisted per-watch location history. Decrypted fixes are not secret, so they
// live in AsyncStorage (separate blob from the watch list). Keeping history means
// the map shows the last-known point immediately, before a fresh fetch returns.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationFix } from '../findmy/decrypt';

const STORAGE_KEY = 'pinetime-companion/locations/v1';
const MAX_FIXES = 500;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type LocationMap = Record<string, LocationFix[]>;

/**
 * Merge new fixes into existing ones: dedupe on (timestamp, lat, lon), sort
 * ascending by timestamp, drop anything older than 30 days, and cap the count.
 * Pure — unit-tested without storage.
 */
export function mergeFixes(existing: LocationFix[], incoming: LocationFix[], now = Date.now()): LocationFix[] {
  const byKey = new Map<string, LocationFix>();
  for (const f of [...existing, ...incoming]) {
    byKey.set(`${f.timestamp}:${f.lat}:${f.lon}`, f);
  }
  const cutoff = now / 1000 - MAX_AGE_MS / 1000;
  return Array.from(byKey.values())
    .filter((f) => f.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_FIXES);
}

async function readAll(): Promise<LocationMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocationMap) : {};
  } catch {
    return {};
  }
}

export async function getFixes(watchId: string): Promise<LocationFix[]> {
  const all = await readAll();
  return all[watchId] ?? [];
}

/** Merge fixes into a watch's history and persist; returns the merged list. */
export async function appendFixes(watchId: string, incoming: LocationFix[]): Promise<LocationFix[]> {
  const all = await readAll();
  const merged = mergeFixes(all[watchId] ?? [], incoming);
  all[watchId] = merged;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return merged;
}
