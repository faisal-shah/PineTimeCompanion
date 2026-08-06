import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_STATE_PROTOCOL_VERSION,
  FAMILY_STATE_SNAPSHOT_SCHEMA_VERSION,
  FAMILY_STATE_STATUS_SIZE,
  decodeFamilyStateStatus,
  FamilyStateCommitError,
  waitForFamilyStateCommit,
} from './familyStateProtocol';
import { BRIDGE_CHAR } from './generated/companionProtocol';

test('family-state status golden vector decodes field by field', () => {
  const payload = Uint8Array.of(1, 1, 3, 1, 4, 1, 4, 3, 2, 1, 0xd4, 0xc3, 0xb2, 0xa1, 1, 0);
  assert.deepEqual(decodeFamilyStateStatus(payload), {
    state: 'failed',
    operation: 'schedule',
    error: 'spi',
    storageWarning: true,
    token: 0x01020304,
    activeGeneration: 0xa1b2c3d4,
    retryCount: 1,
  });
  assert.equal(FAMILY_STATE_PROTOCOL_VERSION, 1);
  assert.equal(FAMILY_STATE_SNAPSHOT_SCHEMA_VERSION, 1);
  assert.equal(FAMILY_STATE_STATUS_SIZE, 16);
});

test('family-state status rejects incompatible and malformed payloads', () => {
  const valid = Uint8Array.of(1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.throws(() => decodeFamilyStateStatus(valid.subarray(0, 15)), /16 bytes/);
  const wrongProtocol = valid.slice();
  wrongProtocol[0] = 2;
  assert.throws(() => decodeFamilyStateStatus(wrongProtocol), /protocol/);
  const wrongState = valid.slice();
  wrongState[2] = 0xff;
  assert.throws(() => decodeFamilyStateStatus(wrongState), /unknown enum/);
  const wrongFlags = valid.slice();
  wrongFlags[5] = 0x80;
  assert.throws(() => decodeFamilyStateStatus(wrongFlags), /unknown flags/);
});

const encodeStatus = (over: Partial<{
  state: number;
  operation: number;
  error: number;
  token: number;
  generation: number;
}> = {}) => {
  const status = new Uint8Array(16);
  status.set([1, 1, over.state ?? 0, over.operation ?? 0, over.error ?? 0, 0]);
  const view = new DataView(status.buffer);
  view.setUint32(6, over.token ?? 0, true);
  view.setUint32(10, over.generation ?? 0, true);
  return status;
};

test('durable wait ignores other tokens and returns matching success', async () => {
  const responses = [
    encodeStatus({ state: 2, operation: 1, token: 99, generation: 3 }),
    encodeStatus({ state: 1, operation: 1, token: 7, generation: 3 }),
    encodeStatus({ state: 2, operation: 1, token: 7, generation: 4 }),
  ];
  const transport = {
    async read(charId: number) {
      assert.equal(charId, BRIDGE_CHAR.familyStateStatus);
      return responses.shift()!;
    },
  };
  const status = await waitForFamilyStateCommit(transport as never, 'schedule', 7, {
    attempts: 3,
    delayMs: 0,
  });
  assert.equal(status.activeGeneration, 4);
});

test('durable wait surfaces the exact storage failure', async () => {
  const transport = {
    async read() {
      return encodeStatus({ state: 3, operation: 2, error: 4, token: 8 });
    },
  };
  await assert.rejects(
    waitForFamilyStateCommit(transport as never, 'tasks', 8, { attempts: 1, delayMs: 0 }),
    (error) =>
      error instanceof FamilyStateCommitError &&
      error.status.error === 'spi' &&
      error.status.token === 8,
  );
});
