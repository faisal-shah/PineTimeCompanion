import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from 'react-native-ble-plx';
import { connectAndDiscover, CONNECT_TIMEOUT_MS, type ConnectableManager } from './bleConnect';
import { TransportError } from './transportError';

// Minimal Device stand-in: only the two methods the helper touches. Never
// imports the ble-plx runtime, so this runs under plain Node.
function fakeDevice(opts: {
  discoverThrows?: Error;
  cancelThrows?: Error;
  discoveredDevice?: Device;
}): Device & { discoverCalls: number; cancelCalls: number } {
  const d = {
    discoverCalls: 0,
    cancelCalls: 0,
    async discoverAllServicesAndCharacteristics() {
      d.discoverCalls++;
      if (opts.discoverThrows) {
        throw opts.discoverThrows;
      }
      return opts.discoveredDevice ?? d;
    },
    async cancelConnection() {
      d.cancelCalls++;
      if (opts.cancelThrows) {
        throw opts.cancelThrows;
      }
      return d;
    },
  };
  return d as unknown as Device & { discoverCalls: number; cancelCalls: number };
}

function manager(device: Device | Error): ConnectableManager & { connectCalls: number; lastTimeout?: number } {
  const m = {
    connectCalls: 0,
    lastTimeout: undefined as number | undefined,
    async connectToDevice(_id: string, options?: { timeout?: number }) {
      m.connectCalls++;
      m.lastTimeout = options?.timeout;
      if (device instanceof Error) {
        throw device;
      }
      return device;
    },
  };
  return m;
}

test('returns the connected+discovered device on success', async () => {
  const device = fakeDevice({});
  const m = manager(device);
  const result = await connectAndDiscover(m, 'AA:BB');
  assert.equal(result, device);
  assert.equal(device.discoverCalls, 1, 'discovery ran');
  assert.equal(device.cancelCalls, 0, 'a good link is not cancelled');
  assert.equal(m.lastTimeout, CONNECT_TIMEOUT_MS, 'connect uses the default timeout');
});

test('returns the device instance produced by discovery', async () => {
  const discovered = {} as Device;
  const connected = fakeDevice({ discoveredDevice: discovered });
  const result = await connectAndDiscover(manager(connected), 'AA:BB');
  assert.equal(result, discovered);
  assert.equal(connected.cancelCalls, 0);
});

test('a discovery failure after a successful open releases the partial link', async () => {
  const boom = new Error('service discovery failed');
  const device = fakeDevice({ discoverThrows: boom });
  const m = manager(device);
  await assert.rejects(connectAndDiscover(m, 'AA:BB'), (e) => {
    assert.ok(e instanceof TransportError);
    assert.match((e as Error).message, /service discovery failed/);
    assert.equal((e as TransportError).cause, boom, 'wraps the original error');
    return true;
  });
  assert.equal(device.cancelCalls, 1, 'the half-open link is cancelled, not leaked');
});

test('a failed open has no device to cancel and still surfaces the error', async () => {
  const boom = new Error('could not connect');
  const m = manager(boom);
  await assert.rejects(connectAndDiscover(m, 'AA:BB'), (e) => {
    assert.ok(e instanceof TransportError);
    assert.match((e as Error).message, /could not connect/);
    return true;
  });
  assert.equal(m.connectCalls, 1);
});

test('a cancelConnection that itself throws does not mask the original failure', async () => {
  const discoveryErr = new Error('discovery blew up');
  const device = fakeDevice({ discoverThrows: discoveryErr, cancelThrows: new Error('cancel failed too') });
  const m = manager(device);
  await assert.rejects(connectAndDiscover(m, 'AA:BB'), (e) => {
    // The discovery error survives, not the cleanup error.
    assert.match((e as Error).message, /discovery blew up/);
    assert.equal((e as TransportError).cause, discoveryErr);
    return true;
  });
  assert.equal(device.cancelCalls, 1, 'cleanup was attempted');
});

test('a custom timeout is forwarded to connectToDevice', async () => {
  const device = fakeDevice({});
  const m = manager(device);
  await connectAndDiscover(m, 'AA:BB', 5000);
  assert.equal(m.lastTimeout, 5000);
});
