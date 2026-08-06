#!/usr/bin/env node
// Layout check for the Watch action buttons on WatchDetail.
//
// Exists because "Repair pairing" shipped wrapping to two lines and rendering
// left-aligned while its one-line neighbours looked centred. The button's
// alignItems only centres the Text *box*; once a wrapped box fills the button
// width, the text inside falls back to the default left alignment. That is
// invisible in code review and invisible at wide viewports, so this measures
// the real line boxes at a narrow phone width.
//
//   npm run web:export && node scripts/action-label-check.mjs
//
// Writes a screenshot to /tmp/action-label-360.png for eyeballing.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const DIST = new URL('../dist-web/', import.meta.url).pathname;
const PORT = 8124;
const CDP_PORT = 9334;
const WIDTH = 360; // the narrow phone width the wrap shows up at
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

const profileDir = mkdtempSync(path.join(tmpdir(), 'action-label-'));
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
    `--window-size=${WIDTH},800`,
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
// Pin the viewport: the window size alone is not authoritative in headless.
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 800, deviceScaleFactor: 1, mobile: true });

// A watch with a deviceId is "paired", which is what renders Repair pairing
// rather than Pair (WatchDetailScreen: `const paired = !!watch.deviceId`).
const watch = {
  id: 'w1',
  name: 'Test watch',
  deviceId: 'AA:BB:CC:DD:EE:FF',
  schedule: { items: [], base: undefined },
  tasks: { items: [], base: undefined },
};

await send('Page.navigate', { url: `http://localhost:${PORT}/` });
await sleep(3500);
await evaluate(`localStorage.setItem('pinetime-companion/watches/v1', ${JSON.stringify(JSON.stringify([watch]))}); true`);
await send('Page.reload');
await sleep(4000);

const clickByText = async (text) =>
  evaluate(`(() => {
     const el = [...document.querySelectorAll('div,span,a')].reverse()
       .find((n) => n.textContent?.trim() === ${JSON.stringify(text)} && n.offsetParent !== null);
     if (!el) return false;
     el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
     return true;
   })()`);

check(await clickByText('Test watch'), 'opened the watch');
await sleep(1800);

// The action row sits below the fold on a phone viewport; bring it on screen so
// the screenshot is worth looking at.
await evaluate(`(() => {
   const el = document.querySelector('[data-testid="repair-pairing"]');
   if (el) el.scrollIntoView({ block: 'center' });
   return true;
 })()`);
await sleep(800);

const { data } = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('/tmp/action-label-360.png', Buffer.from(data, 'base64'));
console.log('screenshot: /tmp/action-label-360.png');

// Measure every Watch action label's real line boxes. Element rects are not
// enough: a wrapped Text fills the button, so the element looks centred while
// its glyphs are not. Range.getClientRects gives one rect per rendered line.
const labels = await evaluate(`(() => {
  const repair = document.querySelector('[data-testid="repair-pairing"]');
  if (!repair) return { error: 'no repair-pairing button' };
  const row = repair.parentElement;
  const buttons = [...row.children];
  const out = [];
  for (const btn of buttons) {
    const b = btn.getBoundingClientRect();
    if (b.width === 0) continue;
    // The deepest element holding only text is the label.
    const leaf = [...btn.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && n.textContent.trim().length > 0)
      .pop();
    if (!leaf) continue;
    // Measure the glyphs, not the range. selectNodeContents().getClientRects()
    // also returns a rect for the collapsed space at a line break, which sits
    // at the end of the previous line and reads as a wildly off-centre "line".
    // Walking non-whitespace characters and grouping them by line gives the
    // true inked extent of each rendered line.
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    const lineByTop = new Map();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const s = node.textContent;
      for (let i = 0; i < s.length; i++) {
        if (/\\s/.test(s[i])) continue;
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const rect = r.getBoundingClientRect();
        if (rect.width <= 0) continue;
        const key = Math.round(rect.top);
        const cur = lineByTop.get(key) ?? { left: Infinity, right: -Infinity };
        cur.left = Math.min(cur.left, rect.left);
        cur.right = Math.max(cur.right, rect.right);
        lineByTop.set(key, cur);
      }
    }
    const lines = [...lineByTop.entries()]
      .sort((a, b2) => a[0] - b2[0])
      .map(([, v]) => ({ center: (v.left + v.right) / 2, width: v.right - v.left }));
    out.push({
      text: leaf.textContent.trim(),
      buttonCenter: b.left + b.width / 2,
      buttonWidth: b.width,
      lines,
    });
  }
  return { out, viewport: window.innerWidth };
})()`);

if (labels?.error) {
  check(false, labels.error);
} else {
  check(labels.viewport === WIDTH, `viewport is ${WIDTH}px (got ${labels.viewport})`);
  check(labels.out.length >= 4, `found the Watch action labels (${labels.out.length})`);

  const repair = labels.out.find((l) => l.text === 'Repair pairing');
  check(!!repair, 'the Repair pairing label is present');

  if (repair) {
    check(repair.lines.length >= 2, `Repair pairing actually wraps at ${WIDTH}px (${repair.lines.length} lines) — otherwise this check proves nothing`);
  }

  // The real assertion: every rendered line of every action label is centred
  // on its own button. 1px of tolerance for subpixel layout.
  for (const l of labels.out) {
    for (const [i, line] of l.lines.entries()) {
      const off = Math.abs(line.center - l.buttonCenter);
      check(
        off <= 1,
        `"${l.text}" line ${i + 1}/${l.lines.length} centred on its ${l.buttonWidth.toFixed(0)}px button ` +
          `(line width ${line.width.toFixed(1)}px, off by ${off.toFixed(2)}px)`,
      );
    }
  }
}

console.log(`\n${failures === 0 ? 'ACTION LABEL CHECK PASS' : `ACTION LABEL CHECK FAIL (${failures})`}`);
for (const c of children) c.kill?.();
server.close();
ws.close();
process.exit(failures === 0 ? 0 : 1);
