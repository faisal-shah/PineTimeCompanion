// Production transport: real BLE via react-native-ble-plx. Deliberately thin —
// UUID mapping, base64 conversion and MTU negotiation only, zero protocol
// logic — because this is the one file that cannot run without a physical
// watch. Everything above the WatchTransport seam is emulator-tested.

import { BleManager, Device } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { BridgeCharId, BRIDGE_CHAR, TransportError, WatchTransport } from './transport';
import { SCHEDULE_SERVICE_UUID, SYNC_COMMAND_CHAR_UUID, DIGEST_CHAR_UUID } from './scheduleProtocol';

// Standard GATT services the companion basics use.
const CTS_SERVICE = '00001805-0000-1000-8000-00805f9b34fb';
const CTS_CURRENT_TIME = '00002a2b-0000-1000-8000-00805f9b34fb';
const ANS_SERVICE = '00001811-0000-1000-8000-00805f9b34fb';
const ANS_NEW_ALERT = '00002a46-0000-1000-8000-00805f9b34fb';
const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';

const CHAR_MAP: Record<BridgeCharId, { service: string; characteristic: string; withResponse: boolean }> = {
  [BRIDGE_CHAR.scheduleSync]: { service: SCHEDULE_SERVICE_UUID, characteristic: SYNC_COMMAND_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.scheduleDigest]: { service: SCHEDULE_SERVICE_UUID, characteristic: DIGEST_CHAR_UUID, withResponse: true },
  [BRIDGE_CHAR.currentTime]: { service: CTS_SERVICE, characteristic: CTS_CURRENT_TIME, withResponse: true },
  [BRIDGE_CHAR.newAlert]: { service: ANS_SERVICE, characteristic: ANS_NEW_ALERT, withResponse: true },
  [BRIDGE_CHAR.battery]: { service: BATTERY_SERVICE, characteristic: BATTERY_LEVEL, withResponse: true },
};

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

  async read(charId: BridgeCharId): Promise<Uint8Array> {
    if (!this.device) {
      throw new TransportError('not connected');
    }
    const { service, characteristic } = CHAR_MAP[charId];
    const result = await this.device.readCharacteristicForService(service, characteristic);
    return new Uint8Array(Buffer.from(result.value ?? '', 'base64'));
  }

  async disconnect(): Promise<void> {
    await this.device?.cancelConnection().catch(() => undefined);
    this.device = undefined;
  }
}
