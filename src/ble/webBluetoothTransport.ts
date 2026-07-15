// Web Bluetooth transport for real watches from browsers/Electron. Structural
// mirror of bleTransport.ts (the hardware-trusted reference): UUID mapping,
// byte conversion and connection lifecycle only, zero protocol logic. Two
// web-specific wrinkles: GATT operations must not overlap (Web Bluetooth
// throws instead of queueing like ble-plx), so everything runs through a
// promise-chain mutex; and there is no MTU API — writeValueWithResponse does
// GATT long writes up to 512 bytes, so requestMtu reports 512. Long-write
// behavior against InfiniTime's NimBLE stack is unverified until real
// hardware exists (syncManager aborts cleanly below 48 if this ever lies).

import { BridgeCharId, TransportError, WatchTransport } from './transport';
import { ALL_SERVICE_UUIDS, CHAR_MAP, WATCH_NAME_PREFIXES } from './gattUuids';
import { getRegisteredDevice, registerDevice } from './webDeviceRegistry';

declare global {
  interface Window {
    desktopBluetooth?: {
      setAutoSelect(target: { id: string; name?: string }): void;
    };
  }
}

export class WebBluetoothTransport implements WatchTransport {
  private device?: BluetoothDevice;
  private server?: BluetoothRemoteGATTServer;
  private chars = new Map<BridgeCharId, BluetoothRemoteGATTCharacteristic>();
  private queue: Promise<unknown> = Promise.resolve();

  // Serialize GATT operations: Web Bluetooth throws "operation already in
  // progress" on concurrent calls (ble-plx queues internally; we must here).
  private locked<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async connect(deviceId: string): Promise<void> {
    if (!navigator.bluetooth) {
      throw new TransportError('This browser has no Web Bluetooth (use Chrome or Edge, or the desktop app).');
    }
    let device = getRegisteredDevice(deviceId);
    if (!device) {
      // Permission may survive from an earlier session (Electron; Chrome only
      // behind a flag) — getDevices() is best-effort.
      try {
        const granted = await navigator.bluetooth.getDevices?.();
        device = granted?.find((d) => d.id === deviceId);
      } catch {
        // Not available — fall through to the chooser.
      }
    }
    if (!device) {
      // In the Electron shell, arm the main process to auto-answer the chooser
      // with the remembered device so reconnects are seamless. In plain Chrome
      // this shows the picker once per session (the tap that triggered this
      // connect supplies the required user gesture).
      window.desktopBluetooth?.setAutoSelect({ id: deviceId });
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: WATCH_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          optionalServices: ALL_SERVICE_UUIDS,
        });
      } catch (e) {
        throw new TransportError(`Bluetooth device selection failed: ${(e as Error).message}`, e);
      }
    }
    registerDevice(device);
    if (device.id !== deviceId) {
      throw new TransportError(
        `Selected a different watch than the one paired with this entry (re-pair from the watch screen if you meant to switch).`,
      );
    }
    try {
      this.server = await device.gatt!.connect();
    } catch (e) {
      throw new TransportError(`BLE connect failed: ${(e as Error).message}`, e);
    }
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
  }

  private onDisconnected = (): void => {
    this.server = undefined;
    this.chars.clear();
  };

  async requestMtu(_mtu: number): Promise<number> {
    if (!this.server) {
      throw new TransportError('not connected');
    }
    return 512; // No MTU API on Web Bluetooth; long writes cover up to 512.
  }

  private async char(charId: BridgeCharId): Promise<BluetoothRemoteGATTCharacteristic> {
    if (!this.server?.connected) {
      throw new TransportError('disconnected');
    }
    let c = this.chars.get(charId);
    if (!c) {
      const { service, characteristic } = CHAR_MAP[charId];
      const svc = await this.server.getPrimaryService(service);
      c = await svc.getCharacteristic(characteristic);
      this.chars.set(charId, c);
    }
    return c;
  }

  write(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    return this.locked(async () => {
      const c = await this.char(charId);
      try {
        await c.writeValueWithResponse(data as BufferSource);
      } catch (e) {
        throw new TransportError(`write to char ${charId} failed: ${(e as Error).message}`, e);
      }
    });
  }

  read(charId: BridgeCharId): Promise<Uint8Array> {
    return this.locked(async () => {
      const c = await this.char(charId);
      try {
        const view = await c.readValue();
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      } catch (e) {
        throw new TransportError(`read of char ${charId} failed: ${(e as Error).message}`, e);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.device?.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.server?.disconnect();
    this.onDisconnected();
    this.device = undefined;
  }
}
