// App-facing wrapper over the native notification-forwarder module (Android).
// Shadowed by forwarder.web.ts on web/desktop. The native module is Android-only
// (platforms: ["android"]) and this file is never loaded on web, so no runtime
// guard is needed here.

import type { EventSubscription } from 'expo-modules-core';
import Native, { type ConnState, type ForwarderStatus, type InstalledApp, type NowPlaying } from '../../modules/notification-forwarder';
import { Watch } from '../model/types';
import { getNotificationSettings } from '../storage/notificationSettings';

export const forwarderAvailable = true;

export function isNotificationAccessGranted(): Promise<boolean> {
  return Native.isNotificationAccessGranted();
}

export function openNotificationAccessSettings(): void {
  Native.openNotificationAccessSettings();
}

export function getInstalledApps(): Promise<InstalledApp[]> {
  return Native.getInstalledApps();
}

export function getStatus(): Promise<ForwarderStatus> {
  return Native.getStatus();
}

/** Release a watch's forwarding link so a JS-driven BLE op (sync/DFU) owns it. */
export function pauseConnections(deviceId: string): Promise<void> {
  return Native.pauseConnections(deviceId);
}

export function resumeConnections(deviceId: string): Promise<void> {
  return Native.resumeConnections(deviceId);
}

export function onConnectionState(cb: (e: { deviceId: string; state: ConnState }) => void): EventSubscription {
  return Native.addListener('onConnectionState', cb);
}

export function onNowPlaying(cb: (e: { nowPlaying: NowPlaying | null }) => void): EventSubscription {
  return Native.addListener('onNowPlaying', cb);
}

/**
 * Push the current desired forwarding config to the native service: the set of
 * watches with per-watch forwarding on (and a deviceId), plus the global app
 * allowlist and calls switch. Called whenever watches or the settings change.
 */
export async function syncForwarderConfig(watches: Watch[]): Promise<void> {
  const settings = await getNotificationSettings();
  const enabledWatches = watches
    .filter((w) => w.forwardNotifications && w.deviceId)
    .map((w) => ({ deviceId: w.deviceId as string, name: w.name }));
  await Native.setConfig({
    enabledWatches,
    allowedPackages: settings.allowedPackages,
    forwardCalls: settings.forwardCalls,
  });
}
