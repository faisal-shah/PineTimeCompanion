#!/usr/bin/env node
// Closed-loop web E2E against the live InfiniSim simulator.
//
// Drives the exported web bundle in headless Chrome over the DevTools protocol:
// boot -> add watch -> pair simulator -> schedule sync -> set time -> battery
// read. Exercises the whole web sim path (WsTransport -> ws-tcp proxy -> TCP
// GATT bridge) plus the showAlert web shim (dialogs are auto-accepted and
// asserted on).
//
// Prereqs: the sim is running (pinetime-dev-tools/simctl.py start) and the web
// bundle is exported:  npx expo export --platform web --output-dir dist-web
// Then:                node scripts/web-e2e.mjs [dist-dir]
// The static server and the ws-tcp proxy are started (and cleaned up) here.

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const DIST = process.argv[2] ?? 'dist-web';
const HTTP_PORT = 8099;
const CDP_PORT = 9223;
const PROXY_PORT = 18633;
const WATCH_NAME = `E2E${Date.now() % 100000}`;
const dialogs = [];
const children = [];
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinetime-web-e2e-'));

function cleanup() {
  for (const c of children) {
    try { c.kill(); } catch {}
  }
  // Chrome may still be flushing its profile as it dies — best effort only.
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const root = path.resolve(DIST);
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`No index.html in ${root} — run: npx expo export --platform web --output-dir ${DIST}`);
  process.exit(2);
}
createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root) || rel === '/') file = path.join(root, 'index.html');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(HTTP_PORT);

// Start the ws-tcp proxy unless one is already listening.
const proxyBusy = await new Promise((resolve) => {
  const probe = net.createConnection({ host: '127.0.0.1', port: PROXY_PORT }, () => { probe.destroy(); resolve(true); });
  probe.on('error', () => resolve(false));
});
if (!proxyBusy) {
  children.push(spawn(process.execPath, [new URL('./ws-tcp-proxy.mjs', import.meta.url).pathname], { stdio: 'inherit' }));
  await sleep(500);
}

const chromeBin = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((b) => {
  try { return execFile(b, ['--version']), true; } catch { return false; }
});
children.push(execFile(chromeBin, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`, '--window-size=480,900', 'about:blank',
]));

async function getTarget() {
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

const ws = new WebSocket(await getTarget());
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.javascriptDialogOpening') {
    dialogs.push(m.params.message);
    send('Page.handleJavaScriptDialog', { accept: true });
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(selector, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${selector}`);
}
const click = (selector) => evalJs(`document.querySelector(${JSON.stringify(selector)}).click()`);
const clickText = (re) => evalJs(`[...document.querySelectorAll('div')].filter((d) => ${re}.test(d.textContent)).at(-1)?.click()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/` });
await waitFor('[data-testid="new-watch-name"]');
console.log('1. app booted (watch list)');

await evalJs(`(() => {
  const input = document.querySelector('[data-testid="new-watch-name"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(WATCH_NAME)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await click('[data-testid="add-watch"]');
await waitFor(`[data-testid="watch-${WATCH_NAME}"]`);
console.log('2. watch added');

await click(`[data-testid="watch-${WATCH_NAME}"]`);
await waitFor('[data-testid="sync-watch"]');
console.log('3. watch detail open');

await clickText('/^(Re-)?pair$/i');
await waitFor('[data-testid="pair-simulator"]');
await click('[data-testid="pair-simulator"]');
await waitFor('[data-testid="sync-watch"]');
console.log('4. paired with simulator (ws proxy)');

await click('[data-testid="sync-watch"]');
await sleep(4000);
const syncLabel = await evalJs(`document.querySelector('[data-testid="sync-watch"]').textContent`);
console.log('5. sync:', JSON.stringify(syncLabel));

await clickText('/^Set time$/');
await sleep(2500);
await clickText('/^Battery$/');
await sleep(2500);

const batteryPersisted = await evalJs(`(() => {
  const w = JSON.parse(localStorage.getItem('pinetime-companion/watches/v1') ?? '[]');
  return typeof w.find((x) => x.name === ${JSON.stringify(WATCH_NAME)})?.batteryPercent === 'number';
})()`);
console.log('6. dialogs:', JSON.stringify(dialogs));
console.log('7. batteryPercent persisted:', batteryPersisted);

const pass =
  syncLabel.includes('Synced') &&
  dialogs.some((d) => d.includes('Synced') || d.includes('Merged')) &&
  dialogs.some((d) => d.includes('Time set')) &&
  batteryPersisted;
console.log(pass ? 'WEB E2E PASS' : 'WEB E2E FAIL');
process.exit(pass ? 0 : 1);
