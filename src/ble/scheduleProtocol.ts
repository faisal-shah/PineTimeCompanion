// Byte-level encoders/decoders for the InfiniTime Schedule Service
// (doc/ScheduleService.md in the InfiniTime fork). Pure functions over
// Uint8Array — no BLE, no React Native — tested against the golden vectors
// with `node --test` (scheduleProtocol.test.ts).

import { EventRule, WatchEvent, RULE_KIND_CODES, ruleParamByte } from '../model/types';

export const SCHEDULE_SERVICE_UUID = '00060000-78fc-48fe-8e23-433b3a1942d0';
export const SYNC_COMMAND_CHAR_UUID = '00060001-78fc-48fe-8e23-433b3a1942d0';
export const DIGEST_CHAR_UUID = '00060002-78fc-48fe-8e23-433b3a1942d0';
export const EVENT_READ_CHAR_UUID = '00060003-78fc-48fe-8e23-433b3a1942d0';

export const PROTOCOL_VERSION = 1;

export const EVENT_RECORD_SIZE = 39;
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
  record.set(u32le(event.lastModified >>> 0), 35);
  return record;
}

const RULE_KINDS_BY_CODE = ['once', 'everyNDays', 'weekly', 'monthly'] as const;

export function decodeEventRecord(record: Uint8Array): WatchEvent {
  if (record.length !== EVENT_RECORD_SIZE) {
    throw new Error(`event record must be ${EVENT_RECORD_SIZE} bytes, got ${record.length}`);
  }
  const kind = RULE_KINDS_BY_CODE[record[2]];
  if (!kind) {
    throw new Error(`unknown rule kind ${record[2]}`);
  }
  const param = record[9];
  const rule: EventRule =
    kind === 'once'
      ? { kind }
      : kind === 'everyNDays'
        ? { kind, intervalDays: Math.max(1, param) }
        : kind === 'weekly'
          ? { kind, weekdayMask: param & 0x7f }
          : { kind, dayOfMonth: Math.min(31, Math.max(1, param)) };
  const titleBytes = record.subarray(11, 35);
  const nul = titleBytes.indexOf(0);
  const year = record[5] | (record[6] << 8);
  return {
    id: record[0] | (record[1] << 8),
    rule,
    hour: record[3],
    minute: record[4],
    anchorDate: `${year}-${String(record[7]).padStart(2, '0')}-${String(record[8]).padStart(2, '0')}`,
    enabled: (record[10] & 0x01) !== 0,
    title: new TextDecoder().decode(nul >= 0 ? titleBytes.subarray(0, nul) : titleBytes),
    lastModified: (record[35] | (record[36] << 8) | (record[37] << 16) | (record[38] << 24)) >>> 0,
  };
}

export function encodeBeginSync(count: number, version: number): Uint8Array {
  return new Uint8Array([0x00, 0x00, count, ...u32le(version)]);
}

export function encodeEventMessage(index: number, event: WatchEvent): Uint8Array {
  const msg = new Uint8Array(3 + EVENT_RECORD_SIZE);
  msg[0] = 0x01;
  msg[1] = 0x01; // EventRecord message version (39-byte records)
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
