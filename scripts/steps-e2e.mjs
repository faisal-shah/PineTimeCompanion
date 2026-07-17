#!/usr/bin/env node
// Step-read e2e against a live InfiniSim: bumps the sim's step counter via the
// simctl hotkey, then reads it back through the REAL readSteps over a Node TCP
// transport (the WatchTransport the app uses).
//
// Prereqs: sim running with the steps-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/steps-e2e.mjs

import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readSteps } from '../src/ble/syncManager.ts';

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

const before = await readSteps(makeTransport(), `${HOST}:${PORT}`);
console.log('steps before bump:', before);

const BUMPS = 20;
for (let i = 0; i < BUMPS; i++) sim('key', 'steps-up');

const after = await readSteps(makeTransport(), `${HOST}:${PORT}`);
console.log('steps after bump:', after);

const pass = after > before;
console.log(pass ? 'STEPS E2E PASS' : 'STEPS E2E FAIL');
process.exit(pass ? 0 : 1);
