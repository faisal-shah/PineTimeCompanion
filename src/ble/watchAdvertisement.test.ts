import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNNAMED_WATCH, isWatchAdvertisement, watchDisplayName } from './watchAdvertisement';

const DFU = '00001530-1212-efde-1523-785feabcd123';

// The case the old filter got wrong, and the reason discovery needed a reset:
// the name is in the scan response, a second packet, and a duty-cycled scan
// routinely reports the advertisement on its own.
test('a watch is recognised from its advertisement alone, with no name', () => {
  assert.ok(isWatchAdvertisement({ name: null, serviceUUIDs: [DFU] }));
  assert.equal(watchDisplayName({ name: null, serviceUUIDs: [DFU] }), UNNAMED_WATCH);
});

test('the service UUID matches whatever case the platform reports', () => {
  assert.ok(isWatchAdvertisement({ serviceUUIDs: [DFU.toUpperCase()] }));
});

test('the name still matches when the scan response did arrive', () => {
  assert.ok(isWatchAdvertisement({ name: 'InfiniTime', serviceUUIDs: [] }));
  assert.ok(isWatchAdvertisement({ name: 'Pinetime-1', serviceUUIDs: null }));
  assert.ok(isWatchAdvertisement({ localName: 'InfiniTime' }));
  assert.equal(watchDisplayName({ name: 'InfiniTime' }), 'InfiniTime');
});

test('other devices are not offered as watches', () => {
  assert.ok(!isWatchAdvertisement({ name: 'Galaxy Buds', serviceUUIDs: ['0000180d-0000-1000-8000-00805f9b34fb'] }));
  assert.ok(!isWatchAdvertisement({ name: null, serviceUUIDs: null }));
  assert.ok(!isWatchAdvertisement({}));
});

// The heart-rate UUID is advertised too, but it is a standard assigned number
// that any chest strap also carries; only the DFU UUID identifies InfiniTime.
test('a bare heart-rate advertiser is not mistaken for a watch', () => {
  assert.ok(!isWatchAdvertisement({ name: 'HRM-Dual', serviceUUIDs: ['0000180d-0000-1000-8000-00805f9b34fb'] }));
});
