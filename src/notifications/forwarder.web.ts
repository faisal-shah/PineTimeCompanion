// Web/desktop no-op for the notification-forwarder wrapper. Notification
// forwarding is Android-only (native NotificationListenerService + a persistent
// BLE foreground service), so on web the whole API is inert and the UI shows an
// "Android only" note.

import type { EventSubscription } from 'expo-modules-core';
import type { ForwarderStatus, InstalledApp, ConnState } from '../../modules/notification-forwarder';
import { Watch } from '../model/types';

export const forwarderAvailable = false;

export function isNotificationAccessGranted(): Promise<boolean> {
  return Promise.resolve(false);
}

export function openNotificationAccessSettings(): void {}

export function getInstalledApps(): Promise<InstalledApp[]> {
  return Promise.resolve([]);
}

export function getStatus(): Promise<ForwarderStatus> {
  return Promise.resolve({ serviceRunning: false, connections: [] });
}

export function pauseConnections(_deviceId: string): Promise<void> {
  return Promise.resolve();
}

export function resumeConnections(_deviceId: string): Promise<void> {
  return Promise.resolve();
}

export function onConnectionState(_cb: (e: { deviceId: string; state: ConnState }) => void): EventSubscription {
  return { remove() {} };
}

export async function syncForwarderConfig(_watches: Watch[]): Promise<void> {}
