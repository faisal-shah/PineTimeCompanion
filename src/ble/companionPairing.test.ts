import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_CHAR } from './generated/companionProtocol';
import { encodeCompanionManagementStatus } from './companionManagementProtocol';
import {
  checkVerifyConsistency,
  readManagementStatus,
  runVerifiedPairing,
  PairingHooks,
} from './companionPairing';
import { TransportError } from './transportError';

// A transport whose per-characteristic read behaviour is scripted. `with
// Connection` also negotiates an MTU and writes the clock on connect; both are
// accepted and ignored here.
class ScriptTransport {
  connects = 0;
  disconnects = 0;
  reads: number[] = [];
  constructor(private readonly script: Record<number, () => Uint8Array | Promise<Uint8Array>>) {}
  async connect(): Promise<void> {
    this.connects++;
  }
  async disconnect(): Promise<void> {
    this.disconnects++;
  }
  async requestMtu(mtu: number): Promise<number> {
    return mtu;
  }
  async write(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}
  async subscribe(): Promise<() => void> {
    return () => undefined;
  }
  async read(charId: number): Promise<Uint8Array> {
    this.reads.push(charId);
    const fn = this.script[charId];
    if (!fn) {
      throw new TransportError('characteristic not found');
    }
    return fn();
  }
}

const full = () => encodeCompanionManagementStatus({ count: 5, resetEpoch: 42, evictionCount: 3 });
const room = () => encodeCompanionManagementStatus({ count: 2, resetEpoch: 42, evictionCount: 3 });

const noHooks: PairingHooks = {
  async confirmEviction() {
    throw new Error('confirmEviction should not be called');
  },
};

test('verifies without a prompt when the watch has room', async () => {
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: room,
    [BRIDGE_CHAR.companionVerify]: room,
  });
  const out = await runVerifiedPairing(t as never, 'dev', noHooks);
  assert.equal(out.kind, 'verified');
  // Two separate connect/disconnect cycles: status then verify.
  assert.equal(t.connects, 2);
  assert.equal(t.disconnects, 2);
  assert.deepEqual(t.reads, [BRIDGE_CHAR.companionStatus, BRIDGE_CHAR.companionVerify]);
});

test('at capacity, confirming proceeds to verify and saves', async () => {
  let asked = false;
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: full,
    // The sixth pairing evicts the LRU peer: count holds at 5, evictionCount +1.
    [BRIDGE_CHAR.companionVerify]: () => encodeCompanionManagementStatus({ count: 5, resetEpoch: 42, evictionCount: 4 }),
  });
  const hooks: PairingHooks = {
    async confirmEviction(status) {
      asked = true;
      assert.equal(status.atCapacity, true);
      return true;
    },
  };
  const out = await runVerifiedPairing(t as never, 'dev', hooks);
  assert.ok(asked, 'the eviction confirmation is shown');
  assert.equal(out.kind, 'verified');
});

test('at capacity, cancelling leaves the app unchanged and never authenticates', async () => {
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: full,
    [BRIDGE_CHAR.companionVerify]: full,
  });
  const hooks: PairingHooks = {
    async confirmEviction() {
      return false;
    },
  };
  const out = await runVerifiedPairing(t as never, 'dev', hooks);
  assert.equal(out.kind, 'cancelled');
  // The verify characteristic must never be read after a cancel.
  assert.deepEqual(t.reads, [BRIDGE_CHAR.companionStatus]);
});

test('a changed reset epoch between status and verify is a mismatch, not a save', async () => {
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: room,
    [BRIDGE_CHAR.companionVerify]: () => encodeCompanionManagementStatus({ count: 2, resetEpoch: 99, evictionCount: 3 }),
  });
  const out = await runVerifiedPairing(t as never, 'dev', noHooks);
  assert.equal(out.kind, 'mismatch');
  if (out.kind === 'mismatch') {
    assert.equal(out.mismatch, 'resetEpoch');
  }
});

test('missing management characteristic falls back to explicit legacy', async () => {
  const t = new ScriptTransport({
    // Only the status char is scripted to throw "not found"; verify irrelevant.
    [BRIDGE_CHAR.companionStatus]: () => {
      throw new TransportError('characteristic not found');
    },
  });
  const out = await runVerifiedPairing(t as never, 'dev', noHooks);
  assert.equal(out.kind, 'legacy');
});

test('a garbage payload is unsupported, never a false verification', async () => {
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: () => new Uint8Array(10),
  });
  const res = await readManagementStatus(t as never, 'dev', 'status');
  assert.equal(res.kind, 'unsupported');
});

test('an operational failure surfaces as error, never legacy or verified', async () => {
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: () => {
      throw new TransportError('bluetooth is off');
    },
  });
  const out = await runVerifiedPairing(t as never, 'dev', noHooks);
  assert.equal(out.kind, 'error');
});

test('a failed passkey on the verify read surfaces as error, not verified', async () => {
  const t = new ScriptTransport({
    [BRIDGE_CHAR.companionStatus]: room,
    [BRIDGE_CHAR.companionVerify]: () => {
      throw new TransportError('insufficient authentication');
    },
  });
  const out = await runVerifiedPairing(t as never, 'dev', noHooks);
  assert.equal(out.kind, 'error');
});

test('checkVerifyConsistency allows the sixth-pairing eviction step', () => {
  const before = { resetEpoch: 1, capacity: 5, evictionPolicy: 'lru', count: 5, evictionCount: 7 } as never;
  const after = { resetEpoch: 1, capacity: 5, evictionPolicy: 'lru', count: 5, evictionCount: 8 } as never;
  assert.deepEqual(checkVerifyConsistency(before, after), { ok: true });
});

test('checkVerifyConsistency rejects a regressed count', () => {
  const before = { resetEpoch: 1, capacity: 5, evictionPolicy: 'lru', count: 3, evictionCount: 0 } as never;
  const after = { resetEpoch: 1, capacity: 5, evictionPolicy: 'lru', count: 2, evictionCount: 0 } as never;
  assert.deepEqual(checkVerifyConsistency(before, after), { ok: false, mismatch: 'countRegressed' });
});
