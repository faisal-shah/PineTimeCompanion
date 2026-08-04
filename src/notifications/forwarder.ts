// App-facing wrapper over the native notification-forwarder module (Android).
// Shadowed by forwarder.web.ts on web/desktop. The native module is Android-only
// (platforms: ["android"]) and this file is never loaded on web, so no runtime
// guard is needed here.

import type { EventSubscription } from 'expo-modules-core';
import Native, { type BondState, type ConnState, type ForwarderStatus, type InstalledApp, type NowPlaying } from '../../modules/notification-forwarder';
import { Watch } from '../model/types';
import { getNotificationSettings } from '../storage/notificationSettings';

export const forwarderAvailable = true;

// Forwarding ownership (which watch a running op currently holds) lives on the
// app-wide coordinator; re-export it here as the single import point for a
// later forwarding-status UI. The native ForwarderStatus.pausedDeviceIds is the
// service-side view of the same fact.
export {
  forwardingOwnership,
  subscribeForwardingOwnership,
  type ForwardingHold,
} from '../ble/connectionCoordinator';

export function isNotificationAccessGranted(): Promise<boolean> {
  return Native.isNotificationAccessGranted();
}

export function openNotificationAccessSettings(): void {
  Native.openNotificationAccessSettings();
}

/** App info, where Android 13+ hides "Allow restricted settings". */
export function openAppInfoSettings(): void {
  Native.openAppInfoSettings();
}

/** System Bluetooth settings — where the user forgets a watch during repair. */
export function openBluetoothSettings(): void {
  Native.openBluetoothSettings();
}

/** The OS bond state for a device (repair diagnostics). */
export function getBondState(deviceId: string): Promise<BondState> {
  return Native.getBondState(deviceId);
}

/** Ask Android to (re)create a bond via the public pairing dialog. Never removes one. */
export function createBond(deviceId: string): Promise<boolean> {
  return Native.createBond(deviceId);
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
