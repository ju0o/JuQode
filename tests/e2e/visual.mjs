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
import os from 'node:os';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

/* The app under test gets its OWN store, seeded with one project. Two reasons:
 *   1. a test must never touch the user's real juqode.db
 *   2. SC-02 is reachable without a native folder dialog, which cannot be driven headlessly */
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-e2e-'));
const DB = path.join(DB_DIR, 'juqode.db');
const SEED = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-seed-')));

/* A small but REAL project, so the Brief has something it can actually confirm. It also
 * carries a `.env` and a `node_modules`, which must never be read: the exclusion list is
 * JuQode's own and does not depend on .gitignore (19 §C1 ④). */
fs.writeFileSync(path.join(SEED, 'package.json'), JSON.stringify({
  name: 'seed-app', main: 'src/index.js',
  scripts: { dev: 'vite', build: 'vite build', test: 'node --test' },
  dependencies: { vite: '^5.0.0' },
}, null, 2));
fs.writeFileSync(path.join(SEED, 'package-lock.json'), '{"lockfileVersion":3}');
fs.writeFileSync(path.join(SEED, 'README.md'), '# seed-app\n\n작은 예제 프로젝트예요.\n\n## 설치\n\nnpm i\n');
fs.writeFileSync(path.join(SEED, '.env'), 'SECRET_TOKEN=juqode-synthetic-fixture-marker\n');
for (const d of ['src', 'lib', 'node_modules']) fs.mkdirSync(path.join(SEED, d));
fs.writeFileSync(path.join(SEED, 'src', 'index.js'), 'export const hi = 1;\n');
fs.writeFileSync(path.join(SEED, 'node_modules', 'huge.js'), 'x'.repeat(1000));

/* A fixture CLI, not the host's. Without this the WBS-09 assertions test a different code
 * path on every machine — and on a host with no Claude Code they pass carrying no information. */
const FAKE_CLI = path.join(DB_DIR, 'claude');
fs.writeFileSync(FAKE_CLI, [
  '#!/bin/sh',
  "if [ \"$1\" = \"--version\" ]; then echo '9.9.9-fixture (Claude Code)'; exit 0; fi",
  "if [ \"$1\" = \"auth\" ]; then echo '{\"loggedIn\":true,\"email\":\"fixture@example.test\",\"orgId\":\"org-fixture\"}'; exit 0; fi",
  'exit 1',
].join('\n') + '\n', { mode: 0o755 });
/* TWO projects, SEED opened first so SEED2 is the newer one. That makes "did the recent list
 * get re-read?" answerable: the list starts SEED2-first, the run opens SEED, and on return
 * SEED must be on top. A count alone cannot tell a re-read from a stale DOM. */
const SEED2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-seed2-')));
{
  const { openDb } = require(path.join(ROOT, 'app/main/db/db.js'));
  const repo = require(path.join(ROOT, 'app/main/db/repo.js'));
  const db = openDb(DB);
  repo.openProject(db, SEED, path.basename(SEED));
  const t = Date.now(); while (Date.now() === t) { /* distinct millisecond */ }
  repo.openProject(db, SEED2, path.basename(SEED2));
  db.close();
}

/* Artifact hygiene: a test run must never mutate committed evidence, or a reviewer cannot
 * verify without dirtying the tree. Screenshots go to an untracked directory by default;
 * replacing the tracked goldens requires saying so explicitly. */
/* Current rendering of each built screen. WBS-01's own evidence directory stays as the
 * historical record of that package; this one tracks what the app looks like NOW. */
const GOLDEN = path.join(ROOT, 'docs', 'dev-evidence', 'screens');
const UPDATE = process.argv.includes('--update-golden') || process.env.JUQODE_UPDATE_GOLDEN === '1';
const OUT = UPDATE ? GOLDEN : path.join(ROOT, 'tmp-visual');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9223;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Resolve the token through a real element: `getPropertyValue('--fail')` gives the HEX as
 * authored, while `getComputedStyle(x).color` gives `rgb(...)`. Comparing those two can never
 * be true, so the earlier "no red on this screen" assertion proved nothing. Verified by
 * deliberately painting an element red: the old check still reported 0. */
const RED_COUNT = (scope) => `(() => {
  const probe = document.createElement('span');
  probe.style.color = 'var(--fail)';
  document.body.appendChild(probe);
  const red = getComputedStyle(probe).color;
  probe.remove();
  const hit = (n) => { const c = getComputedStyle(n);
    return c.color === red || c.borderTopColor === red || c.backgroundColor === red; };
  return [...document.querySelectorAll(${JSON.stringify(scope)})].filter(hit).length;
})()`;

/* Progress on stderr, so a run that stalls says WHERE it stalled instead of going quiet. */
const step = (m) => process.stderr.write(`  · ${m}\n`);

async function cdp(sendFn) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  assert.ok(page, `no page target — did the window open?\n${appErr.slice(-1500)}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  /* A CDP call that never comes back must fail the run, not hang it. A hung harness
     reads as "still working" and can burn a whole CI slot saying nothing. */
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); rej(new Error(`CDP timeout: ${method} ${JSON.stringify(params).slice(0, 160)}`)); }, 20000);
    pending.set(n, (msg) => { clearTimeout(timer); res(msg); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  try { return await sendFn({ send, evalJs }); } finally { ws.close(); }
}

/* `detached` puts xvfb-run AND the Electron tree it starts into one process group.
 * Killing the group is the only thing that actually stops them: SIGTERM to xvfb-run alone
 * leaves Electron running, holding the inherited stdio pipes, so this script would finish
 * its work and then never exit — measured, and the reason for the group kill. */
/* A leftover Electron on this port would be driven INSTEAD of the app under test, and the
 * run would report on code that is not in the working tree. */
for (const port of [PORT, PORT + 1]) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(700) });
    throw new Error(`something is already listening on ${port} — kill the stale Electron before running this`);
  } catch (e) { if (!/fetch failed|aborted|timeout/i.test(e.message)) throw e; }
}

const app = spawn('xvfb-run', ['-a', path.join(ROOT, 'node_modules', '.bin', 'electron'), '.',
  '--no-sandbox', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, detached: true, env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: DB,
      JUQODE_CLAUDE_BIN: FAKE_CLI, JUQODE_INTERPRET_DELAY_MS: '2500' } });
app.on('error', (e) => { throw new Error(`could not start the app (is xvfb-run installed?): ${e.message}`); });
const stopApp = () => { try { process.kill(-app.pid, 'SIGKILL'); } catch { /* already gone */ } };
process.on('exit', stopApp);
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
  step('cdp attached');
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
  step('theme matrix');
  /* Colour transitions are on `.btn`, so a measurement taken too soon reads a mid-transition
   * value — an earlier revision of this file reported 11.78 : 1 for a pair whose tokens work
   * out to 15.7 : 1, because it sampled during the fade. Reduced-motion removes the moving
   * target so the number is the token pair and nothing else. */
  out.matrix = {};
  for (const os of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: os },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ] });
    for (const toggle of ['', 'light', 'dark']) {
      await evalJs(`document.documentElement.setAttribute('data-theme','${toggle}')`);
      await sleep(200);
      const c = await evalJs(PRI_CONTRAST);
      const bg = await evalJs('getComputedStyle(document.body).backgroundColor');
      out.matrix[`os=${os} toggle=${toggle || 'system'}`] = { priContrast: c, bodyBg: bg };
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] });

  step('sc01 shots');
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

  /* WBS-02 — the recent row opens the real project it names, from the real store.
   * (The folder BUTTON opens a native dialog; that path cannot be driven headlessly and is
   * covered by the unit tests over project.inspect / project.openPath instead.) */
  await evalJs(`document.documentElement.setAttribute('data-theme','light')`);
  out.recentRows = await evalJs('document.querySelectorAll(\'[data-el="recent-row"]\').length');
  step('open recent row');
  /* the SECOND row — the older project — so the reorder on return is a real signal */
  await evalJs(`document.querySelectorAll('[data-el="recent-row"]')[1].click()`);
  await sleep(700);

  /* 해석 중 — a required `15` state that had no rendered evidence. The scan finishes in
   * milliseconds, so the app is asked to hold the answer rather than the state being faked. */
  out.interpretingText = await evalJs(`document.querySelector('[data-card="brief"]')?.innerText ?? null`);
  out.interpretingHasChips = await evalJs(`document.querySelectorAll('[data-card="brief"] .chip').length`);
  {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'sc02-interpreting-light.png'), Buffer.from(shot.result.data, 'base64'));
  }
  await sleep(2200);
  out.screenAfterOpen = await evalJs('window.__screen()');
  out.openedProject  = await evalJs('JSON.stringify(window.__project())');
  /* SC-02 no longer probes on entry (the 사용 불가 card belongs to a start attempt — see
   * CANON_FINDINGS CF-3), so detection is exercised through the bridge it is exposed on. */
  out.claude         = await evalJs('(async () => JSON.stringify(await window.juqode.claudeStatus()))()');
  await sleep(400);
  out.interp         = await evalJs('JSON.stringify(window.__interp())');
  out.briefRows      = await evalJs(`document.querySelectorAll('[data-card="brief"] .ans').length`);
  out.briefChips     = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-card="brief"] .ans')].map(n => n.querySelector('.chip').textContent))`);
  out.briefConfirmedHaveSource = await evalJs(`[...document.querySelectorAll('[data-card="brief"] .ans')]
    .filter(n => n.querySelector('.chip').textContent.includes('확인됨')
              && !n.querySelector('.chip').textContent.includes('못함')
              && !n.querySelector('.src')).length`);
  out.briefStamp = await evalJs(`document.querySelector('[data-card="brief"] .chead .mut2')?.textContent ?? null`);
  out.briefPartialAmber = await evalJs(`(() => {
    const probe = document.createElement('span'); probe.style.color = 'var(--part)';
    document.body.appendChild(probe); const amber = getComputedStyle(probe).color; probe.remove();
    const line = document.querySelector('[data-card="brief"] .partial-line');
    return line ? getComputedStyle(line).color === amber : null; })()`);
  out.sc02Cards      = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-card]')].map(n => n.getAttribute('data-card')))`);
  /* The open-path gate, exercised THROUGH the bridge. Asserting that main.js contains the
   * string `not-offered` passes just as happily when the gate is `true || …`. */
  out.gate = await evalJs(`(async () => JSON.stringify({
    absolute: await window.juqode.openPath('/etc'),
    empty:    await window.juqode.openPath(''),
    nul:      await window.juqode.openPath(null),
    number:   await window.juqode.openPath(42),
  }))()`);
  out.sc02Overflow   = await evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  out.sc02Clipped    = await evalJs(`[...document.querySelectorAll('.sc02 .card')].filter(n => n.scrollHeight > n.clientHeight + 1).length`);
  out.sc02Reds       = await evalJs(RED_COUNT('.sc02 *'));
  /* Prove the counter can actually see red before trusting a zero from it. */
  await evalJs(`document.querySelector('.sc02 .card').style.color = 'var(--fail)'`);
  out.sc02RedProbe   = await evalJs(RED_COUNT('.sc02 *'));
  await evalJs(`document.querySelector('.sc02 .card').style.color = ''`);

  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc02-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evalJs(`document.querySelectorAll('.fade-in').forEach(n => { n.classList.remove('fade-in'); void n.offsetWidth; n.classList.add('fade-in'); })`);
  await sleep(150);
  out.animating = await evalJs('document.getAnimations().filter(a => a.playState === "running").length');
  await send('Emulation.setEmulatedMedia', { features: [] });

  step('back to picker');
  // 다른 프로젝트 열기 goes back to SC-01, and the project it just opened is now remembered
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('다른 프로젝트')).click()`);
  await sleep(700);
  out.screenAfterBack = await evalJs('window.__screen()');
  out.recentAfterBack = await evalJs('document.querySelectorAll(\'[data-el="recent-row"]\').length');
  out.recentTopAfterBack = await evalJs(`document.querySelector('[data-el="recent-row"] .path')?.textContent ?? null`);

  /* ── 열 수 없음 ────────────────────────────────────────────────────────────────
   * The one red on SC-01. Until now no rendered evidence existed for ANY of the states the
   * colour grammar is actually about, so "red is failure only" rested on reading the source.
   * The second recent row's folder is deleted out from under the app, which is a real user
   * situation, and the resulting card is measured and photographed. */
  step('folder that is gone');
  fs.rmSync(SEED2, { recursive: true, force: true });
  await evalJs(`[...document.querySelectorAll('[data-el="recent-row"]')].at(-1).click()`);
  await sleep(600);
  out.failCard = await evalJs(`document.querySelector('[data-el="fail"]')?.innerText ?? null`);
  out.failActions = await evalJs(`document.querySelectorAll('[data-el="fail"] .row-acts button').length`);
  out.failReds = await evalJs(RED_COUNT('[data-el="fail"], [data-el="fail"] *'));
  out.failStillSC01 = await evalJs('window.__screen()');
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc01-fail-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  return out;
});

step('cdp done — stopping app');
stopApp();
await sleep(400);

const bridge = JSON.parse(results.bridge);
assert.strictEqual(results.ready, true, 'renderer did not initialise');
assert.strictEqual(results.screen, 'SC-01', `expected SC-01, got ${results.screen}`);
assert.deepStrictEqual(bridge.keys.sort(), ['boot', 'claudeStatus', 'interpret', 'openPath', 'openProject', 'versions'],
  'renderer API surface is not exactly the declared one');
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
/* WBS-02 · WBS-21 · WBS-09 */
assert.strictEqual(results.recentRows, 2, 'the seeded projects did not reach SC-01 from the store');
assert.strictEqual(results.screenAfterOpen, 'SC-02', `opening a project did not reach SC-02 (got ${results.screenAfterOpen})`);
assert.strictEqual(JSON.parse(results.openedProject).path, SEED, 'SC-02 is showing a different project than the one opened');
assert.deepStrictEqual(JSON.parse(results.sc02Cards).sort(), ['brief', 'history', 'stream'],
  'SC-02 board is not the cards this package builds — nothing a later package owns may be drawn');
/* WBS-03 — the Brief is six answers, and a 확인됨 chip must name the file it rests on (D-114). */
const interp = JSON.parse(results.interp);
assert.ok(interp, 'the Brief never arrived — interpretation did not run on open');
assert.strictEqual(results.briefRows, 6, `the Brief must render all six questions, found ${results.briefRows}`);
assert.strictEqual(results.briefConfirmedHaveSource, 0,
  'a 확인됨 answer is rendered without the source file it rests on');
/* 15 SC-02 ① requires the 해석 시점 timestamp on the Brief. */
/* 해석 중 says what it is doing and claims nothing: no chips, no answers, no percent. */
assert.ok(results.interpretingText && results.interpretingText.includes('프로젝트를 읽고 있어요'),
  `해석 중 did not render (got ${results.interpretingText})`);
assert.strictEqual(results.interpretingHasChips, 0, '해석 중 rendered a confidence chip before it had an answer');
assert.ok(!/\d+\s*%/.test(results.interpretingText), '해석 중 rendered a percentage');

assert.ok(results.briefStamp && results.briefStamp.includes('읽은 시점'),
  `the Brief has no 해석 시점 timestamp (got ${results.briefStamp})`);
/* 16 §2: 부분 is amber. It is the state the user is always in until WBS-04. */
assert.strictEqual(results.briefPartialAmber, true, '부분 해석 is not rendered in the amber it is assigned');
/* The seeded project is an EMPTY folder: nothing about it can be confirmed except what the
 * scan itself knows, so the Brief must not claim otherwise. */
/* The seeded project has a manifest, folders and scripts, so the facts layer can confirm
 * 쓰인 기술 · 폴더가 하는 일 · 실행 방법. It has no narrative layer yet, so 하는 일 and
 * 주요 기능 stay 확인 못함 — partial, which `11` says is not a failure. */
assert.strictEqual(interp.status, 'partial', `expected 부분 해석, got ${interp.status}`);
const confirmed = interp.answers.filter((a) => a.confidence === 'confirmed').map((a) => a.q);
/* q4 is 확인 못함 on purpose: the question is what the folders DO, and the scan established
 * only that they exist. A 확인됨 chip there would certify an answer nothing has given. */
assert.deepStrictEqual(confirmed, [3, 5, 6], `the facts layer confirmed q${confirmed}`);
assert.deepStrictEqual(interp.answers.filter((a) => a.confidence === 'unconfirmed').map((a) => a.q), [1, 2, 4]);

/* 19 §C1 ④ — a secret is excluded BY NAME, before anything opens it. */
assert.ok(!interp.readFiles.includes('.env'), 'the scanner read a .env file');
assert.ok(!JSON.stringify(interp).includes('SECRET_TOKEN'), 'a secret name reached the interpretation');
assert.deepStrictEqual(interp.readFiles.sort(), ['README.md', 'package.json'],
  'the facts layer read something other than the manifests and the README');
assert.ok(interp.answers.every((a) => a.confidence !== 'confirmed' || a.sourceRef),
  '20 requires a source_ref on every confirmed answer');

assert.strictEqual(results.sc02Overflow, 0, `SC-02 horizontal overflow of ${results.sc02Overflow}px`);
assert.strictEqual(results.sc02Clipped, 0, 'an SC-02 card is clipping its own content');
assert.ok(results.sc02RedProbe > 0,
  'the red counter cannot see red — a zero from it would prove nothing (this check was once vacuous)');
assert.strictEqual(results.sc02Reds, 0, 'SC-02 renders red with nothing failed — red is failure only (16 §2)');
assert.strictEqual(results.animating, 0,
  'an animation is still running under prefers-reduced-motion: reduce');

/* WBS-09 through the bridge, against the FIXTURE CLI — so this asserts our code, not the host's. */
const claude = JSON.parse(results.claude);
assert.strictEqual(claude.available, true, 'detection did not reach the fixture CLI');
assert.strictEqual(claude.version, '9.9.9-fixture', 'detection did not read the fixture version');
assert.deepStrictEqual(Object.keys(claude).sort(), ['available', 'version'],
  'Claude Code detection carried more than availability into the renderer');
for (const k of ['fixture@example.test', 'org-fixture', 'email', 'orgId']) {
  assert.ok(!JSON.stringify(claude).includes(k), `detection leaked ${k} into the renderer`);
}

/* A renderer must not be able to name a folder of its own choosing. `null` is the one that
 * used to get through: the gate compared against `lastPick`, which starts as null, and
 * realpath coerces a non-string — so `openPath(null)` opened a "null" folder under cwd. */
const gate = JSON.parse(results.gate);
for (const [what, r] of Object.entries(gate)) {
  assert.strictEqual(r.ok, false, `openPath(${what}) was accepted — the renderer can name any path`);
  assert.strictEqual(r.reason, 'not-offered', `openPath(${what}) answered ${r.reason}, expected not-offered`);
}

assert.strictEqual(results.screenAfterBack, 'SC-01', '다른 프로젝트 열기 did not return to SC-01');
assert.strictEqual(results.recentAfterBack, 2, 'the recent list lost a row on return');
assert.ok(results.recentTopAfterBack && results.recentTopAfterBack.endsWith(path.basename(SEED)),
  'the just-opened project is not at the top of the recent list — the list was not re-read');
/* 15 SC-01 Failure State: title + reason in plain words + TWO recovery actions, and it is
 * the one red on this screen. */
assert.strictEqual(results.failStillSC01, 'SC-01', 'a folder that cannot be opened must not navigate away');
assert.ok(results.failCard, 'a deleted folder produced no failure card at all');
assert.ok(results.failCard.includes('이 폴더는 열 수 없어요'), `failure card headline is wrong: ${results.failCard}`);
assert.ok(results.failCard.includes('폴더가 없어요'), 'the failure card does not name the reason');
assert.strictEqual(results.failActions, 2, `15 asks for 2 recovery actions, found ${results.failActions}`);
assert.ok(results.failReds > 0, 'the one red on SC-01 is not rendered red');

for (const d of [SEED, SEED2]) fs.rmSync(d, { recursive: true, force: true });

console.log(JSON.stringify(results, null, 2));
/* ── A store the app must refuse ────────────────────────────────────────────────
 * WBS-21 says a file we cannot understand is refused, never replaced. That is only half
 * the promise: the app must also still BOOT and say so. Nothing above proves that, so it
 * gets its own launch with a deliberately unusable store. */
{
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-bad-'));
  const bad = path.join(badDir, 'juqode.db');
  fs.writeFileSync(bad, 'this is not a database');
  const before = fs.readFileSync(bad);

  const PORT2 = PORT + 1;
  const app2 = spawn('xvfb-run', ['-a', path.join(ROOT, 'node_modules', '.bin', 'electron'), '.',
    '--no-sandbox', `--remote-debugging-port=${PORT2}`],
    { cwd: ROOT, detached: true, env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: bad } });
  const stop2 = () => { try { process.kill(-app2.pid, 'SIGKILL'); } catch { /* gone */ } };
  process.on('exit', stop2);
  await sleep(4000);

  const list = await (await fetch(`http://127.0.0.1:${PORT2}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  assert.ok(page, 'the app did not open a window when its store was unusable — it must still boot');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let n = 0; const waiting = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
  const ev2 = (expr) => new Promise((res, rej) => {
    const id = ++n;
    const t = setTimeout(() => rej(new Error('CDP timeout on the refused-store run')), 20000);
    waiting.set(id, (msg) => { clearTimeout(t); res(msg.result?.result?.value); });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });

  const refused = {
    screen:   await ev2('window.__screen()'),
    card:     await ev2(`document.querySelector('[data-el="store"]')?.textContent ?? null`),
    disabled: await ev2(`document.querySelector('[data-act="open-project"]').disabled`),
    reds:     await ev2(RED_COUNT('[data-el="store"] *')),
    walk:     await ev2(`(async () => JSON.stringify(await window.juqode.openPath('/etc')))()`),
  };
  ws.close();
  stop2();
  await sleep(400);

  assert.strictEqual(refused.screen, 'SC-01', 'a refused store must not stop the app from booting');
  assert.ok(refused.card && refused.card.includes('지금 안 됨'),
    'a refused store must be reported with the 지금 안 됨 grammar, not silently');
  assert.strictEqual(refused.disabled, true,
    'opening a project must be disabled when nothing can remember it');
  assert.strictEqual(refused.reds, 0, 'a refused store is not a failure — it must not render red');
  assert.deepStrictEqual(fs.readFileSync(bad), before,
    'the unusable file was modified — WBS-21 says refuse, never replace');
  /* Every handler must ANSWER. A throw here rejects the invoke, and the renderer's boot is a
   * top-level await — one rejection leaves a blank window with no message. */
  const walk = JSON.parse(refused.walk);
  assert.strictEqual(walk.ok, false);
  assert.strictEqual(walk.reason, 'no-store',
    'open-path with no store must answer, not reject — a rejected invoke blanks the window');
  fs.rmSync(badDir, { recursive: true, force: true });
  console.log('refused-store boot: PASS  ', JSON.stringify(refused));
}
fs.rmSync(DB_DIR, { recursive: true, force: true });

console.log('\nvisual+behaviour: PASS   screenshots ->', OUT,
  UPDATE ? '(tracked goldens UPDATED)' : '(untracked; pass --update-golden to replace tracked evidence)');
process.exit(0);
