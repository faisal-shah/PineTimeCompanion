// Decrypt a FindMy / OpenHaystack location report on-device. The watch does no
// cryptography and Apple's crowd-sourced reports are end-to-end encrypted to the
// key we generated (src/beacon/findMyKeys.ts); only the holder of the 28-byte
// P-224 private key can recover lat/lon. This is a faithful TypeScript port of
// FindMy.py's LocationReport.decrypt (findmy/reports/reports.py), cross-checked
// against macless-haystack's decrypt_reports.dart and verified byte-for-byte by
// a golden vector minted with Python's `cryptography` (decrypt.test.ts).
//
// P-224 (secp224r1) ECDH uses `elliptic` (same lib and reason as findMyKeys.ts —
// @noble/curves ships no P-224). AES-128-GCM uses @noble/ciphers, whose gcm
// accepts the non-standard 16-byte IV this scheme derives.

import { ec as EC } from 'elliptic';
import { sha256 } from '@noble/hashes/sha256';
import { gcm } from '@noble/ciphers/aes.js';
import { Buffer } from 'buffer';

const p224 = new EC('p224');

/** Seconds between the Unix epoch and Apple's 2001-01-01 epoch. */
const APPLE_EPOCH_OFFSET = 978307200;

export interface LocationFix {
  /** Unix seconds (UTC) the report was published. */
  timestamp: number;
  /** Decimal degrees, signed (negative = south). */
  lat: number;
  /** Decimal degrees, signed (negative = west). */
  lon: number;
  /** Horizontal accuracy in metres. */
  accuracy: number;
  /** Battery level from the status byte: 0 full, 1 medium, 2 low, 3 critical. */
  battery: number;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Signed big-endian int32 at offset `o`. */
function readInt32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) | 0;
}

/** Unsigned big-endian uint32 at offset `o`. */
function readUInt32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/**
 * Decrypt one base64 report payload with the 28-byte P-224 private key (base64).
 * Throws if the payload is malformed or the GCM tag fails (wrong key for this
 * report) — callers filter those out.
 */
export function decryptReport(payloadB64: string, privateKeyB64: string): LocationFix {
  let payload: Uint8Array = new Uint8Array(Buffer.from(payloadB64, 'base64'));

  // macOS-14+ inserted one byte after the timestamp, making the payload 89 bytes.
  // Drop it so the canonical 88-byte offsets below apply uniformly.
  if (payload.length > 88) {
    payload = concat(payload.subarray(0, 4), payload.subarray(5));
  }
  if (payload.length !== 88) {
    throw new Error(`unexpected report payload length ${payload.length}`);
  }

  // Cleartext prefix: timestamp (Apple epoch) + a status/confidence byte.
  const timestamp = readUInt32BE(payload, 0) + APPLE_EPOCH_OFFSET;

  // Encrypted section: ephemeral pubkey (0x04||X||Y, 57B), ciphertext (10B), tag (16B).
  const ephPub = payload.subarray(5, 62);
  const ciphertext = payload.subarray(62, 72);
  const tag = payload.subarray(72, 88);

  // ECDH: our private key × the report's ephemeral public key → shared X (28B BE).
  const priv = new Uint8Array(Buffer.from(privateKeyB64, 'base64'));
  if (priv.length !== 28) {
    throw new Error(`private key must be 28 bytes, got ${priv.length}`);
  }
  const sharedBN = p224.keyFromPrivate(priv).derive(p224.keyFromPublic(ephPub).getPublic());
  const shared = new Uint8Array(sharedBN.toArrayLike(Buffer, 'be', 28));

  // ANSI X9.63 KDF, single SHA-256 block: sharedInfo is the FULL 57-byte point.
  const symmetric = sha256(concat(shared, Uint8Array.of(0, 0, 0, 1), ephPub));
  const aesKey = symmetric.subarray(0, 16); // AES-128
  const iv = symmetric.subarray(16, 32); // 16-byte IV (non-standard, but valid GCM)

  const plaintext = gcm(aesKey, iv).decrypt(concat(ciphertext, tag)); // 10 bytes

  return {
    timestamp,
    lat: readInt32BE(plaintext, 0) / 1e7,
    lon: readInt32BE(plaintext, 4) / 1e7,
    accuracy: plaintext[8],
    battery: plaintext[9] >> 6,
  };
}
