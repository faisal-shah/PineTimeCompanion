// User-overridable Find My settings: the map tile style URL and the anisette
// server list. Persisted (non-secret) in AsyncStorage. Defaults: OpenFreeMap
// (no signup/key) and the bundled SideStore anisette list.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pinetime-companion/findmy-settings/v1';

export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface FindMySettings {
  /** MapLibre style JSON URL for tiles. */
  mapStyleUrl: string;
  /** Extra anisette server URLs (https), tried before the bundled defaults. Empty = defaults only. */
  anisetteServers: string[];
}

const DEFAULTS: FindMySettings = { mapStyleUrl: DEFAULT_MAP_STYLE_URL, anisetteServers: [] };

export async function getFindMySettings(): Promise<FindMySettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FindMySettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export async function saveFindMySettings(settings: FindMySettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
