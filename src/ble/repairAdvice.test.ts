import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRepair } from './repairAdvice';

test('a bumped reset epoch reads as the watch clearing all pairings', () => {
  const advice = decideRepair({ resetEpoch: 1, evictionCount: 0 }, { resetEpoch: 2, evictionCount: 0 });
  assert.equal(advice.reason, 'resetEpochChanged');
  assert.match(advice.message, /forgotten every paired phone/i);
  assert.equal(advice.offerBluetoothSettings, true);
});

test('an advanced eviction count reads as this phone being the LRU companion', () => {
  const advice = decideRepair({ resetEpoch: 1, evictionCount: 3 }, { resetEpoch: 1, evictionCount: 4 });
  assert.equal(advice.reason, 'evictionAdvanced');
  assert.match(advice.message, /least recently used/i);
});

test('reset epoch takes precedence over eviction when both changed', () => {
  const advice = decideRepair({ resetEpoch: 1, evictionCount: 3 }, { resetEpoch: 9, evictionCount: 4 });
  assert.equal(advice.reason, 'resetEpochChanged');
});

test('no observable change reads as a generic out-of-sync bond', () => {
  const advice = decideRepair({ resetEpoch: 1, evictionCount: 3 }, { resetEpoch: 1, evictionCount: 3 });
  assert.equal(advice.reason, 'outOfSync');
  assert.equal(advice.offerBluetoothSettings, true);
});

test('an unreadable public status falls back to unknown, still with the Forget/Pair fix', () => {
  const advice = decideRepair({ resetEpoch: 1, evictionCount: 3 }, undefined);
  assert.equal(advice.reason, 'unknown');
  assert.equal(advice.offerBluetoothSettings, true);
  assert.match(advice.message, /Bluetooth settings/i);
});

test('missing stored metadata does not invent a reset or eviction story', () => {
  const advice = decideRepair({}, { resetEpoch: 5, evictionCount: 9 });
  assert.equal(advice.reason, 'outOfSync');
});
