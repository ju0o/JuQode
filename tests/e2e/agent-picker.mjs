/* V1-304 · the Agent picker on the REAL Electron renderer (Xvfb, ASUS Linux Native), against fixture CLIs only: no model, no login.
 *
 * One app launch per Claude state that has to be reached through the real `claude-detect` probe (ready, 미설치, 인증 필요,
 * 버전 불명, 버전 변경). 미실측 (Codex / OpenCode) is in every launch. What this proves:
 *   - each state is drawn with its own words, in light/dark at 880/1024/1200/1440 and at 150% zoom, with no sideways scroll;
 *   - choosing an AI, ticking the model check and re-checking create NO Work (counted through the product's own history API);
 *   - focus stays where the person put it while the status changes underneath;
 *   - the picker holds no start control; the existing start button is what creates the one Work, and it says so.
 * What it does NOT prove: that Codex / OpenCode work, that a model list exists, or that a non-developer understands the screen. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert';
import { findFreePortBlock } from './port-block.mjs';
import { sweepDisplays } from './xvfb.mjs';
import { launchArgs, killTree, WIN } from './launch.mjs';
sweepDisplays();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { DB, USER_DATA, SEED, SEED2, FAKE_CLI } = await import('./fixture.mjs');
const OUT = path.resolve(process.env.JUQODE_E2E_SHOT_DIR || path.join(ROOT, 'tmp-agent-picker'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => process.stderr.write(`  · ${m}\n`);

/* a controllable fixture `claude`: version / login come from a file the test rewrites between probes */
const CTRL = path.join(USER_DATA, 'picker-ctrl.json');
const CTRL_CLI = path.join(USER_DATA, 'picker-claude');
fs.writeFileSync(CTRL_CLI, `#!/usr/bin/env node
const c = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(CTRL)}, 'utf8'));
const a = process.argv.slice(2);
if (a[0] === '--version') { process.stdout.write(c.version ? c.version + ' (Claude Code)\\n' : '\\n'); process.exit(0); }
if (a[0] === 'auth') { process.stdout.write(JSON.stringify({ loggedIn: c.loggedIn }) + '\\n'); process.exit(0); }
process.exit(0);
`, { mode: 0o755 });
const ctrl = (o) => fs.writeFileSync(CTRL, JSON.stringify(o));

const results = { launches: {}, captures: [], checks: [] };
const ok = (name, cond, detail = '') => { results.checks.push({ name, pass: Boolean(cond), detail }); assert.ok(cond, `${name} ${detail}`); };

async function session(label, bin, body) {
  const PORT = await findFreePortBlock(Number(process.env.JUQODE_E2E_PORT || 9411), 3);
  const [file, argv] = launchArgs(['.', '--no-sandbox', `--remote-debugging-port=${PORT}`]);
  const app = spawn(file, argv, { cwd: ROOT, detached: !WIN, env: { ...process.env, JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA, JUQODE_QUIET_MS: '2500', JUQODE_CLAUDE_BIN: bin } });
  try {
    await sleep(4000);
    let page = null;
    for (let i = 0; i < 20 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!page) await sleep(750);
    }
    assert.ok(page, `${label}: no page target`);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let nextId = 0; const pending = new Map();
    ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pending.has(g.id)) { pending.get(g.id)(g); pending.delete(g.id); } };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const n = ++nextId; const t = setTimeout(() => { pending.delete(n); rej(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(n, (g) => { clearTimeout(t); res(g); }); ws.send(JSON.stringify({ id: n, method, params }));
    });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
    for (let i = 0; i < 100 && !(await ev(`typeof window.__screen === 'function'`)); i++) await sleep(50);
    await send('Page.enable');
    const key = async (k, code, vk, text) => { await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(150); };
    const view = async (width, theme, zoom = 1) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await ev(`document.documentElement.setAttribute('data-theme','${theme}'); document.documentElement.style.zoom='${zoom}'`); await sleep(250);
    };
    const shot = async (name) => { fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); results.captures.push(name); };
    const works = async () => JSON.parse(await ev(`(async () => JSON.stringify((await window.juqode.history(window.__project().id)).works.length))()`));
    const openProject = async (dir) => {
      await ev(`[...document.querySelectorAll('[data-el="recent-row"]')].find((r) => r.innerText.includes(${JSON.stringify(path.basename(dir))}))?.click()`);
      for (let i = 0; i < 60 && (await ev('window.__screen()')) !== 'SC-02'; i++) await sleep(250);
      await ev(`(document.querySelector('[data-act="board-start"]') ?? document.querySelector('.nav-new'))?.click()`); await sleep(300);
      for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-el="agent-picker"]')`)); i++) await sleep(250);
      for (let i = 0; i < 60 && /확인하는 중/.test(await ev(`document.querySelector('[data-el="agent-summary"]').innerText`)); i++) await sleep(250);
    };
    const rows = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-agent]')].map((r) => ({ id: r.dataset.agent, state: r.dataset.state, disabled: r.querySelector('input').disabled, checked: r.querySelector('input').checked, text: r.textContent.replace(/\\s+/g, ' ').trim() })))`));
    const open = (v) => ev(`document.querySelector('[data-el="agent-picker"]').open = ${v}`);
    const overflow = async (n) => { const o = JSON.parse(await ev(`JSON.stringify({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth })`)); ok(`${n}: no sideways scroll`, o.sw <= o.iw + 1, JSON.stringify(o)); };
    await body({ ev, send, key, view, shot, works, openProject, rows, open, overflow, sleep });
  } finally { killTree(app); await sleep(500); }
}

const WIDTHS = [880, 1024, 1200, 1440];
async function gallery(t, state) {
  await t.open(true);
  for (const w of WIDTHS) for (const th of ['light', 'dark']) { await t.view(w, th); await t.overflow(`${state} ${w} ${th}`); await t.shot(`${state}-${w}-${th}`); }
  await t.view(1200, 'light', 1.5); await t.overflow(`${state} 1200 150%`); await t.shot(`${state}-1200-light-zoom150`);
  await t.view(1200, 'light', 1);
}

/* ── states reached through the real probe ── */
ctrl({ version: '2.1.0', loggedIn: false });
await session('auth', CTRL_CLI, async (t) => {
  await t.openProject(SEED);
  const r = await t.rows();
  results.launches.auth = r;
  ok('auth: Claude 인증 필요 and not selectable', r[0].state === 'auth' && r[0].disabled && /인증 필요/.test(r[0].text), JSON.stringify(r));
  await gallery(t, 'auth');
});
ctrl({ version: '', loggedIn: true });
await session('version-unknown', CTRL_CLI, async (t) => {
  await t.openProject(SEED);
  const r = await t.rows(); results.launches['version-unknown'] = r;
  ok('version-unknown: 버전 불명 and not selectable', r[0].state === 'version-unknown' && r[0].disabled && /버전 불명/.test(r[0].text), JSON.stringify(r));
  await gallery(t, 'version-unknown');
});
await session('missing', '/nonexistent/juqode-picker-claude', async (t) => {
  await t.openProject(SEED);
  const r = await t.rows(); results.launches.missing = r;
  ok('missing: 미설치 and not selectable', r[0].state === 'missing' && r[0].disabled && /미설치/.test(r[0].text), JSON.stringify(r));
  const w0 = await t.works();
  const summary = await t.ev(`document.querySelector('[data-el="agent-summary"]').innerText`);
  ok('missing: the one-line summary says it is unusable', /쓸 수 없는 상태/.test(summary), summary);
  ok('missing: no Work created by looking', (await t.works()) === w0);
  await gallery(t, 'missing');
});

/* version CHANGE: first probe 2.1.0, then the fixture is replaced by 2.2.0 and the person presses 다시 확인 */
ctrl({ version: '2.1.0', loggedIn: true });
await session('version-changed', CTRL_CLI, async (t) => {
  await t.openProject(SEED);
  let r = await t.rows();
  ok('version-changed: first probe is ready', r[0].state === 'ready' && !r[0].disabled);
  const w0 = await t.works();
  ctrl({ version: '2.2.0', loggedIn: true });
  await t.open(true);
  await t.ev(`document.querySelector('[data-act="agent-recheck"]').focus()`);
  await t.key('Enter', 'Enter', 13, '\r');
  for (let i = 0; i < 40 && (await t.rows())[0].state === 'ready'; i++) await t.sleep(250);
  r = await t.rows(); results.launches['version-changed'] = r;
  ok('version-changed: 버전 변경 and not selectable', r[0].state === 'version-changed' && r[0].disabled && /버전 변경/.test(r[0].text) && /2\.1\.0.*2\.2\.0/.test(r[0].text), r[0].text);
  const act = await t.ev(`document.activeElement?.getAttribute('data-act')`);
  ok('version-changed: focus stayed on 다시 확인 while the status changed', act === 'agent-recheck', String(act));
  ok('version-changed: no Work created', (await t.works()) === w0);
  await gallery(t, 'version-changed');
  await t.ev(`document.querySelector('[data-act="agent-accept-version"]').click()`); await t.sleep(300);
  r = await t.rows();
  ok('version-changed: after the person accepts the new version, Claude is ready again', r[0].state === 'ready' && !r[0].disabled);
});

/* ── ready + the explicit approval, on the fixture CLI that can actually run a Work ── */
await session('ready', FAKE_CLI, async (t) => {
  await t.openProject(SEED2);
  const r = await t.rows(); results.launches.ready = r;
  ok('ready: Claude 설치됨·로그인됨, selected, selectable', r[0].state === 'ready' && !r[0].disabled && r[0].checked && /설치됨/.test(r[0].text) && /제한 모드/.test(r[0].text), r[0].text);
  for (const i of [1, 2]) ok(`ready: ${r[i].id} is 미실측 + 현재 실행 불가 and disabled`, r[i].state === 'unmeasured' && r[i].disabled && /미실측/.test(r[i].text) && /현재 실행 불가/.test(r[i].text) && !r[i].checked);
  await gallery(t, 'ready');

  /* ③ is visible and read-only: no model list, no select */
  await t.open(true);
  const model = await t.ev(`document.querySelector('[data-el="agent-model"]').innerText`);
  ok('ready: ③ says the model is NOT confirmed and is not replaced', /확인하지 못함/.test(model) && /바꾸지 않아요/.test(model), model);
  ok('ready: no model <select>/<option> anywhere in the picker', await t.ev(`!document.querySelector('[data-el="agent-picker"] select, [data-el="agent-picker"] option')`));
  const pickerButtons = await t.ev(`JSON.stringify([...document.querySelectorAll('[data-el="agent-picker"] button')].map((b) => b.dataset.act))`);
  ok('ready: the picker holds only re-check / accept-version buttons - no start control', JSON.parse(pickerButtons).every((a) => ['agent-recheck', 'agent-accept-version'].includes(a)), pickerButtons);

  /* ② ③ without ④: tick the check-box with the keyboard, change the radio, re-check - the Work count must not move */
  const w0 = await t.works();
  await t.ev(`document.querySelector('[data-act="agent-ack"]').focus()`);
  await t.key(' ', 'Space', 32, ' ');
  ok('ready: ③ check-box ticked by keyboard, focus stayed', await t.ev(`document.querySelector('[data-act="agent-ack"]').checked && document.activeElement === document.querySelector('[data-act="agent-ack"]')`));
  const approve = await t.ev(`document.querySelector('[data-el="agent-approve"]').innerText`);
  ok('ready: ④ text says nothing has started and says only the start button starts it', /일은 아직 시작되지 않았어요/.test(approve) && /시작 버튼을 눌렀을 때만/.test(approve), approve);
  await t.ev(`document.querySelector('[data-act="agent-recheck"]').click()`); await t.sleep(1500);
  ok('ready: selecting / confirming / re-checking created no Work', (await t.works()) === w0, `${w0} -> ${await t.works()}`);
  results.workCount = { beforeApproval: w0 };
  await t.view(1200, 'light'); await t.shot('ready-after-confirm-before-start-1200-light');

  /* ④ the one explicit approval: type a request, press the emphasised start button */
  await t.ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = 'README에 한 줄 추가해 줘'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(400);
  const btnLabel = await t.ev(`[...document.querySelectorAll('.btn.pri')].filter((b) => b.offsetParent !== null).map((b) => b.innerText.trim()).join('|')`);
  ok('ready: exactly one emphasised start button is on screen', btnLabel.split('|').length === 1 && btnLabel.length > 0, btnLabel);
  ok('ready: still no Work before the start button is pressed', (await t.works()) === w0);
  await t.ev(`document.querySelector('.btn.pri').click()`);
  for (let i = 0; i < 40 && (await t.works()) === w0; i++) await t.sleep(250);
  const w1 = await t.works();
  ok('ready: the start button created exactly one Work', w1 === w0 + 1, `${w0} -> ${w1}`);
  results.workCount.afterApproval = w1;
});

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
step(`agent-picker: ${results.checks.length} checks, ${results.captures.length} captures -> ${OUT}`);
process.exit(0);
