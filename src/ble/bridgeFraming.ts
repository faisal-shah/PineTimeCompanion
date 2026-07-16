// Frame codec for InfiniSim's TCP GATT bridge (sim/gatt_bridge.h framing),
// shared by TcpTransport (native dev) and WsTransport (web dev via the
// ws-tcp proxy).
//
// Request  (client → bridge): [charId, op, lenLo, lenHi, ...data]
//   op: 0 = write (expects a response), 1 = read, 2 = write-without-response
//       (no response frame is sent back).
// Response (bridge → client, in reply to a write/read):
//   [status, lenLo, lenHi, ...payload]   (status is a small ATT-style code)
// Notification (bridge → client, UNSOLICITED — a firmware notify):
//   [0xF0, charId, lenLo, lenHi, ...payload]
//   0xF0 is not a valid ATT status, so the first byte disambiguates the two
//   inbound frame shapes. All frames are length-prefixed, so arbitrary chunk
//   splits/merges on the wire reassemble.

import { BridgeCharId } from './transport';

export type BridgeOp = 0 | 1 | 2; // 0 = write, 1 = read, 2 = write-no-response

const NOTIFY_MARKER = 0xf0;

export interface BridgeResponse {
  status: number;
  payload: Uint8Array;
}

export type BridgeFrame =
  | { kind: 'response'; status: number; payload: Uint8Array }
  | { kind: 'notify'; charId: number; payload: Uint8Array };

export function encodeBridgeRequest(charId: BridgeCharId, op: BridgeOp, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + data.length);
  frame[0] = charId;
  frame[1] = op;
  frame[2] = data.length & 0xff;
  frame[3] = data.length >> 8;
  frame.set(data, 4);
  return frame;
}

/** Reassembles inbound frames (responses + notifications) from a byte stream. */
export class FrameParser {
  private buffer = new Uint8Array(0);

  feed(chunk: Uint8Array): BridgeFrame[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const frames: BridgeFrame[] = [];
    for (;;) {
      if (this.buffer.length >= 1 && this.buffer[0] === NOTIFY_MARKER) {
        // Notification: [0xF0, charId, lenLo, lenHi, ...payload]
        if (this.buffer.length < 4) {
          break;
        }
        const len = this.buffer[2] | (this.buffer[3] << 8);
        if (this.buffer.length < 4 + len) {
          break;
        }
        frames.push({ kind: 'notify', charId: this.buffer[1], payload: this.buffer.slice(4, 4 + len) });
        this.buffer = this.buffer.slice(4 + len);
        continue;
      }
      // Response: [status, lenLo, lenHi, ...payload]
      if (this.buffer.length < 3) {
        break;
      }
      const len = this.buffer[1] | (this.buffer[2] << 8);
      if (this.buffer.length < 3 + len) {
        break;
      }
      frames.push({ kind: 'response', status: this.buffer[0], payload: this.buffer.slice(3, 3 + len) });
      this.buffer = this.buffer.slice(3 + len);
    }
    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}
