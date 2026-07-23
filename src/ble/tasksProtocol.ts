// Byte-level encoders/decoders for the InfiniTime Task Service (the daily task
// checklist) — the twin of scheduleProtocol.ts. Pure functions over Uint8Array,
// golden-tested (tasksProtocol.test.ts). A task record is simpler than an event
// (no time/rule); the digest additionally carries the completion STREAK the
// watch owns and the app may read/override.

import { WatchTask } from '../model/types';
import { encodeTitle, TITLE_BYTES } from './scheduleProtocol';

export const TASK_SERVICE_UUID = '00070000-78fc-48fe-8e23-433b3a1942d0';
export const TASK_SYNC_CHAR_UUID = '00070001-78fc-48fe-8e23-433b3a1942d0';
export const TASK_DIGEST_CHAR_UUID = '00070002-78fc-48fe-8e23-433b3a1942d0';
export const TASK_READ_CHAR_UUID = '00070003-78fc-48fe-8e23-433b3a1942d0';

export const PROTOCOL_VERSION = 1;
export const TASK_RECORD_SIZE = 31; // [id u16][order u8][title 24][lastModified u32]
export const TASK_DIGEST_SIZE = 9; // [protoVer][capacity][count][taskVersion u32][streak u16]

export { TITLE_BYTES };

function u16le(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff];
}
function u32le(v: number): [number, number, number, number] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

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
  const titleBytes = record.subarray(3, 27);
  const nul = titleBytes.indexOf(0);
  return {
    id: record[0] | (record[1] << 8),
    order: record[2],
    title: new TextDecoder().decode(nul >= 0 ? titleBytes.subarray(0, nul) : titleBytes),
    lastModified: (record[27] | (record[28] << 8) | (record[29] << 16) | (record[30] << 24)) >>> 0,
  };
}

// --- sync command messages (written to the sync char) ---

export function encodeBeginSync(count: number, version: number): Uint8Array {
  return new Uint8Array([0x00, 0x00, count, ...u32le(version)]);
}

export function encodeTaskMessage(index: number, task: WatchTask): Uint8Array {
  const msg = new Uint8Array(3 + TASK_RECORD_SIZE);
  msg[0] = 0x01;
  msg[1] = 0x01; // TaskRecord message version (31-byte records)
  msg[2] = index;
  msg.set(encodeTaskRecord(task), 3);
  return msg;
}

export function encodeCommitSync(count: number): Uint8Array {
  return new Uint8Array([0x02, 0x00, count]);
}

export function encodeAbortSync(): Uint8Array {
  return new Uint8Array([0x03, 0x00]);
}

/** Phone override of the watch's streak counter. */
export function encodeSetStreak(streak: number): Uint8Array {
  return new Uint8Array([0x04, 0x00, ...u16le(streak & 0xffff)]);
}

// --- digest (read from the digest char) ---

export interface TaskDigest {
  protocolVersion: number;
  capacity: number;
  count: number;
  taskVersion: number;
  streak: number;
}

export function decodeTaskDigest(payload: Uint8Array): TaskDigest {
  if (payload.length !== TASK_DIGEST_SIZE) {
    throw new Error(`task digest must be ${TASK_DIGEST_SIZE} bytes, got ${payload.length}`);
  }
  return {
    protocolVersion: payload[0],
    capacity: payload[1],
    count: payload[2],
    taskVersion: (payload[3] | (payload[4] << 8) | (payload[5] << 16) | (payload[6] << 24)) >>> 0,
    streak: payload[7] | (payload[8] << 8),
  };
}
