import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCurrentTime } from './ctsProtocol';
import { withConnection, BRIDGE_CHAR, WatchTransport } from './transport';

test('encodeCurrentTime lays out the standard 10-byte CTS payload', () => {
  // Sunday 2 August 2026, 18:45:21 local — the case that exposed all of this.
  const b = encodeCurrentTime(new Date(2026, 7, 2, 18, 45, 21, 0));
  assert.equal(b.length, 10);
  assert.equal(b[0] | (b[1] << 8), 2026, 'year, little endian');
  assert.equal(b[2], 8, 'month is 1-based');
  assert.equal(b[3], 2, 'day of month');
  assert.equal(b[4], 18, 'hour is 24h');
  assert.equal(b[5], 45);
  assert.equal(b[6], 21);
  assert.equal(b[7], 7, 'CTS day-of-week is Monday=1..Sunday=7');
  assert.equal(b[9], 0, 'adjust reason');
});

test('the date is carried, not just the time of day', () => {
  // The failure this exists to stop: a watch showing the right time on 1 Jan.
  const b = encodeCurrentTime(new Date(2026, 0, 1, 18, 45, 0, 0));
  const c = encodeCurrentTime(new Date(2026, 7, 2, 18, 45, 0, 0));
  assert.deepEqual([b[4], b[5]], [c[4], c[5]], 'same time of day');
  assert.notDeepEqual([b[2], b[3]], [c[2], c[3]], 'but a different date must encode differently');
});

class FakeTransport implements WatchTransport {
  writes: number[] = [];
  connected = 0;
  async connect(): Promise<void> {
    this.connected++;
  }
  async disconnect(): Promise<void> {}
  async requestMtu(): Promise<number> {
    return 256;
  }
  async read(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async write(charId: number, _payload: Uint8Array): Promise<void> {
    this.writes.push(charId);
  }
  async writeWithoutResponse(): Promise<void> {}
  async subscribe(): Promise<() => void> {
    return () => undefined;
  }
}

test('every app operation sets the watch clock', async () => {
  const t = new FakeTransport();
  await withConnection(t, 'AA:BB', async () => {
    await t.write(BRIDGE_CHAR.battery, new Uint8Array());
  });
  assert.equal(t.writes[0], BRIDGE_CHAR.currentTime, 'the clock is set before the operation runs');
});

test('a watch that rejects the clock write does not fail the operation', async () => {
  // Best-effort: an older or busy watch must not break a sync.
  const t = new FakeTransport();
  t.write = async (charId: number, _payload: Uint8Array) => {
    if (charId === BRIDGE_CHAR.currentTime) throw new Error('no such characteristic');
    t.writes.push(charId);
  };
  let ran = false;
  await withConnection(t, 'AA:BB', async () => {
    ran = true;
  });
  assert.ok(ran, 'the operation still ran');
});
