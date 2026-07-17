// JS surface for the native notification-forwarder module (Android only). This
// module owns the NotificationListenerService + a foreground service that keeps
// forwarding-enabled watches connected over BLE and writes phone notifications
// to them (InfiniTime ANS). JS only pushes config and reads status — all the
// forwarding runs natively so it survives the RN app being swiped away.
//
// On web/desktop this file is shadowed by index.web.ts (no-op). The TS wrapper
// in src/notifications/forwarder.ts guards the requireNativeModule call so a
// build without the module linked (e.g. iOS) fails soft.

import { requireNativeModule, EventEmitter, type EventSubscription } from 'expo-modules-core';

export interface EnabledWatch {
  deviceId: string; // BLE MAC, or "host:port" for the InfiniSim bridge
  name: string;
}

export interface ForwarderConfig {
  enabledWatches: EnabledWatch[];
  allowedPackages: string[]; // apps whose notifications forward (empty = none)
  forwardCalls: boolean; // incoming calls ring the watch (own switch, not the allowlist)
}

export interface InstalledApp {
  packageName: string;
  label: string;
}

export type ConnState = 'IDLE' | 'CONNECTING' | 'READY' | 'BACKOFF';

export interface ConnectionStatus {
  deviceId: string;
  state: ConnState;
}

export interface ForwarderStatus {
  serviceRunning: boolean;
  connections: ConnectionStatus[];
}

const Native = requireNativeModule('NotificationForwarder');
const emitter = new EventEmitter(Native);

/** Push the desired forwarding config; starts/stops the native service. */
export function setConfig(config: ForwarderConfig): Promise<void> {
  return Native.setConfig(config);
}

export function getConfig(): Promise<ForwarderConfig> {
  return Native.getConfig();
}

/** Whether the user has granted this app Notification Access. */
export function isNotificationAccessGranted(): Promise<boolean> {
  return Native.isNotificationAccessGranted();
}

/** Opens the system Notification Access settings screen. */
export function openNotificationAccessSettings(): void {
  Native.openNotificationAccessSettings();
}

/** Launchable apps on the device, for the allowlist picker. */
export function getInstalledApps(): Promise<InstalledApp[]> {
  return Native.getInstalledApps();
}

export function getStatus(): Promise<ForwarderStatus> {
  return Native.getStatus();
}

/** Release a watch's forwarding link so a JS-driven BLE op (sync/DFU) can own it. */
export function pauseConnections(deviceId: string): Promise<void> {
  return Native.pauseConnections(deviceId);
}

export function resumeConnections(deviceId: string): Promise<void> {
  return Native.resumeConnections(deviceId);
}

export function onConnectionState(
  listener: (e: { deviceId: string; state: ConnState }) => void,
): EventSubscription {
  return emitter.addListener('onConnectionState', listener);
}

export function onCallEvent(
  listener: (e: { deviceId: string; event: number }) => void,
): EventSubscription {
  return emitter.addListener('onCallEvent', listener);
}

export default Native;
