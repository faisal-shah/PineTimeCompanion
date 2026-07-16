// Production transport: real BLE via react-native-ble-plx. Deliberately thin —
// UUID mapping, base64 conversion and MTU negotiation only, zero protocol
// logic — because this is the one file that cannot run without a physical
// watch. Everything above the WatchTransport seam is emulator-tested.

import { BleManager, Device } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { BridgeCharId, TransportError, WatchTransport } from './transport';
import { CHAR_MAP } from './gattUuids';

export class BleTransport implements WatchTransport {
  private device?: Device;

  constructor(private readonly manager: BleManager) {}

  async connect(deviceId: string): Promise<void> {
    try {
      const device = await this.manager.connectToDevice(deviceId, { timeout: 15000 });
      this.device = await device.discoverAllServicesAndCharacteristics();
    } catch (e) {
      throw new TransportError(`BLE connect failed: ${(e as Error).message}`, e);
    }
  }

  async requestMtu(mtu: number): Promise<number> {
    if (!this.device) {
      throw new TransportError('not connected');
    }
    const device = await this.device.requestMTU(mtu);
    return device.mtu;
  }

  async write(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    if (!this.device) {
      throw new TransportError('not connected');
    }
    const { service, characteristic } = CHAR_MAP[charId];
    const base64 = Buffer.from(data).toString('base64');
    await this.device.writeCharacteristicWithResponseForService(service, characteristic, base64);
  }

  async writeWithoutResponse(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    if (!this.device) {
      throw new TransportError('not connected');
    }
    const { service, characteristic } = CHAR_MAP[charId];
    const base64 = Buffer.from(data).toString('base64');
    await this.device.writeCharacteristicWithoutResponseForService(service, characteristic, base64);
  }

  async read(charId: BridgeCharId): Promise<Uint8Array> {
    if (!this.device) {
      throw new TransportError('not connected');
    }
    const { service, characteristic } = CHAR_MAP[charId];
    const result = await this.device.readCharacteristicForService(service, characteristic);
    return new Uint8Array(Buffer.from(result.value ?? '', 'base64'));
  }

  async subscribe(charId: BridgeCharId, cb: (data: Uint8Array) => void): Promise<() => void> {
    if (!this.device) {
      throw new TransportError('not connected');
    }
    const { service, characteristic } = CHAR_MAP[charId];
    const sub = this.device.monitorCharacteristicForService(service, characteristic, (error, ch) => {
      if (error || !ch?.value) {
        return;
      }
      cb(new Uint8Array(Buffer.from(ch.value, 'base64')));
    });
    return () => sub.remove();
  }

  async disconnect(): Promise<void> {
    await this.device?.cancelConnection().catch(() => undefined);
    this.device = undefined;
  }
}
