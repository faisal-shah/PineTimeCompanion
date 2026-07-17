// Where the app looks for firmware + resources releases. A GitHub "owner/repo"
// slug, configurable so a user can point at their own InfiniTime fork or a
// downstream build. Persisted (non-secret) in AsyncStorage, like findMySettings.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pinetime-companion/update-settings/v1';

export const DEFAULT_UPDATE_REPO = 'faisal-shah/InfiniTime';

export interface UpdateSettings {
  /** GitHub "owner/repo" whose releases carry the DFU + resources zips. */
  repo: string;
}

const DEFAULTS: UpdateSettings = { repo: DEFAULT_UPDATE_REPO };

// "owner/repo" — each side a GitHub-legal name (alphanumerics, -, _, .).
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidRepo(repo: string): boolean {
  return REPO_RE.test(repo.trim());
}

export async function getUpdateSettings(): Promise<UpdateSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const merged = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UpdateSettings>) } : DEFAULTS;
    return isValidRepo(merged.repo) ? merged : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export async function saveUpdateSettings(settings: UpdateSettings): Promise<void> {
  const repo = settings.repo.trim();
  if (!isValidRepo(repo)) {
    throw new Error('Repository must be in "owner/repo" form.');
  }
  await AsyncStorage.setItem(KEY, JSON.stringify({ repo }));
}
