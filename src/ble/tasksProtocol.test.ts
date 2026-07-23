import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_RECORD_SIZE,
  TASK_DIGEST_SIZE,
  decodeTaskDigest,
  decodeTaskRecord,
  encodeBeginSync,
  encodeCommitSync,
  encodeSetStreak,
  encodeTaskMessage,
  encodeTaskRecord,
} from './tasksProtocol';
import { WatchTask } from '../model/types';

const task = (over: Partial<WatchTask> = {}): WatchTask => ({
  id: 0x1234,
  title: 'Brush teeth',
  order: 2,
  lastModified: 0x0a0b0c0d,
  ...over,
});

test('encodeTaskRecord lays out 31 bytes: id, order, title, lastModified', () => {
  const r = encodeTaskRecord(task());
  assert.equal(r.length, TASK_RECORD_SIZE);
  assert.deepEqual([...r.subarray(0, 3)], [0x34, 0x12, 2]); // id LE, order
  assert.equal(new TextDecoder().decode(r.subarray(3, 3 + 'Brush teeth'.length)), 'Brush teeth');
  assert.equal(r[3 + 'Brush teeth'.length], 0); // NUL after title
  assert.deepEqual([...r.subarray(27, 31)], [0x0d, 0x0c, 0x0b, 0x0a]); // lastModified LE
});

test('task record round-trips', () => {
  const t = task({ title: 'Read Qur’an 📖', order: 17, id: 1, lastModified: 12345 });
  assert.deepEqual(decodeTaskRecord(encodeTaskRecord(t)), t);
});

test('title truncates on a UTF-8 boundary (<=23 bytes) without splitting a char', () => {
  const long = 'é'.repeat(20); // 40 bytes
  const decoded = decodeTaskRecord(encodeTaskRecord(task({ title: long })));
  const bytes = new TextEncoder().encode(decoded.title).length;
  assert.ok(bytes <= 23, `title is ${bytes} bytes`);
  assert.ok(decoded.title.split('').every((c) => c === 'é'));
});

test('decodeTaskRecord rejects a wrong length', () => {
  assert.throws(() => decodeTaskRecord(new Uint8Array(30)), /31 bytes/);
});

test('sync command frames', () => {
  assert.deepEqual([...encodeBeginSync(3, 0x01020304)], [0x00, 0x00, 3, 0x04, 0x03, 0x02, 0x01]);
  assert.deepEqual([...encodeCommitSync(3)], [0x02, 0x00, 3]);
  const msg = encodeTaskMessage(5, task());
  assert.equal(msg.length, 3 + TASK_RECORD_SIZE);
  assert.deepEqual([...msg.subarray(0, 3)], [0x01, 0x01, 5]);
  assert.deepEqual([...encodeSetStreak(300)], [0x04, 0x00, 0x2c, 0x01]); // 300 = 0x012c LE
});

test('digest decodes protoVer/capacity/count/version/streak (9 bytes)', () => {
  const d = decodeTaskDigest(new Uint8Array([1, 20, 5, 0x04, 0x03, 0x02, 0x01, 0x0c, 0x01]));
  assert.deepEqual(d, { protocolVersion: 1, capacity: 20, count: 5, taskVersion: 0x01020304, streak: 0x010c });
  assert.equal(TASK_DIGEST_SIZE, 9);
  assert.throws(() => decodeTaskDigest(new Uint8Array(8)), /9 bytes/);
});
