// Global (not per-watch) notification-forwarding settings: which phone apps may
// forward, and whether incoming calls forward. The per-watch on/off lives on the
// Watch record (forwardNotifications). Persisted (non-secret) in AsyncStorage,
// same shape as findMySettings.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pinetime-companion/notification-settings/v1';

export interface NotificationSettings {
  /** Package names whose notifications forward. Empty = forward nothing. */
  allowedPackages: string[];
  /** Ring the watch on an incoming phone call. */
  forwardCalls: boolean;
}

const DEFAULTS: NotificationSettings = { allowedPackages: [], forwardCalls: true };

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
