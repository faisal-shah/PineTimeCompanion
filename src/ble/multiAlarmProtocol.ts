// Byte-level encoder/decoder for the InfiniTime Multi-Alarm Service
// (doc/MultiAlarmService.md in the InfiniTime fork). Pure functions over
// Uint8Array — no BLE, no React Native — tested against golden vectors
// (multiAlarmProtocol.test.ts). The same 24 bytes are the BLE characteristic
// value, the watch's /.system/alarms.dat records, and this app's canonical
// form.
//
// Wire layout: {version u32 LE, MaxAlarms × {hour, minute, mode, enabled}}.
// On a READ the leading u32 is the watch's current version; on a WRITE it is
// the EXPECTED prior version (compare-and-swap).

export const MULTIALARM_SERVICE_UUID = '00090000-78fc-48fe-8e23-433b3a1942d0';
export const MULTIALARM_CHAR_UUID = '00090001-78fc-48fe-8e23-433b3a1942d0';

export const MAX_ALARMS = 5;
export const MULTIALARM_WIRE_SIZE = 4 + MAX_ALARMS * 4;

export type AlarmMode = 'once' | 'daily';

export interface Alarm {
  hour: number;
  minute: number;
  mode: AlarmMode;
  enabled: boolean;
}

export interface MultiAlarmState {
  version: number;
  alarms: Alarm[]; // exactly MAX_ALARMS
}

export function emptyAlarm(): Alarm {
  return { hour: 0, minute: 0, mode: 'once', enabled: false };
}

/** Decode a READ payload (or a persisted blob) into state. */
export function decodeMultiAlarm(bytes: Uint8Array): MultiAlarmState {
  if (bytes.length !== MULTIALARM_WIRE_SIZE) {
    throw new Error(`multi-alarm payload must be ${MULTIALARM_WIRE_SIZE} bytes, got ${bytes.length}`);
  }
  const version = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  const alarms: Alarm[] = [];
  for (let i = 0; i < MAX_ALARMS; i++) {
    const o = 4 + i * 4;
    alarms.push({
      hour: bytes[o],
      minute: bytes[o + 1],
      mode: bytes[o + 2] === 1 ? 'daily' : 'once',
      enabled: bytes[o + 3] !== 0,
    });
  }
  return { version, alarms };
}

/** Encode a WRITE: `expectedVersion` is the CAS guard the watch checks. */
export function encodeMultiAlarm(expectedVersion: number, alarms: Alarm[]): Uint8Array {
  if (alarms.length !== MAX_ALARMS) {
    throw new Error(`expected ${MAX_ALARMS} alarms, got ${alarms.length}`);
  }
  const out = new Uint8Array(MULTIALARM_WIRE_SIZE);
  const v = expectedVersion >>> 0;
  out[0] = v & 0xff;
  out[1] = (v >> 8) & 0xff;
  out[2] = (v >> 16) & 0xff;
  out[3] = (v >> 24) & 0xff;
  alarms.forEach((a, i) => {
    const o = 4 + i * 4;
    out[o] = a.hour & 0xff;
    out[o + 1] = a.minute & 0xff;
    out[o + 2] = a.mode === 'daily' ? 1 : 0;
    out[o + 3] = a.enabled ? 1 : 0;
  });
  return out;
}
