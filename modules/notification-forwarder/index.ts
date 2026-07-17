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

export interface ConnectionStatus {
  deviceId: string;
  state: ConnState;
}

export interface ForwarderStatus {
  serviceRunning: boolean;
  connections: ConnectionStatus[];
}

export type ForwarderEvents = {
  onConnectionState: (event: { deviceId: string; state: ConnState }) => void;
  onCallEvent: (event: { deviceId: string; event: number }) => void;
};

declare class NotificationForwarderModule extends NativeModule<ForwarderEvents> {
  ping(): string;
  setConfig(config: ForwarderConfig): Promise<void>;
  getConfig(): Promise<ForwarderConfig>;
  isNotificationAccessGranted(): Promise<boolean>;
  openNotificationAccessSettings(): void;
  getInstalledApps(): Promise<InstalledApp[]>;
  getStatus(): Promise<ForwarderStatus>;
  pauseConnections(deviceId: string): Promise<void>;
  resumeConnections(deviceId: string): Promise<void>;
}

export default requireNativeModule<NotificationForwarderModule>('NotificationForwarder');
