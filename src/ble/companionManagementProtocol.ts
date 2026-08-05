// Byte-level decoder for the InfiniTime Companion Management Service. Pure
// functions over Uint8Array — no BLE, no React Native — tested against golden
// vectors (companionManagementProtocol.test.ts).
//
// The watch exposes two reads on this service, both carrying the identical
// 20-byte status payload:
//
//   companionStatus (BRIDGE_CHAR 33) — public, readable before pairing. The
//     app reads it to learn the retained-peer capacity and how full it is
//     before it commits to pairing.
//   companionVerify (BRIDGE_CHAR 34) — authenticated. Reading it forces the OS
//     pairing/passkey exchange, and a valid payload back is proof the watch
//     actually remembers this phone as a bonded companion.
//
// Wire layout (little-endian), from protocol/companion.json:
//   byte 0      protocol version   (== companion_management.protocol_version)
//   byte 1      capacity           (retained-peer slots; == retainedPeers)
//   byte 2      count              (retained peers in use, 0..capacity)
//   byte 3      eviction policy     (== companion_management.eviction_policy_lru)
//   bytes 4-7   resetEpoch    u32   (bumped once when the watch clears pairings)
//   bytes 8-11  evictionCount u32   (bumped each time the LRU peer is evicted)
//   bytes 12-13 cccdReject    u16   (subscriptions refused for lack of slots)
//   bytes 14-15 invariant     u16   (internal consistency counter)
//   bytes 16-19 flags         u32   (see MANAGEMENT_FLAG_BITS)

import { BRIDGE_CHAR, GATT_CHARACTERISTICS, COMPANION_CAPABILITIES, RECORDS } from './generated/companionProtocol';

export const MANAGEMENT_STATUS_CHAR = BRIDGE_CHAR.companionStatus;
export const MANAGEMENT_VERIFY_CHAR = BRIDGE_CHAR.companionVerify;

export const MANAGEMENT_SERVICE_UUID = GATT_CHARACTERISTICS.companionStatus.service;
export const MANAGEMENT_STATUS_UUID = GATT_CHARACTERISTICS.companionStatus.characteristic;
export const MANAGEMENT_VERIFY_UUID = GATT_CHARACTERISTICS.companionVerify.characteristic;

/** The exact payload length both reads must produce. */
export const MANAGEMENT_STATUS_SIZE = RECORDS.companion_management.status_size;
/** The only protocol version this decoder understands. */
export const MANAGEMENT_PROTOCOL_VERSION = RECORDS.companion_management.protocol_version;
/** The eviction-policy discriminant that means least-recently-used. */
export const MANAGEMENT_POLICY_LRU = RECORDS.companion_management.eviction_policy_lru;
/** Retained-peer capacity the firmware advertises. */
export const MANAGEMENT_CAPACITY = COMPANION_CAPABILITIES.retainedPeers;

/**
 * The management flags, in wire bit order (bit 0 first). Each marks a piece of
 * watch-side companion-store state the app may want to surface or reason about.
 */
export const MANAGEMENT_FLAG_BITS = {
  /** A prior bond format was intentionally ignored on this boot. */
  legacyReset: 0,
  /** The persisted companion store failed its own validation and was dropped. */
  storeInvalid: 1,
  /** A companion-store write is queued but not yet flushed to flash. */
  writePending: 2,
  /** Critical (identity/bond) state is dirty and awaiting persist. */
  criticalDirty: 3,
  /** Usage (last-seen/LRU ordering) state is dirty and awaiting persist. */
  usageDirty: 4,
  /** The empty final-format store is being committed; BLE remains gated off. */
  formatInitializationPending: 5,
} as const;

export type ManagementFlag = keyof typeof MANAGEMENT_FLAG_BITS;

export interface ManagementFlags {
  legacyReset: boolean;
  storeInvalid: boolean;
  writePending: boolean;
  criticalDirty: boolean;
  usageDirty: boolean;
  formatInitializationPending: boolean;
}

export interface CompanionManagementStatus {
  /** Always MANAGEMENT_PROTOCOL_VERSION once decoded (validated). */
  protocolVersion: number;
  /** Retained-peer capacity (validated == MANAGEMENT_CAPACITY). */
  capacity: number;
  /** Retained peers currently in use, 0..capacity. */
  count: number;
  /** The eviction policy; only 'lru' is defined. */
  evictionPolicy: 'lru';
  /** Monotonic epoch, bumped once when the watch forgets all pairings. */
  resetEpoch: number;
  /** Monotonic count of LRU evictions the watch has performed. */
  evictionCount: number;
  /** CCCD subscriptions the watch refused for lack of a persisted slot. */
  cccdReject: number;
  /** Internal store consistency counter (opaque; surfaced for diagnostics). */
  invariant: number;
  flags: ManagementFlags;
  /** count === capacity: the next new companion evicts the least-recently-used one. */
  atCapacity: boolean;
}

function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function u16le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8)) & 0xffff;
}

function decodeFlags(word: number): ManagementFlags {
  const bit = (n: number) => ((word >>> n) & 1) === 1;
  return {
    legacyReset: bit(MANAGEMENT_FLAG_BITS.legacyReset),
    storeInvalid: bit(MANAGEMENT_FLAG_BITS.storeInvalid),
    writePending: bit(MANAGEMENT_FLAG_BITS.writePending),
    criticalDirty: bit(MANAGEMENT_FLAG_BITS.criticalDirty),
    usageDirty: bit(MANAGEMENT_FLAG_BITS.usageDirty),
    formatInitializationPending: bit(MANAGEMENT_FLAG_BITS.formatInitializationPending),
  };
}

/**
 * Thrown when a management payload is structurally invalid: wrong length, a
 * protocol version this build does not understand, a capacity or policy that
 * disagrees with the generated contract, or an out-of-range count. Callers use
 * this to tell "the watch answered with garbage / an incompatible firmware"
 * apart from a transport error, and must NEVER treat a rejected payload as a
 * successful verification.
 */
export class ManagementProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagementProtocolError';
  }
}

/**
 * Decode and strictly validate a 20-byte companion-management status payload
 * (from either the public status read or the authenticated verify read).
 *
 * Validation is deliberately strict — every field that the app trusts to gate
 * pairing is checked against the generated contract, because the whole point of
 * the verify read is that a malformed or wrong-version answer must not be
 * mistaken for proof of a bond.
 */
export function decodeCompanionManagementStatus(bytes: Uint8Array): CompanionManagementStatus {
  if (bytes.length !== MANAGEMENT_STATUS_SIZE) {
    throw new ManagementProtocolError(
      `companion management status must be ${MANAGEMENT_STATUS_SIZE} bytes, got ${bytes.length}`,
    );
  }
  const protocolVersion = bytes[0];
  if (protocolVersion !== MANAGEMENT_PROTOCOL_VERSION) {
    throw new ManagementProtocolError(
      `unsupported companion management protocol version ${protocolVersion} (expected ${MANAGEMENT_PROTOCOL_VERSION})`,
    );
  }
  const capacity = bytes[1];
  if (capacity !== MANAGEMENT_CAPACITY) {
    throw new ManagementProtocolError(
      `companion capacity ${capacity} disagrees with the firmware contract (${MANAGEMENT_CAPACITY})`,
    );
  }
  const count = bytes[2];
  if (count > capacity) {
    throw new ManagementProtocolError(`companion count ${count} exceeds capacity ${capacity}`);
  }
  const policy = bytes[3];
  if (policy !== MANAGEMENT_POLICY_LRU) {
    throw new ManagementProtocolError(
      `unsupported eviction policy ${policy} (expected LRU = ${MANAGEMENT_POLICY_LRU})`,
    );
  }
  return {
    protocolVersion,
    capacity,
    count,
    evictionPolicy: 'lru',
    resetEpoch: u32le(bytes, 4),
    evictionCount: u32le(bytes, 8),
    cccdReject: u16le(bytes, 12),
    invariant: u16le(bytes, 14),
    flags: decodeFlags(u32le(bytes, 16)),
    atCapacity: count === capacity,
  };
}

/**
 * Encode a status payload. Only used to build golden vectors and simulator
 * fixtures in tests; the watch is the sole producer in production.
 */
export function encodeCompanionManagementStatus(s: {
  protocolVersion?: number;
  capacity?: number;
  count: number;
  policy?: number;
  resetEpoch: number;
  evictionCount: number;
  cccdReject?: number;
  invariant?: number;
  flags?: Partial<ManagementFlags>;
}): Uint8Array {
  const out = new Uint8Array(MANAGEMENT_STATUS_SIZE);
  out[0] = s.protocolVersion ?? MANAGEMENT_PROTOCOL_VERSION;
  out[1] = s.capacity ?? MANAGEMENT_CAPACITY;
  out[2] = s.count;
  out[3] = s.policy ?? MANAGEMENT_POLICY_LRU;
  const put32 = (o: number, v: number) => {
    const n = v >>> 0;
    out[o] = n & 0xff;
    out[o + 1] = (n >> 8) & 0xff;
    out[o + 2] = (n >> 16) & 0xff;
    out[o + 3] = (n >> 24) & 0xff;
  };
  const put16 = (o: number, v: number) => {
    out[o] = v & 0xff;
    out[o + 1] = (v >> 8) & 0xff;
  };
  put32(4, s.resetEpoch);
  put32(8, s.evictionCount);
  put16(12, s.cccdReject ?? 0);
  put16(14, s.invariant ?? 0);
  let word = 0;
  const f = s.flags ?? {};
  for (const [name, bit] of Object.entries(MANAGEMENT_FLAG_BITS)) {
    if (f[name as ManagementFlag]) {
      word |= 1 << bit;
    }
  }
  put32(16, word);
  return out;
}
