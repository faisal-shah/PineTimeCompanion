import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProtocolVersionError, syncSchedule } from './listSyncManager';
import { BRIDGE_CHAR, WatchTransport } from './transport';
import type { Watch } from '../model/types';

/** A watch that answers the digest read with the protocol version we choose. */
function watchOnVersion(protocolVersion: number): WatchTransport {
  const digest = new Uint8Array([protocolVersion, 64, 0, 7, 0, 0, 0]);
  return {
    async connect() {},
    async disconnect() {},
    async requestMtu() {
      return 256;
    },
    async read(charId: number) {
      assert.equal(charId, BRIDGE_CHAR.scheduleDigest, 'the version is read from the digest, before anything is written');
      return digest;
    },
    async write() {},
    async writeWithoutResponse() {},
    async subscribe() {
      return () => undefined;
    },
  } as unknown as WatchTransport;
}

const watch = {
  id: 'w1',
  name: 'Test watch',
  deviceId: 'AA:BB',
  schedule: { items: [], version: 1, base: undefined },
  tasks: { items: [], version: 1, base: undefined },
} as unknown as Watch;

test('syncing a watch on an older schedule format is refused, naming the watch', async () => {
  // The record layout is both the BLE protocol and the watch's flash format, so
  // pushing v2 records at a v1 watch is not a degraded sync, it is corruption.
  await assert.rejects(syncSchedule(watchOnVersion(1), watch), (e) => {
    assert.ok(e instanceof ProtocolVersionError);
    assert.match((e as Error).message, /Update the watch firmware/);
    return true;
  });
});

test('syncing a watch on a newer format tells you to update the app instead', async () => {
  await assert.rejects(syncSchedule(watchOnVersion(99), watch), (e) => {
    assert.ok(e instanceof ProtocolVersionError);
    assert.match((e as Error).message, /Update the app/);
    return true;
  });
});
