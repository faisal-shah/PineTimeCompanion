// Byte-level encoders/decoders for the InfiniTime Schedule Service
// (doc/ScheduleService.md in the InfiniTime fork). Pure functions over
// Uint8Array — no BLE, no React Native — tested against the golden vectors
// with `node --test` (scheduleProtocol.test.ts).

import { WatchEvent, RULE_KIND_CODES, ruleParamByte } from '../model/types';

export const SCHEDULE_SERVICE_UUID = '00060000-78fc-48fe-8e23-433b3a1942d0';
export const SYNC_COMMAND_CHAR_UUID = '00060001-78fc-48fe-8e23-433b3a1942d0';
export const DIGEST_CHAR_UUID = '00060002-78fc-48fe-8e23-433b3a1942d0';

export const EVENT_RECORD_SIZE = 35;
export const TITLE_BYTES = 23; // 24-byte field, last byte always NUL

function u16le(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32le(value: number): [number, number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** UTF-8 encode and truncate WITHOUT splitting a multi-byte character. */
export function encodeTitle(title: string): Uint8Array {
  const full = new TextEncoder().encode(title);
  if (full.length <= TITLE_BYTES) {
    return full;
  }
  let end = TITLE_BYTES;
  while (end > 0 && (full[end] & 0xc0) === 0x80) {
    end--; // don't cut inside a UTF-8 continuation sequence
  }
  return full.subarray(0, end);
}

export function encodeEventRecord(event: WatchEvent): Uint8Array {
  const record = new Uint8Array(EVENT_RECORD_SIZE); // zero-filled: title NUL padding
  const [y, m, d] = event.anchorDate.split('-').map(Number);
  record.set(u16le(event.id), 0);
  record[2] = RULE_KIND_CODES[event.rule.kind];
  record[3] = event.hour;
  record[4] = event.minute;
  record.set(u16le(y), 5);
  record[7] = m;
  record[8] = d;
  record[9] = ruleParamByte(event.rule);
  record[10] = event.enabled ? 0x01 : 0x00;
  record.set(encodeTitle(event.title), 11);
  return record;
}

export function encodeBeginSync(count: number, version: number): Uint8Array {
  return new Uint8Array([0x00, 0x00, count, ...u32le(version)]);
}

export function encodeEventMessage(index: number, event: WatchEvent): Uint8Array {
  const msg = new Uint8Array(3 + EVENT_RECORD_SIZE);
  msg[0] = 0x01;
  msg[1] = 0x00;
  msg[2] = index;
  msg.set(encodeEventRecord(event), 3);
  return msg;
}

export function encodeCommitSync(count: number): Uint8Array {
  return new Uint8Array([0x02, 0x00, count]);
}

export function encodeAbortSync(): Uint8Array {
  return new Uint8Array([0x03, 0x00]);
}

export interface Digest {
  protocolVersion: number;
  capacity: number;
  count: number;
  scheduleVersion: number;
}

export function decodeDigest(payload: Uint8Array): Digest {
  if (payload.length !== 7) {
    throw new Error(`digest must be 7 bytes, got ${payload.length}`);
  }
  return {
    protocolVersion: payload[0],
    capacity: payload[1],
    count: payload[2],
    scheduleVersion: (payload[3] | (payload[4] << 8) | (payload[5] << 16) | (payload[6] << 24)) >>> 0,
  };
}
