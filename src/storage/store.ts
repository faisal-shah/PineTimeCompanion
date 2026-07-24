// App state: a list of watches, persisted as one JSON blob in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';
import { Watch } from '../model/types';
import { emptyList } from '../model/listSync';

const STORAGE_KEY = 'pinetime-companion/watches/v1';

export async function loadWatches(): Promise<Watch[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Watch[]) : [];
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
