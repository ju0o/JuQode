/* SC-01 visual + behaviour verification against the REAL Electron app.
 *
 * Drives the app over the Chrome DevTools Protocol (no extra dependency) and captures
 * screenshots so a human can look at them. DOM assertions alone are not enough —
 * 21 WBS-01 QA evidence asks for per-OS screenshots.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'dev-evidence', 'wbs-01');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9223;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(sendFn) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  assert.ok(page, 'no page target — did the window open?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  try { return await sendFn({ send, evalJs }); } finally { ws.close(); }
}

const app = spawn('xvfb-run', ['-a', path.join(ROOT, 'node_modules', '.bin', 'electron'), '.',
  '--no-sandbox', `--remote-debugging-port=${PORT}`], { cwd: ROOT, env: { ...process.env, JUQODE_TRACE: '1' } });
let appErr = '';
app.stderr.on('data', (d) => { appErr += d; });

await sleep(4000);

/* WCAG 2.x contrast of the primary button's own text on its own fill. */
const PRI_CONTRAST = `(() => {
  const b = document.querySelector('.btn.pri'); const g = getComputedStyle(b);
  const lum = (c) => { const [r,gr,bl] = c.match(/\\d+/g).slice(0,3).map(Number)
    .map(v => { v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); });
    return .2126*r + .7152*gr + .0722*bl; };
  const l1 = lum(g.color), l2 = lum(g.backgroundColor);
  return Math.round(((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)) * 100) / 100;
})()`;

const results = await cdp(async ({ send, evalJs }) => {
  await send('Page.enable');
  const out = {};

  out.ready  = await evalJs('window.__ready === true');
  out.screen = await evalJs('window.__screen()');

  // the exposed surface must be exactly what preload declares — nothing more
  out.bridge = await evalJs(`JSON.stringify({
    keys: Object.keys(window.juqode || {}),
    require: typeof require, process: typeof process, module: typeof module,
    ipcRenderer: typeof window.ipcRenderer
  })`);

  out.copy = await evalJs(`JSON.stringify({
    title: document.querySelector('.h1')?.textContent,
    open:  document.querySelector('[data-act="open-project"]')?.textContent,
    recent: document.querySelector('.recent h2')?.textContent
  })`);

  // one window, one primary action (14 §4 T4)
  out.primaryActions = await evalJs('document.querySelectorAll(".btn.pri").length');

  /* Every combination of OS preference x explicit toggle. A token redefined in the
     prefers-color-scheme block but not in [data-theme="dark"] is correct ONLY when the OS
     already prefers dark; Windows defaults to light, so that is the shipping path. */
  out.matrix = {};
  for (const os of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: os }] });
    for (const toggle of ['', 'light', 'dark']) {
      await evalJs(`document.documentElement.setAttribute('data-theme','${toggle}')`);
      await sleep(200);
      const c = await evalJs(PRI_CONTRAST);
      const bg = await evalJs('getComputedStyle(document.body).backgroundColor');
      out.matrix[`os=${os} toggle=${toggle || 'system'}`] = { priContrast: c, bodyBg: bg };
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] });

  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(250);
    out[`${theme}Bg`] = await evalJs('getComputedStyle(document.body).backgroundColor');
    out[`${theme}Ink`] = await evalJs('getComputedStyle(document.body).color');
    out[`${theme}PriContrast`] = await evalJs(PRI_CONTRAST);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc01-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  // no horizontal overflow at the shipped minimum width
  out.overflow = await evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');

  out.centreOffset = await evalJs(`(() => {
    const m = document.querySelector('.sc01');
    const first = m.firstElementChild.getBoundingClientRect();
    const last = m.lastElementChild.getBoundingClientRect();
    const box = m.getBoundingClientRect();
    return Math.round(((first.top + last.bottom) / 2) - (box.top + box.height / 2));
  })()`);

  // the folder button must tell the truth rather than pretend
  await evalJs(`document.querySelector('[data-act="open-project"]').click()`);
  await sleep(500);
  out.notYet = await evalJs(`document.querySelector('[data-el="notyet"]')?.textContent ?? null`);

  return out;
});

app.kill('SIGTERM');
await sleep(800);

const bridge = JSON.parse(results.bridge);
assert.strictEqual(results.ready, true, 'renderer did not initialise');
assert.strictEqual(results.screen, 'SC-01', `expected SC-01, got ${results.screen}`);
assert.deepStrictEqual(bridge.keys.sort(), ['openProject', 'versions'], 'renderer API surface is not exactly the declared one');
assert.strictEqual(bridge.require, 'undefined', 'require leaked into the renderer');
assert.strictEqual(bridge.process, 'undefined', 'process leaked into the renderer');
assert.strictEqual(bridge.module, 'undefined', 'module leaked into the renderer');
assert.strictEqual(bridge.ipcRenderer, 'undefined', 'ipcRenderer leaked into the renderer');
assert.strictEqual(results.primaryActions, 1, 'SC-01 must have exactly one primary action');
assert.strictEqual(results.overflow, 0, `horizontal overflow of ${results.overflow}px`);
assert.notStrictEqual(results.lightBg, results.darkBg, 'light and dark render the same background');
for (const [k, v] of Object.entries(results.matrix)) {
  assert.ok(v.priContrast >= 4.5, `${k}: primary button contrast ${v.priContrast}:1 is below AA (4.5:1)`);
}
/* the screen must be vertically centred — 17: "가운데로 모인 성긴 화면" */
assert.ok(Math.abs(results.centreOffset) <= 40,
  `SC-01 content is ${results.centreOffset}px off vertical centre`);
assert.ok(results.notYet && results.notYet.includes('지금 안 됨'), 'folder open did not report honestly');

console.log(JSON.stringify(results, null, 2));
console.log('\nvisual+behaviour: PASS   screenshots ->', OUT);
