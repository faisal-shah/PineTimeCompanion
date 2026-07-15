// Frame codec for InfiniSim's TCP GATT bridge (sim/gatt_bridge.h framing),
// shared by TcpTransport (native dev) and WsTransport (web dev via the
// ws-tcp proxy). Request: [charId, op, lenLo, lenHi, ...data]. Response:
// [status, lenLo, lenHi, ...payload]. Both directions are length-prefixed, so
// arbitrary chunk splits/merges on the wire are fine — FrameParser reassembles.

import { BridgeCharId } from './transport';

export type BridgeOp = 0 | 1; // 0 = write, 1 = read

export interface BridgeResponse {
  status: number;
  payload: Uint8Array;
}

export function encodeBridgeRequest(charId: BridgeCharId, op: BridgeOp, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + data.length);
  frame[0] = charId;
  frame[1] = op;
  frame[2] = data.length & 0xff;
  frame[3] = data.length >> 8;
  frame.set(data, 4);
  return frame;
}

/** Reassembles response frames from an arbitrarily-chunked byte stream. */
export class FrameParser {
  private buffer = new Uint8Array(0);

  /** Feed a received chunk; returns every complete response it finishes. */
  feed(chunk: Uint8Array): BridgeResponse[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const responses: BridgeResponse[] = [];
    while (this.buffer.length >= 3) {
      const len = this.buffer[1] | (this.buffer[2] << 8);
      if (this.buffer.length < 3 + len) {
        break;
      }
      responses.push({ status: this.buffer[0], payload: this.buffer.slice(3, 3 + len) });
      this.buffer = this.buffer.slice(3 + len);
    }
    return responses;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}
