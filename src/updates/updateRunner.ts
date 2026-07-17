// Orchestrates an OTA update over a WatchTransport: read the running firmware
// revision, flash a firmware DFU archive, and push an external-resources
// archive. Each step owns the connection (connect -> work -> disconnect) so the
// UI can run them independently and the watch's exclusive GATT link is released
// between steps.

import { WatchTransport, BRIDGE_CHAR } from '../ble/transport';
import { runDfu, DfuProgress } from '../ble/legacyDfu';
import { parseDfuArchive } from '../ble/dfuZip';
import { uploadResources, ResourcesProgress } from '../ble/resourcesUpload';
import { parseResourcesArchive } from '../ble/resourcesZip';

// The watch refused DFU/FS access: "Firmware & files" is Disabled in its
// settings (BLE_ATT_ERR_INSUFFICIENT_AUTHOR / status 8).
export class DfuDisabledError extends Error {
  constructor() {
    super('Firmware updates are turned off on the watch. On the watch, open Settings ▸ "Firmware & files" and choose Enabled (or "Till reboot"), then try again.');
    this.name = 'DfuDisabledError';
  }
}

function isAuthError(e: unknown): boolean {
  const m = (e as Error)?.message ?? '';
  return /\bstatus 8\b/.test(m) || /authoriz/i.test(m) || /insufficient_auth/i.test(m);
}

/** Read the Device Information Service firmware revision string (e.g. "1.16.0"). */
export async function readFirmwareRevision(transport: WatchTransport, deviceId: string): Promise<string> {
  await transport.connect(deviceId);
  try {
    const bytes = await transport.read(BRIDGE_CHAR.firmwareRevision);
    return new TextDecoder().decode(bytes).replace(/\0+$/, '').trim();
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/**
 * Flash a firmware DFU archive. Resolves once the watch has been told to
 * activate + reset — it then reboots into the new image UNVALIDATED, so the UI
 * must prompt the user to tap Validate on the watch.
 */
export async function runFirmwareUpdate(
  transport: WatchTransport,
  deviceId: string,
  dfuZip: Uint8Array,
  onProgress?: (p: DfuProgress) => void,
): Promise<void> {
  const archive = parseDfuArchive(dfuZip);
  await transport.connect(deviceId);
  try {
    await runDfu(transport, archive, onProgress);
  } catch (e) {
    throw isAuthError(e) ? new DfuDisabledError() : e;
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

/** Push an external-resources archive over the BLE filesystem. */
export async function runResourcesUpdate(
  transport: WatchTransport,
  deviceId: string,
  resourcesZip: Uint8Array,
  onProgress?: (p: ResourcesProgress) => void,
): Promise<void> {
  const archive = parseResourcesArchive(resourcesZip);
  await transport.connect(deviceId);
  try {
    // A larger MTU lets the 235-byte FS chunks go out in one write on real
    // hardware; the sim bridge ignores it. DFU is unaffected (always 20-byte).
    await transport.requestMtu(256).catch(() => undefined);
    await uploadResources(transport, archive, onProgress);
  } catch (e) {
    throw isAuthError(e) ? new DfuDisabledError() : e;
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}
