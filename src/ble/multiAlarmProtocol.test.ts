import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Alarm,
  MAX_ALARMS,
  MULTIALARM_WIRE_SIZE,
  decodeMultiAlarm,
  emptyAlarm,
  encodeMultiAlarm,
} from './multiAlarmProtocol';

const sample: Alarm[] = [
  { hour: 7, minute: 3, mode: 'daily', enabled: true },
  { hour: 12, minute: 30, mode: 'once', enabled: true },
  { hour: 23, minute: 59, mode: 'daily', enabled: false },
  emptyAlarm(),
  emptyAlarm(),
];

// Golden vector: the exact 24 bytes the InfiniTime MultiAlarmService produces
// (verified against the sim bridge — version 5, the two set alarms + zeros).
const golden = Uint8Array.from([
  0x05, 0x00, 0x00, 0x00, // version 5 LE
  7, 3, 1, 1, // 07:03 daily enabled
  12, 30, 0, 1, // 12:30 once enabled
  23, 59, 1, 0, // 23:59 daily disabled
  0, 0, 0, 0,
  0, 0, 0, 0,
]);

test('encode matches the golden wire bytes', () => {
  assert.deepEqual([...encodeMultiAlarm(5, sample)], [...golden]);
});

test('decode is the inverse of encode', () => {
  const state = decodeMultiAlarm(golden);
  assert.equal(state.version, 5);
  assert.deepEqual(state.alarms, sample);
});

test('decode round-trips an encoded write', () => {
  const bytes = encodeMultiAlarm(42, sample);
  const state = decodeMultiAlarm(bytes);
  assert.equal(state.version, 42);
  assert.deepEqual(state.alarms, sample);
});

test('version is unsigned 32-bit', () => {
  const bytes = encodeMultiAlarm(0xfffffffe, sample);
  assert.equal(decodeMultiAlarm(bytes).version, 0xfffffffe);
});

test('rejects wrong-length payloads', () => {
  assert.throws(() => decodeMultiAlarm(new Uint8Array(MULTIALARM_WIRE_SIZE - 1)));
});

test('rejects wrong alarm count', () => {
  assert.throws(() => encodeMultiAlarm(0, sample.slice(0, MAX_ALARMS - 1)));
});
