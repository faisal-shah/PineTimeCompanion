import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MTU, withConnection } from './transport';
import { encodeCurrentWeather, encodeForecast } from './weatherProtocol';

// The ATT default of 23 leaves a 20-byte payload. Anything longer is silently
// truncated on real hardware, and neither the simulator (TCP bridge, no MTU)
// nor the web build (Chrome negotiates for us) can catch it — so pin it here.
const ATT_DEFAULT_PAYLOAD = 20;

class FakeTransport {
  mtuRequested: number | null = null;
  connected = false;
  disconnected = false;
  constructor(private readonly mtuFails = false) {}

  async connect(): Promise<void> {
    this.connected = true;
  }
  async requestMtu(mtu: number): Promise<number> {
    if (this.mtuFails) {
      throw new Error('watch refused');
    }
    this.mtuRequested = mtu;
    return mtu;
  }
  async disconnect(): Promise<void> {
    this.disconnected = true;
  }
  async write(): Promise<void> {}
  async writeWithoutResponse(): Promise<void> {}
  async read(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async subscribe(): Promise<() => void> {
    return () => undefined;
  }
}

test('withConnection negotiates an MTU by default', async () => {
  const t = new FakeTransport();
  await withConnection(t as never, 'dev', async () => undefined);
  assert.equal(t.mtuRequested, DEFAULT_MTU);
  assert.ok(t.disconnected, 'still disconnects');
});

test('a watch that refuses the MTU does not fail the operation', async () => {
  const t = new FakeTransport(true);
  let ran = false;
  await withConnection(t as never, 'dev', async () => {
    ran = true;
  });
  assert.ok(ran, 'the body still runs');
  assert.ok(t.disconnected, 'still disconnects');
});

test('the messages that motivated this all exceed the default ATT payload', () => {
  // Regression guards: if any of these shrink below the limit the negotiation
  // still matters for the others, but these are the ones that broke.
  const current = encodeCurrentWeather({ timestamp: 0, temp: 2600, min: 2500, max: 3600, icon: 0 });
  const forecast = encodeForecast(0, Array.from({ length: 5 }, () => ({ min: 2500, max: 3600, icon: 0 })));
  assert.ok(current.length > ATT_DEFAULT_PAYLOAD, `current weather is ${current.length} B`);
  assert.ok(forecast.length > ATT_DEFAULT_PAYLOAD, `forecast is ${forecast.length} B`);

  // The current-weather icon sits at byte 48 — far past a truncated write,
  // which is why the watch showed an "unknown" icon while the phone showed sun.
  assert.equal(current.length, 53);
  assert.ok(48 > ATT_DEFAULT_PAYLOAD);
});
