// Electron-shell E2E: launches the desktop app (packaged app:// path), drives
// it over CDP through the same closed loop as scripts/web-e2e.mjs: add watch ->
// pair simulator -> sync -> set time -> battery, against live InfiniSim via
// the ws-tcp proxy. Verifies the custom protocol serving, preload wiring, and
// that localStorage persists under the app:// origin.
// Usage: node scripts/desktop-e2e.mjs   (from the repo root)
// Prereqs: sim running (simctl.py start), web bundle exported to desktop/dist
// (npm run desktop:export), desktop deps installed (npm --prefix desktop i).
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CDP_PORT = 9225;
const PROXY_PORT = 18633;
const DESKTOP = path.join(ROOT, 'desktop');
const WATCH_NAME = `Desk${Date.now() % 100000}`;
const dialogs = [];
const children = [];
// Kill whole process groups: electron forks helpers that outlive a plain kill
// and keep pipes open (a silent-hang footgun).
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch {} } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proxyBusy = await new Promise((resolve) => {
  const p = net.createConnection({ host: '127.0.0.1', port: PROXY_PORT }, () => { p.destroy(); resolve(true); });
  p.on('error', () => resolve(false));
});
if (!proxyBusy) {
  children.push(spawn(process.execPath, [path.join(ROOT, 'scripts/ws-tcp-proxy.mjs')], { stdio: 'inherit', detached: true }));
  await sleep(500);
}

const electronBin = path.join(DESKTOP, 'node_modules', '.bin', 'electron');
children.push(spawn(electronBin, ['--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, '.'], {
  cwd: DESKTOP,
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':110' },
  stdio: 'inherit',
  detached: true,
}));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.startsWith('app://'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('electron page did not come up');
}

const ws = new WebSocket(await getTarget());
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Page.javascriptDialogOpening') {
    dialogs.push(m.params.message);
    send('Page.handleJavaScriptDialog', { accept: true });
  }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (sel, t = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { if (await evalJs(`!!document.querySelector(${JSON.stringify(sel)})`)) return; await sleep(200); }
  throw new Error(`timeout: ${sel}`);
};
const click = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);

await send('Page.enable');
await waitFor('[data-testid="new-watch-name"]');
const origin = await evalJs('location.origin');
const hasPreload = await evalJs('!!window.desktopBluetooth');
console.log('1. booted | origin:', origin, '| preload surface present:', hasPreload);

await evalJs(`(() => {
  const i = document.querySelector('[data-testid="new-watch-name"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(WATCH_NAME)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await click('[data-testid="add-watch"]');
await waitFor(`[data-testid="watch-${WATCH_NAME}"]`);
await click(`[data-testid="watch-${WATCH_NAME}"]`);
await waitFor('[data-testid="sync-watch"]');
await evalJs(`[...document.querySelectorAll('div')].filter((d) => /^(Re-)?pair$/i.test(d.textContent)).at(-1)?.click()`);
await waitFor('[data-testid="pair-simulator"]');
const simLabel = await evalJs(`document.querySelector('[data-testid="pair-simulator"]').textContent`);
console.log('2. pair screen | sim entry:', JSON.stringify(simLabel));
await click('[data-testid="pair-simulator"]');
await waitFor('[data-testid="sync-watch"]');

await click('[data-testid="sync-watch"]');
await sleep(4000);
const syncLabel = await evalJs(`document.querySelector('[data-testid="sync-watch"]').textContent`);
console.log('3. sync:', JSON.stringify(syncLabel));

await evalJs(`[...document.querySelectorAll('div')].filter((d) => /^Set time$/.test(d.textContent)).at(-1)?.click()`);
await sleep(2500);
await evalJs(`[...document.querySelectorAll('div')].filter((d) => /^Battery$/.test(d.textContent)).at(-1)?.click()`);
await sleep(2500);

const batteryPersisted = await evalJs(`(() => {
  const w = JSON.parse(localStorage.getItem('pinetime-companion/watches/v1') ?? '[]');
  return typeof w.find((x) => x.name === ${JSON.stringify(WATCH_NAME)})?.batteryPercent === 'number';
})()`);
console.log('4. dialogs:', JSON.stringify(dialogs));
console.log('5. batteryPercent persisted (app:// localStorage):', batteryPersisted);

const pass =
  origin === 'app://bundle' && hasPreload &&
  simLabel.includes('localhost:18633') &&
  syncLabel.includes('Synced') &&
  dialogs.some((d) => d.includes('Synced') || d.includes('Merged')) &&
  dialogs.some((d) => d.includes('Time set')) &&
  batteryPersisted;
console.log(pass ? 'ELECTRON E2E PASS' : 'ELECTRON E2E FAIL');
process.exit(pass ? 0 : 1);
