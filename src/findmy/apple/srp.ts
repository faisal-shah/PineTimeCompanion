// Apple's SRP-6a exchange for GrandSlam login. This is NOT interchangeable with
// off-the-shelf SRP libraries: Apple uses RFC-5054 padding, SHA-256, the 2048-bit
// group, and — critically — omits the username from x (`no_username_in_x`). This
// is a faithful port of Python's srp._pysrp with those flags, cross-checked
// byte-for-byte against pysrp as an oracle (srp.test.ts).
//
//   x  = SHA256( salt || SHA256( ":" || passwordMaterial ) )    (no username)
//   k  = SHA256( PAD(N) || PAD(g) )
//   u  = SHA256( PAD(A) || PAD(B) )
//   S  = (B - k*v) ^ (a + u*x)  mod N
//   K  = SHA256( S )
//   M1 = SHA256( H(N) xor H(g) || SHA256(I) || salt || A || B || K )
//   M2 = SHA256( A || M1 || K )
// where PAD(x) is left-zero-padded to N's byte length and A/B/salt/S are minimal
// big-endian.

import { sha256 } from '@noble/hashes/sha256';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { Buffer } from 'buffer';

// RFC 5054 2048-bit group (NG_2048), matching srp._pysrp.
const N_HEX =
  'ac6bdb41324a9a9bf166de5e1389582faf72b6651987ee07fc3192943db56050' +
  'a37329cbb4a099ed8193e0757767a13dd52312ab4b03310dcd7f48a9da04fd50' +
  'e8083969edb767b0cf6095179a163ab3661a05fbd5faaae82918a9962f0b93b8' +
  '55f97993ec975eeaa80d740adbf4ff747359d041d5c33ea71d281e446b14773b' +
  'ca97b43a23fb801676bd207a436c6481f1d2b9078717461a5b9d32e688f87748' +
  '544523b524b0d57d5ea77a2775d2ecfa032cfbdbf52fb3786160279004e57ae6' +
  'af874e7303ce53299ccc041c7bc308d82a5698f3a8d0c38271ae35f8e9dbfbb6' +
  '94b5c803d89f7ae435de236d525f54759b65e372fcd68ef20fa7111f9e4aff73';
const N = BigInt('0x' + N_HEX);
const g = 2n;
const N_BYTES = 256;

export type SrpProtocol = 's2k' | 's2k_fo';

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) {
    n = (n << 8n) | BigInt(byte);
  }
  return n;
}

/** Minimal big-endian, matching pysrp long_to_bytes (no leading zero, no sign byte). */
function bigIntToBytes(n: bigint): Uint8Array {
  if (n === 0n) {
    return new Uint8Array(0);
  }
  let hex = n.toString(16);
  if (hex.length % 2) {
    hex = '0' + hex;
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function padLeft(b: Uint8Array, width: number): Uint8Array {
  if (b.length >= width) {
    return b;
  }
  const out = new Uint8Array(width);
  out.set(b, width - b.length);
  return out;
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

function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  base %= mod;
  if (base < 0n) {
    base += mod;
  }
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// k = SHA256( PAD(N) || PAD(g) ) — constant.
const K_MULT = bytesToBigInt(sha256(concat(padLeft(bigIntToBytes(N), N_BYTES), padLeft(bigIntToBytes(g), N_BYTES))));

// H(N) xor H(g-padded) for M1, per pysrp HNxorg (g padded to len(N)).
function hNxorG(): Uint8Array {
  const hN = sha256(bigIntToBytes(N));
  const hg = sha256(padLeft(bigIntToBytes(g), bigIntToBytes(N).length));
  const out = new Uint8Array(hN.length);
  for (let i = 0; i < hN.length; i++) {
    out[i] = hN[i] ^ hg[i];
  }
  return out;
}

/** The SRP "password": PBKDF2-HMAC-SHA256 over SHA256(password) (hex-encoded for s2k_fo). */
export function encryptPassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
  protocol: SrpProtocol,
): Uint8Array {
  let p: Uint8Array = sha256(new TextEncoder().encode(password));
  if (protocol === 's2k_fo') {
    p = new TextEncoder().encode(Buffer.from(p).toString('hex'));
  }
  return pbkdf2(sha256, p, salt, { c: iterations, dkLen: 32 });
}

export interface SrpChallengeResult {
  /** M1 proof to send to the server, base64. */
  m1: Uint8Array;
  /** Session key K, kept to verify M2 and decrypt spd. */
  sessionKey: Uint8Array;
}

/**
 * SRP client for one login. `a` (the 256-byte ephemeral secret) is normally
 * random; tests pin it for deterministic vectors.
 */
export class SrpClient {
  private readonly username: Uint8Array;
  private readonly a: bigint;
  readonly A: Uint8Array;
  private m1?: Uint8Array;
  private sessionKey?: Uint8Array;

  constructor(username: string, aBytes: Uint8Array) {
    if (aBytes.length !== N_BYTES) {
      throw new Error(`SRP ephemeral secret must be ${N_BYTES} bytes`);
    }
    this.username = new TextEncoder().encode(username);
    this.a = bytesToBigInt(aBytes);
    this.A = bigIntToBytes(modpow(g, this.a, N));
  }

  /** Process the server challenge (salt, B) and produce M1 + the session key. */
  processChallenge(
    salt: Uint8Array,
    B: Uint8Array,
    passwordMaterial: Uint8Array,
  ): SrpChallengeResult {
    const bInt = bytesToBigInt(B);
    if (bInt % N === 0n) {
      throw new Error('SRP safety check failed: B % N == 0');
    }
    const aInt = bytesToBigInt(this.A);

    // u = SHA256( PAD(A) || PAD(B) )
    const u = bytesToBigInt(sha256(concat(padLeft(this.A, N_BYTES), padLeft(B, N_BYTES))));
    if (u === 0n) {
      throw new Error('SRP safety check failed: u == 0');
    }

    // x = SHA256( salt || SHA256( ":" || passwordMaterial ) )
    const inner = sha256(concat(Uint8Array.of(0x3a), passwordMaterial));
    const x = bytesToBigInt(sha256(concat(salt, inner)));

    const v = modpow(g, x, N);
    let base = (bInt - ((K_MULT * v) % N)) % N;
    if (base < 0n) {
      base += N;
    }
    const S = modpow(base, this.a + u * x, N);

    const K = sha256(bigIntToBytes(S));
    const m1 = sha256(concat(hNxorG(), sha256(this.username), salt, this.A, B, K));

    this.m1 = m1;
    this.sessionKey = K;
    return { m1, sessionKey: K };
  }

  /** The negotiated session key; throws if processChallenge hasn't run. */
  sessionKeyOrThrow(): Uint8Array {
    if (!this.sessionKey) {
      throw new Error('processChallenge must run before reading the session key');
    }
    return this.sessionKey;
  }

  /** Verify the server's M2 = SHA256( A || M1 || K ). */
  verifyM2(m2: Uint8Array): boolean {
    if (!this.m1 || !this.sessionKey) {
      throw new Error('processChallenge must run before verifyM2');
    }
    const expected = sha256(concat(this.A, this.m1, this.sessionKey));
    if (expected.length !== m2.length) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i] ^ m2[i];
    }
    return diff === 0;
  }
}
