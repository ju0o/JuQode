/* SC-01 visual + behaviour verification against the REAL Electron app.
 *
 * Drives the app over the Chrome DevTools Protocol (no extra dependency) and captures
 * screenshots so a human can look at them. DOM assertions alone are not enough —
 * 21 WBS-01 QA evidence asks for per-OS screenshots.
 */
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import os from 'node:os';
import { createRequire } from 'node:module';
/* Stale Xvfb locks accumulate and eventually starve `xvfb-run -a` — see xvfb.mjs. */
import { sweepDisplays } from './xvfb.mjs';
sweepDisplays();

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
/* A real git repo, because that is what a real project is — and it is the ONLY basis kind that
 * produces a diff (`git_tree`; the non-Git manifest basis compares hashes and has no patch to
 * read). Without this SC-04 could only ever be exercised in its 변경 없음 state. */
{
  const g = (...a) => execFileSync('git', a, { cwd: SEED, stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'fixture@example.test');
  g('config', 'user.name', 'fixture');
  fs.writeFileSync(path.join(SEED, '.gitignore'), 'node_modules/\n.env\n');
  g('add', '-A');
  g('commit', '-qm', 'seed');
}

/* A fixture CLI, not the host's. Without this the WBS-09 assertions test a different code
 * path on every machine — and on a host with no Claude Code they pass carrying no information. */
const FAKE_CLI = path.join(DB_DIR, 'claude');
/* The same fixture also serves the Work loop: asked to run a session it emits a stream that
 * ends in a permission REFUSAL, which is the D-133 state the screen has to render. */
const FAKE_CLI_JS = path.join(DB_DIR, 'claude-session.js');
fs.writeFileSync(FAKE_CLI_JS, `
const fs = require('fs');
/* On the RESUME the grant exists, so the Edit goes through and the Work ends — which is what
 * D-133's contract B describes and what gives SC-04 a finished Work to read. A fixture that
 * denied forever could only ever exercise the refusal card. */
const ARGV_LOG = ${JSON.stringify(path.join(DB_DIR, 'ARGV.log'))};
try {
  fs.mkdirSync(require('path').dirname(ARGV_LOG), { recursive: true });
  fs.appendFileSync(ARGV_LOG, process.argv.slice(2).join(' ') + '\\n');
} catch { /* the log is evidence for the test, never a reason for the fixture to die */ }
const resumed = process.argv.includes('--resume');
/* The EXPLANATION pass (WBS-26) is distinguishable from a Work turn by the tool restriction it
 * carries: \`--tools ""\` empties the built-in tool set. Answering it with real groups is what
 * gives SC-04's explained state — the JUQODE chip, 무엇/왜/어떤 동작에, the confidence chip and
 * \`readerFor\`'s persisted-groups branch — its first execution anywhere in the suite. */
const explaining = process.argv.includes('--tools');
if (explaining) {
  const groups = [{ title: '실행 안내를 README 에 넣었어요',
                    what: 'README 에 실행 방법을 적고, greet 함수를 추가했어요',
                    why: '프로젝트를 처음 여는 사람이 실행 방법을 찾을 수 있게',
                    affects: '문서와 인사말 함수',
                    confidence: 'confirmed',
                    files: ['README.md', 'src/index.js'] }];
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x', cwd: '/p' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    permission_denials: [], result: JSON.stringify(groups) }) + '\\n');
  process.exit(0);
}
/* The fixture EDITS the project on the GRANTED turn — the Edit it was denied is the Edit it
 * then performs. A Work that changed nothing could only ever show SC-04's 변경 없음 state.
 * One .js file (S1 — real declarations) and one .md file (S2 — \`19\` §C5-B sends structured
 * formats straight to Raw), so both strategies get rendered evidence. */
if (resumed) {
  fs.writeFileSync(${JSON.stringify(path.join(SEED, 'src', 'index.js'))},
    'export const hi = 1;\\n\\nexport function greet(name) {\\n  return "hi " + name;\\n}\\n');
  fs.writeFileSync(${JSON.stringify(path.join(SEED, 'README.md'))},
    '# seed-app\\n\\n작은 예제 프로젝트예요.\\n\\n## 설치\\n\\nnpm i\\n\\n## 실행\\n\\nnpm run dev\\n');
  /* …and it touches the gitignored, JuQode-excluded .env. Canon 19 SS-E: that change is NOT in
   * the diff by design, and the product still has to SAY it happened — from the ledger, as a
   * path and nothing more. This gives the evidence-gap card its first rendered evidence. */
  fs.writeFileSync(${JSON.stringify(path.join(SEED, '.env'))},
    'SECRET_TOKEN=juqode-synthetic-fixture-marker-CHANGED\\n');
}
const out = resumed ? [
  { type: 'system', subtype: 'init', session_id: 's', cwd: '/p', claude_code_version: '9.9.9' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_2', name: 'Edit', input: { file_path: 'README.md' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', is_error: false }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'README.md 와 src/index.js 를 고쳤어요', permission_denials: [] },
] : [
  { type: 'system', subtype: 'init', session_id: 's', cwd: '/p', claude_code_version: '9.9.9' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_a', name: 'Read', input: { file_path: 'README.md' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_a', is_error: false }] } },
  { type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_1',
    message: 'Claude requested permissions to write to README.md, but you have not granted it yet.' },
  { type: 'result', subtype: 'success', is_error: false, result: '권한이 없어 바꾸지 못했어요',
    permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_1', tool_input: { file_path: 'README.md' } }] },
];
for (const e of out) process.stdout.write(JSON.stringify(e) + '\\n');
`);
fs.writeFileSync(FAKE_CLI, [
  '#!/bin/sh',
  "if [ \"$1\" = \"--version\" ]; then echo '9.9.9-fixture (Claude Code)'; exit 0; fi",
  "if [ \"$1\" = \"auth\" ]; then echo '{\"loggedIn\":true,\"email\":\"fixture@example.test\",\"orgId\":\"org-fixture\"}'; exit 0; fi",
  /* "$@" — the fixture has to SEE `--resume`, or it cannot behave like a session that was
   * granted something. Without it every turn replayed the same denial. */
  `exec ${process.execPath} ${FAKE_CLI_JS} "$@"`,
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

/* Attaching is a race against the app's own start-up, and how long that takes varies with the
 * machine. Retrying is not papering over a failure — a refused connection at t=4s and one at
 * t=20s are different facts, and only the second one means the app did not come up. */
async function pageTarget(port, { tries = 20, everyMs = 750 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
      last = 'no page target yet';
    } catch (e) { last = e.message; }
    await sleep(everyMs);
  }
  throw new Error(`no page target on ${port} after ${(tries * everyMs) / 1000}s: ${last}`);
}

async function cdp(sendFn) {
  const page = await pageTarget(PORT);
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

  /* ── the Work loop, end to end through the real app ──────────────────────────────
   * SC-02 submit → route disclosure → guard/evidence/session → SC-03 with a refusal card →
   * allow → the same Work resumes. Every card here was deferred in earlier batches precisely
   * because it had nowhere to lead; this is the run that gives it somewhere. */
  step('submit an intent');
  await evalJs(`(() => { const f = document.querySelector('[data-el="intent"]');
    f.value = 'README.md 의 첫 줄을 바꿔줘'; })()`);
  await evalJs(`document.querySelector('[data-act="submit-intent"]').click()`);
  await sleep(2500);

  out.screenAfterSubmit = await evalJs('window.__screen()');
  out.work = await evalJs('JSON.stringify(window.__work())');
  out.permPanel = await evalJs(`document.querySelector('[data-el="permission"]')?.innerText ?? null`);
  out.workReds = await evalJs(RED_COUNT('.sc03 *'));
  out.nextSlot = await evalJs(`document.querySelector('[data-el="next"]')?.innerText ?? null`);
  out.liveness = await evalJs(`document.querySelector('[data-el="liveness"]')?.innerText ?? null`);
  out.sc03Cards = await evalJs(`JSON.stringify([...document.querySelectorAll('.sc03 [data-card]')].map(n => n.getAttribute('data-card')))`);
  out.sc03Overflow = await evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  out.sc03Clipped = await evalJs(`[...document.querySelectorAll('.sc03 .card')].filter(n => n.scrollHeight > n.clientHeight + 1).length`);
  out.sc03Times = await evalJs(`document.querySelector('[data-card="work"] .times')?.innerText ?? null`);
  out.sc03About = await evalJs(`document.querySelector('[data-card="about"]')?.innerText ?? null`);
  out.sc03RawCollapsed = await evalJs(`document.querySelector('[data-el="raw"]')?.open === false`);
  /* Cards must not overlap. `scrollHeight > clientHeight` measures a card clipping ITSELF and
   * cannot see one card drawn on top of another — which is what a spanned grid row did. */
  out.overlaps = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('.sc03 .card, .sc02 .card')].map(n => n.getBoundingClientRect());
    let hits = 0;
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits++;
    }
    return hits; })()`);
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc03-permission-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  /* the guard: a second submit while this Work is open must be refused, not queued */
  step('guard');
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`);
  await sleep(500);
  await evalJs(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = '로그인 오류 고쳐줘'; })()`);
  await evalJs(`document.querySelector('[data-act="submit-intent"]').click()`);
  await sleep(1500);
  out.guardCard = await evalJs(`document.querySelector('[data-el="guard"]')?.innerText ?? null`);
  out.guardReds = await evalJs(RED_COUNT('[data-el="guard"], [data-el="guard"] *'));
  out.guardKeptText = await evalJs(`document.querySelector('[data-el="intent"]').value`);

  /* ── SC-04 · Change Reader (WBS-28) ──────────────────────────────────────────────────
   * The Work has ended, so the result card carries `변경 읽기`. This is the first rendered
   * evidence for the screen, and for the reading order it argues for: 뜻 → 코드 → 원문. */
  step('SC-04');
  /* The guard above needed this Work still ACTIVE, so the grant comes after it: `허용하고 다시
   * 해 보기` is on SC-03, which SC-02's current-Work `열기` returns to. */
  await evalJs(`[...document.querySelectorAll('.sc02 button')].find(b => b.textContent.trim() === '열기')?.click()`);
  await sleep(800);
  /* D-133 contract B: the grant is scoped to THIS tool input and the SAME session resumes. The
   * fixture edits on that turn, which is what gives SC-04 a finished Work with real changes. */
  await evalJs(`[...document.querySelectorAll('.sc03 button')].find(b => b.textContent.includes('허용하고'))?.click()`);
  await sleep(2500);
  out.afterAllow = await evalJs('JSON.stringify(window.__work())');
  await evalJs(`[...document.querySelectorAll('.sc03 button')].find(b => b.textContent.includes('변경 읽기'))?.click()`);
  await sleep(1200);
  out.screenReader   = await evalJs('window.__screen()');
  out.reader         = await evalJs('JSON.stringify(window.__reader())');
  out.readerReds     = await evalJs(RED_COUNT('.sc04 *'));
  /* Prove the counter can actually see red on THIS screen before trusting a zero from it —
   * a red count that is structurally always zero is the exact shape of test this run keeps
   * finding. */
  await evalJs(`document.querySelector('.sc04 .card')?.style.setProperty('color', 'var(--fail)')`);
  out.readerRedProbe = await evalJs(RED_COUNT('.sc04 *'));
  await evalJs(`document.querySelector('.sc04 .card')?.style.removeProperty('color')`);
  out.readerOverflow = await evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  out.readerCols     = await evalJs(`document.querySelectorAll('.sc04-col').length`);
  out.readerRawShut  = await evalJs(`document.querySelectorAll('.sc04-patch').length`);
  out.readerText     = await evalJs(`document.querySelector('.sc04')?.innerText ?? null`);

  /* D-118's skip: the RAW text must be reachable from the group, without going through a block. */
  await evalJs(`document.querySelector('.sc04-group .sc04-rawbtn')?.click()`);
  await sleep(500);
  out.readerRawOpen  = await evalJs(`document.querySelectorAll('.sc04-patch').length`);
  out.readerPatch    = await evalJs(`document.querySelector('.sc04-patch')?.innerText ?? null`);
  /* The patch scrolls INSIDE its own box; the page never scrolls sideways (`16` responsive). */
  out.readerRawOverflow = await evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc04-reader-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  /* ── the EXPLAINED state ──────────────────────────────────────────────────────────────
   * Every test in the repository — unit and e2e — used to leave every group unexplainable, so
   * the whole success path of WBS-26 was dead code: the JUQODE actor chip, the 무엇/왜/어떤
   * 동작에 rows, the confidence chip, and `readerFor`'s persisted-groups branch. A mutation
   * that ignored every stored group forever survived the entire suite.
   *
   * The pass itself needs a real model, so the GROUPS are seeded directly and the screen is
   * re-opened — which exercises exactly the code a successful pass leads to. */
  step('SC-04 explained');
  await evalJs(`document.querySelector('.sc04-explain')?.click()`);
  await sleep(3000);
  out.explainedReader = await evalJs('JSON.stringify(window.__reader())');
  out.explainedText   = await evalJs(`document.querySelector('.sc04')?.innerText ?? null`);
  out.explainedReds   = await evalJs(RED_COUNT('.sc04 *'));
  /* Nothing on any screen may render a stringified object. `when(at)` was called in SC-04's
   * header without being defined or imported, and it did NOT throw — the browser has a global
   * `when`, so the header quietly displayed `[object Observable]` beside the outcome chip. A
   * free identifier that resolves to a platform global fails silently and looks like data. */
  out.objectText = await evalJs(`(() => {
    const hits = [];
    for (const n of document.querySelectorAll('.board, .board *')) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3 && /\\[object [A-Z]/.test(c.nodeValue)) hits.push(c.nodeValue.trim());
      }
    }
    return JSON.stringify([...new Set(hits)]);
  })()`);
  out.readerStamp = await evalJs(`document.querySelector('.sc04-headtop')?.innerText ?? null`);
  out.evidenceGap = await evalJs(`document.querySelector('[data-el="evidence-gap"]')?.innerText ?? null`);
  out.evidenceGapReds = await evalJs(RED_COUNT('[data-el="evidence-gap"], [data-el="evidence-gap"] *'));
  out.explainArgv     = fs.existsSync(path.join(DB_DIR, 'ARGV.log'))
    ? fs.readFileSync(path.join(DB_DIR, 'ARGV.log'), 'utf8') : '';
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc04-explained-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업으로'))?.click()`);
  await sleep(600);
  out.screenAfterReader = await evalJs('window.__screen()');
  /* …and on to SC-02, which is where the rest of the run continues from. */
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`);
  await sleep(600);


  /* ── History (WBS-20) ─────────────────────────────────────────────────────────────────
   * SC-02's History was empty-only until now, which meant `15`'s `변경 보기` entry into SC-04
   * did not exist and a finished Work could only be reached while it was still on screen. */
  step('history');
  await sleep(1200);                       // the list is filled by an async read of the store
  out.historyRows   = await evalJs(`document.querySelectorAll('[data-el="history-row"]').length`);
  out.historyText   = await evalJs(`document.querySelector('[data-card="history"]')?.innerText ?? null`);
  out.historyReds   = await evalJs(RED_COUNT('[data-card="history"], [data-card="history"] *'));
  /* Cards must not be drawn on top of each other. The existing overlap check runs while SC-03
   * is on screen, so its `.sc02 .card` half matched NOTHING and could never fail — and SC-02's
   * real layout, once History had rows, drew the History card over the Brief. */
  out.sc02Overlaps = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('.sc02 .card')].map(n => n.getBoundingClientRect());
    let hits = 0;
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits++;
    }
    return hits; })()`);
  out.sc02CardCount = await evalJs(`document.querySelectorAll('.sc02 .card').length`);
  out.sc02Clipped2 = await evalJs(`[...document.querySelectorAll('.sc02 .card')].filter(n => n.scrollHeight > n.clientHeight + 1).length`);
  /* `변경 보기` → SC-04, for a Work that is no longer the one on screen. */
  await evalJs(`[...document.querySelectorAll('[data-el="history-row"] button')].find(b => b.textContent.includes('변경 보기'))?.click()`);
  await sleep(1500);
  out.historyToReader = await evalJs('window.__screen()');
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('이해했어요'))?.click()`);
  await sleep(800);
  /* …and `결과 보기` → SC-03. */
  await evalJs(`[...document.querySelectorAll('[data-el="history-row"] button')].find(b => b.textContent.includes('결과 보기'))?.click()`);
  await sleep(1200);
  out.historyToWork = await evalJs('window.__screen()');
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`);
  await sleep(800);

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

console.log(JSON.stringify(results, null, 2));

const bridge = JSON.parse(results.bridge);
assert.strictEqual(results.ready, true, 'renderer did not initialise');
assert.strictEqual(results.screen, 'SC-01', `expected SC-01, got ${results.screen}`);
assert.deepStrictEqual(bridge.keys.sort(),
  ['boot', 'claudeStatus', 'history', 'interpret', 'onWorkUpdate', 'openPath', 'openProject',
   'routeIntent', 'versions', 'workAllow', 'workAnswer', 'workCancel', 'workChanges',
   'workExplain', 'workGet', 'workReader', 'workSignals', 'workStart'],
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
assert.deepStrictEqual(JSON.parse(results.sc02Cards).sort(), ['brief', 'history', 'intent', 'stream'],
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

/* ── the Work loop ── */
assert.strictEqual(results.screenAfterSubmit, 'SC-03', `submitting a change request did not reach SC-03 (${results.screenAfterSubmit})`);
const work = JSON.parse(results.work);
assert.ok(work, 'SC-03 rendered without a Work');
assert.strictEqual(work.intent, 'README.md 의 첫 줄을 바꿔줘', 'the Work is not named by the user\'s own words');
assert.strictEqual(work.status, 'permission_waiting', `expected the refusal state, got ${work.status}`);
assert.strictEqual(work.outcome, null, 'a Work with an unanswered refusal was reported as ended');
assert.strictEqual(work.permission, 'Edit');
assert.ok(work.signals >= 5, `only ${work.signals} signals were persisted — 기술 출력 보기 needs them all`);

/* D-133: the tool is ALREADY denied, so nothing on this card may call it 대기 중. */
assert.ok(results.permPanel, 'the permission card did not render');
assert.ok(results.permPanel.includes('Claude Code가 이 동작을 하지 못했어요'), results.permPanel);
assert.ok(!results.permPanel.includes('대기'), 'the refusal is described as waiting — D-133 forbids it');
assert.ok(results.permPanel.includes('허용하고 다시 해 보기'));

/* 사용 불가 / 대기 is amber OUTLINE, and red is failure only — nothing here failed. */
assert.strictEqual(results.workReds, 0, 'SC-03 renders red for a refusal, which is not a failure');

/* ── SC-04 · Change Reader ─────────────────────────────────────────────────────────────── */
assert.strictEqual(results.screenReader, 'SC-04', `변경 읽기 did not reach SC-04 (${results.screenReader})`);
const reader = results.reader ? JSON.parse(results.reader) : null;
assert.ok(reader, 'SC-04 rendered without a read model');
assert.ok(reader.groups.length >= 1, 'the Work edited two files and the reader shows no group');

/* Every file the Work changed is in exactly one group. This is D-121, and it is the property
 * that makes 변경 n개 and the reader the same statement. */
const readerFiles = reader.groups.flatMap((g) => g.files);
assert.strictEqual(new Set(readerFiles).size, readerFiles.length, 'a file appears in two groups');
assert.ok(readerFiles.includes('src/index.js'), `the edited .js file is missing: ${readerFiles}`);
assert.ok(readerFiles.includes('README.md'), `the edited .md file is missing: ${readerFiles}`);
/* `19` §C5-B: the .env is excluded by JuQode's own list, so it can never reach this screen. */
assert.ok(!readerFiles.some((f) => f.includes('.env')), `an excluded path reached SC-04: ${readerFiles}`);
assert.ok(!readerFiles.some((f) => f.includes('node_modules')), 'node_modules reached SC-04');

/* No pass has run yet — which is NOT the same as one having failed. `18` reader.unexplained's
 * truth condition is "LLM 설명 실패/거부", so using it here made the product announce its own
 * failure for work it never attempted. */
assert.ok(reader.groups.every((g) => g.explainable === false),
  'nothing explained this Work, yet a group claims it was explained');
assert.ok(results.readerText.includes('아직 이 변경을 말로 설명하지 않았어요'),
  `the not-yet-asked state is missing: ${results.readerText.slice(0, 200)}`);
assert.ok(!results.readerText.includes('이 변경은 말로 설명하지 못했어요'),
  'the screen claims an explanation FAILED when none was ever requested');
/* 단위화 불가 — README.md is one of `19` §C5-B's structured formats and goes straight to Raw. */
assert.ok(results.readerText.includes('이 파일은 단위로 나누지 못했어요'), 'the 단위화 불가 state is missing');
/* …and the .js file DID produce a named unit, or S1 is not actually running. */
assert.ok(reader.groups.some((g) => g.blocks.includes('greet')),
  `the added function is not a Code Block: ${JSON.stringify(reader.groups.map((g) => g.blocks))}`);

assert.strictEqual(results.readerReds, 0, 'SC-04 renders red, and nothing on it failed (16 §2)');
assert.ok(results.readerRedProbe > 0, 'the SC-04 red counter cannot see red — its zero proves nothing');
assert.strictEqual(results.readerCols, 3, '15 §0: SC-04 is three columns — 뜻 · 코드 · 원문');
assert.ok(results.readerOverflow <= 0, `SC-04 scrolls sideways by ${results.readerOverflow}px`);

/* D-118: Raw is reachable from the GROUP, without passing through a Code Block. */
assert.strictEqual(results.readerRawShut, 0, 'the raw panel is open before it was asked for');
assert.ok(results.readerRawOpen > 0, 'Raw Diff 보기 on the group did not open the raw text');
assert.ok(/^@@|^[-+]|diff/m.test(results.readerPatch ?? ''),
  `the raw panel is not showing a patch: ${String(results.readerPatch).slice(0, 80)}`);
assert.ok(results.readerRawOverflow <= 0,
  `an open patch made the PAGE scroll sideways by ${results.readerRawOverflow}px — it must scroll inside its own box`);
assert.strictEqual(results.screenAfterReader, 'SC-03', '작업으로 돌아가기 did not return to SC-03');

/* ── SC-04, once a pass HAS explained the change (WBS-26) ───────────────────────────────
 * Everything below was dead code in every test that existed before: the whole success path of
 * the explanation layer, and the branch of `readerFor` that reads persisted groups. */
const explained = results.explainedReader ? JSON.parse(results.explainedReader) : null;
assert.ok(explained, 'SC-04 lost its read model after the explanation pass');
assert.ok(explained.groups.some((g) => g.explainable === true),
  `the pass returned groups and none of them is explained: ${results.explainedReader}`);
assert.ok(results.explainedText.includes('무엇') && results.explainedText.includes('왜'),
  'the 무엇 / 왜 / 어떤 동작에 rows never rendered');
assert.ok(results.explainedText.includes('실행 안내를 README 에 넣었어요'),
  'the explanation the pass produced is not on screen');
assert.ok(!results.explainedText.includes('이 변경은 말로 설명하지 못했어요'),
  'the screen still claims the change could not be explained');
assert.strictEqual(results.explainedReds, 0, 'the explained state renders red, and nothing failed');

/* The Work observed no test/run, so `19` §C5-X forbids 확인됨 however confident the model was —
 * and this is the first time the confidence chip has been rendered at all. */
assert.ok(results.explainedText.includes('예상됨'),
  `a model-authored explanation is 예상됨: ${results.explainedText.slice(0, 300)}`);
assert.ok(!results.explainedText.includes('확인됨'),
  'the pass claimed 확인됨 with no observed run and the screen printed it');

/* …and the pass really was launched with the built-in tool set emptied. An empty ALLOW list
 * added no flag at all, and no test looked at argv, so a pass documented as "no tools" ran
 * with all of them in the user's project directory. */
assert.ok(/--tools/.test(results.explainArgv),
  `the explanation pass carried no tool restriction: ${results.explainArgv}`);

assert.deepStrictEqual(JSON.parse(results.objectText), [],
  'a screen rendered a stringified object — some value reached the DOM without being formatted');
/* `15` SC-04 Re-entry State: the header shows the Work's time. A change read days later is a
 * different thing from one read a minute after it happened. */
assert.ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(results.readerStamp ?? ''),
  `SC-04's header carries no timestamp: ${results.readerStamp}`);
assert.ok(/끝났어요|일부만|끝내지 못했어요|취소했어요/.test(results.readerStamp ?? ''),
  `SC-04's header carries no outcome chip: ${results.readerStamp}`);

/* Canon 19 SS-E · 증거에 담기지 않은 변경. The Work touched the seed's gitignored `.env`, which
 * JuQode also excludes, so that change is not in the diff BY DESIGN — and the product still has
 * to say it happened. From the ledger: the PATH, and nothing else. */
assert.ok(results.evidenceGap, 'the excluded path changed and no evidence-gap card was drawn');
assert.ok(results.evidenceGap.includes('증거에 담기지 않은 변경이 있어요'));
assert.ok(results.evidenceGap.includes('.env'), `the card names no path: ${results.evidenceGap}`);
assert.ok(results.evidenceGap.includes('이 파일들은 프로젝트가 무시하도록 설정해 둔 파일이에요'));
/* Metadata only. The ledger holds (path, size, mtime_ns); the file was never opened, so nothing
 * about its CONTENTS may appear — and the synthetic marker is what proves it did not. */
assert.ok(!results.evidenceGap.includes('SECRET_TOKEN'),
  'the evidence-gap card leaked a name from inside an excluded file');
assert.ok(!/juqode-synthetic-fixture-marker/.test(results.evidenceGap),
  'the evidence-gap card leaked the CONTENTS of an excluded file');
/* 알 수 없음 is dashed, never red: nothing failed here. */
assert.strictEqual(results.evidenceGapReds, 0, 'the evidence-gap card renders red — it is not a failure');

/* ── History · WBS-20 ─────────────────────────────────────────────────────────────────── */
assert.ok(results.historyRows >= 1, 'a Work ended and History shows no row');
assert.ok(!results.historyText.includes('아직 끝난 작업이 없어요'),
  'History claims it is empty while holding a row');
/* `18` orient.* — one true sentence. Nothing is running, so it is not the running one, and
   `확인 불가` is reserved for a Work whose process could not be found. */
assert.ok(results.historyText.includes('마지막 작업이 끝났어요'),
  `the orientation sentence is wrong or missing: ${results.historyText}`);
assert.ok(!results.historyText.includes('확인할 수 없어요'),
  'History says the Work\'s state is unknown when the Work plainly ended');
assert.ok(/변경 \d+개/.test(results.historyText), `the row states no measured change count: ${results.historyText}`);
assert.ok(results.historyText.includes('끝났어요'), 'the row carries no outcome chip');
assert.strictEqual(results.historyReds, 0, 'History renders red for a Work that completed');

/* Both destinations `15` names, for a Work that is not the one on screen. */
assert.strictEqual(results.historyToReader, 'SC-04', `변경 보기 did not reach SC-04 (${results.historyToReader})`);
assert.strictEqual(results.historyToWork, 'SC-03', `결과 보기 did not reach SC-03 (${results.historyToWork})`);

assert.ok(results.sc02CardCount >= 3, `the overlap check saw ${results.sc02CardCount} cards — it proves nothing`);
assert.strictEqual(results.sc02Overlaps, 0, 'SC-02 draws cards on top of each other');
assert.strictEqual(results.sc02Clipped2, 0, 'an SC-02 card clips its own content');
/* The NEXT slot is always rendered, and empty is the right answer here (D-107). */
assert.ok(results.nextSlot && results.nextSlot.includes('Claude Code가 아직 다음 단계를 보내지 않았어요'),
  `NEXT slot: ${results.nextSlot}`);
assert.ok(results.liveness && !/\d+\s*%/.test(results.liveness), 'the liveness line shows a percentage');
assert.deepStrictEqual(JSON.parse(results.sc03Cards).sort(), ['about', 'steps', 'work'],
  '`15` SC-03 requires the right rail 이 Work 에 대해 alongside the Work and Steps');
assert.strictEqual(results.sc03Overflow, 0);
assert.strictEqual(results.sc03Clipped, 0, 'an SC-03 card is clipping its own content');
assert.strictEqual(results.overlaps, 0, 'two cards are drawn on top of each other');
/* `15` SC-03 header: the started/ended times, and the right rail with the raw output collapsed. */
assert.ok(results.sc03Times && results.sc03Times.includes('시작'), `header times: ${results.sc03Times}`);
assert.ok(results.sc03About && results.sc03About.includes('이 작업에 대해'), `right rail: ${results.sc03About}`);
assert.strictEqual(results.sc03RawCollapsed, true, '기술 출력 보기 must be collapsed by default (A-11)');

/* D-117: the second request is refused as a guard, and the text stays in the field. */
assert.ok(results.guardCard && results.guardCard.includes('지금 진행 중인 작업이 있어요'), `guard: ${results.guardCard}`);
assert.strictEqual(results.guardKeptText, '로그인 오류 고쳐줘',
  'the refused request was cleared or queued — UF-RULE-NOQUEUE says it stays in the field');
/* The guard is amber, not red: another Work running is not a failure. */
assert.strictEqual(results.guardReds, 0, 'the guard card is rendered as a failure');

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

  const page = await pageTarget(PORT2);
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
