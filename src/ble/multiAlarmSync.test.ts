import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WatchTransport, BridgeCharId, BRIDGE_CHAR } from './transport';
import { Alarm, decodeMultiAlarm, emptyAlarm, encodeMultiAlarm } from './multiAlarmProtocol';
import { setAlarm, updateAlarms } from './multiAlarmSync';

// A mock watch: holds version + 5 alarms, enforces compare-and-swap on write
// exactly like the firmware. `onBeforeWrite` lets a test inject a concurrent
// change (another phone) between a client's read and its write.
class MockWatch implements WatchTransport {
  version = 3;
  alarms: Alarm[] = Array.from({ length: 5 }, emptyAlarm);
  writeCount = 0;
  rejectCount = 0;
  onBeforeWrite?: () => void;

  async connect(): Promise<void> {}
  async requestMtu(): Promise<number> {
    return 64;
  }
  async disconnect(): Promise<void> {}

  async read(charId: BridgeCharId): Promise<Uint8Array> {
    assert.equal(charId, BRIDGE_CHAR.multiAlarm);
    return encodeMultiAlarm(this.version, this.alarms);
  }

  async write(charId: BridgeCharId, data: Uint8Array): Promise<void> {
    assert.equal(charId, BRIDGE_CHAR.multiAlarm);
    // Fire and clear as a one-shot; a callback that re-arms itself (see the
    // "never clears" test) survives because we clear before invoking.
    const injected = this.onBeforeWrite;
    this.onBeforeWrite = undefined;
    injected?.();
    const incoming = decodeMultiAlarm(data);
    if (incoming.version !== this.version) {
      this.rejectCount++;
      throw new Error(`write to char ${charId} rejected (status 14)`); // CAS mismatch
    }
    this.writeCount++;
    this.version++;
    this.alarms = incoming.alarms;
  }
}

test('setAlarm writes the chosen slot under the current version', async () => {
  const watch = new MockWatch();
  const alarm: Alarm = { hour: 7, minute: 3, mode: 'daily', enabled: true };
  const result = await setAlarm(watch, 'sim', 1, alarm);
  assert.equal(result.version, 4); // 3 -> 4
  assert.deepEqual(result.alarms[1], alarm);
  assert.equal(watch.rejectCount, 0);
});

test('CAS conflict: a concurrent change forces a re-pull + retry that preserves both edits', async () => {
  const watch = new MockWatch();
  // Another phone sets slot 4 right before our first write lands.
  watch.onBeforeWrite = () => {
    watch.alarms[4] = { hour: 22, minute: 0, mode: 'once', enabled: true };
    watch.version++; // 3 -> 4, invalidating our read
  };
  // We set slot 0; our first write (expecting v3) is rejected, we re-read v4,
  // re-apply slot 0, and succeed at v5.
  const result = await setAlarm(watch, 'sim', 0, { hour: 6, minute: 15, mode: 'daily', enabled: true });
  assert.equal(watch.rejectCount, 1, 'exactly one CAS rejection');
  assert.equal(result.version, 5);
  assert.deepEqual(result.alarms[0], { hour: 6, minute: 15, mode: 'daily', enabled: true }, 'our edit survived');
  assert.deepEqual(result.alarms[4], { hour: 22, minute: 0, mode: 'once', enabled: true }, "other phone's edit survived");
});

test('gives up after the retry cap when conflicts never clear', async () => {
  const watch = new MockWatch();
  // Bump the version before every write so no attempt ever matches.
  const bumpForever = () => {
    watch.version++;
    watch.onBeforeWrite = bumpForever;
  };
  watch.onBeforeWrite = bumpForever;
  await assert.rejects(() => updateAlarms(watch, 'sim', (a) => a), /kept conflicting/);
});
