// The transport seam. All sync logic runs against this interface; the dev
// build talks TCP to InfiniSim's GATT bridge, production talks BLE via
// react-native-ble-plx. Only bleTransport.ts cannot be exercised without a
// physical watch.

export const BRIDGE_CHAR = {
  scheduleSync: 0,
  scheduleDigest: 1,
  currentTime: 2,
  newAlert: 3,
  battery: 4,
  eventRead: 5,
} as const;

export type BridgeCharId = (typeof BRIDGE_CHAR)[keyof typeof BRIDGE_CHAR];

export interface WatchTransport {
  /** deviceId: BLE MAC for real watches; "host:port" for the sim bridge. */
  connect(deviceId: string): Promise<void>;
  /** Returns the negotiated MTU; sync aborts below 48. */
  requestMtu(mtu: number): Promise<number>;
  write(charId: BridgeCharId, data: Uint8Array): Promise<void>;
  read(charId: BridgeCharId): Promise<Uint8Array>;
  disconnect(): Promise<void>;
}

export class TransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransportError';
  }
}
