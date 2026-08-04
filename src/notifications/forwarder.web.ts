// Web/desktop no-op for the notification-forwarder wrapper. Notification
// forwarding is Android-only (native NotificationListenerService + a persistent
// BLE foreground service), so on web the whole API is inert and the UI shows an
// "Android only" note.

import type { EventSubscription } from 'expo-modules-core';
import type { BondState, ForwarderStatus, InstalledApp, ConnState, NowPlaying } from '../../modules/notification-forwarder';
import { Watch } from '../model/types';

export const forwarderAvailable = false;

// Same forwarding-ownership accessors as the native wrapper. The coordinator is
// pure TS, so it tracks JS-driven ops on web too (its gate is a no-op there).
export {
  forwardingOwnership,
  subscribeForwardingOwnership,
  type ForwardingHold,
} from '../ble/connectionCoordinator';

export function isNotificationAccessGranted(): Promise<boolean> {
  return Promise.resolve(false);
}

export function openNotificationAccessSettings(): void {}

export function openAppInfoSettings(): void {}

// No Android bond APIs on web/desktop: the repair UI shows platform-specific
// computer instructions (system Bluetooth settings / chooser, registry clear)
// instead of driving the OS. These stay inert so shared code can call them.
export function openBluetoothSettings(): void {}

export function getBondState(_deviceId: string): Promise<BondState> {
  return Promise.resolve('UNKNOWN');
}

export function createBond(_deviceId: string): Promise<boolean> {
  return Promise.resolve(false);
}

export function getInstalledApps(): Promise<InstalledApp[]> {
  return Promise.resolve([]);
}

export function getStatus(): Promise<ForwarderStatus> {
  return Promise.resolve({ serviceRunning: false, connections: [], pausedDeviceIds: [] });
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

export function onNowPlaying(_cb: (e: { nowPlaying: NowPlaying | null }) => void): EventSubscription {
  return { remove() {} };
}

export async function syncForwarderConfig(_watches: Watch[]): Promise<void> {}
