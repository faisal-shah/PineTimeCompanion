#!/usr/bin/env node
// Daily-tasks e2e against a live InfiniSim. Pushes a task list to the REAL
// firmware TaskController over the TCP bridge, drives the watch's Tasks app by
// touch injection (open summary -> checklist -> tap rows to tick), and proves
// the watch-only completion + streak logic across midnight rollovers.
//
// Completion is watch-only and never leaves the watch, so it can't be read back
// over the bridge. Its observable consequence is the STREAK: at local midnight
// the watch bumps the streak iff every task was ticked that day. Driving the
// clock past midnight (CTS write, same trick as the steps rollover) and reading
// the digest's streak is therefore a black-box proof that the taps registered,
// that a full day bumps, that an empty/partial day resets, and that the ticks
// are cleared each day. Round E exercises the phone's SetStreak override.
//
// Prereqs: sim running with the tasks-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/tasks-e2e.mjs

import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { encodeBeginSync, encodeTaskMessage, encodeCommitSync, decodeTaskDigest } from '../src/ble/tasksProtocol.ts';
import { encodeCurrentTime, setTaskStreak } from '../src/ble/syncManager.ts';
import { BRIDGE_CHAR } from '../src/ble/transport.ts';

const PORT = 18632;
const HOST = '127.0.0.1';
const dev = `${HOST}:${PORT}`;
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
const settle = (...a) => execFileSync('python3', [SIMCTL, '--settle', '0.8', ...a], { stdio: 'ignore' });
const awake = () => { try { sim('awake'); } catch {} };
const shot = (name) => { awake(); try { sim('--settle', '1.0', 'shot', name); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- bridge ops ---
async function withT(fn) {
  const t = makeTransport();
  await t.connect(dev);
  try { return await fn(t); } finally { await t.disconnect(); }
}
const pushTasks = (tasks, version) => withT(async (t) => {
  await t.write(BRIDGE_CHAR.tasksSync, encodeBeginSync(tasks.length, version));
  for (let i = 0; i < tasks.length; i++) await t.write(BRIDGE_CHAR.tasksSync, encodeTaskMessage(i, tasks[i]));
  await t.write(BRIDGE_CHAR.tasksSync, encodeCommitSync(tasks.length));
  await sleep(200);
});
const digest = () => withT(async (t) => decodeTaskDigest(await t.read(BRIDGE_CHAR.tasksDigest)));
const setClock = (date) => withT((t) => t.write(BRIDGE_CHAR.currentTime, encodeCurrentTime(date)));
async function midnight(nextDay) { await setClock(nextDay); await sleep(900); } // let SystemTask run OnNewDay

// --- watch navigation (coords verified against the Tasks app) ---
// Enter the Tasks app ONCE from the watchface (its launcher tile is page-1
// slot 4), then stay in-app for every round: leaving via `button` lands on the
// launcher, and paging there would open the wrong app. Summary<->checklist is
// driven purely by tap (open) and swipe-down (back), which never leave the app.
function enterTasks() { awake(); settle('swipe', 'up'); settle('tap', '45', '160'); }
const openList = () => { awake(); settle('tap', '120', '120'); }; // tap summary -> checklist
const tickRow = (i) => { awake(); settle('tap', '20', String(48 + i * 48)); };
const backToSummary = () => settle('swipe', 'down'); // checklist page 0 -> summary

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? '✔' : '✗ FAIL'} ${what}`); if (!ok) fails++; };

const TASKS = [
  { id: 1, order: 0, title: 'Brush teeth', lastModified: 1000 },
  { id: 2, order: 1, title: 'Make bed', lastModified: 1000 },
  { id: 3, order: 2, title: 'Read Quran', lastModified: 1000 },
];

// --- 1. push definitions + normalize to a clean slate ---
await setClock(new Date(2026, 6, 20, 12, 0, 0));
await pushTasks(TASKS, 10);
let d = await digest();
check(d.count === 3 && d.capacity === 20 && d.protocolVersion === 1, `push: count=${d.count} cap=${d.capacity} proto=${d.protocolVersion}`);
// A rollover clears whatever ticks were left over; then force streak to a known 0.
await midnight(new Date(2026, 6, 21, 0, 5, 0));
await setTaskStreak(makeTransport(), dev, 0);
d = await digest();
check(d.streak === 0, `baseline streak = 0 (got ${d.streak})`);

// --- Round A: tick all 3 -> midnight -> streak bumps to 1 ---
await setClock(new Date(2026, 6, 21, 23, 0, 0));
enterTasks(); shot('tasks-e2e-summary-empty'); // open the app once; stay in it
openList(); shot('tasks-e2e-list-empty');
tickRow(0); tickRow(1); tickRow(2); shot('tasks-e2e-list-allticked');
backToSummary(); shot('tasks-e2e-summary-alldone');
await midnight(new Date(2026, 6, 22, 0, 5, 0));
d = await digest();
check(d.streak === 1, `Round A: all ticked -> streak 1 (got ${d.streak})`);

// --- Round B: a day with no ticks -> streak resets to 0 (proves ticks clear daily) ---
// OnNewDay fires on the transition INTO hour 0, so step through an evening first.
await setClock(new Date(2026, 6, 22, 22, 0, 0));
await midnight(new Date(2026, 6, 23, 0, 5, 0));
d = await digest();
check(d.streak === 0, `Round B: empty day -> streak 0 & ticks cleared (got ${d.streak})`);

// --- Round C: tick all 3 again -> streak back to 1 ---
await setClock(new Date(2026, 6, 23, 23, 0, 0));
openList(); tickRow(0); tickRow(1); tickRow(2); backToSummary();
await midnight(new Date(2026, 6, 24, 0, 5, 0));
d = await digest();
check(d.streak === 1, `Round C: re-bump -> streak 1 (got ${d.streak})`);

// --- Round D: tick only 2 of 3 -> partial day resets streak ---
await setClock(new Date(2026, 6, 24, 23, 0, 0));
openList(); tickRow(0); tickRow(1); backToSummary(); shot('tasks-e2e-partial');
await midnight(new Date(2026, 6, 25, 0, 5, 0));
d = await digest();
check(d.streak === 0, `Round D: 2 of 3 -> streak 0 (got ${d.streak})`);

// --- Round E: phone overrides the streak (parent forgives a day / sets a reward) ---
await setTaskStreak(makeTransport(), dev, 9);
d = await digest();
check(d.streak === 9, `Round E: phone setStreak(9) read back (got ${d.streak})`);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nTASKS E2E PASS');
process.exit(fails ? 1 : 0);
