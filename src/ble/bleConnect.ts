// Connect + discover for the ble-plx transport, factored out so the
// "always releasable partial link" rule is a single, unit-testable unit.
//
// ble-plx connects in two steps: open the link, then discover services and
// characteristics. If the open succeeds but discovery fails, the link is
// half-open and MUST still be releasable — otherwise the watch stays owned by a
// dead session and the next connect comes back busy/already-connected. This
// helper stores the connected device before discovery and cancels it on any
// failure, so a partial link is always torn down, then rethrows the original
// error as a TransportError.
//
// It imports only the ble-plx *type* (erased at build), never the runtime
// module, so it can be exercised with plain mocks under Node.

import type { Device } from 'react-native-ble-plx';
import { TransportError } from './transportError';

/** The slice of BleManager this helper needs. */
export interface ConnectableManager {
  connectToDevice(deviceId: string, options?: { timeout?: number }): Promise<Device>;
}

export const CONNECT_TIMEOUT_MS = 15000;

/**
 * Connect to `deviceId` and discover its GATT table, returning the connected
 * device. On any failure — including a discovery failure after a successful
 * open — the partial link is cancelled before the error is rethrown, so the
 * caller never holds (or leaks) an un-releasable connection.
 */
export async function connectAndDiscover(
  manager: ConnectableManager,
  deviceId: string,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<Device> {
  let device: Device | undefined;
  try {
    // Store the connected device before discovery: from here on the link exists
    // and must be releasable even if discovery throws.
    device = await manager.connectToDevice(deviceId, { timeout: timeoutMs });
    return await device.discoverAllServicesAndCharacteristics();
  } catch (e) {
    // Best-effort release of the (possibly half-open) link. Never let this
    // cleanup mask the original failure.
    await device?.cancelConnection().catch(() => undefined);
    throw new TransportError(`BLE connect failed: ${(e as Error).message}`, e);
  }
}
