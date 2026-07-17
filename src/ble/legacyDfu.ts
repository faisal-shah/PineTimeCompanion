// Nordic Legacy DFU client for InfiniTime, over the WatchTransport seam. Mirrors
// the 9-step sequence in InfiniTime/doc/ble.md and the firmware DfuService.
//
// Hard constraints (from the firmware + Gadgetbridge's hard-won fixes):
// - Firmware packets MUST be 20 bytes — larger crashes InfiniTime. Never raise
//   the MTU for the packet stream.
// - The packet-receipt-notification interval must be nonzero (the firmware does
//   `count % prn` with no zero guard) — we use 10.
// - A 10-second inactivity timeout on the watch aborts the transfer; we keep the
//   stream flowing continuously.
// - Integrity is a CRC-16 the watch computes from the .dat; a mismatch replies
//   [0x10,0x04,0x05]. There is no signature.
// - After Activate+Reset the image boots UNVALIDATED — the user must tap Validate
//   on the watch or the next reboot rolls back. No BLE opcode confirms it.

import { BRIDGE_CHAR, TransportError, WatchTransport } from './transport';
import { NotificationInbox } from './notificationInbox';
import { DfuArchive } from './dfuZip';

const PRN_INTERVAL = 10;
const CHUNK = 20;
const NOTIFY_TIMEOUT_MS = 8000;
// The validate response is a 1s AsyncSend timer, but only on success. On a CRC
// failure the firmware calls Reset() right after arming that timer, which stops
// it before it fires — so a failed validate sends NOTHING and we detect it by
// this timeout instead. Kept comfortably above the 1s success latency.
const VALIDATE_TIMEOUT_MS = 4000;

// Opcodes / responses (control point).
const OP_START = 0x01;
const OP_INIT_PARAMS = 0x02;
const OP_RECEIVE_IMAGE = 0x03;
const OP_VALIDATE = 0x04;
const OP_ACTIVATE_RESET = 0x05;
const OP_PRN_REQUEST = 0x08;
const RSP = 0x10;
const IMAGE_TYPE_APP = 0x04;
const ERR_NO_ERROR = 0x01;
const ERR_CRC = 0x05;

export type DfuPhase = 'start' | 'init' | 'transfer' | 'validate' | 'activate';

export interface DfuProgress {
  phase: DfuPhase;
  sent: number;
  total: number;
}

export class DfuAbortedError extends Error {}

const isResponse = (op: number, err: number) => (n: Uint8Array) => n[0] === RSP && n[1] === op && n[2] === err;

/**
 * Run a full Legacy-DFU transfer. Returns when the watch has been told to
 * activate + reset (it reboots into the new image, unvalidated). Throws
 * DfuAbortedError on a CRC failure or a watch-side rejection.
 */
export async function runDfu(
  transport: WatchTransport,
  archive: DfuArchive,
  onProgress?: (p: DfuProgress) => void,
): Promise<void> {
  const { binFile, datFile } = archive;
  const total = binFile.length;
  const inbox = new NotificationInbox(NOTIFY_TIMEOUT_MS);
  const unsubscribe = await transport.subscribe(BRIDGE_CHAR.dfuControl, (n) => inbox.push(n));

  const ctrl = (bytes: number[]) => transport.write(BRIDGE_CHAR.dfuControl, new Uint8Array(bytes));
  const packet = (data: Uint8Array) => transport.writeWithoutResponse(BRIDGE_CHAR.dfuPacket, data);

  try {
    onProgress?.({ phase: 'start', sent: 0, total });

    // 1. Start DFU (application image).
    await ctrl([OP_START, IMAGE_TYPE_APP]);
    // 2. Image sizes: softdevice=0, bootloader=0, application=binFile.length.
    const sizes = new Uint8Array(12);
    new DataView(sizes.buffer).setUint32(8, total, true);
    await packet(sizes);
    await inbox.wait(isResponse(OP_START, ERR_NO_ERROR));

    // 3. Init packet (the .dat, carrying the CRC the watch validates against).
    onProgress?.({ phase: 'init', sent: 0, total });
    await ctrl([OP_INIT_PARAMS, 0x00]); // begin init
    await packet(datFile);
    await ctrl([OP_INIT_PARAMS, 0x01]); // init complete
    await inbox.wait(isResponse(OP_INIT_PARAMS, ERR_NO_ERROR));

    // 4. Packet-receipt-notification interval (must be nonzero), then start data.
    await ctrl([OP_PRN_REQUEST, PRN_INTERVAL]);
    await ctrl([OP_RECEIVE_IMAGE]);

    // 5. Stream the firmware in 20-byte chunks. PRN notifications ([0x11, …])
    //    arrive every PRN_INTERVAL packets — informational, used for progress.
    onProgress?.({ phase: 'transfer', sent: 0, total });
    for (let offset = 0; offset < total; offset += CHUNK) {
      await packet(binFile.subarray(offset, Math.min(offset + CHUNK, total)));
      const sent = Math.min(offset + CHUNK, total);
      if ((sent / CHUNK) % PRN_INTERVAL === 0 || sent === total) {
        onProgress?.({ phase: 'transfer', sent, total });
      }
    }
    // Firmware sends [0x10,0x03,0x01] once every byte is received.
    await inbox.wait(isResponse(OP_RECEIVE_IMAGE, ERR_NO_ERROR));

    // 6. Validate (CRC-16 over the staged image). Success notifies
    //    [0x10,0x04,0x01]; a CRC failure notifies nothing (see VALIDATE_TIMEOUT_MS)
    //    and resets the watch to Idle, so a timeout here means the image was
    //    rejected. The explicit ERR_CRC branch is defensive for firmwares that
    //    do send it.
    onProgress?.({ phase: 'validate', sent: total, total });
    await ctrl([OP_VALIDATE]);
    let validation: Uint8Array;
    try {
      validation = await inbox.wait(
        (n) => n[0] === RSP && n[1] === OP_VALIDATE && (n[2] === ERR_NO_ERROR || n[2] === ERR_CRC),
        VALIDATE_TIMEOUT_MS,
      );
    } catch (e) {
      if (e instanceof TransportError) {
        throw new DfuAbortedError(
          'The watch did not confirm the firmware — it failed validation (CRC mismatch or wrong image) and was not activated',
        );
      }
      throw e;
    }
    if (validation[2] === ERR_CRC) {
      throw new DfuAbortedError('Firmware failed the CRC check on the watch (corrupt or wrong image)');
    }

    // 7. Activate + reset. The watch reboots into the new (unvalidated) image.
    onProgress?.({ phase: 'activate', sent: total, total });
    await ctrl([OP_ACTIVATE_RESET]);
  } finally {
    unsubscribe();
  }
}
