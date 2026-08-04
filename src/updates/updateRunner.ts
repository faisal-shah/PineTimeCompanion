// Orchestrates an OTA update over a WatchTransport: read the running firmware
// revision, flash a firmware DFU archive, and push an external-resources
// archive. Each step is one coordinated transient session (connect -> work ->
// disconnect) so the UI can run them independently and the watch's exclusive
// GATT link — and the notification-forwarding link to the same watch — is
// released between steps.
//
// The forwarding pause/resume and the bounded connect retry are NOT open-coded
// here: they belong to the app-wide ConnectionCoordinator, the single authority
// for that envelope. Routing through it is what keeps OTA from double-pausing
// the forwarder (which the old open-coded pause/resume did) and gives DFU the
// same transient-failure retry as everything else. The DFU/FS steps
// deliberately do not go through withConnection (no clock write on the DFU
// path) so they never race a rebooting watch — they use the coordinator's
// run() directly.

import { WatchTransport, BRIDGE_CHAR } from '../ble/transport';
import { getCoordinator } from '../ble/connectionCoordinator';
import { classifyBleError } from '../ble/transportError';
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

function asDfuError(e: unknown): unknown {
  // Classify in DFU/FS context: insufficient *authorization* (ATT status 8)
  // here means the watch's "Firmware & files" access is Disabled, so surface
  // the actionable message instead of a raw GATT error. In any other context
  // the same status 8 is a generic `authorization` refusal.
  return classifyBleError(e, 'dfu').kind === 'dfuDisabled' ? new DfuDisabledError() : e;
}

/** Read the Device Information Service firmware revision string (e.g. "1.16.0"). */
export async function readFirmwareRevision(transport: WatchTransport, deviceId: string): Promise<string> {
  return getCoordinator().run(transport, deviceId, async () => {
    const bytes = await transport.read(BRIDGE_CHAR.firmwareRevision);
    return new TextDecoder().decode(bytes).replace(/\0+$/, '').trim();
  });
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
  try {
    await getCoordinator().run(transport, deviceId, async () => {
      await runDfu(transport, archive, onProgress);
    });
  } catch (e) {
    throw asDfuError(e);
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
  try {
    await getCoordinator().run(transport, deviceId, async () => {
      // A larger MTU lets the 235-byte FS chunks go out in one write on real
      // hardware; the sim bridge ignores it. DFU is unaffected (always 20-byte).
      await transport.requestMtu(256).catch(() => undefined);
      await uploadResources(transport, archive, onProgress);
    });
  } catch (e) {
    throw asDfuError(e);
  }
}
