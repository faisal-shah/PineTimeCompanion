import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDfu, DfuAbortedError, DfuPhase } from './legacyDfu';
import { BRIDGE_CHAR, WatchTransport } from './transport';
import { DfuArchive } from './dfuZip';

// A mock watch that emulates the InfiniTime DfuService control-point handshake:
// it records every write and pushes the firmware's notifications back to the
// control-point subscriber. `crcOk: false` reproduces the real firmware quirk —
// a failed validate notifies NOTHING (Reset() stops the AsyncSend timer), so the
// client only learns of failure by timing out.
class MockDfuWatch implements WatchTransport {
  readonly ctrlWrites: Uint8Array[] = [];
  readonly packets: Uint8Array[] = [];
  /** Set once the watch has reset out from under the final write. */
  resetRaced = false;
  /** Make this control-point opcode fail, to exercise phase reporting. */
  failCtrlOp?: number;
  /** Stop emitting packet receipts after this many payload packets, to model
   *  the watch leaving the update screen mid-transfer. */
  stopAckingAfter?: number;
  private notify?: (n: Uint8Array) => void;
  private bytesReceived = 0;
  private appSize = 0;
  private payloadPackets = 0;

  constructor(private readonly crcOk: boolean) {}

  async connect(): Promise<void> {}
  async requestMtu(): Promise<number> {
    return 512;
  }
  async read(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async disconnect(): Promise<void> {}

  async subscribe(charId: number, cb: (data: Uint8Array) => void): Promise<() => void> {
    assert.equal(charId, BRIDGE_CHAR.dfuControl, 'DFU subscribes to the control point');
    this.notify = cb;
    return () => (this.notify = undefined);
  }

  private send(bytes: number[]): void {
    // Async, like a real notification, so the inbox waiter is already registered.
    setTimeout(() => this.notify?.(new Uint8Array(bytes)), 0);
  }

  async write(charId: number, data: Uint8Array): Promise<void> {
    assert.equal(charId, BRIDGE_CHAR.dfuControl, 'ctrl commands go to the control point');
    this.ctrlWrites.push(data);
    const [op, sub] = data;
    if (op === this.failCtrlOp) throw new Error('radio fell over');
    if (op === 0x01) return; // StartDFU: response comes after the size packet
    if (op === 0x02 && sub === 0x01) this.send([0x10, 0x02, 0x01]); // init complete
    if (op === 0x03) return; // ReceiveImage: response comes after all bytes
    if (op === 0x04) {
      // Validate: success notifies; failure (bad CRC) notifies nothing.
      if (this.crcOk) this.send([0x10, 0x04, 0x01]);
    }
  }

  async writeWithoutResponse(charId: number, data: Uint8Array): Promise<void> {
    // Activate+Reset is the one control-point command sent without a response:
    // the watch calls NVIC_SystemReset() on receipt and the link dies before it
    // could ever ACK. Model that — the write rejects, and runDfu must not care.
    if (charId === BRIDGE_CHAR.dfuControl) {
      assert.equal(data[0], 0x05, 'only Activate+Reset is written to ctrl without a response');
      this.ctrlWrites.push(data);
      this.resetRaced = true;
      throw new Error('Characteristic 00001531-1212-efde-1523-785feabcd123 write failed');
    }
    assert.equal(charId, BRIDGE_CHAR.dfuPacket, 'firmware bytes go to the packet char');
    assert.ok(data.length <= 20, `packet must be <= 20 bytes, got ${data.length}`);
    this.packets.push(data);
    // First packet after StartDFU is the 12-byte image-size header.
    if (this.appSize === 0 && data.length === 12) {
      this.appSize = new DataView(data.buffer, data.byteOffset).getUint32(8, true);
      this.send([0x10, 0x01, 0x01]); // StartDFU accepted
      return;
    }
    // The .dat init packet arrives between init-begin and init-complete; ignore.
    // Everything after ReceiveImage is firmware payload — count it.
    if (this.appSize > 0 && this.bytesReceived < this.appSize && this.sawReceive) {
      this.bytesReceived += data.length;
      this.payloadPackets++;
      if (this.bytesReceived >= this.appSize) {
        this.send([0x10, 0x03, 0x01]);
      } else if (this.payloadPackets % 10 === 0) {
        // Mirrors DfuService.cpp: a receipt every nbPacketsToNotify packets,
        // carrying the watch's own byte count, and never on the packet that
        // completes the image.
        if (this.stopAckingAfter !== undefined && this.payloadPackets > this.stopAckingAfter) return;
        const b = this.bytesReceived;
        this.send([0x11, b & 0xff, (b >> 8) & 0xff, (b >> 16) & 0xff, (b >> 24) & 0xff]);
      }
    }
  }

  private get sawReceive(): boolean {
    return this.ctrlWrites.some((w) => w[0] === 0x03);
  }
}

function makeArchive(size: number): DfuArchive {
  const binFile = new Uint8Array(size);
  for (let i = 0; i < size; i++) binFile[i] = i & 0xff;
  return { binFile, datFile: new Uint8Array([0x52, 0x00, 0xff, 0xff]), crc16: 1234, version: '1.16.0' };
}

test('runDfu drives the full handshake and streams the image in 20-byte chunks', async () => {
  const watch = new MockDfuWatch(true);
  const archive = makeArchive(410); // not a multiple of 20 → tests the final short chunk
  const phases: DfuPhase[] = [];
  await runDfu(watch, archive, (p) => {
    if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
  });

  // Control-point opcode order: Start, Init-begin, Init-complete, PRN, Receive,
  // Validate, Activate.
  assert.deepEqual(
    watch.ctrlWrites.map((w) => [w[0], w[1] ?? null]),
    [
      [0x01, 0x04], // StartDFU, application image
      [0x02, 0x00], // init begin
      [0x02, 0x01], // init complete
      [0x08, 10], // PRN interval (nonzero)
      [0x03, null], // ReceiveImage
      [0x04, null], // Validate
      [0x05, null], // Activate + reset
    ],
  );
  assert.deepEqual(phases, ['start', 'init', 'transfer', 'validate', 'activate']);

  // Firmware payload = ceil(410/20) = 21 chunks; last is 10 bytes. Plus the
  // 12-byte size header and the 4-byte .dat.
  const payload = watch.packets.filter((p) => p.length <= 20 && p.length !== 4).slice(1);
  assert.equal(payload.length, 21);
  assert.equal(payload.at(-1)!.length, 10);
  assert.equal(payload.reduce((n, p) => n + p.length, 0), 410);

  // The watch reset mid-write and the write rejected — runDfu still resolved.
  // Regression for the "Update failed: Characteristic 00001531-… write failed"
  // dialog that appeared on every *successful* update.
  assert.ok(watch.resetRaced, 'Activate+Reset must be written without a response');
});

test('runDfu fails, and stops advancing progress, when the watch stops acknowledging', async () => {
  // Reported from hardware: the phone was switched to another app mid-update,
  // the watch abandoned the transfer and returned to the watch face, and the
  // companion's percentage kept climbing to the end. Packets go out with
  // writeWithoutResponse, so they keep "succeeding" locally with nothing
  // listening; only the watch's receipts prove otherwise.
  const watch = new MockDfuWatch(true);
  watch.stopAckingAfter = 10; // one receipt, then silence
  const archive = makeArchive(4000); // 200 packets, so there is a lot left to fake
  let highWater = 0;
  await assert.rejects(
    runDfu(watch, archive, (p) => {
      if (p.phase === 'transfer') highWater = Math.max(highWater, p.sent);
    }),
    (e) => {
      assert.ok(e instanceof DfuAbortedError, 'a silent watch is an aborted update, not a crash');
      assert.match((e as Error).message, /stopped acknowledging/);
      return true;
    },
  );
  // The bar must reflect what the watch confirmed, which is the single receipt
  // at 200 bytes -- not the ~4000 bytes we managed to hand to the BLE stack.
  assert.equal(highWater, 200, 'progress may only count bytes the watch acknowledged');
  assert.ok(
    !watch.ctrlWrites.some((w) => w[0] === 0x05),
    'a failed transfer must never activate the image',
  );
});

test('runDfu names the step a transport failure came from', async () => {
  const watch = new MockDfuWatch(true);
  watch.failCtrlOp = 0x03; // ReceiveImage
  await assert.rejects(runDfu(watch, makeArchive(200)), (e) => {
    assert.match((e as Error).message, /Failed while transferring the firmware: radio fell over/);
    return true;
  });
});

test('runDfu never activates and throws DfuAbortedError when the watch rejects the CRC', async () => {
  const watch = new MockDfuWatch(false); // failed validate notifies nothing
  const archive = makeArchive(200);
  await assert.rejects(runDfu(watch, archive), (e) => {
    assert.ok(e instanceof DfuAbortedError);
    return true;
  });
  // The image transferred fully, but Activate (0x05) must never be sent.
  assert.ok(!watch.ctrlWrites.some((w) => w[0] === 0x05), 'must not activate a rejected image');
});
