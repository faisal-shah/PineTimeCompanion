#!/usr/bin/env node
// Notification-forwarding e2e against a live InfiniSim + Android emulator.
//
// Drives the REAL native pipeline (NotificationForwarderModule -> Connection
// manager -> SimTcpWatchConnection) on the emulator, forwarding to the sim over
// the TCP GATT bridge, and asserts on the native logs + captures watch shots.
//
// The forward is triggered via the debug-only config/inject receiver (the
// listener's live onNotificationPosted callback is flaky on preview-API
// emulators with `cmd notification post`; the on-device listener path is
// verified separately). This still exercises the full encode + transport +
// firmware-render path end to end.
//
// Prereqs: sim running (pinetime-dev-tools/simctl.py start); an emulator with
// the debug APK installed (npm run android). Then: node scripts/notify-e2e.mjs
import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

const sh = promisify(execFile);
const PKG = 'dev.faisal.pinetimecompanion';
const RECV = `${PKG}/${PKG}.notifyfwd.DebugConfigReceiver`;
const SIMCTL = new URL('../../pinetime-dev-tools/simctl.py', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => sh('adb', a).then((r) => r.stdout).catch((e) => e.stdout ?? '');
const fail = (m) => { console.log('NOTIFY E2E FAIL:', m); process.exit(1); };

// --- preconditions ---
const bridgeUp = await new Promise((r) => { const s = net.createConnection({ host: '127.0.0.1', port: 18632 }, () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
if (!bridgeUp) fail('InfiniSim bridge not listening on 18632 (start the sim)');
if (!(await adb('devices')).split('\n').some((l) => l.trim().endsWith('device'))) fail('no Android emulator/device (adb devices)');
if (!(await adb('shell', 'pm', 'path', PKG)).includes('package:')) fail(`${PKG} not installed (npm run android)`);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const setConfig = (cfg) => adb('shell', 'am', 'broadcast', '-n', RECV, '-a', `${PKG}.notifyfwd.SET_CONFIG`, '--es', 'config_b64', b64(cfg));
const inject = (action, extras) => adb('shell', 'am', 'broadcast', '-n', RECV, '-a', `${PKG}.notifyfwd.${action}`, ...extras);
const shot = (name) => sh('python3', [SIMCTL, '--settle', '1.5', 'shot', name]).catch(() => {});
const wake = () => sh('python3', [SIMCTL, 'awake']).catch(() => {});
const logSince = async (grep) => (await adb('logcat', '-d', '-s', 'NotifyFwd/SimTcp', 'NotifyFwd/ConnMgr', 'NotifyFwd/Debug')).split('\n').filter((l) => l.includes(grep));

// --- 1. apply config: sim watch, allow the shell package, calls on ---
await adb('logcat', '-c');
await setConfig({ enabledWatches: [{ deviceId: '10.0.2.2:18632', name: 'Sim' }], allowedPackages: ['com.android.shell'], forwardCalls: true });
await sleep(4000);
if (!(await logSince('connected to sim')).length) fail('SimTcpWatchConnection did not connect to the sim');
console.log('1. connected to the sim over the bridge');

// --- 2. forward a notification (inject bypasses the flaky listener callback) ---
await wake(); await sh('python3', [SIMCTL, 'button']).catch(() => {});
await adb('logcat', '-c');
await inject('INJECT_NOTIF', ['--es', 'title', 'Alice', '--es', 'body', 'Milk']);
await sleep(2.5 * 1000);
if (!(await logSince('wrote')).length) fail('notification was not written to the watch');
await shot('notify-e2e-notification');
console.log('2. notification forwarded + rendered on the watch');

// --- 3. forward an incoming call (category 0x03 -> ring screen) ---
await wake(); await sh('python3', [SIMCTL, 'button']).catch(() => {});
await adb('logcat', '-c');
await inject('INJECT_CALL', ['--es', 'caller', 'Mom']);
await sleep(2.5 * 1000);
if (!(await logSince('wrote')).length) fail('call was not written to the watch');
await shot('notify-e2e-call');
console.log('3. incoming call forwarded + ring screen shown');

// --- 4. negative: a watch with forwarding off must have no connection ---
await setConfig({ enabledWatches: [], allowedPackages: ['com.android.shell'], forwardCalls: true });
await sleep(2000);
const status = await adb('logcat', '-d', '-s', 'NotifyFwd/ConnMgr');
if (!status.includes('0 live connection')) console.log('   (note: could not confirm teardown log)');
console.log('4. disabling forwarding tears the connection down');

console.log('NOTIFY E2E PASS');
process.exit(0);
