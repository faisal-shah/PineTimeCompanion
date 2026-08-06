import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDS } from '../ble/generated/companionProtocol';
import type { FamilyStateStatus } from '../ble/familyStateProtocol';
import type { Watch } from '../model/types';
import { clearWatchForFamilyCutover, familyCutoverBlockReason, isFamilyCutoverVersion } from './familyCutover';

const watch = (): Watch => ({
  id: 'w1',
  name: 'Watch',
  lastSyncAt: '2026-01-01T00:00:00.000Z',
  prayerSettings: {} as never,
  beacon: { advertisementKeyB64: 'a', hashedKeyId: 'b', provisioned: true },
  schedule: { items: [], version: 4, syncedVersion: 4, capacity: 64 },
  tasks: { items: [], version: 7, syncedVersion: 7, capacity: 20 },
  taskStreak: 12,
});

const status: FamilyStateStatus = {
  state: 'succeeded',
  operation: 'boot_initialization',
  error: 'none',
  storageWarning: false,
  token: 0,
  activeGeneration: 1,
  retryCount: 0,
};

test('3.0 and later are family cutover firmware', () => {
  assert.equal(isFamilyCutoverVersion('2.0.2'), false);
  assert.equal(isFamilyCutoverVersion('v3.0.0'), true);
  assert.equal(isFamilyCutoverVersion('4.1.0'), true);
  assert.equal(isFamilyCutoverVersion('garbage'), false);
});

test('cutover blocks a local schedule above generated capacity', () => {
  const value = watch();
  value.schedule.items = Array.from({ length: RECORDS.schedule.capacity + 1 }, (_, id) => ({
    id,
    title: `Event ${id}`,
    hour: 1,
    minute: 0,
    anchorDate: '2026-01-01',
    rule: { kind: 'everyNDays', intervalDays: 1 },
    enabled: true,
    lastModified: 1,
  }));
  assert.match(familyCutoverBlockReason(value) ?? '', /at most 32/);
  value.schedule.items.pop();
  assert.equal(familyCutoverBlockReason(value), null);
});

test('confirmed cutover clears incompatible local state without losing pairing', () => {
  const value = watch();
  value.deviceId = 'AA:BB';
  const cleared = clearWatchForFamilyCutover(value, status, new Date('2026-08-06T12:00:00.000Z'));
  assert.equal(cleared.deviceId, 'AA:BB');
  assert.deepEqual(cleared.schedule, { items: [], version: 1, capacity: 32 });
  assert.deepEqual(cleared.tasks, { items: [], version: 1, capacity: 20 });
  assert.equal(cleared.taskStreak, undefined);
  assert.equal(cleared.prayerSettings, undefined);
  assert.equal(cleared.beacon, undefined);
  assert.deepEqual(cleared.familyProtocol, {
    protocolVersion: RECORDS.family_state.protocol_version,
    snapshotSchemaVersion: RECORDS.family_state.snapshot_schema_version,
    activeGeneration: 1,
    confirmedAt: '2026-08-06T12:00:00.000Z',
  });
  assert.equal(cleared.familyCutoverClearedAt, '2026-08-06T12:00:00.000Z');
});
