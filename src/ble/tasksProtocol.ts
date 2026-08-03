// Byte-level encoder/decoder for the InfiniTime Task Service (the daily task
// checklist). The sync command framing + digest header are shared and live in
// listProtocol.ts; a task record is simpler than an event (no time/rule), and
// the digest additionally carries the completion STREAK the watch owns and the
// app may read/override. Pure functions — golden-tested (tasksProtocol.test.ts).

import { WatchTask } from '../model/types';
import { ListDigest, decodeListDigest, decodeTitle, encodeRecordMessage, encodeTitle, u16le, u16leAt, u32le, u32leAt } from './listProtocol';

// Service byte 0x0a — 0x07 (00070000) is already the Prayer service.
export const TASK_SERVICE_UUID = '000a0000-78fc-48fe-8e23-433b3a1942d0';
export const TASK_SYNC_CHAR_UUID = '000a0001-78fc-48fe-8e23-433b3a1942d0';
export const TASK_DIGEST_CHAR_UUID = '000a0002-78fc-48fe-8e23-433b3a1942d0';
export const TASK_READ_CHAR_UUID = '000a0003-78fc-48fe-8e23-433b3a1942d0';

export const PROTOCOL_VERSION = 1;
export const TASK_RECORD_SIZE = 31; // [id u16][order u8][title 24][lastModified u32]
export const TASK_DIGEST_SIZE = 9; // [protoVer][capacity][count][version u32][streak u16]

export function encodeTaskRecord(task: WatchTask): Uint8Array {
  const r = new Uint8Array(TASK_RECORD_SIZE); // zero-filled: title NUL padding
  r.set(u16le(task.id), 0);
  r[2] = task.order & 0xff;
  r.set(encodeTitle(task.title), 3); // 24-byte field at [3..26], last byte stays NUL
  r.set(u32le(task.lastModified >>> 0), 27);
  return r;
}

export function decodeTaskRecord(record: Uint8Array): WatchTask {
  if (record.length !== TASK_RECORD_SIZE) {
    throw new Error(`task record must be ${TASK_RECORD_SIZE} bytes, got ${record.length}`);
  }
  return {
    id: u16leAt(record, 0),
    order: record[2],
    title: decodeTitle(record.subarray(3, 27)),
    lastModified: u32leAt(record, 27),
  };
}

/** Must match TaskService's record version on the watch. */
export const TASK_RECORD_VERSION = 1;

export function encodeTaskMessage(index: number, task: WatchTask): Uint8Array {
  return encodeRecordMessage(index, encodeTaskRecord(task), TASK_RECORD_VERSION);
}

/** Phone override of the watch's streak counter. */
export function encodeSetStreak(streak: number): Uint8Array {
  return new Uint8Array([0x04, 0x00, ...u16le(streak & 0xffff)]);
}

/** Digest = the shared list header + a trailing streak u16. */
export interface TaskDigest extends ListDigest {
  streak: number;
}

export function decodeTaskDigest(payload: Uint8Array): TaskDigest {
  return { ...decodeListDigest(payload, TASK_DIGEST_SIZE), streak: u16leAt(payload, 7) };
}
