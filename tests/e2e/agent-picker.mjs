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
      for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-el="agent-summary"]')`)); i++) await sleep(250);
      for (let i = 0; i < 60 && (await ev(`document.querySelector('[data-el="agent-summary"]').dataset.checking`)) !== 'false'; i++) await sleep(250);
    };
    const rows = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-agent]')].map((r) => ({ id: r.dataset.agent, state: r.dataset.state, disabled: r.querySelector('input').disabled, checked: r.querySelector('input').checked, text: r.textContent.replace(/\\s+/g, ' ').trim() })))`));
    const summaryText = () => ev(`document.querySelector('[data-el="agent-summary"]').innerText.replace(/\\s+/g, ' ').trim()`);
    const startNotes = () => ev(`JSON.stringify([...document.querySelectorAll('.start-note')].filter((n) => n.offsetParent !== null).map((n) => n.innerText.trim()))`).then(JSON.parse);
    const panelVisible = () => ev(`(() => { const p = document.querySelector('[data-el="agent-panel"]'); return !!p && p.offsetParent !== null; })()`);
    const openPanel = async () => { await ev(`document.querySelector('[data-act="agent-open"]').click()`); await sleep(350); };
    const closePanel = async () => { await ev(`document.querySelector('[data-act="inspect-close"]').click()`); await sleep(300); };
    const overflow = async (n) => { const o = JSON.parse(await ev(`JSON.stringify({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth })`)); ok(`${n}: no sideways scroll`, o.sw <= o.iw + 1, JSON.stringify(o)); };
    await body({ ev, send, key, view, shot, works, openProject, rows, summaryText, startNotes, panelVisible, openPanel, closePanel, overflow, sleep });
  } finally { killTree(app); await sleep(500); }
}

const WIDTHS = [880, 1024, 1200, 1440];
/* the composer summary first (panel closed), then the Inspector panel across the matrix; closing returns focus to the way in */
async function gallery(t, state) {
  for (const w of [880, 1200]) for (const th of ['light', 'dark']) { await t.view(w, th); await t.overflow(`${state} composer ${w} ${th}`); await t.shot(`${state}-composer-${w}-${th}`); }
  await t.view(1200, 'light');
  await t.openPanel();
  ok(`${state}: the panel opens from the composer summary`, await t.panelVisible());
  for (const w of WIDTHS) for (const th of ['light', 'dark']) { await t.view(w, th); await t.overflow(`${state} panel ${w} ${th}`); await t.shot(`${state}-panel-${w}-${th}`); }
  await t.view(1200, 'light', 1.5); await t.overflow(`${state} panel 1200 150%`); await t.shot(`${state}-panel-1200-light-zoom150`);
  await t.view(1200, 'light', 1);
}
const NO_PROMISE = /준비(가)? 됐|준비 완료|모델 선택 완료|선택 완료/;

/* every blocked state must say the choice is void, name the state, never promise a start, and never substitute another AI */
async function blockedChecks(t, label, tag) {
  const sum = await t.summaryText();
  ok(`${label}: summary names the state`, sum.includes(tag), sum);
  ok(`${label}: summary says the choice is void and nothing was substituted`, /이 선택은 지금 쓸 수 없어요/.test(sum) && /다른 AI로 바꾸지 않았어요/.test(sum), sum);
  ok(`${label}: summary never claims readiness`, !NO_PROMISE.test(sum), sum);
  const notes = (await t.startNotes()).join(' | ');
  ok(`${label}: no "바로 시작해요" promise while the AI cannot run`, !/바로 시작해요/.test(notes) && /쓸 수 없는 상태예요/.test(notes), notes);
}

ctrl({ version: '2.1.0', loggedIn: false });
await session('auth', CTRL_CLI, async (t) => {
  await t.openProject(SEED);
  await blockedChecks(t, 'auth', '인증 필요');
  await t.openPanel();
  const r = await t.rows(); results.launches.auth = r;
  ok('auth: Claude 인증 필요 and not selectable', r[0].state === 'auth' && r[0].disabled && /인증 필요/.test(r[0].text), JSON.stringify(r));
  await t.closePanel();
  await gallery(t, 'auth');
});
ctrl({ version: '', loggedIn: true });
await session('version-unknown', CTRL_CLI, async (t) => {
  await t.openProject(SEED);
  await blockedChecks(t, 'version-unknown', '버전 불명');
  await t.openPanel();
  const r = await t.rows(); results.launches['version-unknown'] = r;
  ok('version-unknown: 버전 불명 and not selectable', r[0].state === 'version-unknown' && r[0].disabled && /버전 불명/.test(r[0].text), JSON.stringify(r));
  await t.closePanel();
  await gallery(t, 'version-unknown');
});
await session('missing', '/nonexistent/juqode-picker-claude', async (t) => {
  await t.openProject(SEED);
  await blockedChecks(t, 'missing', '미설치');
  await t.openPanel();
  const r = await t.rows(); results.launches.missing = r;
  ok('missing: 미설치 and not selectable', r[0].state === 'missing' && r[0].disabled && /미설치/.test(r[0].text), JSON.stringify(r));
  await t.closePanel();
  const w0 = await t.works();
  ok('missing: no Work created by looking', (await t.works()) === w0);
  /* the Canon flow is kept: pressing start is still allowed and the refusal card explains it; nothing is created */
  await t.ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = 'README에 한 줄 추가해 줘'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(400);
  const disabled = await t.ev(`[...document.querySelectorAll('.btn.pri')].filter((b) => b.offsetParent !== null).every((b) => !b.disabled)`);
  ok('missing: the start button is NOT disabled (existing flow kept)', disabled);
  await t.ev(`document.querySelector('.btn.pri').click()`); await t.sleep(2500);
  const card = await t.ev(`document.querySelector('[data-el="consequence"]').innerText.replace(/\\s+/g, ' ').trim()`);
  ok('missing: pressing start shows the existing refusal explanation', card.length > 10 && !/바로 시작해요/.test(card), card);
  ok('missing: still no Work', (await t.works()) === w0);
  await gallery(t, 'missing');
});

/* version CHANGE: first probe 2.1.0, then the fixture is replaced by 2.2.0 and the person presses 다시 확인 */
ctrl({ version: '2.1.0', loggedIn: true });
await session('version-changed', CTRL_CLI, async (t) => {
  await t.openProject(SEED);
  await t.openPanel();
  let r = await t.rows();
  ok('version-changed: first probe is ready', r[0].state === 'ready' && !r[0].disabled);
  const w0 = await t.works();
  /* tick the optional "seen" mark; a version change must void it */
  await t.ev(`document.querySelector('[data-act="agent-ack"]').focus()`);
  await t.key(' ', 'Space', 32, ' ');
  ok('version-changed: "seen" ticked', await t.ev(`document.querySelector('[data-act="agent-ack"]').checked`));
  ctrl({ version: '2.2.0', loggedIn: true });
  await t.ev(`document.querySelector('[data-act="agent-recheck"]').focus()`);
  await t.key('Enter', 'Enter', 13, '\r');
  for (let i = 0; i < 40 && (await t.rows())[0].state === 'ready'; i++) await t.sleep(250);
  r = await t.rows(); results.launches['version-changed'] = r;
  ok('version-changed: 버전 변경 and not selectable', r[0].state === 'version-changed' && r[0].disabled && /버전 변경/.test(r[0].text) && /2\.1\.0.*2\.2\.0/.test(r[0].text), r[0].text);
  ok('version-changed: focus stayed on 다시 확인 while the status changed', (await t.ev(`document.activeElement?.getAttribute('data-act')`)) === 'agent-recheck');
  await t.closePanel();
  await blockedChecks(t, 'version-changed', '버전 변경');
  await t.openPanel();
  await t.ev(`document.querySelector('[data-act="agent-accept-version"]').click()`); await t.sleep(300);
  r = await t.rows();
  ok('version-changed: after the person accepts the new version, Claude is selectable again', r[0].state === 'ready' && !r[0].disabled);
  ok('version-changed: the earlier "seen" mark was voided and is NOT restored', !(await t.ev(`document.querySelector('[data-act="agent-ack"]').checked`)));
  ok('version-changed: no Work created by any of this', (await t.works()) === w0);
  await t.closePanel();
  await gallery(t, 'version-changed');
});

/* ── ready: summary, the way into the Inspector from an UNSAVED request, the same state on a saved Task, and the one approval ── */
await session('ready', FAKE_CLI, async (t) => {
  await t.openProject(SEED2);
  const sum = await t.summaryText();
  results.readySummary = sum;
  ok('ready: composer summary names the AI, LIMITED mode and the default', /Claude Code/.test(sum) && /제한 모드\(안전 인증 아님\)/.test(sum) && /기본으로 골라져 있어요 \(실행 승인 아님\)/.test(sum), sum);
  ok('ready: summary says the model is unconfirmed and the choice is not wired to the run', /모델: 확인하지 못함/.test(sum) && /실제 실행 인자에 연결되지 않았어요/.test(sum), sum);
  ok('ready: summary never claims readiness / a finished model choice', !NO_PROMISE.test(sum), sum);
  ok('ready: the panel is NOT in the composer (it lives in the Inspector region)', await t.ev(`!document.querySelector('[data-region="stage"] [data-el="agent-panel"]') && !!document.querySelector('[data-region="inspector"] [data-el="agent-panel"]')`));
  await gallery(t, 'ready');

  /* an unsaved request: type it, open the choice from the summary - the text and the proposal must survive, focus must return */
  const text = 'README에 한 줄 추가해 줘';
  await t.view(1200, 'light');
  await t.ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await t.sleep(400);
  const w0 = await t.works();
  await t.openPanel();
  ok('ready: unsaved request - panel opened beside it', await t.panelVisible());
  ok('ready: unsaved request - the written text is untouched', (await t.ev(`document.querySelector('[data-el="intent"]').value`)) === text);
  ok('ready: unsaved request - the proposal is still there', await t.ev(`!document.querySelector('[data-el="composer-draft"]').hidden`));
  const r = await t.rows(); results.launches.ready = r;
  ok('ready: Claude 설치됨·로그인됨, selected, selectable', r[0].state === 'ready' && !r[0].disabled && r[0].checked && /설치됨/.test(r[0].text) && /제한 모드/.test(r[0].text), r[0].text);
  for (const i of [1, 2]) ok(`ready: ${r[i].id} is 미실측 + 현재 실행 불가 and disabled`, r[i].state === 'unmeasured' && r[i].disabled && /미실측/.test(r[i].text) && /현재 실행 불가/.test(r[i].text) && !r[i].checked);
  const model = await t.ev(`document.querySelector('[data-el="agent-model"]').innerText`);
  ok('ready: ③ says the model is NOT confirmed and is not replaced', /확인하지 못함/.test(model) && /바꾸지 않아요/.test(model), model);
  ok('ready: ③ "seen" mark is optional and says so', /선택 사항/.test(model), model);
  ok('ready: no model <select>/<option> anywhere in the panel', await t.ev(`!document.querySelector('[data-el="agent-panel"] select, [data-el="agent-panel"] option')`));
  const pb = await t.ev(`JSON.stringify([...document.querySelectorAll('[data-el="agent-panel"] button')].map((b) => b.dataset.act))`);
  ok('ready: the panel holds only re-check / accept-version buttons - no start control', JSON.parse(pb).every((a) => ['agent-recheck', 'agent-accept-version'].includes(a)), pb);
  await t.ev(`document.querySelector('[data-act="agent-ack"]').focus()`);
  await t.key(' ', 'Space', 32, ' ');
  ok('ready: "seen" ticked by keyboard, focus stayed', await t.ev(`document.querySelector('[data-act="agent-ack"]').checked && document.activeElement === document.querySelector('[data-act="agent-ack"]')`));
  ok('ready: the composer summary shows the SAME state (seen) - one source', /내용은 봤어요/.test(await t.summaryText()));
  const approve = await t.ev(`document.querySelector('[data-el="agent-approve"]').innerText`);
  ok('ready: ④ text says nothing has started and that the composer start button is the only start', /일은 아직 시작되지 않았어요/.test(approve) && /시작 버튼을 눌렀을 때만/.test(approve) && !NO_PROMISE.test(approve), approve);
  ok('ready: panel says the choice is not wired to the run arguments', /실제 실행 인자에 연결되지 않았어요/.test(await t.ev(`document.querySelector('[data-el="agent-panel"]').innerText`)));
  await t.ev(`document.querySelector('[data-act="agent-recheck"]').click()`); await t.sleep(1500);
  ok('ready: choosing / viewing / re-checking created no Work', (await t.works()) === w0, `${w0} -> ${await t.works()}`);
  await t.shot('ready-unsaved-request-panel-open-1200-light');
  await t.closePanel();
  ok('ready: closing the panel returns focus to the way in (AI 고르기·확인)', (await t.ev(`document.activeElement?.getAttribute('data-act')`)) === 'agent-open');
  ok('ready: the written text survived open + close', (await t.ev(`document.querySelector('[data-el="intent"]').value`)) === text);
  results.workCount = { beforeApproval: w0 };

  /* ④ the one explicit approval: the emphasised start button of the composer */
  const label = await t.ev(`[...document.querySelectorAll('.btn.pri')].filter((b) => b.offsetParent !== null).map((b) => b.innerText.trim()).join('|')`);
  ok('ready: exactly one emphasised start button is on screen', label.split('|').length === 1 && label.length > 0, label);
  ok('ready: still no Work before the start button is pressed', (await t.works()) === w0);
  await t.ev(`document.querySelector('.btn.pri').click()`);
  for (let i = 0; i < 40 && (await t.works()) === w0; i++) await t.sleep(250);
  const w1 = await t.works();
  ok('ready: the start button created exactly one Work', w1 === w0 + 1, `${w0} -> ${w1}`);
  results.workCount.afterApproval = w1;

  /* an EXISTING Task: the same panel in its Inspector, the same state as the composer summary */
  for (let i = 0; i < 40 && (await t.ev('window.__screen()')) !== 'SC-02'; i++) {
    await t.ev(`[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.includes('작업대로'))?.click()`); await t.sleep(500);
  }
  for (let i = 0; i < 40 && !(await t.ev(`!!document.querySelector('.task-pick')`)); i++) await t.sleep(250);
  await t.view(1200, 'light');
  await t.ev(`document.querySelector('.task-pick').click()`); await t.sleep(600);
  /* the fixture CLI refuses the edit, so this Task's attempt is WAITING FOR A PERMISSION: that card is the one thing to do */
  const live = await t.ev(`!!document.querySelector('[data-region="inspector"] [data-el="inspect-permission"]')`);
  ok('ready: the saved Task has a live attempt waiting for a permission (fixture)', live);
  ok('ready: permission wait - the AI choice panel is hidden, not competing', await t.ev(`document.querySelector('[data-el="agent-panel"]').hidden === true && document.querySelector('[data-el="agent-panel"]').offsetParent === null`));
  ok('ready: permission wait - no agent control is focusable inside the Inspector', await t.ev(`![...document.querySelectorAll('[data-region="inspector"] [data-agent] input, [data-region="inspector"] [data-act^="agent-"]')].some((n) => n.offsetParent !== null)`));
  for (const [w, th] of [[1200, 'light'], [880, 'dark'], [880, 'light'], [1200, 'dark']]) {
    await t.view(w, th);
    await t.ev(`document.querySelector('.task-pick').click()`); await t.sleep(500);
    const g = JSON.parse(await t.ev(`(() => { const p = document.querySelector('[data-el="inspect-permission"]'); const a = [...p.querySelectorAll('button')].find((b) => b.classList.contains('pri')); const r = a.getBoundingClientRect();
      const head = document.querySelector('.sc02-inspect .inspect-title').getBoundingClientRect();
      return JSON.stringify({ allowLabel: a.innerText.trim(), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, topOfAllow: Math.round(r.top), titleTop: Math.round(head.top), vh: innerHeight, panelDisplay: getComputedStyle(document.querySelector('[data-el="agent-panel"]')).display }); })()`));
    ok(`ready: permission wait ${w} ${th}: 허용 button is inside the window without scrolling`, g.inView, JSON.stringify(g));
    ok(`ready: permission wait ${w} ${th}: the AI panel takes no space`, g.panelDisplay === 'none');
    await t.shot(`permission-wait-inspector-${w}-${th}`);
  }
  /* keyboard: from the Inspector's 닫기, Tab reaches 허용 and 중지 and never lands on an AI control */
  await t.view(1200, 'light');
  await t.ev(`document.querySelector('.sc02-inspect [data-act="inspect-close"]').focus()`);
  const seen = [];
  for (let i = 0; i < 14; i++) { await t.key('Tab', 'Tab', 9); seen.push(await t.ev(`(() => { const a = document.activeElement; return (a?.getAttribute('data-act') || a?.innerText || a?.tagName || '').toString().trim().slice(0, 30) + (a?.closest('[data-el="agent-panel"]') ? ' [AGENT]' : ''); })()`)); }
  results.permissionKeyboardOrder = seen;
  ok('ready: keyboard reaches 허용 and 중지 from the Inspector', seen.some((x) => /허용/.test(x)) && seen.some((x) => /그만두기/.test(x)), seen.join(' > '));
  ok('ready: keyboard never lands on an AI control while the permission is open', !seen.some((x) => /\[AGENT\]/.test(x)), seen.join(' > '));
  const wBefore = await t.works();
  /* the permission buttons still work: stop the attempt through the card; when it has ended the choice comes back */
  await t.ev(`document.querySelector('[data-el="inspect-permission"] .btn.cancel').click()`);
  let back = false;
  for (let i = 0; i < 60 && !back; i++) { await t.sleep(500); await t.ev(`document.querySelector('.task-pick')?.click()`); back = await t.ev(`document.querySelector('[data-el="agent-panel"]').hidden === false`); }
  ok('ready: after the attempt ended, the AI choice for the next attempt is back in the Inspector', back);
  ok('ready: stopping through the card created no Work', (await t.works()) === wBefore);
  await t.view(1200, 'light'); await t.shot('ended-task-inspector-1200-light');
  await t.view(880, 'dark'); await t.shot('ended-task-inspector-880-dark'); await t.view(1200, 'light');
});

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
step(`agent-picker: ${results.checks.length} checks, ${results.captures.length} captures -> ${OUT}`);
process.exit(0);
