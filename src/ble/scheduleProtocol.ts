// Byte-level encoder/decoder for the InfiniTime Schedule Service's per-event
// record + digest (doc/ScheduleService.md in the InfiniTime fork). The sync
// command framing + digest header are shared across every list service and live
// in listProtocol.ts. Pure functions — golden-tested in scheduleProtocol.test.ts.

import { EventRule, WatchEvent, RULE_KIND_CODES, ruleParamByte } from '../model/types';
import {
  ListDigest,
  decodeListDigest,
  decodeTitle,
  encodeRecordMessage,
  encodeTitle,
  u16le,
  u16leAt,
  u32le,
  u32leAt,
} from './listProtocol';

export const SCHEDULE_SERVICE_UUID = '00060000-78fc-48fe-8e23-433b3a1942d0';
export const SYNC_COMMAND_CHAR_UUID = '00060001-78fc-48fe-8e23-433b3a1942d0';
export const DIGEST_CHAR_UUID = '00060002-78fc-48fe-8e23-433b3a1942d0';
export const EVENT_READ_CHAR_UUID = '00060003-78fc-48fe-8e23-433b3a1942d0';

export const PROTOCOL_VERSION = 1;

export const EVENT_RECORD_SIZE = 39;
export const SCHEDULE_DIGEST_SIZE = 7;

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
  const year = u16leAt(record, 5);
  return {
    id: u16leAt(record, 0),
    rule,
    hour: record[3],
    minute: record[4],
    anchorDate: `${year}-${String(record[7]).padStart(2, '0')}-${String(record[8]).padStart(2, '0')}`,
    enabled: (record[10] & 0x01) !== 0,
    title: decodeTitle(record.subarray(11, 35)),
    lastModified: u32leAt(record, 35),
  };
}

export function encodeEventMessage(index: number, event: WatchEvent): Uint8Array {
  return encodeRecordMessage(index, encodeEventRecord(event));
}

export function decodeDigest(payload: Uint8Array): ListDigest {
  return decodeListDigest(payload, SCHEDULE_DIGEST_SIZE);
}
