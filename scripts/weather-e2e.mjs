#!/usr/bin/env node
// Weather push e2e against a live InfiniSim: drives the REAL writeWeather over a
// Node TCP transport (the WatchTransport the app uses), pushing a current-weather
// + forecast message to the SimpleWeatherService. Verify by screenshotting the
// watch face, which renders the pushed temperature + icon.
//
// Prereqs: sim running with the weather-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/weather-e2e.mjs

import net from 'node:net';
import { writeWeather } from '../src/ble/syncManager.ts';
import { WeatherIcon } from '../src/ble/weatherProtocol.ts';

const PORT = 18632;
const HOST = '127.0.0.1';

function makeTransport() {
  let sock;
  let buf = Buffer.alloc(0);
  const pending = [];
  const parse = () => {
    for (;;) {
      if (buf.length < 3) break;
      const len = buf.readUInt16LE(1);
      if (buf.length < 3 + len) break;
      const status = buf[0];
      const payload = new Uint8Array(buf.subarray(3, 3 + len));
      buf = buf.subarray(3 + len);
      pending.shift()?.({ status, payload });
    }
  };
  const frame = (charId, op, data) => {
    const h = Buffer.alloc(4);
    h[0] = charId;
    h[1] = op;
    h.writeUInt16LE(data.length, 2);
    sock.write(Buffer.concat([h, Buffer.from(data)]));
  };
  return {
    async connect() {
      await new Promise((res, rej) => {
        sock = net.createConnection({ port: PORT, host: HOST }, res);
        sock.on('error', rej);
        sock.on('data', (d) => { buf = Buffer.concat([buf, d]); parse(); });
      });
    },
    async requestMtu() { return 256; },
    write(charId, data) {
      return new Promise((resolve, reject) => {
        pending.push(({ status }) => (status === 0 ? resolve() : reject(new Error(`write char ${charId} status ${status}`))));
        frame(charId, 0, data);
      });
    },
    async writeWithoutResponse(charId, data) { frame(charId, 2, data); },
    read(charId) {
      return new Promise((resolve, reject) => {
        pending.push(({ status, payload }) => (status === 0 ? resolve(payload) : reject(new Error(`read char ${charId} status ${status}`))));
        frame(charId, 1, new Uint8Array(0));
      });
    },
    async subscribe() { return () => undefined; },
    async disconnect() { sock?.end(); },
  };
}

const now = Math.floor(Date.now() / 1000);
const current = { timestamp: now, temp: 2150, min: 1500, max: 2500, icon: WeatherIcon.clear, location: 'Testville', sunrise: 360, sunset: 1230 };
const forecast = [
  { min: 1500, max: 2500, icon: WeatherIcon.clear },
  { min: 1600, max: 2400, icon: WeatherIcon.rain },
  { min: 1400, max: 2200, icon: WeatherIcon.broken },
  { min: 1300, max: 2100, icon: WeatherIcon.snow },
  { min: 1200, max: 2000, icon: WeatherIcon.thunder },
];

const t = makeTransport();
await writeWeather(t, `${HOST}:${PORT}`, current, forecast);
console.log('WEATHER PUSHED: 21.5°C current + 5-day forecast');
console.log('(verify: the watch face / Weather app now shows the temperature + icon)');
process.exit(0);
