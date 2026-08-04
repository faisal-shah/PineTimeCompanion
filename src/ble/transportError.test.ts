import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBleError, isRetryableKind, TransportError } from './transportError';

// Minimal stand-ins for the error shapes each platform throws. We never import
// react-native-ble-plx or construct a real DOMException — the classifier only
// duck-types these fields.
function bleError(fields: { errorCode?: number; attErrorCode?: number; reason?: string; message?: string }) {
  return { name: 'BleError', ...fields };
}
function domException(name: string, message = '') {
  return { name, message };
}

test('ATT authorization (status 8) is generic authorization in general context, DFU-disabled in DFU context', () => {
  const raw = bleError({ errorCode: 401, attErrorCode: 0x08, reason: 'GATT write failed' });
  const general = classifyBleError(raw);
  assert.equal(general.kind, 'authorization', 'general context: a plain access refusal');
  assert.equal(general.retryable, false);
  assert.equal(general.attErrorCode, 0x08);
  assert.equal(general.reason, 'GATT write failed', 'preserves the ble-plx reason');
  assert.equal(general.bleErrorCode, 401, 'preserves the ble-plx error code');

  const dfu = classifyBleError(raw, 'dfu');
  assert.equal(dfu.kind, 'dfuDisabled', 'DFU/FS context: "Firmware & files" disabled');
  assert.equal(dfu.retryable, false);
  assert.equal(dfu.attErrorCode, 0x08);
});

test('a status-8 message classifies by context too', () => {
  assert.equal(classifyBleError(new Error('write rejected (status 8)')).kind, 'authorization');
  assert.equal(classifyBleError(new Error('write rejected (status 8)'), 'dfu').kind, 'dfuDisabled');
  assert.equal(classifyBleError(new Error('BLE_ATT_ERR_INSUFFICIENT_AUTHOR')).kind, 'authorization');
  assert.equal(classifyBleError(new Error('BLE_ATT_ERR_INSUFFICIENT_AUTHOR'), 'dfu').kind, 'dfuDisabled');
});

test('an already-classified TransportError is re-specialized under a DFU context', () => {
  // A general-context authorization error, as a transport would wrap it.
  const wrapped = new TransportError('write rejected (status 8)', bleError({ attErrorCode: 0x08 }));
  assert.equal(wrapped.kind, 'authorization', 'wrapped in general context');
  assert.equal(classifyBleError(wrapped, 'dfu').kind, 'dfuDisabled', 'DFU context re-specializes it');
  assert.equal(classifyBleError(wrapped).kind, 'authorization', 'general context leaves it generic');
});

test('authorization and dfuDisabled are both non-retryable', () => {
  assert.equal(isRetryableKind('authorization'), false);
  assert.equal(isRetryableKind('dfuDisabled'), false);
});

test('ATT authentication / encryption codes classify as authentication', () => {
  for (const att of [0x05, 0x0f, 0x0c]) {
    const meta = classifyBleError(bleError({ attErrorCode: att }));
    assert.equal(meta.kind, 'authentication', `att 0x${att.toString(16)}`);
    assert.equal(meta.retryable, false);
  }
});

test('ble-plx transient codes classify as transient and retryable', () => {
  const transientCodes = [3 /*timeout*/, 4 /*start failed*/, 200 /*conn failed*/, 201 /*disconnected*/, 203 /*already connected*/, 205 /*not connected*/, 104 /*resetting*/];
  for (const code of transientCodes) {
    const meta = classifyBleError(bleError({ errorCode: code }));
    assert.equal(meta.kind, 'transient', `errorCode ${code}`);
    assert.equal(meta.retryable, true);
  }
});

test('Bluetooth-off, permission, cancelled and not-found ble-plx codes', () => {
  assert.equal(classifyBleError(bleError({ errorCode: 102 })).kind, 'bluetoothOff');
  assert.equal(classifyBleError(bleError({ errorCode: 101 })).kind, 'permission');
  assert.equal(classifyBleError(bleError({ errorCode: 601 })).kind, 'permission');
  assert.equal(classifyBleError(bleError({ errorCode: 2 })).kind, 'cancelled');
  assert.equal(classifyBleError(bleError({ errorCode: 204 })).kind, 'notFound');
  for (const kind of ['bluetoothOff', 'permission', 'cancelled', 'notFound'] as const) {
    assert.equal(isRetryableKind(kind), false, `${kind} is not retryable`);
  }
});

test('Web Bluetooth DOMException names classify and are preserved', () => {
  assert.deepEqual(pick(classifyBleError(domException('NotFoundError'))), { kind: 'notFound', domName: 'NotFoundError' });
  assert.deepEqual(pick(classifyBleError(domException('SecurityError'))), { kind: 'permission', domName: 'SecurityError' });
  assert.deepEqual(pick(classifyBleError(domException('NotAllowedError'))), { kind: 'permission', domName: 'NotAllowedError' });
  assert.deepEqual(pick(classifyBleError(domException('AbortError'))), { kind: 'cancelled', domName: 'AbortError' });
  assert.deepEqual(pick(classifyBleError(domException('NetworkError'))), { kind: 'transient', domName: 'NetworkError' });
  assert.deepEqual(pick(classifyBleError(domException('InvalidStateError'))), { kind: 'transient', domName: 'InvalidStateError' });
});

test('message heuristics cover the plain-string / wrapped cases', () => {
  assert.equal(classifyBleError(new Error('BLE_ATT_ERR_INSUFFICIENT_AUTHOR')).kind, 'authorization');
  assert.equal(classifyBleError(new Error('write rejected (status 8)')).kind, 'authorization');
  assert.equal(classifyBleError(new Error('insufficient encryption; needs pairing')).kind, 'authentication');
  assert.equal(classifyBleError(new Error('Bluetooth is off')).kind, 'bluetoothOff');
  assert.equal(classifyBleError(new Error('missing BLUETOOTH_CONNECT permission')).kind, 'permission');
  assert.equal(classifyBleError(new Error('operation cancelled by user')).kind, 'cancelled');
  assert.equal(classifyBleError(new Error('device not found')).kind, 'notFound');
  assert.equal(classifyBleError(new Error('operation already in progress')).kind, 'transient');
  assert.equal(classifyBleError(new Error('device disconnected')).kind, 'transient');
  assert.equal(classifyBleError(new Error('some totally novel failure')).kind, 'unknown');
});

test('an unknown error is never retried', () => {
  const meta = classifyBleError(new Error('???'));
  assert.equal(meta.kind, 'unknown');
  assert.equal(meta.retryable, false);
});

test('TransportError classifies from its cause automatically', () => {
  const wrapped = new TransportError('BLE connect failed: device disconnected', bleError({ errorCode: 201 }));
  assert.equal(wrapped.kind, 'transient');
  assert.equal(wrapped.retryable, true);
  assert.equal(wrapped.metadata.bleErrorCode, 201);
});

test('classifying an already-classified TransportError is idempotent', () => {
  const authz = new TransportError('write rejected', bleError({ attErrorCode: 0x08 }));
  const rewrapped = new TransportError('outer', authz);
  assert.equal(rewrapped.kind, 'authorization', 'inherits the inner classification, does not re-guess');
});

test('TransportError with no cause is unknown, and an explicit kind wins', () => {
  assert.equal(new TransportError('not connected').kind, 'unknown');
  const forced = new TransportError('x', undefined, { kind: 'transient' });
  assert.equal(forced.kind, 'transient');
  assert.equal(forced.retryable, true, 'retryable derives from the forced kind');
});

test('TransportError.from returns the same instance for an existing TransportError', () => {
  const e = new TransportError('boom');
  assert.equal(TransportError.from(e), e);
  const wrapped = TransportError.from(bleError({ errorCode: 102 }), 'connect failed');
  assert.equal(wrapped.kind, 'bluetoothOff');
  assert.equal(wrapped.message, 'connect failed');
});

function pick(meta: { kind: string; domName?: string }) {
  return { kind: meta.kind, domName: meta.domName };
}
