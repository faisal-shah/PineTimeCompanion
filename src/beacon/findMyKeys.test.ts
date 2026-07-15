// Golden-vector tests for FindMy key derivation. The vector was computed with
// Python's `cryptography` (SECP224R1) and matches macless-haystack's
// generate_keys.py, so this locks `elliptic` to the canonical EC math.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ec as EC } from 'elliptic';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';
import { advertisementKeyBytes, generateFindMyKey, keyFileContents, keyFileName } from './findMyKeys';

const p224 = new EC('p224');

// Deterministic golden vector: private key = 0x0102...1c.
const GOLDEN_PRIV_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
const GOLDEN_ADV_HEX = '627b7c0b3a2fb7a478ac5670e9973194a5fda0bc0791b07506a73ddd';
const GOLDEN_HASHED_B64 = '/vOKuaTt4YQhx94Ge/rHR9KDiKnuhcZ7CrxlJFsRUzg=';

test('derives the canonical advertisement key + hashed id (macless-haystack vector)', () => {
  const key = p224.keyFromPrivate(Buffer.from(GOLDEN_PRIV_HEX, 'hex'));
  const advKey = key.getPublic().getX().toArrayLike(Buffer, 'be', 28);
  assert.equal(advKey.toString('hex'), GOLDEN_ADV_HEX);
  assert.equal(Buffer.from(sha256(advKey)).toString('base64'), GOLDEN_HASHED_B64);
});

test('generateFindMyKey produces 28-byte keys and a matching hash', () => {
  const key = generateFindMyKey();
  const priv = Buffer.from(key.privateKeyB64, 'base64');
  const adv = Buffer.from(key.advertisementKeyB64, 'base64');
  assert.equal(priv.length, 28);
  assert.equal(adv.length, 28);
  // hashedKeyId must be SHA-256 of the advertisement key.
  assert.equal(key.hashedKeyId, Buffer.from(sha256(adv)).toString('base64'));
  // advertisement key must be the public X of the private key.
  const derived = p224.keyFromPrivate(priv).getPublic().getX().toArrayLike(Buffer, 'be', 28);
  assert.equal(adv.toString('hex'), derived.toString('hex'));
});

test('advertisementKeyBytes returns the 28 raw bytes', () => {
  const key = generateFindMyKey();
  const bytes = advertisementKeyBytes(key);
  assert.equal(bytes.length, 28);
  assert.equal(Buffer.from(bytes).toString('base64'), key.advertisementKeyB64);
});

test('keyfile export matches the macless-haystack format', () => {
  const key = {
    privateKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHA==',
    advertisementKeyB64: 'Ynt8Czovt6R4rFZw6ZcxlKX9oLwHkbB1Bqc93Q==',
    hashedKeyId: GOLDEN_HASHED_B64,
  };
  assert.equal(
    keyFileContents(key),
    'Private key: AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHA==\n' +
      'Advertisement key: Ynt8Czovt6R4rFZw6ZcxlKX9oLwHkbB1Bqc93Q==\n' +
      'Hashed adv key: /vOKuaTt4YQhx94Ge/rHR9KDiKnuhcZ7CrxlJFsRUzg=\n'
  );
  // filename: first 7 chars of the hashed id, '/' stripped.
  assert.equal(keyFileName(key), 'vOKuaTt.keys');
});
