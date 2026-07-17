#!/usr/bin/env node
// Step-read e2e against a live InfiniSim: bumps the sim's step counter via the
// simctl hotkey, then reads it back through the REAL readSteps over a Node TCP
// transport (the WatchTransport the app uses).
//
// Prereqs: sim running with the steps-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/steps-e2e.mjs

import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readStepCounts, encodeCurrentTime } from '../src/ble/syncManager.ts';

const PORT = 18632;
const HOST = '127.0.0.1';
const SIMCTL = new URL('../../pinetime-dev-tools/simctl.py', import.meta.url).pathname;

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
    h[0] = charId; h[1] = op; h.writeUInt16LE(data.length, 2);
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
    write(charId, data) { return new Promise((resolve, reject) => { pending.push(({ status }) => (status === 0 ? resolve() : reject(new Error(`write ${charId} status ${status}`)))); frame(charId, 0, data); }); },
    async writeWithoutResponse(charId, data) { frame(charId, 2, data); },
    read(charId) { return new Promise((resolve, reject) => { pending.push(({ status, payload }) => (status === 0 ? resolve(payload) : reject(new Error(`read ${charId} status ${status}`)))); frame(charId, 1, new Uint8Array(0)); }); },
    async subscribe() { return () => undefined; },
    async disconnect() { sock?.end(); },
  };
}

const sim = (...a) => execFileSync('python3', [SIMCTL, ...a], { stdio: 'ignore' });
const CURRENT_TIME = 2; // BRIDGE_CHAR.currentTime
const dev = `${HOST}:${PORT}`;

// A standalone connection just to set the watch clock (CTS write triggers the
// firmware's DateTimeController::UpdateTime, which fires OnNewDay at hour 0).
async function setClock(date) {
  const t = makeTransport();
  await t.connect(dev);
  try {
    await t.write(CURRENT_TIME, encodeCurrentTime(date));
  } finally {
    await t.disconnect();
  }
}

// --- 1. today's count reads and increments ---
await setClock(new Date(2026, 6, 17, 12, 0, 0)); // noon, hour != 0
const before = await readStepCounts(makeTransport(), dev);
const BUMPS = 20;
for (let i = 0; i < BUMPS; i++) sim('key', 'steps-up');
const afterBump = await readStepCounts(makeTransport(), dev);
console.log('today before/after bump:', before.today, '->', afterBump.today);

// --- 2. midnight rollover: today should move into yesterday ---
const preRollToday = afterBump.today;
await setClock(new Date(2026, 6, 18, 0, 5, 0)); // next day, hour 0 -> OnNewDay -> AdvanceDay
await new Promise((r) => setTimeout(r, 800)); // let SystemTask process OnNewDay
const afterRoll = await readStepCounts(makeTransport(), dev);
console.log('after rollover — today:', afterRoll.today, 'yesterday:', afterRoll.yesterday, `(expected yesterday = ${preRollToday})`);

const pass =
  afterBump.today > before.today && // today counts
  afterRoll.yesterday === preRollToday && // yesterday holds the pre-rollover total
  afterRoll.today < preRollToday; // today reset at rollover
console.log(pass ? 'STEPS E2E PASS' : 'STEPS E2E FAIL');
process.exit(pass ? 0 : 1);
