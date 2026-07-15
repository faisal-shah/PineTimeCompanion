// Golden vector for report decryption, minted with Python's `cryptography`
// (SECP224R1) by encrypting a report exactly as an iPhone finder does — the
// reverse of FindMy.py's decrypt — so this locks the P-224 ECDH + X9.63 KDF +
// AES-128-GCM path byte-for-byte. Recipient private key is the repo's existing
// keygen golden scalar 0x01..0x1c (see findMyKeys.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptReport } from './decrypt';

const PRIV_B64 = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHA==';
const PAYLOAD_B64 =
  'KbknAGMEOYKCE4DJ573s+o1p0LtKDtQO8nPVjHV7GdXGaPb08eWA1nC+8i+pKF+Pb7FwjW5JsyjJfzUK9woV+CQnY4WMftSaAuzwTC4n7v8mR7EsyQZ75g==';

test('decryptReport recovers lat/lon/accuracy/battery/timestamp', () => {
  const fix = decryptReport(PAYLOAD_B64, PRIV_B64);
  assert.equal(fix.lat, 37.3349);
  assert.equal(fix.lon, -122.009);
  assert.equal(fix.accuracy, 15);
  assert.equal(fix.battery, 1);
  assert.equal(fix.timestamp, 1678307200);
});

test('decryptReport rejects a wrong-length private key', () => {
  assert.throws(() => decryptReport(PAYLOAD_B64, 'AAAA'), /28 bytes/);
});

test('decryptReport fails the GCM tag with the wrong key', () => {
  // A different valid 28-byte P-224 scalar (0x02..0x1d) → wrong shared secret → tag mismatch.
  const wrong = Buffer.from('02030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d', 'hex').toString(
    'base64',
  );
  assert.throws(() => decryptReport(PAYLOAD_B64, wrong));
});
