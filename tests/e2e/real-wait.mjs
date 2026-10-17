/* OPT-IN, ~3 minutes, not part of `npm run test:e2e`: the permission wait at the product's REAL silence threshold.
 *
 * Every other e2e shortens the threshold (JUQODE_QUIET_MS=2500) so a run can reach 새 신호 없음 at all. That proves the
 * redraw path, not the clock. This one leaves the defaults alone (2분 silence, pushes every min(15 s, half of it)),
 * puts keyboard focus on 허용하고 다시 해 보기 and on a typed answer, and watches for as long as it takes the real
 * clock to cause the first redraw — recording WHEN it came and whether focus survived it. Fixture CLI, no model. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert';
import { findFreePortBlock } from './port-block.mjs';
import { sweepDisplays } from './xvfb.mjs';
import { launchArgs, killTree, WIN } from './launch.mjs';
sweepDisplays();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { DB, USER_DATA, SEED, FAKE_CLI } = await import('./fixture.mjs');
const PORT = await findFreePortBlock(Number(process.env.JUQODE_E2E_PORT || 9423), 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA, JUQODE_CLAUDE_BIN: FAKE_CLI };
delete env.JUQODE_QUIET_MS; delete env.JUQODE_CANCEL_CONFIRM_MS;      // the shipped defaults, on purpose
const [file, argv] = launchArgs(['.', '--no-sandbox', `--remote-debugging-port=${PORT}`]);
const app = spawn(file, argv, { cwd: ROOT, detached: !WIN, env });
process.on('exit', () => killTree(app));
await sleep(4000);
let page = null;
for (let i = 0; i < 20 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not yet */ } if (!page) await sleep(750); }
assert.ok(page, 'no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let n = 0; const pend = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pend.has(g.id)) { pend.get(g.id)(g); pend.delete(g.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++n; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 773, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 100 && !(await ev(`typeof window.__screen === 'function'`)); i++) await sleep(50);
  await ev(`[...document.querySelectorAll('[data-el="recent-row"]')].find((r) => r.innerText.includes(${JSON.stringify(path.basename(SEED))}))?.click()`);
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-act="board-start"]')`)); i++) await sleep(250);
  await ev(`document.querySelector('[data-act="board-start"]').click()`);
  await ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = '로그인 버튼 고치기'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('[data-act="submit-intent"]').click()`);
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('.sc03 [data-el="permission"]')`)); i++) await sleep(250);
  const t0 = Date.now();
  const res = JSON.parse(await ev(`(async () => {
    const find = () => [...document.querySelectorAll('.sc03 button')].find((x) => x.textContent.includes('허용하고 다시 해 보기'));
    const b = find(); b.focus(); const t0 = Date.now();
    const log = []; let last = b; let liveness = window.__work()?.liveness;
    while (Date.now() - t0 < 200000) {
      await new Promise((r) => setTimeout(r, 500));
      const l = window.__work()?.liveness;
      const cur = find();
      if (cur !== last || l !== liveness) {
        const a = document.activeElement;
        log.push({ atSeconds: Math.round((Date.now() - t0) / 1000), liveness: l, replaced: cur !== last, focus: a === document.body ? 'BODY' : a.textContent.trim().slice(0, 20) });
        last = cur; liveness = l;
        if (l === 'quiet' && log.filter((x) => x.liveness === 'quiet').length >= 3) break;     // a few redraws past the threshold is enough
      }
    }
    return JSON.stringify({ log, quietPanel: !!document.querySelector('.sc03 [data-el="quiet"]') });
  })()`));
  console.log(JSON.stringify({ ...res, elapsedSeconds: Math.round((Date.now() - t0) / 1000) }, null, 2));
  assert.ok(res.log.some((x) => x.replaced), 'the real clock never redrew the screen in 200 s — nothing was measured');
  assert.ok(res.log.every((x) => !x.replaced || x.focus === '허용하고 다시 해 보기'), `focus was lost across a real redraw: ${JSON.stringify(res.log)}`);
  assert.strictEqual(res.quietPanel, false, 'a permission wait shows 새 신호 없음 at the real threshold');
  console.log('real-wait: PASS');
} finally { ws.close(); killTree(app); }
