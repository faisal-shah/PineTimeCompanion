#!/usr/bin/env node
// DFU integration test against a live InfiniSim, driving the REAL legacyDfu.ts
// client through a Node TCP transport (same WatchTransport interface the app
// uses). Flashes an actual InfiniTime release zip end to end and asserts the
// watch's CRC-validate passes; then a byte-corrupted image must be rejected.
//
// Prereqs: sim running with the DFU-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/dfu-e2e.mjs [path-to-dfu-zip]
// If no zip is given, downloads the latest InfiniTime release DFU zip via gh.

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runDfu, DfuAbortedError } from '../src/ble/legacyDfu.ts';
import { parseDfuArchive } from '../src/ble/dfuZip.ts';
import { BRIDGE_CHAR } from '../src/ble/transport.ts';

const PORT = 18632;
const HOST = '127.0.0.1';

// Minimal Node TCP transport implementing WatchTransport over the sim bridge,
// including the notification-frame routing that ws/tcpTransport.ts do.
function makeTransport() {
  let sock;
  let buf = Buffer.alloc(0);
  const pending = [];
  const subs = new Map();
  const parse = () => {
    for (;;) {
      if (buf.length >= 1 && buf[0] === 0xf0) {
        if (buf.length < 4) break;
        const len = buf.readUInt16LE(2);
        if (buf.length < 4 + len) break;
        const charId = buf[1];
        const payload = new Uint8Array(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
        subs.get(charId)?.forEach((cb) => cb(payload));
      } else {
        if (buf.length < 3) break;
        const len = buf.readUInt16LE(1);
        if (buf.length < 3 + len) break;
        const status = buf[0];
        const payload = new Uint8Array(buf.subarray(3, 3 + len));
        buf = buf.subarray(3 + len);
        pending.shift()?.({ status, payload });
      }
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
        sock.on('data', (d) => {
          buf = Buffer.concat([buf, d]);
          parse();
        });
      });
    },
    async requestMtu() {
      return 512;
    },
    write(charId, data) {
      return new Promise((resolve, reject) => {
        pending.push(({ status }) => (status === 0 ? resolve() : reject(new Error(`write char ${charId} status ${status}`))));
        frame(charId, 0, data);
      });
    },
    async writeWithoutResponse(charId, data) {
      frame(charId, 2, data);
    },
    read(charId) {
      return new Promise((resolve, reject) => {
        pending.push(({ status, payload }) => (status === 0 ? resolve(payload) : reject(new Error(`read char ${charId} status ${status}`))));
        frame(charId, 1, new Uint8Array(0));
      });
    },
    async subscribe(charId, cb) {
      let set = subs.get(charId);
      if (!set) subs.set(charId, (set = new Set()));
      set.add(cb);
      return () => set.delete(cb);
    },
    async disconnect() {
      sock?.end();
    },
  };
}

// --- fixture ---
let zipPath = process.argv[2];
if (!zipPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfu-fixture-'));
  execFileSync('gh', ['release', 'download', '--repo', 'faisal-shah/InfiniTime', '--pattern', '*app-dfu*.zip', '--dir', dir, '--clobber'], { stdio: 'inherit' });
  zipPath = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.endsWith('.zip'));
}
const archive = parseDfuArchive(new Uint8Array(fs.readFileSync(zipPath)));
console.log(`fixture: ${path.basename(zipPath)} — ${archive.binFile.length} B image, crc16 ${archive.crc16}`);

const readVersion = async (t) => new TextDecoder().decode(await t.read(BRIDGE_CHAR.firmwareRevision));

// Order matters against the sim: a failed validate calls the firmware's Reset()
// (state -> Idle), so the corrupt run leaves the watch ready for another DFU.
// The valid run ends in Activate+Reset, which reboots real hardware but leaves
// the in-process sim non-Idle — so it must go last.

// --- negative: corrupted image must fail the watch CRC ---
// The firmware never notifies the CRC error (Reset() stops the AsyncSend timer
// before it fires), so runDfu surfaces the rejection as a DfuAbortedError on the
// validate timeout — that IS the real-world failure signal.
let crcRejected = false;
{
  const t = makeTransport();
  await t.connect();
  console.log('watch firmware version:', await readVersion(t));
  const corrupt = { ...archive, binFile: archive.binFile.slice() };
  corrupt.binFile[Math.floor(corrupt.binFile.length / 2)] ^= 0xff; // flip a byte
  try {
    await runDfu(t, corrupt);
    console.log('1. corrupted image -> UNEXPECTEDLY accepted');
  } catch (e) {
    crcRejected = e instanceof DfuAbortedError;
    console.log('1. corrupted image ->', crcRejected ? 'rejected (not validated/activated) ✓' : `unexpected: ${e.message}`);
  }
  await t.disconnect();
}

// Let the watch settle back to Idle before the next DFU connection.
await new Promise((r) => setTimeout(r, 1500));

// --- happy path: real image validates + activates ---
let activated = false;
{
  const t = makeTransport();
  await t.connect();
  let lastPct = -1;
  await runDfu(t, archive, (p) => {
    const pct = p.total ? Math.floor((p.sent / p.total) * 100) : 0;
    if (p.phase === 'transfer' && pct !== lastPct && pct % 20 === 0) {
      console.log(`  transfer ${pct}%`);
      lastPct = pct;
    } else if (p.phase !== 'transfer') {
      console.log(`  phase: ${p.phase}`);
    }
  });
  await t.disconnect();
  activated = true;
  console.log('2. real image -> Activate+Reset reached (CRC validated on watch) ✓');
}

const pass = crcRejected && activated;
console.log(pass ? 'DFU E2E PASS' : 'DFU E2E FAIL');
process.exit(pass ? 0 : 1);
