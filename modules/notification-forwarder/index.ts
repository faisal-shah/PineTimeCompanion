// JS surface for the native notification-forwarder module (Android only). This
// module owns the NotificationListenerService + a foreground service that keeps
// forwarding-enabled watches connected over BLE and writes phone notifications
// to them (InfiniTime ANS). JS only pushes config and reads status — all the
// forwarding runs natively so it survives the RN app being swiped away.
//
// On web/desktop this file is shadowed by index.web.ts (no-op). On a native
// build where the module somehow isn't linked, requireNativeModule throws; the
// TS wrapper in src/notifications/forwarder.ts guards that.

import { requireNativeModule } from 'expo-modules-core';

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

export interface ConnectionStatus {
  deviceId: string;
  state: 'IDLE' | 'CONNECTING' | 'READY' | 'BACKOFF';
}

export interface ForwarderStatus {
  serviceRunning: boolean;
  connections: ConnectionStatus[];
}

const Native = requireNativeModule('NotificationForwarder');

/** Phase-1 liveness check — proves the native module is linked. */
export function ping(): string {
  return Native.ping();
}

export default Native;
