// Compare-and-swap sync for the Multi-Alarm Service. The watch is the source of
// truth; edits are applied per-slot against the watch's current state under a
// CAS version, so two phones editing different alarms don't clobber each other.
// On a CAS rejection (another phone or the watch changed the alarms since we
// read) we re-pull, re-apply just our slot, and retry.
//
// Deliberately NOT the staged-list/three-way-merge model the schedule and tasks
// use (src/ble/listSyncManager.ts). Alarms are a fixed 5 slots with no per-item
// id, title or lastModified, and the WATCH edits them too — its UI, and the
// firmware itself, which disables a one-shot alarm the moment it fires. CAS
// never silently loses a write and needs no clock; a timestamp merge against a
// skewed watch clock could resurrect an alarm that has already gone off. See
// InfiniTime doc/ble.md, "Companion sync models".
//
// Each exported call owns one connection for its whole operation — the CAS
// loop must read and write over the same open link.

import { WatchTransport, BRIDGE_CHAR, withConnection } from './transport';
import {
  Alarm,
  MAX_ALARMS,
  MultiAlarmState,
  decodeMultiAlarm,
  encodeMultiAlarm,
} from './multiAlarmProtocol';

const MAX_CAS_RETRIES = 5;
const MTU = 64; // the alarm blob is 24 B; this is ample

async function readOverOpen(transport: WatchTransport): Promise<MultiAlarmState> {
  return decodeMultiAlarm(await transport.read(BRIDGE_CHAR.multiAlarm));
}

export function readAlarms(transport: WatchTransport, deviceId: string): Promise<MultiAlarmState> {
  return withConnection(transport, deviceId, () => readOverOpen(transport), MTU);
}

/**
 * Apply a per-slot edit and push it, retrying through CAS conflicts. `mutate`
 * receives the current alarms (fresh each attempt) and returns the full
 * 5-alarm array to write — callers change only the slot they own. Returns the
 * committed state (re-read after the accepted write).
 */
export function updateAlarms(
  transport: WatchTransport,
  deviceId: string,
  mutate: (current: Alarm[]) => Alarm[],
): Promise<MultiAlarmState> {
  return withConnection(transport, deviceId, async () => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const current = await readOverOpen(transport);
      const next = mutate(current.alarms.map((a) => ({ ...a })));
      if (next.length !== MAX_ALARMS) {
        throw new Error(`mutate must return exactly ${MAX_ALARMS} alarms`);
      }
      try {
        await transport.write(BRIDGE_CHAR.multiAlarm, encodeMultiAlarm(current.version, next));
        return await readOverOpen(transport); // confirm the committed state
      } catch (e) {
        // The watch rejects (nonzero GATT status → transport throws) on a CAS
        // mismatch; re-pull and retry. A persistent failure surfaces below.
        lastError = e as Error;
      }
    }
    throw new Error(`alarm sync kept conflicting after ${MAX_CAS_RETRIES} retries: ${lastError?.message ?? 'unknown'}`);
  }, MTU);
}

export function setAlarm(
  transport: WatchTransport,
  deviceId: string,
  index: number,
  alarm: Alarm,
): Promise<MultiAlarmState> {
  return updateAlarms(transport, deviceId, (current) => {
    const next = current.map((a) => ({ ...a }));
    next[index] = alarm;
    return next;
  });
}

export function setAlarmEnabled(
  transport: WatchTransport,
  deviceId: string,
  index: number,
  enabled: boolean,
): Promise<MultiAlarmState> {
  return updateAlarms(transport, deviceId, (current) => {
    const next = current.map((a) => ({ ...a }));
    next[index] = { ...next[index], enabled };
    return next;
  });
}
