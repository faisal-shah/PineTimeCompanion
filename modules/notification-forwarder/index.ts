// JS surface for the native notification-forwarder module (Android only). This
// module owns the NotificationListenerService + a foreground service that keeps
// forwarding-enabled watches connected over BLE and writes phone notifications
// to them (InfiniTime ANS). JS only pushes config and reads status — all the
// forwarding runs natively so it survives the RN app being swiped away.
//
// App code imports the typed default export through src/notifications/forwarder.ts
// (which is shadowed by a no-op on web).

import { NativeModule, requireNativeModule } from 'expo-modules-core';

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

/** OS bond state for a device, mirroring the native BondState enum. */
export type BondState = 'NONE' | 'BONDING' | 'BONDED' | 'UNKNOWN';

export interface ConnectionStatus {
  deviceId: string;
  state: ConnState;
}

export interface NowPlaying {
  artist: string;
  track: string;
  playing: boolean;
}

export interface ForwarderStatus {
  serviceRunning: boolean;
  connections: ConnectionStatus[];
  /** Watches whose forwarding link is currently held (paused) by a JS-driven
   *  op (sync/OTA). Empty when nothing owns a link. Consumed by the forwarding
   *  ownership/status UI. */
  pausedDeviceIds: string[];
  /** Current phone media session state, when music bridging is active. */
  nowPlaying?: NowPlaying | null;
}

export type ForwarderEvents = {
  onConnectionState: (event: { deviceId: string; state: ConnState }) => void;
  onCallEvent: (event: { deviceId: string; event: number }) => void;
  onNowPlaying: (event: { nowPlaying: NowPlaying | null }) => void;
};

declare class NotificationForwarderModule extends NativeModule<ForwarderEvents> {
  ping(): string;
  setConfig(config: ForwarderConfig): Promise<void>;
  getConfig(): Promise<ForwarderConfig>;
  isNotificationAccessGranted(): Promise<boolean>;
  openNotificationAccessSettings(): void;
  openAppInfoSettings(): void;
  openBluetoothSettings(): void;
  getBondState(deviceId: string): Promise<BondState>;
  createBond(deviceId: string): Promise<boolean>;
  is24HourFormat(): boolean;
  getInstalledApps(): Promise<InstalledApp[]>;
  getStatus(): Promise<ForwarderStatus>;
  pauseConnections(deviceId: string): Promise<void>;
  resumeConnections(deviceId: string): Promise<void>;
}

export default requireNativeModule<NotificationForwarderModule>('NotificationForwarder');
