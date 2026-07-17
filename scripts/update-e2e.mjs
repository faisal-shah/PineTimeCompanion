#!/usr/bin/env node
// Closed-loop web E2E for the Update screen against the live InfiniSim.
//
// Drives the exported web bundle in headless Chrome over CDP: boot -> add watch
// -> pair simulator -> open Update -> read the running firmware revision (over
// the ws sim path) -> list releases -> flash firmware (real DFU zip) -> assert
// the Validate card appears -> upload resources (real resources zip). The GitHub
// API call is intercepted via CDP Fetch and answered with a canned release whose
// asset URLs point at a local fixture server, so the test is network-free and
// deterministic; the asset bytes are the real 1.16.0 zips.
//
// Prereqs: sim running (simctl.py start) and the web bundle exported
// (npm run web:export). Then:
//   node scripts/update-e2e.mjs <dfu.zip> <resources.zip> [dist-dir]

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const DFU_ZIP = process.argv[2];
const RES_ZIP = process.argv[3];
const DIST = process.argv[4] ?? 'dist-web';
if (!DFU_ZIP || !RES_ZIP) {
  console.error('usage: node scripts/update-e2e.mjs <dfu.zip> <resources.zip> [dist-dir]');
  process.exit(2);
}
const HTTP_PORT = 8099;
const CDP_PORT = 9224;
const PROXY_PORT = 18633;
const WATCH_NAME = `UPD${Date.now() % 100000}`;
const dialogs = [];
const children = [];
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinetime-update-e2e-'));

process.on('exit', () => {
  for (const c of children) { try { c.kill(); } catch {} }
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Canned GitHub releases response; asset URLs resolve to the fixture server.
const RELEASES_JSON = JSON.stringify([
  {
    tag_name: '1.16.0',
    name: 'InfiniTime 1.16.0',
    prerelease: false,
    published_at: '2024-01-01T00:00:00Z',
    assets: [
      { name: 'pinetime-mcuboot-app-dfu-1.16.0.zip', browser_download_url: `http://localhost:${HTTP_PORT}/fixtures/dfu.zip` },
      { name: 'infinitime-resources-1.16.0.zip', browser_download_url: `http://localhost:${HTTP_PORT}/fixtures/resources.zip` },
    ],
  },
]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const root = path.resolve(DIST);
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`No index.html in ${root} — run: npm run web:export`);
  process.exit(2);
}
createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/fixtures/dfu.zip' || rel === '/fixtures/resources.zip') {
    const file = rel.endsWith('dfu.zip') ? DFU_ZIP : RES_ZIP;
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': fs.statSync(file).size });
    res.end(await readFile(file));
    return;
  }
  let file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root) || rel === '/') file = path.join(root, 'index.html');
  try {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
}).listen(HTTP_PORT);

// ws-tcp proxy (start unless already up).
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
      const page = (await (await fetch(`http://localhost:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');
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
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    if (request.url.includes('api.github.com')) {
      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
        ],
        body: Buffer.from(RELEASES_JSON).toString('base64'),
      });
    } else {
      send('Fetch.continueRequest', { requestId });
    }
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
async function waitFor(selector, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${selector}`);
}
const click = (selector) => evalJs(`document.querySelector(${JSON.stringify(selector)}).click()`);
const clickText = (re) => evalJs(`[...document.querySelectorAll('div')].filter((d) => ${re}.test(d.textContent)).at(-1)?.click()`);
const text = (selector) => evalJs(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] });
await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/` });
await waitFor('[data-testid="new-watch-name"]');
console.log('1. booted');

await evalJs(`(() => {
  const input = document.querySelector('[data-testid="new-watch-name"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(WATCH_NAME)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await click('[data-testid="add-watch"]');
await waitFor(`[data-testid="watch-${WATCH_NAME}"]`);
await click(`[data-testid="watch-${WATCH_NAME}"]`);
await waitFor('[data-testid="feature-Update"]');
console.log('2. watch hub open');

await clickText('/^(Re-)?pair$/i');
await waitFor('[data-testid="pair-simulator"]');
await click('[data-testid="pair-simulator"]');
await waitFor('[data-testid="feature-Update"]');
console.log('3. paired sim');

await click('[data-testid="feature-Update"]');
await waitFor('[data-testid="current-firmware"]');
// Firmware revision read over the ws sim path + releases from the intercepted API.
await waitFor('[data-testid="release-1.16.0"]');
const rev = (await text('[data-testid="current-firmware"]'))?.trim();
console.log('4. update screen: installed =', JSON.stringify(rev));

// Flash firmware (confirm dialog auto-accepted -> download -> DFU over ws).
await waitFor('[data-testid="flash-fw-1.16.0"]');
await click('[data-testid="flash-fw-1.16.0"]');
await waitFor('[data-testid="validate-card"]', 60000);
console.log('5. firmware flashed; Validate card shown');

// Upload resources (real zip over the BLE filesystem).
await sleep(1000);
await click('[data-testid="upload-res-1.16.0"]');
const t0 = Date.now();
while (Date.now() - t0 < 60000 && !dialogs.some((d) => d.includes('Resources uploaded'))) await sleep(500);
console.log('6. dialogs:', JSON.stringify(dialogs));

await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
  fs.writeFileSync(path.join(os.tmpdir(), 'update-e2e.png'), Buffer.from(r.data, 'base64')),
);

const pass =
  rev === '1.16.0' &&
  (await evalJs(`!!document.querySelector('[data-testid="validate-card"]')`)) &&
  dialogs.some((d) => d.includes('Resources uploaded'));
console.log(pass ? 'UPDATE E2E PASS' : 'UPDATE E2E FAIL');
process.exit(pass ? 0 : 1);
