import { test } from 'node:test';
import assert from 'node:assert/strict';
// The web factory touches browser globals only inside makeTransport's
// constructors, so importing it under node is safe for selection-logic tests.
import { isSimulatorDeviceId as webIsSim, SIMULATOR_DEVICE_ID as WEB_SIM_ID } from './transportFactory.web';

test('sim-id rule: host:port forms are simulator ids', () => {
  assert.equal(webIsSim(WEB_SIM_ID), true);
  assert.equal(webIsSim('localhost:18633'), true);
  assert.equal(webIsSim('10.0.2.2:18632'), true);
});

test('sim-id rule: BLE identifiers are never simulator ids', () => {
  // Android ble-plx device id: 6-octet MAC.
  assert.equal(webIsSim('E1:5C:12:34:56:78'), false);
  // Web Bluetooth device.id: opaque base64-ish token — alphabet has no ':'.
  assert.equal(webIsSim('Xq0GbIkGz5kKbJkGz5kKbA=='), false);
  assert.equal(webIsSim(''), false);
  assert.equal(webIsSim(undefined), false);
});
