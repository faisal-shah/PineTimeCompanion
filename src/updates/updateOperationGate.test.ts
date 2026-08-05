import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UpdateOperationGate } from './updateOperationGate';

test('only one update operation may own the gate', () => {
  const gate = new UpdateOperationGate();
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.isActive(), true);
  assert.equal(gate.tryAcquire(), false);
});

test('release permits the next update operation', () => {
  const gate = new UpdateOperationGate();
  assert.equal(gate.tryAcquire(), true);
  gate.release();
  assert.equal(gate.isActive(), false);
  assert.equal(gate.tryAcquire(), true);
});
