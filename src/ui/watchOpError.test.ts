import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentWatchOpError } from './watchOpError';
import { TransportError } from '../ble/transport';

const label = 'Sync';

test('a busy/transient error offers retry or forwarding-off, never re-pair', () => {
  const view = presentWatchOpError(new TransportError('GATT operation already in progress'), { label });
  assert.equal(view.kind, 'transient');
  assert.equal(view.action, 'retry');
  assert.match(view.message, /forwarding/i);
  assert.notEqual(view.action, 'pairRepair');
});

test('an authentication failure routes to pair/repair', () => {
  const view = presentWatchOpError(new TransportError('insufficient authentication'), { label });
  assert.equal(view.kind, 'authentication');
  assert.equal(view.action, 'pairRepair');
});

test('an authorization refusal is not a pairing problem', () => {
  const err = Object.assign(new Error('status 8'), { attErrorCode: 0x08 });
  const view = presentWatchOpError(err, { label });
  assert.equal(view.kind, 'authorization');
  assert.equal(view.action, 'none');
});

test('status 8 in a DFU context reads as firmware access disabled', () => {
  const err = Object.assign(new Error('status 8'), { attErrorCode: 0x08 });
  const view = presentWatchOpError(err, { label: 'Update', context: 'dfu' });
  assert.equal(view.kind, 'dfuDisabled');
  assert.equal(view.action, 'enableDfuAccess');
});

test('bluetooth off, permission, cancelled, not found each get their own action', () => {
  assert.equal(presentWatchOpError(Object.assign(new Error('x'), { errorCode: 102 }), { label }).action, 'enableBluetooth');
  assert.equal(presentWatchOpError(Object.assign(new Error('x'), { errorCode: 101 }), { label }).action, 'openPermissions');
  assert.equal(presentWatchOpError(Object.assign(new Error('x'), { errorCode: 2 }), { label }).action, 'none');
  assert.equal(presentWatchOpError(Object.assign(new Error('x'), { errorCode: 204 }), { label }).action, 'retry');
  assert.equal(presentWatchOpError(Object.assign(new Error('x'), { errorCode: 2 }), { label }).kind, 'cancelled');
  assert.equal(presentWatchOpError(Object.assign(new Error('x'), { errorCode: 204 }), { label }).kind, 'notFound');
});

test('an unclassifiable error keeps the raw message and offers nothing', () => {
  const view = presentWatchOpError(new Error('weird internal thing'), { label });
  assert.equal(view.kind, 'unknown');
  assert.equal(view.action, 'none');
  assert.match(view.message, /weird internal thing/);
});

test('the copy avoids marketing filler', () => {
  const view = presentWatchOpError(new TransportError('busy'), { label });
  assert.doesNotMatch(view.title + view.message, /seamless|effortless|magic|simply|just works/i);
});
