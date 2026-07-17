// Per-watch daily step history. The watch keeps only today+yesterday in RAM, so
// the phone is the durable record. Each read gives today's running total; we keep
// the max seen per date (the day's final total). Persisted in AsyncStorage,
// mirroring locationStore.ts.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pinetime-companion/steps/v1';
const MAX_DAYS = 60;

export interface StepSample {
  date: string; // 'YYYY-MM-DD' (local)
  steps: number;
}

type StepMap = Record<string, StepSample[]>;

/** Local calendar date key for a Date (defaults to now). */
export function dateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Fold a (date, steps) reading into the history: keep the max steps per date,
 * sort ascending, cap to MAX_DAYS. Pure — unit-tested without storage.
 */
export function mergeSamples(existing: StepSample[], date: string, steps: number): StepSample[] {
  const byDate = new Map(existing.map((s) => [s.date, s.steps]));
  byDate.set(date, Math.max(byDate.get(date) ?? 0, steps));
  return Array.from(byDate, ([d, s]) => ({ date: d, steps: s }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);
}

async function readAll(): Promise<StepMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StepMap) : {};
  } catch {
    return {};
  }
}

export async function getSteps(watchId: string): Promise<StepSample[]> {
  return (await readAll())[watchId] ?? [];
}

/** Record a step reading for a date; returns the merged history. */
export async function appendSteps(watchId: string, date: string, steps: number): Promise<StepSample[]> {
  const all = await readAll();
  const merged = mergeSamples(all[watchId] ?? [], date, steps);
  all[watchId] = merged;
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  return merged;
}
