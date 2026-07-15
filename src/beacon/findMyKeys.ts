// Find My / OpenHaystack key generation for the beacon feature. The watch does
// no cryptography — this module generates the P-224 (secp224r1) keypair on the
// phone, derives the 28-byte advertisement key the watch broadcasts, and
// exports a macless-haystack .keys file the user loads into their own server to
// retrieve locations. See InfiniTime doc/BeaconService.md.
//
// P-224 is required by FindMy; @noble/curves dropped it, so we use `elliptic`
// (verified byte-for-byte against Python's `cryptography` and macless-haystack's
// generate_keys.py in findMyKeys.test.ts). elliptic's genKeyPair needs a secure
// RNG: the app imports `react-native-get-random-values` at entry so
// global.crypto.getRandomValues exists on device (Node already has it, so the
// tests run unpolyfilled).

import { ec as EC } from 'elliptic';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';

const p224 = new EC('p224');

export const ADV_KEY_SIZE = 28;

export interface FindMyKey {
  /** 28-byte P-224 private key, base64. Kept on the phone / exported; never on the watch. */
  privateKeyB64: string;
  /** 28-byte advertisement key (public key X coordinate), base64. This goes to the watch. */
  advertisementKeyB64: string;
  /** base64(SHA-256(advertisementKey)); the id used to query Apple for reports. */
  hashedKeyId: string;
}

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Generate one FindMy keypair. */
export function generateFindMyKey(): FindMyKey {
  const key = p224.genKeyPair();
  const priv = key.getPrivate().toArrayLike(Buffer, 'be', ADV_KEY_SIZE);
  const advKey = key.getPublic().getX().toArrayLike(Buffer, 'be', ADV_KEY_SIZE);
  return {
    privateKeyB64: toB64(priv),
    advertisementKeyB64: toB64(advKey),
    hashedKeyId: toB64(sha256(advKey)),
  };
}

/** The 28 raw advertisement-key bytes to write to the watch. */
export function advertisementKeyBytes(key: Pick<FindMyKey, 'advertisementKeyB64'>): Uint8Array {
  const bytes = Buffer.from(key.advertisementKeyB64, 'base64');
  if (bytes.length !== ADV_KEY_SIZE) {
    throw new Error(`advertisement key must be ${ADV_KEY_SIZE} bytes, got ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

/**
 * macless-haystack .keys file text. Matches biemster/FindMy generate_keys.py
 * output so the user can drop it straight into their server.
 */
export function keyFileContents(key: FindMyKey): string {
  return (
    `Private key: ${key.privateKeyB64}\n` +
    `Advertisement key: ${key.advertisementKeyB64}\n` +
    `Hashed adv key: ${key.hashedKeyId}\n`
  );
}

/** Filename convention: first 7 chars of the hashed key id, '/' stripped, + .keys */
export function keyFileName(key: FindMyKey): string {
  return `${key.hashedKeyId.replace(/\//g, '').slice(0, 7)}.keys`;
}
