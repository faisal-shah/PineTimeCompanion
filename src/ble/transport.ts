// The transport seam. All sync logic runs against this interface; the dev
// build talks TCP to InfiniSim's GATT bridge, production talks BLE via
// react-native-ble-plx. Only bleTransport.ts cannot be exercised without a
// physical watch.

import { encodeCurrentTime } from './ctsProtocol';

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
  tasksSync: 30, // 000a0001 write (TaskService: begin/record/commit/abort/setStreak)
  tasksDigest: 31, // 000a0002 read (protoVer, capacity, count, version, streak)
  taskRead: 32, // 000a0003 write index -> read one task record
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

/**
 * Run `fn` over one open connection, always disconnecting afterwards. Every
 * watch operation is a connect → do work → disconnect cycle (the BLE link is
 * exclusive), so this is the single place that owns that lifecycle.
 * `mtu` is requested when given; the caller checks the negotiated value.
 */
/**
 * Enough for every message the app sends. Negotiated by default because the
 * ATT default of 23 leaves a 20-byte payload, which silently truncates the
 * weather messages (53 and 36 bytes), a watch message (up to 100) and the
 * Find My key (28) — the watch then parses whatever it did receive. This is
 * invisible in the simulator (the TCP bridge has no MTU) and on the web
 * (Chrome negotiates a large MTU itself), so it only shows on real hardware.
 */
export const DEFAULT_MTU = 256;

export async function withConnection<T>(
  transport: WatchTransport,
  deviceId: string,
  fn: () => Promise<T>,
  mtu: number = DEFAULT_MTU,
): Promise<T> {
  await transport.connect(deviceId);
  try {
    // Best-effort: a watch that refuses still handles the short writes, so
    // don't fail the whole operation over it.
    await transport.requestMtu(mtu).catch(() => undefined);
    // Set the clock on every connection we make. The watch loses its time on
    // power loss, and on a firmware image whose memory layout shifted, and it
    // cannot tell that state from a real date -- it shows 1 January of the build
    // year and computes prayer times for it, confidently. Ten bytes on a link
    // that is already open, and it needs no pairing. Best-effort for the same
    // reason as the MTU: never fail the user's actual operation over it. The DFU
    // path deliberately does not come through here, so this never races a
    // rebooting watch.
    await transport.write(BRIDGE_CHAR.currentTime, encodeCurrentTime(new Date())).catch(() => undefined);
    return await fn();
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}
