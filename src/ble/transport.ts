// The transport seam. All sync logic runs against this interface; the dev
// build talks TCP to InfiniSim's GATT bridge, production talks BLE via
// react-native-ble-plx. Only bleTransport.ts cannot be exercised without a
// physical watch.

import { BRIDGE_CHAR } from './generated/companionProtocol';
import type { BridgeCharId } from './generated/companionProtocol';
import { getCoordinator } from './connectionCoordinator';
import { TransportError } from './transportError';

export { BRIDGE_CHAR };
export type { BridgeCharId };

// The structured error every transport throws. Defined in transportError.ts
// (with the pure BLE classifier) and re-exported here so the many `from
// './transport'` imports keep working.
export { TransportError };
export type { TransportErrorKind, TransportErrorMetadata } from './transportError';
export { classifyBleError, isRetryableKind } from './transportError';

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

  /**
   * Ask for a low-latency link for a bulk transfer, and hand it back after.
   *
   * This is the only remaining lever on DFU throughput. The packet size is
   * pinned at 20 bytes by the firmware (DfuService::DfuImage::Append), packets
   * already go out without a response, and the receipt round trips are already
   * gone -- so what is left is the connection interval, which Android sets to
   * roughly 30-50 ms by default and drops to about 11.25 ms at high priority.
   * Neither side asks for it otherwise: the firmware never requests connection
   * parameters, it only logs the peer's.
   *
   * Optional because only Android BLE can honour it; the sim transports and
   * Web Bluetooth have no such control, and a transfer over them is not slow
   * for this reason.
   */
  requestConnectionPriority?(priority: 'high' | 'balanced'): Promise<void>;
}

/**
 * Hand the connection interval back, from a finally, without ever throwing.
 *
 * A bulk transfer ends by resetting the watch or dropping the link, so this
 * call is the one most likely to fail — and a throw from a finally replaces
 * whatever the transfer was actually reporting. That is how a successful
 * firmware update once came out as "Update failed".
 */
export async function restoreConnectionPriority(transport: WatchTransport): Promise<void> {
  try {
    await transport.requestConnectionPriority?.('balanced');
  } catch {
    // The link is already gone; the interval dies with it.
  }
}

/**
 * Enough for every message the app sends. Negotiated by default because the
 * ATT default of 23 leaves a 20-byte payload, which silently truncates the
 * weather messages (53 and 36 bytes), a watch message (up to 100) and the
 * Find My key (28) — the watch then parses whatever it did receive. This is
 * invisible in the simulator (the TCP bridge has no MTU) and on the web
 * (Chrome negotiates a large MTU itself), so it only shows on real hardware.
 */
export const DEFAULT_MTU = 256;

/**
 * Run `fn` over one coordinated open connection, always disconnecting
 * afterwards. Every ordinary watch operation is a connect → do work →
 * disconnect cycle (the BLE link is exclusive), and it must also pause the
 * native notification-forwarding link to the same watch first and resume it
 * after. That whole envelope — pause, connect-with-retry, disconnect, resume —
 * is owned by the app-wide ConnectionCoordinator; this helper adds the
 * per-connection MTU negotiation, then runs `fn`. `mtu` is requested when
 * given; the caller checks the negotiated value.
 */
export async function withConnection<T>(
  transport: WatchTransport,
  deviceId: string,
  fn: () => Promise<T>,
  mtu: number = DEFAULT_MTU,
): Promise<T> {
  return getCoordinator().run(transport, deviceId, async () => {
    // Best-effort: a watch that refuses still handles the short writes, so
    // don't fail the whole operation over it.
    await transport.requestMtu(mtu).catch(() => undefined);
    return await fn();
  });
}
