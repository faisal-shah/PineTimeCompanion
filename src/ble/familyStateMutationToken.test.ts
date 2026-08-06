import test from 'node:test';
import assert from 'node:assert/strict';
import { familyStateMutationToken } from './familyStateMutationToken';

test('family-state mutation token uses the firmware CRC32', () => {
  assert.equal(
    familyStateMutationToken(new TextEncoder().encode('123456789')),
    0xcbf43926,
  );
});
