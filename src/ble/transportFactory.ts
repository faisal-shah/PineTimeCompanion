// Selects the transport per watch: device ids of the form "host:port" mean
// the InfiniSim TCP bridge (development); anything else is a real BLE MAC.
// The Android emulator reaches the host machine at 10.0.2.2.

import { BleManager } from 'react-native-ble-plx';
import { TcpTransport } from './tcpTransport';
import { BleTransport } from './bleTransport';
import { WatchTransport } from './transport';

export const SIMULATOR_DEVICE_ID = '10.0.2.2:18632';

let bleManager: BleManager | undefined;

export function isSimulatorDeviceId(deviceId: string | undefined): boolean {
  // "host:port" (2 segments) = sim bridge; a BLE MAC has 6 colon-separated octets.
  return !!deviceId && deviceId.split(':').length === 2;
}

export function makeTransport(deviceId: string): WatchTransport {
  if (isSimulatorDeviceId(deviceId)) {
    return new TcpTransport();
  }
  bleManager ??= new BleManager();
  return new BleTransport(bleManager);
}
