#!/usr/bin/env node
// Watch-side music e2e against a live InfiniSim: pushes now-playing metadata to
// the REAL firmware MusicService over the TCP bridge, drives the watch's Music
// app by touch injection, and asserts the exact control-event bytes the watch
// notifies back (including OPEN on app entry). Fully headless; no Android.
//
// Prereqs: sim running with the music-enabled GATT bridge (simctl.py start).
//   npx tsx scripts/music-watch-e2e.mjs

import net from 'node:net';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PORT = 18632;
const HOST = '127.0.0.1';
const SIMCTL = new URL('../../pinetime-dev-tools/simctl.py', import.meta.url).pathname;
const SHOTS = new URL('../../pinetime-dev-tools/shots/', import.meta.url).pathname;

// Bridge charIds (sim/gatt_bridge.h).
const CHAR = {
  status: 17, artist: 18, track: 19, album: 20, position: 21,
  totalLength: 22, playbackSpeed: 25, musicEvent: 28,
};
const EVENT = { OPEN: 0xe0, PLAY: 0x00, PAUSE: 0x01, NEXT: 0x03, PREV: 0x04, VOLUP: 0x05, VOLDOWN: 0x06 };
const EVENT_NAME = Object.fromEntries(Object.entries(EVENT).map(([k, v]) => [v, k]));

// --- transport with a notify collector ---
let sock;
let buf = Buffer.alloc(0);
const pending = [];
const notifies = []; // {charId, payload}
function parse() {
  for (;;) {
    if (buf.length >= 1 && buf[0] === 0xf0) {
      if (buf.length < 4) break;
      const len = buf.readUInt16LE(2);
      if (buf.length < 4 + len) break;
      notifies.push({ charId: buf[1], payload: new Uint8Array(buf.subarray(4, 4 + len)) });
      buf = buf.subarray(4 + len);
    } else {
      if (buf.length < 3) break;
      const len = buf.readUInt16LE(1);
      if (buf.length < 3 + len) break;
      const status = buf[0];
      buf = buf.subarray(3 + len);
      pending.shift()?.(status);
    }
  }
}
function connect() {
  return new Promise((res, rej) => {
    sock = net.createConnection({ port: PORT, host: HOST }, res);
    sock.on('error', rej);
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); parse(); });
  });
}
function write(charId, data) {
  return new Promise((resolve, reject) => {
    pending.push((status) => (status === 0 ? resolve() : reject(new Error(`write char ${charId} status ${status}`))));
    const h = Buffer.alloc(4);
    h[0] = charId; h[1] = 0; h.writeUInt16LE(data.length, 2);
    sock.write(Buffer.concat([h, Buffer.from(data)]));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u32be = (v) => new Uint8Array([(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
const utf8 = (s) => new TextEncoder().encode(s);

// Wait for a music event byte (drains matching notifies).
async function expectEvent(byte, what, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const i = notifies.findIndex((n) => n.charId === CHAR.musicEvent && n.payload[0] === byte);
    if (i >= 0) {
      notifies.splice(i, 1);
      console.log(`  event ${EVENT_NAME[byte]} (0x${byte.toString(16)}) ✓  [${what}]`);
      return;
    }
    await sleep(150);
  }
  throw new Error(`no ${EVENT_NAME[byte]} event within ${timeoutMs}ms [${what}]; got ${JSON.stringify(notifies.map((n) => [n.charId, [...n.payload]]))}`);
}

const sim = (...a) => execFileSync('python3', [SIMCTL, ...a], { stdio: 'ignore' });
const awake = () => { try { sim('awake'); } catch {} };
const tap = (x, y) => { awake(); sim('--settle', '1.0', 'tap', String(x), String(y)); };
const swipe = (dir) => { awake(); sim('--settle', '1.0', 'swipe', dir); };
const shot = (name) => { awake(); sim('--settle', '1.0', 'shot', name); };

// --- run ---
await connect();

// 1. Push metadata (Status=1 first so the progress clock runs).
await write(CHAR.status, new Uint8Array([1]));
await write(CHAR.artist, utf8('Daft Punk'));
await write(CHAR.track, utf8('Harder Better Faster'));
await write(CHAR.album, utf8('Discovery'));
await write(CHAR.totalLength, u32be(240));
await write(CHAR.position, u32be(42));
await write(CHAR.playbackSpeed, u32be(100));
console.log('1. metadata pushed');

// 2. Navigate: watchface -> launcher p1 -> p2 -> Music (top-middle).
awake(); sim('--settle', '1.0', 'button'); // ensure watchface
swipe('up');
swipe('up');
shot('music-e2e-before-open');
tap(120, 85); // Music tile
await expectEvent(EVENT.OPEN, 'app entry');
shot('music-e2e-playing');
console.log('2. Music app open, metadata rendering (shot music-e2e-playing)');

// 3. Play/pause semantics: Status=1 -> tap sends PAUSE; Status=0 -> tap sends PLAY.
tap(120, 202);
await expectEvent(EVENT.PAUSE, 'play/pause tap while playing');
await write(CHAR.status, new Uint8Array([0]));
await sleep(300);
tap(120, 202);
await expectEvent(EVENT.PLAY, 'play/pause tap while paused');

// 4. Next / prev via taps and swipes.
tap(199, 202);
await expectEvent(EVENT.NEXT, 'next tap');
tap(41, 202);
await expectEvent(EVENT.PREV, 'prev tap');
swipe('left');
await expectEvent(EVENT.NEXT, 'swipe left');
swipe('right');
await expectEvent(EVENT.PREV, 'swipe right');

// 5. Volume row (revealed by swipe up).
swipe('up');
tap(199, 202);
await expectEvent(EVENT.VOLUP, 'vol+ tap');
tap(41, 202);
await expectEvent(EVENT.VOLDOWN, 'vol- tap');
console.log('3. all control events verified');

// 6. Long multibyte artist (60+ bytes; firmware truncates at 40) — must not crash.
await write(CHAR.artist, utf8('Ångström–Ensemble déjà vu ééééééééééééééééééééééé'));
await sleep(500);
shot('music-e2e-truncated');
// Bridge still responsive?
await write(CHAR.status, new Uint8Array([1]));
console.log('4. long multibyte artist handled (watch alive)');

// 7. The before/after shots must differ (metadata actually rendered).
const a = fs.readFileSync(`${SHOTS}/music-e2e-before-open.png`);
const b = fs.readFileSync(`${SHOTS}/music-e2e-playing.png`);
if (a.equals(b)) throw new Error('screenshots identical — Music app did not render');

console.log('MUSIC WATCH E2E PASS');
process.exit(0);
