// Golden-vector contract tests against doc/ScheduleService.md in the
// InfiniTime fork. Run with:  node --test src/ble/scheduleProtocol.test.ts
// (Node >= 22.6 strips TypeScript types natively.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeEventRecord,
  encodeEventMessage,
  encodeBeginSync,
  encodeCommitSync,
  encodeAbortSync,
  encodeTitle,
  decodeDigest,
  decodeEventRecord,
} from './scheduleProtocol.ts';
import type { WatchEvent } from '../model/types.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('BeginSync golden vector', () => {
  assert.equal(hex(encodeBeginSync(3, 7)), '00000307000000');
});

test('EventRecord golden vector: weekly Quran practice', () => {
  const event: WatchEvent = {
    id: 1,
    title: 'Quran practice',
    hour: 17,
    minute: 0,
    anchorDate: '2026-07-13',
    rule: { kind: 'weekly', weekdayMask: 0x2a },
    enabled: true,
    lastModified: 1784000000,
  };
  assert.equal(
    hex(encodeEventMessage(0, event)),
    '010100' + '0100021100ea07070d2a01' + '517572616e207072616374696365' + '00'.repeat(10) + '00ae556a'
  );
  // decoder round-trips the encoder
  assert.deepEqual(decodeEventRecord(encodeEventRecord(event)), event);
});

test('EventRecord golden vector: daily Brush teeth', () => {
  const event: WatchEvent = {
    id: 2,
    title: 'Brush teeth',
    hour: 20,
    minute: 30,
    anchorDate: '2026-01-01',
    rule: { kind: 'everyNDays', intervalDays: 1 },
    enabled: true,
    lastModified: 0,
  };
  assert.equal(
    hex(encodeEventMessage(1, event)),
    '010101' + '020001141eea0701010101' + '427275736820746565746800' + '00'.repeat(12) + '00000000'
  );
});

test('EventRecord golden vector: one-shot Dentist', () => {
  const event: WatchEvent = {
    id: 3,
    title: 'Dentist',
    hour: 9,
    minute: 15,
    anchorDate: '2026-08-01',
    rule: { kind: 'once' },
    enabled: true,
    lastModified: 0,
  };
  assert.equal(
    hex(encodeEventMessage(2, event)),
    '010102' + '030000090fea0708010001' + '44656e74697374' + '00'.repeat(17) + '00000000'
  );
});

test('CommitSync and AbortSync', () => {
  assert.equal(hex(encodeCommitSync(3)), '020003');
  assert.equal(hex(encodeAbortSync()), '0300');
});

test('Digest golden vector round-trip', () => {
  const digest = decodeDigest(Uint8Array.from(Buffer.from('01100307000000', 'hex')));
  assert.deepEqual(digest, { protocolVersion: 1, capacity: 16, count: 3, scheduleVersion: 7 });
});

test('title truncation respects UTF-8 boundaries', () => {
  // 8 x 3-byte CJK chars = 24 bytes > 23: must cut at 21 (7 chars), not 23.
  const title = '中中中中中中中中';
  const encoded = encodeTitle(title);
  assert.equal(encoded.length, 21);
  assert.equal(new TextDecoder().decode(encoded), '中中中中中中中');
  // 2-byte chars: 12 x 2 = 24 > 23 -> cut at 22 (11 chars)
  assert.equal(encodeTitle('ص'.repeat(12)).length, 22);
  // plain ASCII cuts at exactly 23
  assert.equal(encodeTitle('abcdefghijklmnopqrstuvwxyz').length, 23);
});

test('record is always exactly 35 bytes with NUL-padded title', () => {
  const event: WatchEvent = {
    id: 0xffff,
    title: '',
    hour: 0,
    minute: 0,
    anchorDate: '2027-12-31',
    rule: { kind: 'monthly', dayOfMonth: 31 },
    enabled: false,
    lastModified: 0,
  };
  const record = encodeEventRecord(event);
  assert.equal(record.length, 39);
  assert.equal(record[10], 0x00); // disabled
  assert.equal(record[9], 31); // day of month
  assert.ok(record.subarray(11).every((b) => b === 0));
});
