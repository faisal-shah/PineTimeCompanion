import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORDS } from './generated/companionProtocol';
import { familyStateMutationToken } from './familyStateMutationToken';
import { encodePrayerSettings } from './prayerProtocol';
import { writeBeaconKey, writePrayerSettings } from './syncManager';
import { BRIDGE_CHAR, BridgeCharId, WatchTransport } from './transport';

class DurableSmallStateWatch implements WatchTransport {
  private operation: 'prayer_settings' | 'beacon_key' = 'prayer_settings';
  private token = 0;
  private prayer = new Uint8Array();
  private hasKey = false;

  async connect(): Promise<void> {}
  async requestMtu(): Promise<number> { return 256; }
  async disconnect(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}
  async subscribe(): Promise<() => void> { return () => undefined; }

  async write(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    if (charId === BRIDGE_CHAR.prayerSettings) {
      this.operation = 'prayer_settings';
      this.token = familyStateMutationToken(data);
      this.prayer = data.slice();
      return;
    }
    if (charId === BRIDGE_CHAR.beaconKey) {
      this.operation = 'beacon_key';
      this.token = familyStateMutationToken(data);
      this.hasKey = true;
      return;
    }
    throw new Error(`unexpected write ${charId}`);
  }

  async read(charId: BridgeCharId): Promise<Uint8Array> {
    if (charId === BRIDGE_CHAR.prayerSettings) {
      return this.prayer.slice();
    }
    if (charId === BRIDGE_CHAR.beaconKey) {
      return Uint8Array.of(this.hasKey ? 1 : 0);
    }
    if (charId === BRIDGE_CHAR.familyStateStatus) {
      const contract = RECORDS.family_state;
      const status = new Uint8Array(contract.status_size);
      status[0] = contract.protocol_version;
      status[1] = contract.snapshot_schema_version;
      status[2] = contract.states.succeeded;
      status[3] = contract.operations[this.operation];
      status[4] = contract.errors.none;
      new DataView(status.buffer).setUint32(6, this.token, true);
      new DataView(status.buffer).setUint32(10, 1, true);
      return status;
    }
    throw new Error(`unexpected read ${charId}`);
  }
}

test('prayer settings wait for their durable family-state token', async () => {
  const watch = new DurableSmallStateWatch();
  const settings = {
    method: 'isna' as const,
    asrMadhab: 'hanafi' as const,
    alerts: 'all' as const,
    latE2: 4188,
    lonE2: -8763,
    utcOffsetQuarters: -20,
  };
  await writePrayerSettings(watch, 'sim', settings);
  assert.deepEqual(
    await watch.read(BRIDGE_CHAR.prayerSettings),
    encodePrayerSettings(settings),
  );
});

test('Find My provisioning waits for its durable family-state token', async () => {
  const watch = new DurableSmallStateWatch();
  await writeBeaconKey(watch, 'sim', Uint8Array.from({ length: 28 }, (_, i) => i));
  assert.deepEqual(await watch.read(BRIDGE_CHAR.beaconKey), Uint8Array.of(1));
});
