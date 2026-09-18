/* SC-01 + theme-matrix probe, driven over CDP against a REAL running JuQode window.
 * Called by scripts/verify-windows.ps1. Also runnable on Linux for parity.
 *
 * Writes screenshots to ./tmp-visual (untracked) — never over tracked evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

const PORT = Number(process.env.JUQODE_CDP_PORT || 9223);
const OUT = path.resolve(process.env.JUQODE_SHOT_DIR || 'tmp-visual');
fs.mkdirSync(OUT, { recursive: true });

const PRI_CONTRAST = `(() => {
  const b = document.querySelector('.btn.pri'); const g = getComputedStyle(b);
  const lum = (c) => { const [r,gr,bl] = c.match(/\\d+/g).slice(0,3).map(Number)
    .map(v => { v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); });
    return .2126*r + .7152*gr + .0722*bl; };
  const l1 = lum(g.color), l2 = lum(g.backgroundColor);
  return Math.round(((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)) * 100) / 100;
})()`;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
assert.ok(page, 'no page target — is JuQode running with --remote-debugging-port?');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0; const pending = new Map();
ws.onmessage = (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const js = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
const out = {};
out.ready = await js('window.__ready === true');
out.screen = await js('window.__screen()');
out.bridgeKeys = await js('JSON.stringify(Object.keys(window.juqode||{}))');
out.nodeReachable = await js(`JSON.stringify({require:typeof require,process:typeof process,module:typeof module,ipcRenderer:typeof window.ipcRenderer})`);
out.primaryActions = await js('document.querySelectorAll(".btn.pri").length');
out.copy = await js(`JSON.stringify({title:document.querySelector('.h1')?.textContent,open:document.querySelector('[data-act="open-project"]')?.textContent})`);

/* The full matrix. A token present in the prefers-color-scheme block but absent from
 * [data-theme="dark"] is correct only when the OS already prefers dark; Windows defaults
 * to light, so that is the shipping path and it must be measured explicitly. */
out.themeMatrix = {};
for (const os of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: os }] });
  for (const toggle of ['', 'light', 'dark']) {
    await js(`document.documentElement.setAttribute('data-theme','${toggle}')`);
    await sleep(200);
    out.themeMatrix[`os=${os} toggle=${toggle || 'system'}`] = {
      priContrast: await js(PRI_CONTRAST),
      bodyBg: await js('getComputedStyle(document.body).backgroundColor'),
    };
  }
}
await send('Emulation.setEmulatedMedia', { features: [] });

for (const theme of ['light', 'dark']) {
  await js(`document.documentElement.setAttribute('data-theme','${theme}')`);
  await sleep(250);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `sc01-${theme}.png`), Buffer.from(s.result.data, 'base64'));
}
out.overflow = await js('document.documentElement.scrollWidth - document.documentElement.clientWidth');
out.centreOffset = await js(`(() => { const m=document.querySelector('.sc01');
  const f=m.firstElementChild.getBoundingClientRect(), l=m.lastElementChild.getBoundingClientRect(), b=m.getBoundingClientRect();
  return Math.round(((f.top+l.bottom)/2)-(b.top+b.height/2)); })()`);
ws.close();

assert.strictEqual(out.screen, 'SC-01', `expected SC-01, got ${out.screen}`);
assert.strictEqual(out.primaryActions, 1, 'SC-01 must have exactly one primary action');
assert.strictEqual(out.overflow, 0, `horizontal overflow ${out.overflow}px`);
assert.ok(Math.abs(out.centreOffset) <= 40, `SC-01 is ${out.centreOffset}px off centre`);
for (const [k, v] of Object.entries(out.themeMatrix)) {
  assert.ok(v.priContrast >= 4.5, `${k}: primary button contrast ${v.priContrast}:1 below AA`);
}
const n = JSON.parse(out.nodeReachable);
for (const [k, v] of Object.entries(n)) assert.strictEqual(v, 'undefined', `${k} leaked into the renderer`);

console.log(JSON.stringify(out, null, 2));
