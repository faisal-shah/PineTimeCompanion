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
  prayerSettings: 6,
  beaconKey: 7,
  beaconControl: 8,
  multiAlarm: 9,
  // OTA update surface (Phase 1+). DFU uses the Nordic-legacy service 0x1530;
  // fsTransfer is the Adafruit BLE filesystem (0xFEBB); firmwareRevision is the
  // standard Device Information Service firmware string (0x2A26).
  dfuControl: 10, // 0x1531 write + notify
  dfuPacket: 11, // 0x1532 write-without-response
  fsTransfer: 12, // adaf0200 write + notify
  firmwareRevision: 13, // 0x2A26 read
  weather: 14, // 00050001 write (SimpleWeatherService: current + forecast)
  steps: 15, // 00030001 read (MotionService: today's cumulative step count)
  stepsYesterday: 16, // 00030003 read (MotionService: yesterday's total)
  // 17..29 are MusicService/call-event chars, addressed only from the native
  // Kotlin module (WatchChar) and Node e2e scripts, so they're not in this map.
  tasksSync: 30, // 00070001 write (TaskService: begin/record/commit/abort/setStreak)
  tasksDigest: 31, // 00070002 read (protoVer, capacity, count, version, streak)
  taskRead: 32, // 00070003 write index -> read one task record
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

  // Streaming surface for DFU / filesystem (Phase 1+). Not every transport
  // supports these — the sim tcp/ws transports do (for headless testing), and
  // the native ble-plx transport does; plain Web Bluetooth to a real watch
  // cannot reach the DFU service (Chromium GATT blocklist).

  /** Write without a response (the DFU packet char and FS data are write-no-rsp). */
  writeWithoutResponse(charId: BridgeCharId, data: Uint8Array): Promise<void>;
  /** Subscribe to notifications on a char; returns an unsubscribe fn. */
  subscribe(charId: BridgeCharId, cb: (data: Uint8Array) => void): Promise<() => void>;
}

export class TransportError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransportError';
  }
}
