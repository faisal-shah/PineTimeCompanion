#!/usr/bin/env node
// Visual regression check for the task/schedule list layout.
//
// Exists because the same bug shipped twice: a list inside a flex column
// without the right style prop either refuses to scroll or collapses to zero
// height, and both look fine in code review. This seeds a watch with more
// tasks than fit, renders the real web bundle, and asserts the rows are
// actually on screen and the list actually scrolls.
//
//   npm run web:export && node scripts/list-layout-check.mjs
//
// Writes screenshots to /tmp/list-layout-*.png for eyeballing.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const DIST = new URL('../dist-web/', import.meta.url).pathname;
const PORT = 8123;
const CDP_PORT = 9333;
const TASK_COUNT = 14; // more than fits on a phone viewport
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok:  ' : 'FAIL:'} ${what}`);
  if (!ok) failures++;
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT);

const profileDir = mkdtempSync(path.join(tmpdir(), 'list-layout-'));
const chromeBin = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((b) => {
  try {
    execFile(b, ['--version']);
    return true;
  } catch {
    return false;
  }
});
children.push(
  execFile(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=420,860',
    'about:blank',
  ]),
);

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${CDP_PORT}/json`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('chrome did not come up');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');

// Seed a watch whose task list is longer than the viewport, then reload so the
// app boots straight into that state.
const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
  id: 1000 + i,
  order: i,
  title: `Task number ${i + 1}`,
  lastModified: 1700000000,
}));
const watch = {
  id: 'w1',
  name: 'Test watch',
  deviceId: 'AA:BB:CC:DD:EE:FF',
  schedule: { items: [], base: undefined },
  tasks: { items: tasks, base: undefined },
  taskStreak: 3,
};

await send('Page.navigate', { url: `http://localhost:${PORT}/` });
await sleep(3500);
await evaluate(`localStorage.setItem('pinetime-companion/watches/v1', ${JSON.stringify(JSON.stringify([watch]))}); true`);
await send('Page.reload');
await sleep(4000);

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`/tmp/list-layout-${name}.png`, Buffer.from(data, 'base64'));
  return `/tmp/list-layout-${name}.png`;
};

// Walk into the watch, then into Daily tasks, by testID (RN web emits data-testid).
const clickByText = async (text) =>
  evaluate(`(() => {
     const el = [...document.querySelectorAll('div,span,a')].reverse()
       .find((n) => n.textContent?.trim() === ${JSON.stringify(text)} && n.offsetParent !== null);
     if (!el) return false;
     el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
     return true;
   })()`);

check(await clickByText('Test watch'), 'opened the watch');
await sleep(1200);
check(await clickByText('Daily tasks'), 'opened Daily tasks');
await sleep(1800);

console.log('screenshot:', await shot('tasks'));

// The actual assertions: rows on screen, and a scrollable region taller than it shows.
const visibleRows = await evaluate(`[...document.querySelectorAll('[data-testid^="task-"]')]
  .filter((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().top < window.innerHeight).length`);
check(visibleRows > 0, `task rows rendered on screen (${visibleRows} visible)`);
check(visibleRows >= 4, `enough rows visible to be usable (${visibleRows})`);

const scroller = await evaluate(`(() => {
   const el = [...document.querySelectorAll('div')].find((n) => n.scrollHeight > n.clientHeight + 20 && n.clientHeight > 200);
   return el ? { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : null;
 })()`);
check(scroller !== null, `found a scrollable list region ${scroller ? JSON.stringify(scroller) : ''}`);

const footerVisible = await evaluate(`(() => {
   const el = document.querySelector('[data-testid="new-task-input"]');
   if (!el) return false;
   const r = el.getBoundingClientRect();
   return r.top >= 0 && r.bottom <= window.innerHeight + 1;
 })()`);
check(footerVisible, 'the compose row is on screen, not pushed off by the list');

const syncVisible = await evaluate(`(() => {
   const el = document.querySelector('[data-testid="sync-tasks"]');
   if (!el) return false;
   const r = el.getBoundingClientRect();
   return r.top >= 0 && r.bottom <= window.innerHeight + 1;
 })()`);
check(syncVisible, 'the Sync button is on screen');

// Reload and walk down again rather than using history.back(): this is a
// native-stack app, so browser Back leaves the app entirely.
async function openFromScratch(label) {
  await send('Page.reload');
  await sleep(3500);
  if (!(await clickByText('Test watch'))) return false;
  await sleep(1200);
  const ok = await clickByText(label);
  await sleep(1700);
  return ok;
}

// --- Schedule: a plain FlatList, where `style` IS the outer style. A different
// prop from the draggable list, so it needs its own check. ---
check(await openFromScratch('Schedule'), 'opened Schedule');
console.log('screenshot:', await shot('schedule'));
const schedFooter = await evaluate(`(() => {
   const el = document.querySelector('[data-testid="sync-watch"]') || document.querySelector('[data-testid="add-event"]');
   if (!el) return false;
   const r = el.getBoundingClientRect();
   return r.top >= 0 && r.bottom <= window.innerHeight + 1;
 })()`);
check(schedFooter, 'schedule footer buttons are on screen');

// --- A form screen, proving that swapping Screen's ScrollView for the
// keyboard-aware one did not break the shared wrapper every form uses. ---
check(await openFromScratch('Prayer times'), 'opened a form screen (Prayer times)');
console.log('screenshot:', await shot('form'));
const formRendered = await evaluate(`document.body.innerText.length > 200`);
check(formRendered, 'form screen rendered content through the keyboard-aware wrapper');

console.log(`\n${failures === 0 ? 'LIST LAYOUT CHECK PASS' : `LIST LAYOUT CHECK FAIL (${failures})`}`);
for (const c of children) c.kill?.();
server.close();
ws.close();
process.exit(failures === 0 ? 0 : 1);
