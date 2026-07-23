#!/usr/bin/env node
// Responsive layout verification: screenshots every key screen at a real desktop
// width (1440) and a phone width (390), so the "phone stretched sideways" bug is
// caught by LOOKING, not by trusting the code. Serves the exported web bundle
// (dist-web) over a tiny static server and drives a headless Chrome via CDP.
// Seeds a paired watch + schedule + step history into localStorage so screens
// have content, then navigates by data-testid.
//
//   npm run web:export && node scripts/responsive-shots.mjs
// Shots land in shots/responsive/{desktop,phone}-<screen>.png

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIST = path.resolve('dist-web');
const OUT = path.resolve('shots/responsive');
const PORT = 8095;
const CDP = 9245;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rshots-'));
const kids = [];
process.on('exit', () => kids.forEach((c) => { try { c.kill(); } catch {} }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };

// --- static server ---
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist-web/index.html missing — run `npm run web:export` first');
  process.exit(1);
}
createServer(async (rq, rs) => {
  const rel = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  let f = path.normalize(path.join(DIST, rel));
  if (!f.startsWith(DIST) || rel === '/') f = path.join(DIST, 'index.html');
  try {
    const buf = await readFile(f);
    rs.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }).end(buf);
  } catch {
    rs.writeHead(404).end();
  }
}).listen(PORT);

// --- chrome via CDP ---
const chromeBin = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((b) => {
  try { execFile(b, ['--version']); return true; } catch { return false; }
}) ?? 'google-chrome';
kids.push(execFile(chromeBin, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, 'about:blank']));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const p = (await (await fetch(`http://localhost:${CDP}/json`)).json()).find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('no chrome target');
}
const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
const send = (method, params = {}) =>
  new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (sel, t = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { if (await ev(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; await sleep(150); }
  throw new Error('timeout waiting for ' + sel);
};
const click = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{click(){}}).click()`);
const clickText = (re) =>
  ev(`(() => { const els=[...document.querySelectorAll('div,span,a')].filter(e=>${re}.test((e.textContent||'').trim())&&e.children.length<3); const el=els[els.length-1]; if(el){el.click();return true;} return false; })()`);

await send('Page.enable');
await send('Runtime.enable');

// --- seed data ---
const nowSec = Math.floor(Date.now() / 1000);
const today = new Date().toISOString().slice(0, 10);
const events = [
  { id: 4321, title: 'Fajr reminder', hour: 5, minute: 45, anchorDate: today, rule: { kind: 'everyNDays', intervalDays: 1 }, enabled: true, lastModified: nowSec },
  { id: 8765, title: 'Quran practice', hour: 19, minute: 30, anchorDate: today, rule: { kind: 'weekly', weekdayMask: 0b0101010 }, enabled: true, lastModified: nowSec },
  { id: 2244, title: 'Take medicine', hour: 9, minute: 0, anchorDate: today, rule: { kind: 'monthly', dayOfMonth: 1 }, enabled: false, lastModified: nowSec },
];
const tasks = [
  { id: 11, title: 'Fajr prayer', order: 0, lastModified: nowSec * 1000 },
  { id: 12, title: 'Brush teeth', order: 1, lastModified: nowSec * 1000 },
  { id: 13, title: 'Make bed', order: 2, lastModified: nowSec * 1000 },
  { id: 14, title: 'Read 10 minutes', order: 3, lastModified: nowSec * 1000 },
  { id: 15, title: 'Water the plants', order: 4, lastModified: nowSec * 1000 },
];
const mkWatch = (id, name, battery) => ({
  id, name, deviceId: 'localhost:18633', scheduleVersion: 3, syncedVersion: 3,
  lastSyncAt: new Date().toISOString(), batteryPercent: battery, capacity: 64,
  prayerSettings: { method: 'ummAlQura', asrMadhab: 'standard', alertsEnabled: true, latE2: 2142, lonE2: 3983, utcOffsetQuarters: 12, editedAt: nowSec },
  forwardNotifications: false, events,
  tasks, taskVersion: 4, taskSyncedVersion: 4, taskCapacity: 20, taskStreak: 12,
});
const watches = [mkWatch('w1', 'My PineTime', 82), mkWatch('w2', "Layla's watch", 47)];
const stepDays = [6200, 8100, 10400, 4300, 9700, 12500, 7600, 9100, 11200, 5400, 8800, 10100, 9500, 7500];
const steps = { w1: stepDays.map((s, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return { date: d.toISOString().slice(0, 10), steps: s }; }) };
const SEED = `
  localStorage.setItem('pinetime-companion/watches/v1', ${JSON.stringify(JSON.stringify(watches))});
  localStorage.setItem('pinetime-companion/steps/v1', ${JSON.stringify(JSON.stringify(steps))});
`;

// screens: label -> navigation steps from a fresh WatchList
const SCREENS = [
  ['watchlist', []],
  ['watchdetail', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Schedule"]' }]],
  ['schedule', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Schedule"]' }, { sel: '[data-testid="feature-Schedule"]', wait: '[data-testid="sync-watch"]' }]],
  ['tasks', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Tasks"]' }, { sel: '[data-testid="feature-Tasks"]', wait: '[data-testid="sync-tasks"]' }]],
  ['eventedit', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Schedule"]' }, { sel: '[data-testid="feature-Schedule"]', wait: '[data-testid="add-event"]' }, { sel: '[data-testid="add-event"]', wait: '[data-testid="save-event"]' }]],
  ['prayer', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-PrayerSettings"]' }, { sel: '[data-testid="feature-PrayerSettings"]', wait: '[data-testid="apply-prayer"]' }]],
  ['weather', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Weather"]' }, { sel: '[data-testid="feature-Weather"]', wait: '[data-testid="weather-update"]' }]],
  ['steps', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Steps"]' }, { sel: '[data-testid="feature-Steps"]', wait: '[data-testid="steps-bar-0"]' }]],
  ['notifications', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Notifications"]' }, { sel: '[data-testid="feature-Notifications"]', wait: '', settle: 900 }]],
  ['update', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Update"]' }, { sel: '[data-testid="feature-Update"]', wait: '[data-testid="toggle-prereleases"]', settle: 2500 }]],
  ['beacon', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Beacon"]' }, { sel: '[data-testid="feature-Beacon"]', wait: '[data-testid="beacon-generate"]' }]],
  ['alarms', [{ sel: '[data-testid="watch-My PineTime"]', wait: '[data-testid="feature-Alarms"]' }, { sel: '[data-testid="feature-Alarms"]', wait: '', settle: 700 }]],
];

const WIDTHS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

await mkdir(OUT, { recursive: true });
for (const [mode, dim] of Object.entries(WIDTHS)) {
  await send('Emulation.setDeviceMetricsOverride', { width: dim.width, height: dim.height, deviceScaleFactor: 2, mobile: dim.width < 700 });
  for (const [label, stepsList] of SCREENS) {
    // fresh load resets the nav stack to WatchList; localStorage persists
    await send('Page.navigate', { url: `http://localhost:${PORT}/` });
    await waitFor('[data-testid="new-watch-name"]', 20000).catch(() => {});
    await ev(SEED);
    await send('Page.navigate', { url: `http://localhost:${PORT}/` });
    await waitFor('[data-testid="watch-My PineTime"]', 20000);
    try {
      for (const st of stepsList) {
        await click(st.sel);
        if (st.wait) await waitFor(st.wait, 20000);
        await sleep(st.settle ?? 400);
      }
      await sleep(400);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${mode}-${label}.png`), Buffer.from(r.data, 'base64'));
      console.log(`shot ${mode}-${label}`);
    } catch (e) {
      console.log(`FAIL ${mode}-${label}: ${e.message}`);
    }
  }
}
console.log('DONE');
process.exit(0);
