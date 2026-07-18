#!/usr/bin/env node
// Music-control e2e: the full native pipeline on the Android emulator against a
// live InfiniSim. A REAL MediaSession (debug-hosted) drives the REAL
// SystemMediaSource -> MusicBridge -> SimTcpWatchConnection -> firmware
// MusicService; watch taps come back as events that the phone acts on
// (transportControls + volume), asserted via the debug session's command log.
//
// Prereqs: sim running (simctl.py start); emulator with the debug APK.
//   node scripts/music-e2e.mjs   (or npm run music:e2e)

import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

const sh = promisify(execFile);
const PKG = 'dev.faisal.pinetimecompanion';
const RECV = `${PKG}/${PKG}.notifyfwd.DebugConfigReceiver`;
const SIMCTL = new URL('../../pinetime-dev-tools/simctl.py', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => sh('adb', a).then((r) => r.stdout).catch((e) => e.stdout ?? '');
const fail = (m) => { console.log('MUSIC E2E FAIL:', m); process.exit(1); };

// --- preconditions ---
const bridgeUp = await new Promise((r) => { const s = net.createConnection({ host: '127.0.0.1', port: 18632 }, () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
if (!bridgeUp) fail('InfiniSim bridge not listening on 18632 (start the sim)');
if (!(await adb('devices')).split('\n').some((l) => l.trim().endsWith('device'))) fail('no Android emulator/device');
if (!(await adb('shell', 'pm', 'path', PKG)).includes('package:')) fail(`${PKG} not installed`);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const cast = (action, ...extras) => adb('shell', 'am', 'broadcast', '-n', RECV, '-a', `${PKG}.notifyfwd.${action}`, ...extras);
const sim = (...a) => sh('python3', [SIMCTL, ...a]).catch(() => {});
const awake = () => sim('awake');
const tap = async (x, y) => { await awake(); await sim('--settle', '1.0', 'tap', String(x), String(y)); };
const swipe = async (d) => { await awake(); await sim('--settle', '1.0', 'swipe', d); };
const logDump = (...tags) => adb('logcat', '-d', '-s', ...tags);
const mediaQuery = async () => {
  await cast('MEDIA_QUERY');
  await sleep(800);
  const line = (await logDump('NotifyFwd/Debug')).split('\n').filter((l) => l.includes('media query:')).at(-1) ?? '';
  const commands = /commands=\[(.*?)\]/.exec(line)?.[1]?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const volume = Number(/volume=(\d+)/.exec(line)?.[1] ?? -1);
  return { commands, volume, line };
};

// --- 0. grant Notification Access (MediaSessionManager requires it) and reset
// to a known state: persisted config from earlier runs would start the music
// bridge at process boot, before our log capture.
await adb('shell', 'cmd', 'notification', 'allow_listener', `${PKG}/${PKG}.notifyfwd.NotifListenerService`);
await sleep(2000);
await cast('SET_CONFIG', '--es', 'config_b64', b64({ enabledWatches: [], allowedPackages: [], forwardCalls: true }));
await sleep(1500);
await adb('logcat', '-c');

// --- 1. enable forwarding to the sim watch (music rides the same toggle) ---
await cast('SET_CONFIG', '--es', 'config_b64', b64({ enabledWatches: [{ deviceId: '10.0.2.2:18632', name: 'Sim' }], allowedPackages: [], forwardCalls: true }));
await sleep(4000);
if (!(await logDump('NotifyFwd/SimTcp')).includes('connected to sim')) fail('did not connect to the sim');
if (!(await logDump('NotifyFwd/ConnMgr')).includes('music bridge started')) fail('music bridge did not start');
console.log('1. connected; music bridge active');

// --- 2. real MediaSession -> metadata flows to the watch ---
await adb('logcat', '-c');
await cast('MEDIA_START');
await sleep(500);
await cast('MEDIA_SET', '--es', 'artist', 'Queen', '--es', 'track', 'BoRhap', '--es', 'album', 'Opera', '--ei', 'duration', '354', '--ei', 'position', '30', '--ei', 'playing', '1');
await sleep(2500);
const writes = (await logDump('NotifyFwd/SimTcp')).split('\n').filter((l) => l.includes('wrote'));
for (const want of ['MUSIC_ARTIST', 'MUSIC_TRACK', 'MUSIC_TOTAL_LENGTH', 'MUSIC_STATUS']) {
  if (!writes.some((l) => l.includes(want))) fail(`${want} was not written (writes: ${writes.length})`);
}
console.log('2. metadata flowed through the real media path to the watch');

// --- 3. watch renders it (navigate to Music, shot) ---
await awake(); await sim('--settle', '1.0', 'button');
await swipe('up'); await swipe('up');
await tap(120, 85); // Music tile (launcher p2 top-middle)
await sleep(1000);
await sim('--settle', '1.5', 'shot', 'music-e2e-emulator');
console.log('3. Music app open on the watch (shot music-e2e-emulator)');

// --- 4. watch taps drive the phone's media session ---
await tap(199, 202); // NEXT
await sleep(1500);
let q = await mediaQuery();
if (!q.commands.includes('skipToNext')) fail(`skipToNext not received (${q.line})`);
console.log('4. watch NEXT tap -> phone skipToNext ✓');

await tap(120, 202); // playing=1 -> PAUSE
await sleep(1500);
q = await mediaQuery();
if (!q.commands.includes('pause')) fail(`pause not received (${q.line})`);
console.log('5. watch play/pause tap -> phone pause ✓');

// --- 5. volume buttons adjust STREAM_MUSIC ---
const before = (await mediaQuery()).volume;
await swipe('up'); // reveal volume row
await tap(199, 202); // VOLUP
await sleep(1500);
const after = (await mediaQuery()).volume;
if (!(after > before)) fail(`volume did not rise (${before} -> ${after})`);
console.log(`6. watch VOL+ tap -> stream volume ${before} -> ${after} ✓`);

// --- 6. change detection: new track rewrites track, not artist ---
await adb('logcat', '-c');
await cast('MEDIA_SET', '--es', 'artist', 'Queen', '--es', 'track', 'Track2', '--es', 'album', 'Opera', '--ei', 'duration', '200', '--ei', 'position', '0', '--ei', 'playing', '0');
await sleep(2000);
const writes2 = (await logDump('NotifyFwd/SimTcp')).split('\n').filter((l) => l.includes('wrote'));
if (!writes2.some((l) => l.includes('MUSIC_TRACK'))) fail('changed track was not written');
if (writes2.some((l) => l.includes('MUSIC_ARTIST'))) fail('unchanged artist was rewritten (change detection broken)');
console.log('7. change detection: track rewritten, artist not ✓');

// --- 7. teardown ---
await cast('MEDIA_STOP');
await cast('SET_CONFIG', '--es', 'config_b64', b64({ enabledWatches: [], allowedPackages: [], forwardCalls: true }));
await sleep(2000);
if (!(await logDump('NotifyFwd/ConnMgr')).includes('music bridge stopped')) console.log('   (note: could not confirm bridge-stop log)');
console.log('8. teardown clean');

console.log('MUSIC E2E PASS');
process.exit(0);
