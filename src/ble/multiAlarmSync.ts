// Pull-merge-push for the Multi-Alarm Service. The watch is the source of
// truth; edits are applied per-slot against the watch's current state under a
// compare-and-swap version, so two phones editing different alarms don't
// clobber each other. On a CAS rejection (another phone/the watch changed the
// alarms since we read) we re-pull, re-apply just our slot, and retry.
//
// Each exported call owns one connection for its whole operation — the CAS
// loop must read and write over the same open link.

import { WatchTransport, BRIDGE_CHAR } from './transport';
import {
  Alarm,
  MAX_ALARMS,
  MultiAlarmState,
  decodeMultiAlarm,
  encodeMultiAlarm,
} from './multiAlarmProtocol';

const MAX_CAS_RETRIES = 5;

async function withConnection<T>(
  transport: WatchTransport,
  deviceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await transport.connect(deviceId);
  try {
    await transport.requestMtu(64);
    return await fn();
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
}

async function readOverOpen(transport: WatchTransport): Promise<MultiAlarmState> {
  return decodeMultiAlarm(await transport.read(BRIDGE_CHAR.multiAlarm));
}

export function readAlarms(transport: WatchTransport, deviceId: string): Promise<MultiAlarmState> {
  return withConnection(transport, deviceId, () => readOverOpen(transport));
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
  });
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
