// Shared byte-level codec for the watch's list-sync services (Schedule, Task,
// Alarm). The command framing (begin / record / commit / abort) and the digest
// header are identical across them; only the per-item record layout and any
// extra digest fields differ, and live in each feature's *Protocol.ts. Pure —
// exercised through each feature's golden vectors.

export const TITLE_BYTES = 23; // 24-byte on-wire field, last byte always NUL

export function u16le(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function u32le(value: number): [number, number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export function u16leAt(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function u32leAt(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** UTF-8 encode and truncate WITHOUT splitting a multi-byte character. */
export function encodeTitle(title: string): Uint8Array {
  const full = new TextEncoder().encode(title);
  if (full.length <= TITLE_BYTES) {
    return full;
  }
  let end = TITLE_BYTES;
  while (end > 0 && (full[end] & 0xc0) === 0x80) {
    end--; // don't cut inside a UTF-8 continuation sequence
  }
  return full.subarray(0, end);
}

/** Decode a NUL-padded UTF-8 title field. */
export function decodeTitle(field: Uint8Array): string {
  const nul = field.indexOf(0);
  return new TextDecoder().decode(nul >= 0 ? field.subarray(0, nul) : field);
}

// ---- sync command frames (identical for every list service) ----

export function encodeBeginSync(count: number, version: number): Uint8Array {
  return new Uint8Array([0x00, 0x00, count, ...u32le(version)]);
}

/** Wrap a per-item record as a RecordMessage: [type=1][recordVersion=1][index][record]. */
export function encodeRecordMessage(index: number, record: Uint8Array): Uint8Array {
  const msg = new Uint8Array(3 + record.length);
  msg[0] = 0x01;
  msg[1] = 0x01;
  msg[2] = index;
  msg.set(record, 3);
  return msg;
}

export function encodeCommitSync(count: number): Uint8Array {
  return new Uint8Array([0x02, 0x00, count]);
}

export function encodeAbortSync(): Uint8Array {
  return new Uint8Array([0x03, 0x00]);
}

// ---- digest header (shared prefix; extra bytes are feature-specific) ----

/** The common digest prefix: [protocolVersion][capacity][count][version u32]. */
export interface ListDigest {
  protocolVersion: number;
  capacity: number;
  count: number;
  version: number;
}

export const LIST_DIGEST_SIZE = 7;

/** Decode the shared digest prefix, asserting the exact total length the caller
 *  expects (7 for a plain list, more when the feature appends extra fields). */
export function decodeListDigest(payload: Uint8Array, totalSize: number): ListDigest {
  if (payload.length !== totalSize) {
    throw new Error(`digest must be ${totalSize} bytes, got ${payload.length}`);
  }
  return {
    protocolVersion: payload[0],
    capacity: payload[1],
    count: payload[2],
    version: u32leAt(payload, 3),
  };
}
