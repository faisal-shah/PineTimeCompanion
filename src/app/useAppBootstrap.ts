// Shared app bootstrap for App.tsx (native, all screens) and App.web.tsx
// (web/desktop, watch-management subset): watch-list state, secret migration,
// persistence, and the navigation theme. Keeping this in one place means the
// two App roots differ only in which routes they register.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DarkTheme } from '@react-navigation/native';
import { loadWatches, saveWatches, WatchStore } from '../storage/store';
import { migrateSecrets } from '../secure/secrets';
import { Watch } from '../model/types';
import { colors } from '../ui/theme';

export const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.card, primary: colors.accent, text: colors.text },
};

export const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.text,
  contentStyle: { backgroundColor: colors.background },
} as const;

export function useAppBootstrap(): { loaded: boolean; store: WatchStore } {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadWatches().then(async (w) => {
      // Move any beacon private key still embedded in the persisted blob into
      // the OS keystore, then persist the blanked records (the save effect below
      // fires because `loaded` flips true with the migrated list in state).
      const migrated = await migrateSecrets(w);
      if (migrated.length) {
        const byId = new Map(migrated.map((m) => [m.id, m]));
        w = w.map((x) => byId.get(x.id) ?? x);
      }
      setWatches(w);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) {
      saveWatches(watches).catch(() => undefined);
    }
  }, [watches, loaded]);

  const upsertWatch = useCallback((watch: Watch) => {
    setWatches((prev) => {
      const i = prev.findIndex((w) => w.id === watch.id);
      if (i < 0) {
        return [...prev, watch];
      }
      const next = [...prev];
      next[i] = watch;
      return next;
    });
  }, []);

  const removeWatch = useCallback((id: string) => {
    setWatches((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const store: WatchStore = useMemo(() => ({ watches, upsertWatch, removeWatch }), [watches, upsertWatch, removeWatch]);

  return { loaded, store };
}
