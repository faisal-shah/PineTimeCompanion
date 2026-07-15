// Web variant of the transport factory. Same selection rule as the native
// factory, different transports: "host:port" reaches the InfiniSim bridge via
// the ws-tcp proxy (browsers cannot open raw TCP); anything else is a Web
// Bluetooth device id (an opaque token from requestDevice — its alphabet has
// no ':', so it can never collide with the host:port pattern). This file must
// never import react-native-ble-plx or react-native-tcp-socket: it is what
// keeps them out of the web bundle.

import { WsTransport } from './wsTransport';
import { TransportError, WatchTransport } from './transport';

// The ws-tcp proxy (scripts/ws-tcp-proxy.mjs) listens here and forwards to the
// sim bridge on 18632.
export const SIMULATOR_DEVICE_ID = 'localhost:18633';

export function isSimulatorDeviceId(deviceId: string | undefined): boolean {
  // "host:port" (2 segments) = sim bridge; a BLE MAC has 6 colon-separated octets.
  return !!deviceId && deviceId.split(':').length === 2;
}

export function makeTransport(deviceId: string): WatchTransport {
  if (isSimulatorDeviceId(deviceId)) {
    return new WsTransport();
  }
  // Real watches over Web Bluetooth arrive with webBluetoothTransport.ts.
  throw new TransportError('Real-watch Bluetooth on web is not wired up yet — pair the simulator.');
}
