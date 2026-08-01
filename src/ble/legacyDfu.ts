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
// - Activate+Reset MUST be a write WITHOUT response (ble.md "send 0x05 to the
//   control point as a command with no response"): the firmware answers it by
//   pushing BleFirmwareUpdateFinished, and SystemTask calls NVIC_SystemReset()
//   on receipt, so the MCU is gone before it can send an ATT Write Response.
//   Writing it with-response reports a bogus failure on every successful update.

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
// A PRN covers PRN_INTERVAL * CHUNK = 200 bytes, which the watch acknowledges in
// well under a second. Generous, but bounded: this is what turns "the watch went
// away" from a bar that fills to 100% into a reported failure.
const PRN_TIMEOUT_MS = 8000;
// How far the phone may run ahead of the watch's acknowledged byte count before
// it stops and insists on hearing from it. Big enough that a healthy transfer
// never blocks (receipts arrive every PRN_INTERVAL packets, far inside this),
// small enough that a watch which has gone away is caught within a kilobyte.
const WINDOW_BYTES = 50 * CHUNK;

// Opcodes / responses (control point).
const OP_START = 0x01;
const OP_INIT_PARAMS = 0x02;
const OP_RECEIVE_IMAGE = 0x03;
const OP_VALIDATE = 0x04;
const OP_ACTIVATE_RESET = 0x05;
const OP_PRN_REQUEST = 0x08;
const OP_PACKET_RECEIPT = 0x11;
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

/** Which of the nine steps was in flight when a transport error surfaced. */
const PHASE_LABEL: Record<DfuPhase, string> = {
  start: 'starting the update',
  init: 'sending the init packet',
  transfer: 'transferring the firmware',
  validate: 'validating the image',
  activate: 'activating the new image',
};

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

  // Tracked so a raw GATT error ("Characteristic 0000… write failed") can say
  // which of the nine steps it came from — otherwise the report is undebuggable.
  let phase: DfuPhase = 'start';
  const report = (p: DfuPhase, sent: number) => {
    phase = p;
    onProgress?.({ phase: p, sent, total });
  };

  const ctrl = (bytes: number[]) => transport.write(BRIDGE_CHAR.dfuControl, new Uint8Array(bytes));
  const packet = (data: Uint8Array) => transport.writeWithoutResponse(BRIDGE_CHAR.dfuPacket, data);
  // Activate+Reset only. Command (no response), and a transport error here is
  // the success path, not a failure: the watch resets mid-write and the link
  // drops. See the header note.
  const ctrlNoResponse = async (bytes: number[]) => {
    try {
      await transport.writeWithoutResponse(BRIDGE_CHAR.dfuControl, new Uint8Array(bytes));
    } catch {
      // The watch rebooted before acknowledging — exactly what we asked it to do.
    }
  };

  try {
    report('start', 0);

    // 1. Start DFU (application image).
    await ctrl([OP_START, IMAGE_TYPE_APP]);
    // 2. Image sizes: softdevice=0, bootloader=0, application=binFile.length.
    const sizes = new Uint8Array(12);
    new DataView(sizes.buffer).setUint32(8, total, true);
    await packet(sizes);
    await inbox.wait(isResponse(OP_START, ERR_NO_ERROR));

    // 3. Init packet (the .dat, carrying the CRC the watch validates against).
    report('init', 0);
    await ctrl([OP_INIT_PARAMS, 0x00]); // begin init
    await packet(datFile);
    await ctrl([OP_INIT_PARAMS, 0x01]); // init complete
    await inbox.wait(isResponse(OP_INIT_PARAMS, ERR_NO_ERROR));

    // 4. Packet-receipt-notification interval (must be nonzero), then start data.
    //    Both belong to the transfer, so the phase moves before them — a failure
    //    here is a transfer failure, not an init one.
    report('transfer', 0);
    await ctrl([OP_PRN_REQUEST, PRN_INTERVAL]);
    await ctrl([OP_RECEIVE_IMAGE]);

    // 5. Stream the firmware in 20-byte chunks, waiting for the watch's
    //    packet-receipt notification every PRN_INTERVAL packets.
    //
    //    The wait is not optional and the progress number comes from the watch,
    //    not from us. Packets go out with writeWithoutResponse, which resolves
    //    as soon as the local BLE stack accepts the bytes — so if the watch
    //    aborts the update or the link dies, every write still "succeeds" and a
    //    counter based on what we sent climbs happily to 100% while nothing is
    //    arriving. The PRN is the only evidence the watch is still taking data.
    //
    //    The firmware sends a PRN every nbPacketsToNotify packets *except* when
    //    that packet completes the image (DfuService.cpp: the `bytesReceived !=
    //    applicationSize` guard) — there it sends the ReceiveImage response
    //    instead, which is awaited below. So the final packet is never waited on
    //    here, however the total divides.
    let packetsSent = 0;
    let ackedBytes = 0;
    const isReceipt = (n: Uint8Array) => n[0] === OP_PACKET_RECEIPT;
    const stalled = () =>
      new DfuAbortedError(
        'The watch stopped acknowledging firmware packets, so the update was abandoned. ' +
          'It usually means the watch left the update screen or the connection dropped. ' +
          'The watch keeps running its current firmware — start the update again.',
      );

    // Consume whatever receipts have already arrived, without waiting for one.
    const drainReceipts = () => {
      for (;;) {
        const prn = inbox.tryTake(isReceipt);
        if (prn === undefined) {
          return;
        }
        ackedBytes = new DataView(prn.buffer, prn.byteOffset).getUint32(1, true);
        report('transfer', ackedBytes);
      }
    };

    for (let offset = 0; offset < total; offset += CHUNK) {
      await packet(binFile.subarray(offset, Math.min(offset + CHUNK, total)));
      packetsSent++;
      const sent = Math.min(offset + CHUNK, total);
      drainReceipts();

      // Only stop if we have run far enough ahead of the watch to doubt it is
      // still there. Blocking on every receipt instead costs a round trip per
      // PRN_INTERVAL packets, which on a 400 KB image is ~2000 of them and adds
      // minutes to a flash; packets are written without response precisely so
      // several fit in one connection interval.
      if (sent < total && packetsSent * CHUNK - ackedBytes >= WINDOW_BYTES) {
        try {
          const prn = await inbox.wait(isReceipt, PRN_TIMEOUT_MS);
          ackedBytes = new DataView(prn.buffer, prn.byteOffset).getUint32(1, true);
          report('transfer', ackedBytes);
        } catch (e) {
          if (e instanceof TransportError) {
            throw stalled();
          }
          throw e;
        }
        drainReceipts();
      }
    }
    // Firmware sends [0x10,0x03,0x01] once every byte is received.
    await inbox.wait(isResponse(OP_RECEIVE_IMAGE, ERR_NO_ERROR));

    // 6. Validate (CRC-16 over the staged image). Success notifies
    //    [0x10,0x04,0x01]; a CRC failure notifies nothing (see VALIDATE_TIMEOUT_MS)
    //    and resets the watch to Idle, so a timeout here means the image was
    //    rejected. The explicit ERR_CRC branch is defensive for firmwares that
    //    do send it.
    report('validate', total);
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
    report('activate', total);
    await ctrlNoResponse([OP_ACTIVATE_RESET]);
  } catch (e) {
    // DfuAbortedError already explains itself; anything else is a raw GATT
    // message with no context, so name the step it came from.
    if (e instanceof DfuAbortedError) {
      throw e;
    }
    throw new Error(`Failed while ${PHASE_LABEL[phase]}: ${(e as Error).message}`);
  } finally {
    unsubscribe();
  }
}
