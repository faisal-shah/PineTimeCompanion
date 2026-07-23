// App state: a list of watches, persisted as one JSON blob in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';
import { Watch, WatchEvent, WatchTask } from '../model/types';

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
    scheduleVersion: 1,
    events: [],
    tasks: [],
    taskVersion: 1,
  };
}

/** Random 16-bit ids so events created on different phones never collide. */
export function newEventId(watch: Watch): number {
  for (;;) {
    const id = 1 + Math.floor(Math.random() * 0xfffe);
    if (!watch.events.some((e) => e.id === id)) {
      return id;
    }
  }
}

/** Any schedule edit bumps the version so the watch digest goes stale. */
export function withEvents(watch: Watch, events: WatchEvent[]): Watch {
  return { ...watch, events, scheduleVersion: watch.scheduleVersion + 1 };
}

/** Random 16-bit ids so tasks created on different phones never collide. */
export function newTaskId(watch: Watch): number {
  const tasks = watch.tasks ?? [];
  for (;;) {
    const id = 1 + Math.floor(Math.random() * 0xfffe);
    if (!tasks.some((t) => t.id === id)) {
      return id;
    }
  }
}

/** Any task edit bumps the task version so the watch digest goes stale. */
export function withTasks(watch: Watch, tasks: WatchTask[]): Watch {
  return { ...watch, tasks, taskVersion: (watch.taskVersion ?? 1) + 1 };
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
