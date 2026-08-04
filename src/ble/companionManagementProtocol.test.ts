import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANAGEMENT_CAPACITY,
  MANAGEMENT_POLICY_LRU,
  MANAGEMENT_PROTOCOL_VERSION,
  MANAGEMENT_STATUS_SIZE,
  ManagementProtocolError,
  decodeCompanionManagementStatus,
  encodeCompanionManagementStatus,
} from './companionManagementProtocol';
import { BRIDGE_CHAR, GATT_CHARACTERISTICS } from './generated/companionProtocol';

// Golden vector: protocol 1, capacity 5, count 5 (full), LRU policy, resetEpoch
// 0x01020304, evictionCount 0x0a, cccdReject 2, invariant 7, flags writePending
// (bit 2) + usageDirty (bit 4) => 0b10100 = 0x14.
const golden = Uint8Array.from([
  1, // protocol
  5, // capacity
  5, // count
  1, // policy LRU
  0x04, 0x03, 0x02, 0x01, // resetEpoch LE
  0x0a, 0x00, 0x00, 0x00, // evictionCount LE
  0x02, 0x00, // cccdReject
  0x07, 0x00, // invariant
  0x14, 0x00, 0x00, 0x00, // flags LE
]);

test('the generated contract wires straight through', () => {
  assert.equal(MANAGEMENT_STATUS_SIZE, 20);
  assert.equal(MANAGEMENT_PROTOCOL_VERSION, 1);
  assert.equal(MANAGEMENT_CAPACITY, 5);
  assert.equal(MANAGEMENT_POLICY_LRU, 1);
  assert.equal(BRIDGE_CHAR.companionStatus, 33);
  assert.equal(BRIDGE_CHAR.companionVerify, 34);
  // Both reads sit on the same 000b service, status public, verify authenticated.
  assert.equal(GATT_CHARACTERISTICS.companionStatus.authenticated, false);
  assert.equal(GATT_CHARACTERISTICS.companionVerify.authenticated, true);
  assert.equal(GATT_CHARACTERISTICS.companionStatus.service, GATT_CHARACTERISTICS.companionVerify.service);
});

test('decodes the golden vector field by field', () => {
  const s = decodeCompanionManagementStatus(golden);
  assert.equal(s.protocolVersion, 1);
  assert.equal(s.capacity, 5);
  assert.equal(s.count, 5);
  assert.equal(s.evictionPolicy, 'lru');
  assert.equal(s.resetEpoch, 0x01020304);
  assert.equal(s.evictionCount, 10);
  assert.equal(s.cccdReject, 2);
  assert.equal(s.invariant, 7);
  assert.equal(s.atCapacity, true);
  assert.deepEqual(s.flags, {
    legacyReset: false,
    storeInvalid: false,
    writePending: true,
    criticalDirty: false,
    usageDirty: true,
  });
});

test('encode is the inverse of decode', () => {
  const bytes = encodeCompanionManagementStatus({
    count: 5,
    resetEpoch: 0x01020304,
    evictionCount: 10,
    cccdReject: 2,
    invariant: 7,
    flags: { writePending: true, usageDirty: true },
  });
  assert.deepEqual([...bytes], [...golden]);
  assert.deepEqual(decodeCompanionManagementStatus(bytes), decodeCompanionManagementStatus(golden));
});

test('atCapacity is false below capacity', () => {
  const s = decodeCompanionManagementStatus(
    encodeCompanionManagementStatus({ count: 4, resetEpoch: 1, evictionCount: 0 }),
  );
  assert.equal(s.atCapacity, false);
});

test('resetEpoch and evictionCount are unsigned 32-bit', () => {
  const s = decodeCompanionManagementStatus(
    encodeCompanionManagementStatus({ count: 0, resetEpoch: 0xfffffffe, evictionCount: 0xffffffff }),
  );
  assert.equal(s.resetEpoch, 0xfffffffe);
  assert.equal(s.evictionCount, 0xffffffff);
});

test('every flag bit decodes to its own field', () => {
  const cases: [Parameters<typeof encodeCompanionManagementStatus>[0]['flags'], string][] = [
    [{ legacyReset: true }, 'legacyReset'],
    [{ storeInvalid: true }, 'storeInvalid'],
    [{ writePending: true }, 'writePending'],
    [{ criticalDirty: true }, 'criticalDirty'],
    [{ usageDirty: true }, 'usageDirty'],
  ];
  for (const [flags, name] of cases) {
    const s = decodeCompanionManagementStatus(
      encodeCompanionManagementStatus({ count: 0, resetEpoch: 0, evictionCount: 0, flags }),
    );
    assert.equal((s.flags as unknown as Record<string, boolean>)[name], true, `${name} set`);
    const others = Object.entries(s.flags).filter(([k]) => k !== name);
    assert.ok(others.every(([, v]) => v === false), `only ${name} set`);
  }
});

test('rejects a wrong-length payload', () => {
  assert.throws(() => decodeCompanionManagementStatus(new Uint8Array(MANAGEMENT_STATUS_SIZE - 1)), ManagementProtocolError);
  assert.throws(() => decodeCompanionManagementStatus(new Uint8Array(MANAGEMENT_STATUS_SIZE + 1)), ManagementProtocolError);
});

test('rejects an unknown protocol version', () => {
  const bytes = encodeCompanionManagementStatus({ count: 0, resetEpoch: 0, evictionCount: 0, protocolVersion: 2 });
  assert.throws(() => decodeCompanionManagementStatus(bytes), /protocol version 2/);
});

test('rejects a capacity that disagrees with the contract', () => {
  const bytes = encodeCompanionManagementStatus({ count: 0, resetEpoch: 0, evictionCount: 0, capacity: 8 });
  assert.throws(() => decodeCompanionManagementStatus(bytes), /capacity 8 disagrees/);
});

test('rejects an unknown eviction policy', () => {
  const bytes = encodeCompanionManagementStatus({ count: 0, resetEpoch: 0, evictionCount: 0, policy: 2 });
  assert.throws(() => decodeCompanionManagementStatus(bytes), /eviction policy 2/);
});

test('rejects a count above capacity', () => {
  const bytes = encodeCompanionManagementStatus({ count: 6, resetEpoch: 0, evictionCount: 0 });
  assert.throws(() => decodeCompanionManagementStatus(bytes), /count 6 exceeds capacity 5/);
});
