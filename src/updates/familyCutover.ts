import { RECORDS } from '../ble/generated/companionProtocol';
import type { FamilyStateStatus } from '../ble/familyStateProtocol';
import { emptyList } from '../model/listSync';
import type { Watch } from '../model/types';

export const FAMILY_FIRMWARE_MAJOR = 3;

export function isFamilyCutoverVersion(version: string): boolean {
  const major = Number(/^v?(\d+)\./.exec(version.trim())?.[1]);
  return Number.isInteger(major) && major >= FAMILY_FIRMWARE_MAJOR;
}

export function familyCutoverBlockReason(watch: Watch): string | null {
  const count = watch.schedule.items.length;
  return count > RECORDS.schedule.capacity
    ? `This phone has ${count} schedule items, but InfiniTime 3.0 holds at most ${RECORDS.schedule.capacity}. Reduce the list in the old companion before upgrading.`
    : null;
}

export function clearWatchForFamilyCutover(watch: Watch, status: FamilyStateStatus, now = new Date()): Watch {
  return {
    ...watch,
    lastSyncAt: undefined,
    prayerSettings: undefined,
    beacon: undefined,
    schedule: { ...emptyList(), capacity: RECORDS.schedule.capacity },
    tasks: { ...emptyList(), capacity: RECORDS.task.capacity },
    taskStreak: undefined,
    familyProtocol: {
      protocolVersion: RECORDS.family_state.protocol_version,
      snapshotSchemaVersion: RECORDS.family_state.snapshot_schema_version,
      activeGeneration: status.activeGeneration,
      confirmedAt: now.toISOString(),
    },
    familyCutoverClearedAt: now.toISOString(),
  };
}
