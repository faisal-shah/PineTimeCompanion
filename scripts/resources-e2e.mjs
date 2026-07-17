#!/usr/bin/env node
// External-resources integration test against a live InfiniSim, driving the REAL
// fsClient/resourcesUpload over a Node TCP transport (the WatchTransport the app
// uses). Pushes an actual infinitime-resources-*.zip over the BLE filesystem,
// then LISTDIR-verifies every file landed at its target path with the right size.
//
// Prereqs: sim running with the FS-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/resources-e2e.mjs [path-to-resources-zip]

import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseResourcesArchive } from '../src/ble/resourcesZip.ts';
import { uploadResources } from '../src/ble/resourcesUpload.ts';
import { FsClient } from '../src/ble/fsClient.ts';

const PORT = 18632;
const HOST = '127.0.0.1';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'res-fixture-'));
  execFileSync('gh', ['release', 'download', '--repo', 'faisal-shah/InfiniTime', '--pattern', '*resources*.zip', '--dir', dir, '--clobber'], { stdio: 'inherit' });
  zipPath = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.endsWith('.zip'));
}
const archive = parseResourcesArchive(new Uint8Array(fs.readFileSync(zipPath)));
console.log(`fixture: ${path.basename(zipPath)} — ${archive.files.length} files, ${archive.obsolete.length} obsolete`);

const t = makeTransport();
await t.connect();

let lastPct = -1;
await uploadResources(t, archive, (p) => {
  const pct = p.totalBytes ? Math.floor((p.sentBytes / p.totalBytes) * 100) : 0;
  if (p.phase === 'write' && pct !== lastPct && pct % 20 === 0) {
    console.log(`  ${pct}%`);
    lastPct = pct;
  } else if (p.phase !== 'write') {
    console.log(`  ${p.phase}: ${p.path}`);
  }
});
console.log(`uploaded ${archive.files.length} files`);

// --- verify: LISTDIR each target directory and match filename + size ---
const byDir = new Map();
for (const f of archive.files) {
  const dir = f.path.slice(0, f.path.lastIndexOf('/')) || '/';
  if (!byDir.has(dir)) byDir.set(dir, new Map());
  byDir.get(dir).set(f.path.slice(f.path.lastIndexOf('/') + 1), f.data.length);
}

const client = new FsClient(t);
await client.begin();
let ok = true;
for (const [dir, expected] of byDir) {
  const entries = await client.listDir(dir);
  const found = new Map(entries.map((e) => [e.path, e.size]));
  for (const [name, size] of expected) {
    const got = found.get(name);
    if (got !== size) {
      ok = false;
      console.log(`  MISMATCH ${dir}/${name}: expected ${size} B, got ${got ?? '(absent)'}`);
    }
  }
  console.log(`  ${dir}: ${expected.size} expected, all present: ${[...expected].every(([n, s]) => found.get(n) === s)}`);
}
client.end();
await t.disconnect();

console.log(ok ? 'RESOURCES E2E PASS' : 'RESOURCES E2E FAIL');
process.exit(ok ? 0 : 1);
