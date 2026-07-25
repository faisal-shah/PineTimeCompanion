// App state: a list of watches, persisted as one JSON blob in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';
import { Watch } from '../model/types';
import { SyncedList, emptyList } from '../model/listSync';

const STORAGE_KEY = 'pinetime-companion/watches/v1';

/** A stored record is usable only if it has the shape the current code reads.
 *  This is deliberately NOT a migration — the app is pre-1.0 and formats change
 *  freely — but the store parses JSON off disk, so it must never hand the UI a
 *  record it can't render. Anything unrecognisable is dropped, which resets that
 *  watch rather than white-screening the app. */
function isUsable(w: unknown): w is Watch {
  const c = w as Partial<Watch> | null;
  const list = (l: unknown) => typeof l === 'object' && l !== null && Array.isArray((l as SyncedList<never>).items);
  return typeof c === 'object' && c !== null && typeof c.id === 'string' && typeof c.name === 'string' && list(c.schedule) && list(c.tasks);
}

/** Pure half of loadWatches, so the shape guard is unit-testable. */
export function parseWatches(raw: string | null): Watch[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isUsable) : [];
  } catch {
    return [];
  }
}

export async function loadWatches(): Promise<Watch[]> {
  try {
    return parseWatches(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export async function saveWatches(watches: Watch[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(watches));
}

export function newWatch(name: string): Watch {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    schedule: emptyList(),
    tasks: emptyList(),
  };
}

export interface WatchStore {
  watches: Watch[];
  upsertWatch(watch: Watch): void;
  removeWatch(id: string): void;
}

export const WatchStoreContext = createContext<WatchStore>({
  watches: [],
  upsertWatch: () => undefined,
  removeWatch: () => undefined,
});

export const useWatchStore = () => useContext(WatchStoreContext);
