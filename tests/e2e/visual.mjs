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
/* The app's WHOLE data directory, relocated for the test run.
 *
 * `JUQODE_DB` moved the store; the evidence stores are derived from `userData` and were not,
 * so every run left a bare git repository per project in the developer's own
 * `~/.config/juqode/evidence` — 201 of them had piled up before anyone counted. One variable
 * moves all of it, including the Chromium profile, so nothing this test does touches the real
 * application data. */
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-userdata-'));
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
const restricted = process.argv.includes('--tools');
/* TWO read-only passes now carry that flag — WBS-26's change explanation and WBS-04's Brief
 * narrative — so the fixture tells them apart by what they ASK, which is the only thing that
 * actually differs. Reading the prompt is also how a real CLI would decide. */
/* stdin is a PIPE, and a sync read of a pipe can raise EAGAIN before the parent has written —
 * measured as a silent empty read, which sent the narrative pass down the explanation branch
 * and made the whole WBS-04 e2e assert nothing. Loop until EOF instead. */
function readPrompt() {
  const buf = Buffer.alloc(65536);
  let out = '';
  for (let tries = 0; tries < 2000; tries++) {
    let n = 0;
    try { n = fs.readSync(0, buf, 0, buf.length, null); }
    catch (e) {
      if (e.code === 'EAGAIN') { try { fs.writeSync(2, ''); } catch {} continue; }
      if (e.code === 'EOF') break;
      break;
    }
    if (n === 0) break;
    out += buf.slice(0, n).toString('utf8');
  }
  return out;
}
let ask = '';
try { ask = readPrompt(); } catch { /* no stdin: not a pass */ }

if (restricted && ask.includes('q=1')) {
  /* The narrative pass (WBS-04). Canon 19 C1: it may cite only files the scan actually read, so
   * the fixture cites the README — which the scan does read — and one path nobody read. The
   * second one must be filtered out, and its answer must land on 확인 못함 rather than 예상됨. */
  const six = [
    { q: 1, text: '할 일을 적는 작은 앱이에요', cites: ['README.md'] },
    { q: 2, text: '추가 · 삭제 · 목록 보기', cites: ['README.md'] },
    { q: 4, text: 'src 에 소스가 있어요', cites: ['nobody-read-this.ts'] },
  ];
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'n', cwd: '/p' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    permission_denials: [], result: JSON.stringify(six) }) + '\\n');
  process.exit(0);
}

if (restricted) {
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
  /* TWO tool_use blocks in ONE message, and two tool_results in one reply — a parallel call,
   * which is what the real CLI emits when it edits two files at once. This is the shape that
   * made the 확인됨 tool count report 1 for 2 (batch 18 QA); without it in the recording the
   * cross-check below cannot tell the bug from the fix. */
  { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'tu_2', name: 'Edit', input: { file_path: 'README.md' } },
    { type: 'tool_use', id: 'tu_3', name: 'Edit', input: { file_path: 'src/index.js' } }] } },
  { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'tu_2', is_error: false },
    { type: 'tool_result', tool_use_id: 'tu_3', is_error: false }] } },
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
  /* A marker file flips the fixture to logged-out, so the e2e can reach `15`'s
   * Claude-unavailable state — the one `12` §16 calls 사용 불가 ≠ 실패 — with the real
   * detection code path rather than a stub. `detect()` runs on every preflight, no cache. */
  `if [ \"$1\" = \"auth\" ]; then if [ -f ${JSON.stringify(path.join(DB_DIR, 'logged-out'))} ]; then echo '{\"loggedIn\":false}'; else echo '{\"loggedIn\":true,\"email\":\"fixture@example.test\",\"orgId\":\"org-fixture\"}'; fi; exit 0; fi`,
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

/* WBS-37 · one surface's COMPOSITION, as numbers.
 *
 * `17` says the five surfaces must be recognisable as different arrangements, and that
 * "텍스트만 바뀐 같은 페이지로 읽히면 실패다". That is a claim about geometry, so it is
 * measured as geometry: how many cards, how many DIFFERENT card widths, how much of the
 * surface they cover, and how much bigger the biggest one is than the next.
 *
 * The last number is what says whether a screen has a SUBJECT. On SC-03 the Work is the
 * subject of the screen; on SC-02 nothing is. */
const COMPOSITION = (sel) => `(() => {
  const board = document.querySelector('${sel}');
  if (!board) return null;
  const b = board.getBoundingClientRect();
  const cards = [...board.querySelectorAll('.card')].map(n => n.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0);
  const areas = cards.map(r => r.width * r.height).sort((x, y) => y - x);
  const widths = [...new Set(cards.map(r => Math.round(r.width / 8) * 8))];
  const st = getComputedStyle(board);
  return {
    cards: cards.length,
    distinctWidths: widths.length,
    widestShare: cards.length ? Math.max(...cards.map(r => r.width)) / b.width : 0,
    density: areas.reduce((a, x) => a + x, 0) / (b.width * b.height),
    dominance: areas.length > 1 ? areas[0] / areas[1] : null,
    /* Distinct SIZES, not distinct widths: SC-02 is two equal columns on purpose (a stack
     * cannot overlap — see sc02.js), so its variety is carried by height. Log buckets, so a
     * few pixels of text reflow do not invent a new size. */
    distinctSizes: new Set(areas.map(a => Math.round(Math.log(a) / Math.log(1.25)))).size,
    largest: cards.length ? (() => {
      const all = [...board.querySelectorAll('.card')].filter(n => n.getBoundingClientRect().width > 0);
      const area = (n) => { const r = n.getBoundingClientRect(); return r.width * r.height; };
      return all.reduce((a, b) => (area(b) > area(a) ? b : a)).getAttribute('data-card');
    })() : null,
    radius: cards.length ? getComputedStyle(board.querySelector('.card')).borderTopLeftRadius : null,
    font: st.fontFamily.slice(0, 40),
  }; })()`;

/* WBS-37 · did the shared-element morph actually run?
 *
 * `17`: 같은 것이라는 사실이 움직임으로 보인다. A source assertion cannot tell a transition
 * that runs from one that was written and never fires, so this clicks and then counts the
 * animations ON the incoming element — from inside the page, because a CDP round trip is
 * longer than the 360 ms the transition lasts.
 *
 * It also reports the horizontal overflow while the transform is at its largest. A FLIP scales
 * an element well past its own box, and an overflow that only exists mid-transition is exactly
 * the kind of thing a screenshot taken afterwards cannot see. */
const MORPH = (clickExpr, arriveSel) => `(async () => {
  ${clickExpr};
  let overflow = 0;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => requestAnimationFrame(r));
    overflow = Math.max(overflow,
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const n = document.querySelector('${arriveSel}');
    if (n) return JSON.stringify({ animations: n.getAnimations().length, overflow });
  }
  return JSON.stringify({ animations: -1, overflow }); })()`;

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
  /* The renderer is LOADED before anything is asked of it.
   *
   * `pageTarget` waits for the debugger target, which exists as soon as the window does — the
   * module graph may still be loading behind it. Under load that difference showed up as
   * `window.__screen is not a function`, which reads as a product failure and is not one. The
   * wait is bounded, so a renderer that never loads still fails, and says so in those words. */
  const loaded = await evalJs(`(async () => {
    for (let i = 0; i < 200; i++) {
      if (typeof window.__screen === 'function') return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false; })()`);
  if (!loaded) throw new Error('the renderer never finished loading (window.__screen is missing after 10s)');

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
  { cwd: ROOT, detached: true, env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA,
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
  /* ── WBS-29 · the five state vocabularies, measured against each other ──────────────────
   * `16` §2.1 keeps five states apart, and two of them share the amber hue ON PURPOSE:
   * 부분 is an amber FILL and 대기 an amber OUTLINE. That is the pair most likely to collapse
   * into one another in a refactor, and the pair a reader is least able to recover from.
   *
   * The measurement is taken in BOTH themes, because a token redefined in only one theme block
   * is a failure this codebase has already shipped once. And it is taken WITHOUT colour too:
   * `16` says the mark is what survives a greyscale print and a colour-blind reader, so each
   * state must differ from every other in something that is not hue. */
  out.stateGrammar = await evalJs(`(async () => {
    const KINDS = ['ok', 'part', 'wait', 'fail', 'unk', 'unavail'];
    const strip = document.createElement('div');
    strip.id = 'juqode-state-probe';
    for (const k of KINDS) {
      const c = document.createElement('span');
      c.className = 'chip ' + k;
      c.textContent = k;
      strip.appendChild(c);
    }
    document.body.appendChild(strip);

    /* …and the SURFACES, not only the chips. The chip strip proves the TOKENS are distinct; it
     * says nothing about whether the app applies them, and the review found exactly that gap —
     * the 오래됨 band was ordinary card furniture while this test passed. Each of these is
     * rendered inside the screen that owns it, so its real cascade applies. */
    /* The rules are SCOPED (.sc02 .staleband), so the probe carries its own scope rather than
     * hoping the right screen happens to be mounted. Appending to whatever was on screen gave
     * every surface an unstyled border-style:none and the comparison compared nothing.
     *
     * Run once PER THEME, like the chips: a token redefined in only one theme block is a
     * failure this codebase has already shipped. */
    function surfaceProbe() {
      const rows = [];
      const host = document.createElement('div');
      host.className = 'sc02';
      document.body.appendChild(host);
      for (const [name, cls] of [['stale', 'staleband'], ['softfail', 'failband soft'],
                                 ['fail', 'failband'], ['partial', 'partial-line'],
                                 ['wait', 'panel wait'], ['unavail', 'panel grey']]) {
        const n = document.createElement('div');
        n.className = cls;
        n.textContent = name;
        host.appendChild(n);
        const st = getComputedStyle(n);
        rows.push({ name,
                    background: st.backgroundColor, borderColor: st.borderTopColor,
                    borderStyle: st.borderTopStyle, borderLeft: st.borderLeftWidth,
                    color: st.color });
        n.remove();
      }
      host.remove();
      return rows;
    }

    const out = {};
    const surfacesByTheme = {};
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      surfacesByTheme[theme] = surfaceProbe();
      out[theme] = KINDS.map((k, i) => {
        const el = strip.children[i];
        const s = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        return { kind: k,
                 color: s.color, background: s.backgroundColor,
                 borderColor: s.borderTopColor, borderStyle: s.borderTopStyle,
                 borderLeft: s.borderLeftWidth, borderTop: s.borderTopWidth,
                 glyph: (before.content && before.content !== 'none') ? before.content : '' };
      });
    }
    strip.remove();
    return JSON.stringify({ chips: out, surfaces: surfacesByTheme });
  })()`);

  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(250);
    out[`${theme}Bg`] = await evalJs('getComputedStyle(document.body).backgroundColor');
    out[`${theme}Ink`] = await evalJs('getComputedStyle(document.body).color');
    out[`${theme}PriContrast`] = await evalJs(PRI_CONTRAST);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc01-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  out.compSC01 = await evalJs(COMPOSITION('.sc01'));

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
  /* WBS-04 · the narrative layer's three answers, and what they are allowed to claim. */
  out.briefAnswers = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-card="brief"] .ans')]
    .map(n => ({ q: n.querySelector('.k')?.textContent ?? null,
                 chip: n.querySelector('.chip')?.textContent ?? null,
                 text: n.innerText })))`);
  out.briefText = await evalJs(`document.querySelector('[data-card="brief"]')?.innerText ?? null`);

  /* ── WBS-05 · fold · stale · refresh ────────────────────────────────────────────────────
   * D-132: a FIRST open is large, so the Brief is unfolded here and 접기 collapses it to its
   * header. Nothing about this is automatic — every one of these is a button. */
  out.briefFoldedFirst = await evalJs('JSON.stringify(window.__brief())');
  out.briefAnswersVisible = await evalJs(`document.querySelectorAll('[data-card="brief"] .ans').length`);
  await evalJs(`[...document.querySelectorAll('[data-card="brief"] button')].find(b => b.textContent.trim() === '접기')?.click()`);
  await sleep(300);
  out.briefFoldedAfter = await evalJs('JSON.stringify(window.__brief())');
  out.briefAnswersFolded = await evalJs(`document.querySelectorAll('[data-card="brief"] .ans').length`);
  out.briefHeadFolded = await evalJs(`document.querySelector('[data-card="brief"] .chead')?.innerText ?? null`);
  await evalJs(`[...document.querySelectorAll('[data-card="brief"] button')].find(b => b.textContent.trim() === '펼치기')?.click()`);
  await sleep(300);
  out.briefAnswersUnfolded = await evalJs(`document.querySelectorAll('[data-card="brief"] .ans').length`);
  /* 다시 읽기 — a user-requested re-read (D-132). It is also what makes the narrative pass
   * observable: the first interpretation happens before the window is ready to be asked. */
  await evalJs(`[...document.querySelectorAll('[data-card="brief"] button')].find(b => b.textContent.includes('다시 읽기'))?.click()`);
  await sleep(4000);
  out.briefAfterReread = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-card="brief"] .ans')]
    .map(n => ({ chip: n.querySelector('.chip')?.textContent ?? null, text: n.innerText })))`);
  out.narrative = await evalJs('JSON.stringify(window.__narrative())');
  out.briefPartialAmber = await evalJs(`(() => {
    const probe = document.createElement('span'); probe.style.color = 'var(--part)';
    document.body.appendChild(probe); const amber = getComputedStyle(probe).color; probe.remove();
    const line = document.querySelector('[data-card="brief"] .partial-line');
    return line ? getComputedStyle(line).color === amber : null; })()`);
  out.compSC02       = await evalJs(COMPOSITION('.sc02'));
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
  out.compSC03  = await evalJs(COMPOSITION('.sc03'));
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
  await sleep(900);
  /* WBS-35 · SC-02's presence with a LIVE Work — the Work above is still `permission_waiting`.
   * SC-02 holds no snapshot, so it has to fetch one; a History row would say only `running` and
   * could never produce this mode. This is the assertion that SC-02 asks the right question. */
  out.sc02PresenceLive = await evalJs(`document.querySelector('[data-card="presence"] canvas')?.getAttribute('data-mode')`);
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
  out.morphToWork = await evalJs(MORPH(
    `[...document.querySelectorAll('.sc02 button')].find(b => b.textContent.trim() === '열기')?.click()`,
    '.sc03 [data-card="work"]'));
  await sleep(800);
  /* D-133 contract B: the grant is scoped to THIS tool input and the SAME session resumes. The
   * fixture edits on that turn, which is what gives SC-04 a finished Work with real changes. */
  await evalJs(`[...document.querySelectorAll('.sc03 button')].find(b => b.textContent.includes('허용하고'))?.click()`);
  await sleep(2500);
  out.afterAllow = await evalJs('JSON.stringify(window.__work())');

  /* WBS-18 · the 확인됨 tool count, cross-checked against the app's OWN recorded signals.
   *
   * The number on the card wore a 확인됨 chip while being derived from a capped, block-blind
   * read (batch 18 QA). A test that only asserted "there is a number" would have passed
   * throughout, so this asks the app for its signals and counts them independently — parallel
   * `tool_result` blocks included. */
  out.toolClaim = await evalJs(`(async () => {
    const w = window.__work();
    const s = await window.juqode.workSignals(w.id);
    const rows = (s?.signals ?? []).filter(x => x.kind === 'tool_result');
    /* Counted from the RAW CLI line, which is what the supervisor persists — a counter that
     * read the reducer's \`all\` shape would repeat the very mistake it is checking for, and
     * did, on the first attempt. */
    let blocks = 0;
    for (const r of rows) {
      let p = null;
      try { p = JSON.parse(r.payload ?? 'null'); } catch { blocks += 1; continue; }
      const content = p?.message?.content;
      blocks += Array.isArray(content)
        ? (content.filter(b => b?.type === 'tool_result').length || 1)
        : (Array.isArray(p?.all) && p.all.length ? p.all.length : 1);
    }
    const row = document.querySelector('[data-claim="tools-observed"]');
    return JSON.stringify({ blocks, rows: rows.length,
                            shown: row ? row.innerText : null }); })()`);

  /* ── WBS-38 · 다음 행동 ≠ NEXT, measured on the one screen that shows BOTH ─────────────────
   * `17`'s absolute rule is about VISUAL TREATMENT, so it can only be checked against the real
   * cascade. Taken in both themes: a rule that holds in light and collapses in dark has not
   * held. */
  out.nextVsActions = await evalJs(`(async () => {
    const out = {};
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const slot = document.querySelector('[data-el="next"]');
      const acts = document.querySelector('[data-el="next-actions"]');
      const st = (n) => { const s = getComputedStyle(n); return {
        borderLeftColor: s.borderLeftColor, borderLeftWidth: s.borderLeftWidth }; };
      out[theme] = {
        slot: slot ? { ...st(slot), buttons: slot.querySelectorAll('button').length,
                       labelColor: getComputedStyle(slot.querySelector('.nlabel')).color,
                       text: slot.innerText } : null,
        acts: acts ? { ...st(acts), buttons: acts.querySelectorAll('button').length,
                       labelColor: getComputedStyle(acts.querySelector('.nalabel')).color,
                       text: acts.innerText } : null,
      };
    }
    document.documentElement.setAttribute('data-theme', '');
    return JSON.stringify(out); })()`);

  /* `21` WBS-38's evidence: 두 요소가 같은 화면에 있는 스크린샷. */
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc03-result-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  await evalJs(`document.documentElement.setAttribute('data-theme','')`);
  await sleep(200);

  out.morphToReader = await evalJs(MORPH(
    `[...document.querySelectorAll('.sc03 button')].find(b => b.textContent.includes('변경 읽기'))?.click()`,
    '.sc04'));
  await sleep(1200);
  out.screenReader   = await evalJs('window.__screen()');
  out.compSC04       = await evalJs(COMPOSITION('.sc04'));
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
  /* WBS-38 · `15` SC-04 Secondary Actions. Two of the four are shared top-bar elements; these
   * two are the screen's own, and 원하던 결과가 아니에요 was not built here at all until the
   * batch-16 QA pass — a user who had just been shown why a change happened had no way to say
   * it was not what they wanted from the screen that showed them. */
  out.readerActs = await evalJs(`(() => {
    const b = document.querySelector('.sc04 [data-el="next-actions"]');
    return b ? JSON.stringify({ n: b.querySelectorAll('button').length, text: b.innerText }) : null; })()`);
  await evalJs(`[...document.querySelectorAll('.sc04 [data-el="next-actions"] button')].find(b => b.textContent.includes('원하던 결과가'))?.click()`);
  await sleep(400);
  out.readerUnwanted = await evalJs(`document.querySelector('.sc04 [data-el="unwanted"]')?.innerText ?? null`);

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
  /* WBS-05 · 오래됨. The project gains a top-level folder while the reader is open, which is a
   * STRUCTURAL change and therefore moves `source_hash` (`19` §C1 ⑤ — a body edit does not).
   * Returning to SC-02 re-asks, and the answer must be announced, not acted on. */
  fs.mkdirSync(path.join(SEED, 'server'), { recursive: true });
  fs.writeFileSync(path.join(SEED, 'server', 'index.js'), 'export const port = 3000;\n');

  /* …and on to SC-02, which is where the rest of the run continues from. */
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`);
  await sleep(600);


  /* ── History (WBS-20) ─────────────────────────────────────────────────────────────────
   * SC-02's History was empty-only until now, which meant `15`'s `변경 보기` entry into SC-04
   * did not exist and a finished Work could only be reached while it was still on screen. */
  /* ── WBS-19 · 원하던 결과가 아니라면 ─────────────────────────────────────────────────
   * D-115: no undo button anywhere, and the panel says so before offering the only thing that
   * exists — a NEW Work, which goes through the guard and the evidence basis again. */
  step('unwanted');
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`);
  await sleep(600);
  await evalJs(`[...document.querySelectorAll('[data-el="history-row"] button')].find(b => b.textContent.includes('결과 보기'))?.click()`);
  await sleep(1200);
  await evalJs(`[...document.querySelectorAll('.sc03 button')].find(b => b.textContent.includes('원하던 결과가 아니에요'))?.click()`);
  await sleep(400);
  out.unwantedText = await evalJs(`document.querySelector('[data-el="unwanted"]')?.innerText ?? null`);
  out.unwantedReds = await evalJs(RED_COUNT('[data-el="unwanted"], [data-el="unwanted"] *'));
  /* No rollback control on this screen — `21` WBS-19 states it as an acceptance row. */
  out.sc03Rollback = await evalJs(`[...document.querySelectorAll('.sc03 button')].map(b => b.textContent).join(' | ')`);
  await evalJs(`[...document.querySelectorAll('[data-el="unwanted"] button')].find(b => b.textContent.includes('고치는 작업 요청'))?.click()`);
  await sleep(900);
  out.afterCorrection = await evalJs('window.__screen()');
  out.correctionIntent = await evalJs(`document.querySelector('[data-el="intent"]')?.value ?? null`);
  out.correctionWorkCount = await evalJs(`document.querySelectorAll('[data-el="history-row"]').length`);

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
  /* WBS-37 · SC-04 → SC-02: 읽기면이 접히며 History 로 착지한다. `이해했어요` is SC-04's own
   * way out, so it is where the sentence is about. */
  /* `15` §Keyboard, on the real window. */
  out.morphToBench = await evalJs(MORPH(
    `[...document.querySelectorAll('.sc04 [data-el="next-actions"] button')].find(b => b.textContent.includes('이해했어요'))?.click()`,
    '.sc02 [data-card="history"]'));
  await sleep(800);
  /* `15` §Keyboard: focus returns to the request field after `이해했어요 · 다음 요청으로`.
   * A user who has finished reading a change is about to type the next request; landing them
   * anywhere else makes them reach for the mouse to do the thing the screen is for. */
  /* POLLED, not sampled after a fixed sleep. Read once at a fixed moment this flaked under CPU
   * load and reported `BODY` — a flaky assertion is worse than none, because it makes every
   * "N pass" line in this run a little less true. The claim is unchanged: focus lands on the
   * request field. Only the waiting is now bounded by the outcome instead of by a guess. */
  out.focusAfterUnderstood = await evalJs(`(async () => {
    const at = () => document.activeElement?.getAttribute('data-el') ?? document.activeElement?.tagName ?? null;
    for (let i = 0; i < 120; i++) {
      if (at() === 'intent') return 'intent';
      await new Promise(r => requestAnimationFrame(r));
    }
    return at(); })()`);
  /* …and `결과 보기` → SC-03. */
  await evalJs(`[...document.querySelectorAll('[data-el="history-row"] button')].find(b => b.textContent.includes('결과 보기'))?.click()`);
  await sleep(1200);
  out.historyToWork = await evalJs('window.__screen()');
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`);
  await sleep(800);

  /* WBS-35 · Agent Presence. Measured on the real canvas, because every claim this component
   * makes is about what is PAINTED — a source assertion cannot tell a breathing sphere from a
   * still one. `shot()` reads the canvas back as pixels. */
  const PRESENCE = `document.querySelector('[data-card="presence"] canvas')`;
  const shot = `${PRESENCE}.toDataURL()`;
  out.presenceMode  = await evalJs(`${PRESENCE}?.getAttribute('data-mode')`);
  out.presenceAria  = await evalJs(`${PRESENCE}?.getAttribute('aria-label')`);
  out.presenceLabel = await evalJs(`document.querySelector('[data-card="presence"] .plabel')?.textContent`);
  out.presenceBox   = await evalJs(`JSON.stringify((() => { const r = ${PRESENCE}?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null; })())`);
  /* A blank canvas would satisfy every other check here. Count the pixels that are not fully
   * transparent, so "it drew something" is a measurement. */
  out.presenceInk = await evalJs(`(() => {
    const c = ${PRESENCE}; if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n; })()`);
  /* The idle breath is the product's ONE continuous motion (`16` §1). Two frames apart must
   * differ, or the exemption is being claimed for something that does not move. */
  const a1 = await evalJs(shot);
  await sleep(700);
  out.presenceMoved = (await evalJs(shot)) !== a1;

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  /* WBS-37 · the SAME navigation with motion off. `17`: 전환은 전부 꺼진다.
   *
   * The stylesheet's `animation: none !important` does NOT stop a Web Animations call, so the
   * guard in `transition.js` is the only thing between reduced motion and a transform that
   * still runs — and a guard nobody measures is a guard nobody has. Round trip, so the run
   * continues from SC-02 exactly as it did before. */
  out.morphReducedToWork = await evalJs(MORPH(
    `[...document.querySelectorAll('[data-el="history-row"] button')].find(b => b.textContent.includes('결과 보기'))?.click()`,
    '.sc03 [data-card="work"]'));
  await sleep(900);
  out.morphReducedToBench = await evalJs(MORPH(
    `[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('작업대로'))?.click()`,
    '.sc02 [data-card="history"]'));
  await sleep(700);

  /* The loop keeps running; under reduced motion it simply paints the same frame every time.
   * One settle-length pause lets the easing finish landing before the two shots are compared. */
  await sleep(300);
  const r1 = await evalJs(shot);
  await sleep(700);
  out.presenceStill = (await evalJs(shot)) === r1;
  out.presenceStillMode = await evalJs(`${PRESENCE}?.getAttribute('data-mode')`);
  out.presenceStillInk = await evalJs(`(() => {
    const c = ${PRESENCE};
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n; })()`);

  await evalJs(`document.querySelectorAll('.fade-in').forEach(n => { n.classList.remove('fade-in'); void n.offsetWidth; n.classList.add('fade-in'); })`);
  await sleep(150);
  out.animating = await evalJs('document.getAnimations().filter(a => a.playState === "running").length');
  /* `21` WBS-37's evidence column: a reduced-motion screenshot. Same screen, no motion. */
  {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'sc02-reduced-motion.png'), Buffer.from(shot.result.data, 'base64'));
  }
  await send('Emulation.setEmulatedMedia', { features: [] });

  /* ── TD-01 · the terminal drawer and Quick Command — WBS-25 · WBS-22 · WBS-23 · WBS-24 ──
   * `15`: the drawer opens over the current screen, its banner can never be closed, and typing
   * ROUTES rather than runs — `19` §C4's explain-then-confirm is two round trips by design. */
  step('TD-01');
  out.drawerBefore = await evalJs('JSON.stringify(window.__drawer())');
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.trim() === '터미널')?.click()`);
  await sleep(400);
  out.drawerOpen   = await evalJs('JSON.stringify(window.__drawer())');
  /* `15` §Keyboard: `Esc` closes TD-01 / the discover panel — and NEVER cancels a Work.
   * Innermost first, so one press closes the panel and the next closes the drawer. */
  await evalJs(`document.querySelector('.td01-discover')?.click()`);
  await sleep(500);
  out.escDiscoverOpen = await evalJs('JSON.parse(JSON.stringify(window.__drawer())).discover');
  const esc = `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;
  await evalJs(esc);
  await sleep(300);
  out.escAfterOne = await evalJs('JSON.stringify(window.__drawer())');
  await evalJs(esc);
  await sleep(300);
  out.escAfterTwo = await evalJs('JSON.stringify(window.__drawer())');
  /* …and a third press with nothing open must do nothing, rather than reaching for a Work. */
  await evalJs(esc);
  await sleep(200);
  out.escAfterThree = await evalJs('JSON.stringify(window.__drawer())');
  out.escScreen = await evalJs('window.__screen()');
  /* …and put the drawer back, because the rest of this section is about what is inside it. */
  await evalJs(`window.__toggleDrawer()`);
  await sleep(400);
  out.compTD01     = await evalJs(COMPOSITION('.td01'));
  /* `17` TD-01: 화면 위를 덮되 화면이 뒤에 남아 있는 것이 보인다. Both halves as numbers —
   * the drawer is anchored to the bottom and does not reach the top of the window. */
  out.drawerGeom   = await evalJs(`(() => {
    const d = document.querySelector('.td01'); if (!d) return null;
    const r = d.getBoundingClientRect();
    return JSON.stringify({ top: Math.round(r.top), bottom: Math.round(r.bottom),
                            vh: window.innerHeight,
                            behind: !!document.querySelector('[data-screen]') }); })()`);
  out.drawerBanner = await evalJs(`document.querySelector('[data-el="banner"]')?.innerText ?? null`);
  out.drawerBannerParts = await evalJs(`JSON.stringify([...(document.querySelector('[data-el="banner"]')?.children ?? [])].map(n => n.textContent))`);
  /* The drawer is a SIBLING of #root — a child would be destroyed by the screen it sits over. */
  out.drawerOutsideRoot = await evalJs(`(() => {
    const d = document.querySelector('[data-el="drawer"]');
    return Boolean(d) && !document.getElementById('root').contains(d); })()`);
  out.drawerScreen = await evalJs('window.__screen()');

  /* Typing a recognised phrase EXPLAINS it. Nothing has run. */
  await evalJs(`(() => { const f = document.querySelector('[data-el="qc-input"]'); f.value = '테스트 돌려줘'; })()`);
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '보내기')?.click()`);
  await sleep(600);
  out.qcCard      = await evalJs(`document.querySelector('[data-el="qc-card"]')?.innerText ?? null`);
  out.qcCardKind  = await evalJs(`document.querySelector('[data-el="qc-card"]')?.getAttribute('data-kind') ?? null`);
  out.qcState     = await evalJs('JSON.stringify(window.__drawer())');
  out.qcRanYet    = await evalJs(`document.querySelector('[data-el="qc-run"]') !== null`);
  out.qcReds      = await evalJs(RED_COUNT('.td01 *'));

  /* 미인식 is a BRANCH, not an error — neutral, and it offers the Work path. */
  await evalJs(`(() => { const f = document.querySelector('[data-el="qc-input"]'); f.value = 'rm -rf 해줘'; })()`);
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '보내기')?.click()`);
  await sleep(600);
  out.qcUnrec     = await evalJs(`document.querySelector('[data-el="qc-card"]')?.innerText ?? null`);
  out.qcUnrecKind = await evalJs(`document.querySelector('[data-el="qc-card"]')?.getAttribute('data-kind') ?? null`);
  out.qcUnrecReds = await evalJs(RED_COUNT('[data-el="qc-card"], [data-el="qc-card"] *'));

  /* 모호함 names both readings and runs nothing. */
  await evalJs(`(() => { const f = document.querySelector('[data-el="qc-input"]'); f.value = '서버 좀 정리해줘'; })()`);
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '보내기')?.click()`);
  await sleep(600);
  out.qcAmbigKind = await evalJs(`document.querySelector('[data-el="qc-card"]')?.getAttribute('data-kind') ?? null`);
  out.qcAmbig     = await evalJs(`document.querySelector('[data-el="qc-card"]')?.innerText ?? null`);

  /* Actually RUN one. `qc.git.status` is the fixed, read-only vector — no npm, no network — so
   * the run card's states get rendered evidence without the e2e depending on a build toolchain.
   * Until this existed, 실행 중 · 끝났어요 · 출력 had never been drawn anywhere in the suite. */
  await evalJs(`(() => { const f = document.querySelector('[data-el="qc-input"]'); f.value = '깃상태'; })()`);
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '보내기')?.click()`);
  await sleep(600);
  out.qcGitCard = await evalJs(`document.querySelector('[data-el="qc-card"]')?.innerText ?? null`);
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '실행')?.click()`);
  await sleep(2500);
  out.qcRunState  = await evalJs('JSON.stringify(window.__drawer())');
  out.qcRunCard   = await evalJs(`document.querySelector('[data-el="qc-run"]')?.innerText ?? null`);
  out.qcRunAttr   = await evalJs(`document.querySelector('[data-el="qc-run"]')?.getAttribute('data-state') ?? null`);
  out.qcRunReds   = await evalJs(RED_COUNT('[data-el="qc-run"], [data-el="qc-run"] *'));
  out.qcOutput    = await evalJs(`document.querySelector('.td01-output')?.innerText ?? null`);

  /* 할 수 있는 것 보기 — every rule, and why each one cannot run. */
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.includes('할 수 있는 것'))?.click()`);
  await sleep(600);
  out.qcDiscover = await evalJs(`document.querySelector('[data-el="qc-discover"]')?.innerText ?? null`);
  out.qcDiscoverRows = await evalJs(`document.querySelectorAll('[data-el="qc-discover"] .td01-rule').length`);

  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `td01-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  /* 닫기 preserves the screen beneath. */
  await evalJs(`[...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '닫기')?.click()`);
  await sleep(300);
  out.drawerClosed = await evalJs('JSON.stringify(window.__drawer())');
  out.screenAfterDrawer = await evalJs('window.__screen()');

  /* ── `15` SC-02 Unavailable State — 사용 불가 ≠ 실패 (12 §16) ────────────────────────────
   * `15` asks for 네 개의 복구 버튼, and they were a sentence saying they were not built until
   * WBS-04, 22 and 25 shipped. This is the first RENDERED evidence for the state: the real
   * detection path, through the real bridge, with the fixture logged out. */
  step('Claude unavailable');
  fs.writeFileSync(path.join(DB_DIR, 'logged-out'), '');
  await evalJs(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = '로그인 오류 고쳐줘'; })()`);
  await evalJs(`document.querySelector('[data-act="submit-intent"]').click()`);
  await sleep(1500);
  out.unavailCard = await evalJs(`document.querySelector('[data-el="unavailable"]')?.innerText ?? null`);
  out.unavailActions = await evalJs(`JSON.stringify([...document.querySelectorAll('[data-el="unavailable"] button')].map(b => b.textContent))`);
  out.unavailReds = await evalJs(RED_COUNT('[data-el="unavailable"], [data-el="unavailable"] *'));
  out.unavailKeptText = await evalJs(`document.querySelector('[data-el="intent"]').value`);
  /* Every one of the four must actually GO somewhere. The drawer one is the easiest to prove
   * and the one D-134 changed, so it is the one measured: it opens the drawer CARRYING the
   * sentence the user already typed. */
  await evalJs(`[...document.querySelectorAll('[data-el="unavailable"] button')].find(b => b.textContent.includes('Quick Command'))?.click()`);
  await sleep(500);
  out.unavailToDrawer = await evalJs('JSON.stringify(window.__drawer())');
  await evalJs(`window.__toggleDrawer()`);
  await sleep(300);
  fs.rmSync(path.join(DB_DIR, 'logged-out'));

  step('WBS-05 stale');
  await sleep(1200);
  out.staleBand = await evalJs(`document.querySelector('[data-card="brief"] .staleband')?.innerText ?? null`);
  out.staleState = await evalJs('JSON.stringify(window.__brief())');
  out.staleHead = await evalJs(`document.querySelector('[data-card="brief"] .chead')?.innerText ?? ''`);
  out.staleReds = await evalJs(RED_COUNT('[data-card="brief"] .staleband, [data-card="brief"] .staleband *'));
  out.staleAnswers = await evalJs(`document.querySelectorAll('[data-card="brief"] .ans').length`);
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc02-stale-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }

  /* 이대로 계속 dismisses the announcement and changes NOTHING else — no re-read, same answers. */
  await evalJs(`[...document.querySelectorAll('[data-card="brief"] button')].find(b => b.textContent.trim() === '이대로 계속')?.click()`);
  await sleep(300);
  out.staleAfterKeep = await evalJs(`document.querySelector('[data-card="brief"] .staleband')?.innerText ?? null`);
  out.staleAnswersAfterKeep = await evalJs(`document.querySelectorAll('[data-card="brief"] .ans').length`);

  /* `15` SC-02 갱신 중: the OLD Brief stays visible and the header says a re-read is under way.
   * Nothing on screen moved for the seconds the narrative pass takes, and the button stayed
   * pressable. Captured immediately after the click, before the pass can finish. */
  await evalJs(`[...document.querySelectorAll('[data-card="brief"] button')].find(b => b.textContent.trim() === '다시 읽기')?.click()`);
  await sleep(150);
  out.rereadingHead    = await evalJs(`document.querySelector('[data-card="brief"] .chead')?.innerText ?? ''`);
  /* The Brief is legitimately FOLDED here (D-132 folds it on return), so what proves it did not
   * vanish is its header — the title and the 읽은 시점 it was read at, both still present. */
  out.rereadingKept = await evalJs(`(() => {
    const h = document.querySelector('[data-card="brief"] .chead');
    return Boolean(h) && h.innerText.includes('읽은 시점'); })()`);
  await sleep(5000);
  out.afterReread      = await evalJs(`document.querySelector('[data-card="brief"] .chead')?.innerText ?? ''`);
  out.afterRereadState = await evalJs('JSON.stringify(window.__brief())');


  step('back to picker');
  // 다른 프로젝트 열기 goes back to SC-01, and the project it just opened is now remembered
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('다른 프로젝트')).click()`);
  await sleep(700);
  out.screenAfterBack = await evalJs('window.__screen()');
  /* `15` SC-01 · UF-RETURN: a recent row carries its LAST Work — the intent as typed, plus the
   * outcome. This run has ended several Works in the seeded project, so the top row has one. */
  out.recentLast = await evalJs(`document.querySelector('[data-el="recent-row"] .recentlast')?.innerText ?? null`);
  /* `15` SC-01's return state has its own picture: the first shot is taken before any Work
   * exists, so it cannot show this. */
  for (const theme of ['light', 'dark']) {
    await evalJs(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `sc01-return-${theme}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  await evalJs(`document.documentElement.setAttribute('data-theme','')`);
  await sleep(200);
  out.recentAfterBack = await evalJs('document.querySelectorAll(\'[data-el="recent-row"]\').length');
  out.recentTopAfterBack = await evalJs(`document.querySelector('[data-el="recent-row"] .path')?.textContent ?? null`);

  /* ── the drawer belongs to ONE project ──────────────────────────────────────────
   * The batch-12 review found a Quick Command card confirmed in one project that would RUN in
   * another: the drawer lives OUTSIDE `#root`, so navigating does not clear it, and `실행`
   * reads the project at CLICK time. The fix (`clearDrawerState` on a project change) had no
   * test at all — found by a renderer mutation sweep, where inverting the comparison so it
   * clears when the project is the SAME passed everything.
   *
   * Opening SEED2 and then SEED also leaves the recent list in the order the next step needs. */
  step('drawer is per project');
  await evalJs(`[...document.querySelectorAll('[data-el="recent-row"]')].at(-1).click()`);
  await sleep(1200);
  await evalJs(`window.__openDrawerWith('깃상태')`);
  await sleep(800);
  await evalJs(`document.querySelector('[data-el="qc-send"]')?.click() ?? [...document.querySelectorAll('.td01 button')].find(b => b.textContent.trim() === '보내기')?.click()`);
  await sleep(900);
  out.drawerCardA = await evalJs('JSON.stringify(window.__drawer())');

  /* …to the OTHER project, through the picker, the way a user does it. */
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('다른 프로젝트'))?.click()`);
  await sleep(900);
  await evalJs(`[...document.querySelectorAll('[data-el="recent-row"]')].at(-1).click()`);
  await sleep(1200);
  out.screenAfterSwitch = await evalJs('window.__screen()');
  await evalJs(`window.__toggleDrawer()`);
  await sleep(600);
  out.drawerAfterSwitch = await evalJs('JSON.stringify(window.__drawer())');
  await evalJs(`window.__toggleDrawer()`);
  await sleep(300);
  /* …and back to the picker, where the next step expects to be. SEED was opened last, so the
   * deleted-folder row is still the last one. */
  await evalJs(`[...document.querySelectorAll('.topbar button')].find(b => b.textContent.includes('다른 프로젝트'))?.click()`);
  await sleep(900);

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

/* ── `15` SC-02 Unavailable State ──────────────────────────────────────────────────────── */
{
  assert.ok(results.unavailCard, 'a logged-out Claude Code did not produce the 사용 불가 card');
  assert.ok(results.unavailCard.includes('지금 안 됨 · 실패 아님'),
    `the card does not carry the 12 §16 chip: ${results.unavailCard}`);
  assert.ok(results.unavailCard.includes('로그인이 필요해요'),
    `the card does not name the reason: ${results.unavailCard}`);
  /* NOT RED. `12` §16: 사용 불가 ≠ 실패, and `16` §2.1 keeps red for failure alone. */
  assert.strictEqual(results.unavailReds, 0, '사용 불가 was painted as a failure');
  /* `15`: 네 개의 복구 버튼 — and they are buttons, not a sentence about buttons. */
  const acts = JSON.parse(results.unavailActions);
  assert.deepStrictEqual(acts,
    ['▸ 프로젝트 설명 읽기', '▸ Quick Command 쓰기', '▸ 터미널로 직접 확인', '▸ 해결한 뒤 다시 보내기'],
    `the four recovery paths are not four buttons: ${JSON.stringify(acts)}`);
  /* UF-RULE-NOQUEUE: the submitted text is kept, never queued and never thrown away. */
  assert.strictEqual(results.unavailKeptText, '로그인 오류 고쳐줘',
    'the submitted text was lost when the Work was refused');
  /* …and the paths GO somewhere. D-134: this one opens the drawer carrying the sentence. */
  const d = JSON.parse(results.unavailToDrawer);
  assert.strictEqual(d.open, true, '▸ Quick Command 쓰기 did not open the drawer');
  assert.strictEqual(d.phrase, '로그인 오류 고쳐줘',
    `the drawer did not carry the user's sentence (${d.phrase})`);
}

/* The test run wrote its evidence into ITS OWN directory.
 *
 * `JUQODE_DB` moved the store and `evidenceStore` derives from `userData`, which it did not
 * move — so every run of this file used to leave a bare git repository per project in the
 * developer's own `~/.config/juqode/evidence`. This asserts the relocation actually took
 * effect, rather than asserting that the variable was passed. */
{
  const ev = path.join(USER_DATA, 'evidence');
  assert.ok(fs.existsSync(ev), `the app did not use ${USER_DATA} — evidence went somewhere else`);
  const stores = fs.readdirSync(ev);
  assert.ok(stores.length >= 1, 'the relocated evidence directory is empty');
  /* …and it really is an evidence store, not an empty directory that happens to exist. */
  assert.ok(fs.readdirSync(path.join(ev, stores[0])).length > 0,
    'the evidence store was created but never written to');
}

step('cdp done — stopping app');
stopApp();
await sleep(400);

console.log(JSON.stringify(results, null, 2));

const bridge = JSON.parse(results.bridge);
assert.strictEqual(results.ready, true, 'renderer did not initialise');
assert.strictEqual(results.screen, 'SC-01', `expected SC-01, got ${results.screen}`);
assert.deepStrictEqual(bridge.keys.sort(),
  ['boot', 'brief', 'claudeStatus', 'history', 'interpret', 'onQcUpdate', 'onWorkUpdate',
   'openPath', 'openProject', 'qcList', 'qcRoute', 'qcRun', 'qcRuns', 'qcStop', 'routeIntent',
   'versions', 'workAllow', 'workAnswer', 'workCancel', 'workChanges', 'workExplain', 'workGet',
   'workReader', 'workSignals', 'workStart'],
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
assert.deepStrictEqual(JSON.parse(results.sc02Cards).sort(),
  ['brief', 'history', 'intent', 'presence', 'stream'],
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
 * 쓰인 기술 · 실행 방법 · 확인 못한 것 — and only those. `11` says 부분 is not a failure. */
assert.strictEqual(interp.status, 'partial', `expected 부분 해석, got ${interp.status}`);
const confirmed = interp.answers.filter((a) => a.confidence === 'confirmed').map((a) => a.q);
/* q4 is never 확인됨: the question is what the folders DO, and the scan established only that
 * they exist. A 확인됨 chip there would certify an answer nothing has given. */
assert.deepStrictEqual(confirmed, [3, 5, 6], `the facts layer confirmed q${confirmed}`);
/* WBS-04 · the narrative layer answers q1, q2 and q4, and its answers are 예상됨 at best —
 * `19` §C1 ① lets only the facts layer's own output be 확인됨. The fixture grounds q1 and q2 in
 * a file the scan really read and grounds q4 in one nobody read, so q4 stays 확인 못함. */
assert.deepStrictEqual(interp.answers.filter((a) => a.confidence === 'expected').map((a) => a.q), [1, 2],
  'the narrative layer did not fill the questions the facts layer left open');
assert.deepStrictEqual(interp.answers.filter((a) => a.confidence === 'unconfirmed').map((a) => a.q), [4]);
assert.ok(!interp.answers.some((a) => a.confidence === 'confirmed' && !a.sourceRef),
  '`20`: a 확인됨 answer without the source that backs it');

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

/* ── WBS-04 · the Brief's narrative layer ─────────────────────────────────────────────────── */
const narrative = results.narrative ? JSON.parse(results.narrative) : null;
assert.ok(narrative, 'the renderer never saw a narrative report');
assert.strictEqual(narrative.reason, null, `the narrative pass did not run: ${JSON.stringify(narrative)}`);
assert.strictEqual(narrative.filled, 3, 'the three open questions were not filled');
/* The fixture cites README.md twice (a file the scan really read) and one path nobody read. */
assert.strictEqual(narrative.grounded, 2, 'a citation nobody read was counted as grounding');

const briefRows = JSON.parse(results.briefAfterReread ?? results.briefAnswers);
const chip = (i) => briefRows[i].chip;
/* ① 하는 일 and ② 주요 기능 cited a file the scan read → 예상됨. NEVER 확인됨: `19` §C1 ① lets
 * only the facts layer's own output be confirmed, and `20` demands a source_ref it cannot have. */
assert.ok(chip(0).includes('예상됨'), `q1 chip was ${chip(0)}`);
assert.ok(chip(1).includes('예상됨'), `q2 chip was ${chip(1)}`);
/* ④ 폴더가 하는 일 cited a path nobody read, so the answer is shown under 확인 못함. */
assert.ok(chip(3).includes('확인 못함'), `q4 chip was ${chip(3)}`);
assert.ok(briefRows[3].text.includes('src 에 소스가 있어요'),
  'the ungrounded answer was hidden instead of marked');
assert.ok(!briefRows[3].text.includes('nobody-read-this'),
  'a path nobody read was shown to the user as evidence');
/* …and the measured rows are untouched by any of it. */
assert.ok(chip(2).includes('확인됨') && !chip(2).includes('못함'), `q3 chip was ${chip(2)}`);
assert.strictEqual(results.briefConfirmedHaveSource, 0,
  '`20`: every 확인됨 answer carries the source that backs it');

/* ── WBS-05 · fold ────────────────────────────────────────────────────────────────────────
 * D-132: a FIRST open is large. Folding is a button, and it collapses to the header — which
 * keeps the two things the user can still do. Nothing here happens on its own. */
assert.strictEqual(JSON.parse(results.briefFoldedFirst).folded, false,
  'a first open started folded — D-132 makes it large');
assert.strictEqual(results.briefAnswersVisible, 6);
assert.strictEqual(JSON.parse(results.briefFoldedAfter).folded, true, '접기 did nothing');
assert.strictEqual(results.briefAnswersFolded, 0, 'a folded Brief still drew its six answers');
assert.ok(results.briefHeadFolded.includes('펼치기'), 'a folded Brief cannot be reopened');
assert.ok(results.briefHeadFolded.includes('다시 읽기'), '다시 읽기 vanished when folded');
/* …and it appears exactly ONCE, wherever it is. Two identical buttons in one card make the
 * reader choose between the same thing twice. */
assert.strictEqual((results.staleBand.match(/다시 읽기/g) || []).length, 1);
assert.ok(results.briefHeadFolded.includes('읽은 시점'),
  'a folded Brief must still say WHEN it was read — that is what makes it a cached Brief');
assert.strictEqual(results.briefAnswersUnfolded, 6, '펼치기 did not bring the answers back');

/* ── TD-01 · the drawer, and Quick Command ────────────────────────────────────────────────── */
assert.strictEqual(JSON.parse(results.drawerBefore).open, false, '`15`: the drawer starts 닫힘');
assert.strictEqual(JSON.parse(results.drawerOpen).open, true, '터미널 did not open the drawer');

/* `15` §Keyboard — `Esc` closes TD-01 / the discover panel, and NEVER cancels a Work. */
{
  assert.strictEqual(results.escDiscoverOpen, true, '할 수 있는 것 보기 did not open the panel');
  const one = JSON.parse(results.escAfterOne);
  const two = JSON.parse(results.escAfterTwo);
  const three = JSON.parse(results.escAfterThree);
  /* Innermost first: the panel goes, the drawer stays. */
  assert.strictEqual(one.discover, false, 'Esc did not close the discover panel');
  assert.strictEqual(one.open, true, 'Esc closed the drawer instead of the panel inside it');
  /* Then the drawer. */
  assert.strictEqual(two.open, false, 'a second Esc did not close the drawer');
  /* And then nothing — a key that keeps reaching for something to undo is how a Work gets
   * cancelled by accident, which `15` forbids by name. */
  assert.deepStrictEqual(three, two, 'Esc did something with nothing open');
  assert.strictEqual(results.escScreen, 'SC-02', `Esc navigated (now on ${results.escScreen})`);
}

/* `15` §Keyboard — focus returns to the request field after `이해했어요 · 다음 요청으로`. */
assert.strictEqual(results.focusAfterUnderstood, 'intent',
  `focus landed on ${results.focusAfterUnderstood} instead of the request field`);
assert.strictEqual(results.drawerScreen, 'SC-02',
  'opening the drawer navigated — `15` says it sits OVER the current screen');
/* A child of `#root` would be destroyed by the next screen render, and `15` requires the screen
 * beneath to be preserved. */
assert.strictEqual(results.drawerOutsideRoot, true, 'the drawer is inside #root');

/* `19` §S · Q-03: the banner is the product saying it does not isolate. It is drawn always.
 *
 * The SENTENCE is pinned as a literal and must appear exactly — that is the point of this
 * assertion. `18` `term.safetyTag` labels it, so the banner is the tag followed by the
 * sentence, and nothing else may join them. */
assert.ok(results.drawerBanner, 'the banner is not drawn');
assert.ok(results.drawerBanner.endsWith('여기서 치는 명령은 내 컴퓨터에서 내 권한으로 바로 실행돼요.'),
  `the one line that may never be hidden is missing or reworded: ${results.drawerBanner}`);
assert.ok(results.drawerBanner.startsWith('안전 안내'),
  `the banner is not labelled: ${results.drawerBanner}`);
/* Two children and no more: the label and the sentence. Asserted as PARTS rather than as one
 * string, because `innerText` runs two inline elements together and the whitespace between them
 * is a rendering detail, not something the copy should be made to carry. */
assert.deepStrictEqual(JSON.parse(results.drawerBannerParts),
  ['안전 안내', '여기서 치는 명령은 내 컴퓨터에서 내 권한으로 바로 실행돼요.'],
  'something else joined the banner, or the sentence was reworded');

/* `19` §C4: 항상 설명 후 확인. Typing produced an EXPLANATION and ran nothing. */
assert.strictEqual(results.qcCardKind, 'explained');
assert.ok(results.qcCard.includes('이해한 것'), 'the card does not say what it understood');
assert.ok(results.qcCard.includes('npm run test'), 'the card does not show the command it would run');
assert.ok(results.qcCard.includes('하는 일'), 'the card does not say what the command does');
assert.ok(results.qcCard.includes('JUQODE'), '`15` §0: the card must name who acts');
assert.strictEqual(results.qcRanYet, false, 'typing a phrase RAN it — explain-then-confirm is gone');
assert.strictEqual(JSON.parse(results.qcState).run, null);
assert.strictEqual(results.qcReds, 0, 'the drawer renders red with nothing failed');

/* 미인식 — neutral, and it offers the Work path. `19` §C4: the product does not claim to have
 * detected anything; it recognises six things and declines the rest. */
assert.strictEqual(results.qcUnrecKind, 'unrecognized');
assert.strictEqual(results.qcUnrecReds, 0, '미인식 was painted as a failure — `15` says neutral');
assert.ok(results.qcUnrec.includes('짐작해서 실행하지는 않아요'),
  'the card does not say that it will not guess');
assert.ok(results.qcUnrec.includes('작업으로 보내기'), 'there is no route to the Work path');
assert.ok(!/위험|감지|차단/.test(results.qcUnrec),
  'the card claims it DETECTED something — q02 §5.7: that teaches the user the rest is safe');

/* 모호함 — both readings named, nothing run. */
assert.strictEqual(results.qcAmbigKind, 'ambiguous');
assert.ok(results.qcAmbig.includes('골라'), 'the ambiguity does not ask the user to choose');

/* A Quick Command was actually RUN. Until this existed, 실행 중 · 끝났어요 · 출력 had never been
 * rendered anywhere in the suite, and the batch document claimed every card state was in. */
assert.ok(results.qcGitCard?.includes('git status --porcelain=v1 --branch'),
  'the card does not show the fixed command it would run');
assert.strictEqual(results.qcRunAttr, 'ok', `the run did not succeed: ${results.qcRunAttr}`);
assert.ok(results.qcRunCard.includes('끝났어요'), 'the finished run does not say it finished');
/* `19` §C4: 종료 코드·stderr 숨기지 않음. */
assert.ok(results.qcRunCard.includes('종료 코드 0'), 'the exit code is not shown');
/* The card contains the ACTUAL output — `15` TD-01: the QC card contains the real output. */
assert.ok(results.qcOutput, 'the run produced no visible output');
assert.ok(/README\.md|src\/index\.js/.test(results.qcOutput),
  `the output is not this project's git status: ${results.qcOutput}`);
assert.strictEqual(results.qcRunReds, 0, 'a successful run was painted as a failure');
assert.strictEqual(JSON.parse(results.qcRunState).run.state, 'ok');

/* 할 수 있는 것 보기 — the closed set, with a reason on every one that cannot run. */
assert.strictEqual(results.qcDiscoverRows, 6, 'the discoverability panel is not the closed six');

/* 닫기 preserves the screen beneath (`15`). */
assert.strictEqual(JSON.parse(results.drawerClosed).open, false);
assert.strictEqual(results.screenAfterDrawer, 'SC-02', 'closing the drawer changed the screen');

/* ── WBS-29 · the five state vocabularies, measured against each other ──────────────────────
 * `16` §2.1 keeps these apart, and `12` §16 turns one pair into a product promise: 사용 불가 is
 * NOT 실패. The check runs in both themes, because a token redefined in only one theme block is
 * a failure this codebase has already shipped. */
const grammarAll = JSON.parse(results.stateGrammar);
const grammar = grammarAll.chips;
for (const theme of ['light', 'dark']) {
  const rows = grammar[theme];
  assert.strictEqual(rows.length, 6, `${theme}: expected six states`);

  /* ① Every state differs from every other in COLOUR. */
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const differs = a.color !== b.color || a.background !== b.background || a.borderColor !== b.borderColor;
      assert.ok(differs, `${theme}: ${a.kind} and ${b.kind} are the same colour`);
    }
  }

  /* ② …and in something that is NOT colour. `16`: the mark is what survives a greyscale print
   * and a colour-blind reader. Before this test, 실패 and 사용 불가 carried no mark at all and
   * were separated by hue alone — measured at luminance 244 vs 241 in light theme. */
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      const shape = (r) => `${r.glyph}|${r.borderStyle}|${r.borderLeft}|${r.borderTop}`;
      assert.notStrictEqual(shape(a), shape(b),
        `${theme}: ${a.kind} and ${b.kind} are distinguishable only by colour — ${shape(a)}`);
    }
  }

  /* ③ 부분 (amber FILL) and 대기 (amber OUTLINE) share the hue BY DESIGN, so the thing that
   * keeps them apart is the fill. `16` §2.1 names this pair specifically. */
  const part = rows.find((r) => r.kind === 'part');
  const wait = rows.find((r) => r.kind === 'wait');
  assert.notStrictEqual(part.background, wait.background,
    `${theme}: 부분 and 대기 collapsed into one another — both ${part.background}`);
  assert.notStrictEqual(part.borderLeft, wait.borderLeft, `${theme}: the outline weight is the same too`);

  /* ④ One red. Only 실패 may wear the failure colour. */
  const fail = rows.find((r) => r.kind === 'fail');
  for (const r of rows) {
    if (r.kind === 'fail') continue;
    assert.notStrictEqual(r.color, fail.color, `${theme}: ${r.kind} is painted with the failure colour`);
    assert.notStrictEqual(r.borderColor, fail.borderColor, `${theme}: ${r.kind} is outlined in the failure colour`);
  }

  /* ⑤ Every state carries a mark. A state with none can only be read by its colour. */
  for (const r of rows) assert.ok(r.glyph, `${theme}: ${r.kind} has no mark at all`);

  /* ⑥ …and the specific shapes `16` §2.1 NAMES, not merely "different from each other".
   * Distinctness alone let 알 수 없음 lose its dashed border while its `?` kept the pairwise
   * check happy — and dashed is the thing Canon actually wrote down. */
  const unk = rows.find((r) => r.kind === 'unk');
  assert.strictEqual(unk.borderStyle, 'dashed', `${theme}: 알 수 없음 is not dashed — "dashed blue-grey"`);
  for (const r of rows) {
    if (r.kind === 'unk') continue;
    assert.notStrictEqual(r.borderStyle, 'dashed', `${theme}: ${r.kind} is dashed — that shape means 알 수 없음`);
  }
  /* 대기 is an OUTLINE: no fill of its own, so its background is the card's. 부분 is a FILL. */
  const card = rows.find((r) => r.kind === 'wait').background;
  assert.strictEqual(wait.background, card);
  assert.notStrictEqual(part.background, wait.background, `${theme}: 부분 lost its fill`);
}

/* …and the SURFACES the app actually renders, not only the tokens. `21` WBS-29's risk column:
 * "unavailable · unknown · partial · waiting 이 같은 토큰으로 렌더됨 → 실패". A chip strip
 * cannot see that — the 오래됨 band was plain card furniture while every chip assertion passed. */
for (const theme of ['light', 'dark']) {
  const rows = grammarAll.surfaces[theme];
  assert.ok(rows?.length >= 6, `${theme}: the surface probe rendered nothing`);
  const surf = (n) => rows.find((s) => s.name === n);

  /* 오래됨 waits for the user (다시 읽기 / 이대로 계속) and does neither on its own — `16` §2
   * gives that amber OUTLINE, and `15` SC-02 says "amber line on Brief". */
  assert.notStrictEqual(surf('stale').borderColor, surf('unavail').borderColor,
    `${theme}: the 오래됨 band and the 사용 불가 panel are painted the same`);
  assert.strictEqual(surf('stale').borderColor, surf('wait').borderColor,
    `${theme}: 오래됨 is a state waiting on the user and is not painted as one`);

  /* A refresh that failed over a Brief that still works is NOT on `16` §2's closed list of reds. */
  assert.notStrictEqual(surf('softfail').borderColor, surf('fail').borderColor,
    `${theme}: a failed refresh is painted with the failure colour while the old Brief is readable`);
  assert.strictEqual(surf('softfail').borderColor, surf('unavail').borderColor,
    `${theme}: a failed refresh is not painted as 사용 불가 — 지금 안 됨 · 실패 아님`);
}

/* ── WBS-05 · 오래됨 ──────────────────────────────────────────────────────────────────────
 * A top-level folder appeared while the reader was open — a STRUCTURAL change, so `source_hash`
 * moved (`19` §C1 ⑤; a body edit does not). Returning to SC-02 announces it. */
assert.ok(results.staleBand, 'the project changed and the Brief said nothing about it');
assert.ok(results.staleBand.includes('바뀌었'), `the stale line reads wrong: ${results.staleBand}`);
assert.ok(!results.staleBand.includes('0일'), 'the same-day case printed "0일 전에 읽은 내용이에요"');
/* Both routes are offered, and NEITHER of them happened on its own (D-132). */
assert.ok(results.staleBand.includes('다시 읽기'), 'no way to act on the announcement');
assert.strictEqual((results.staleHead.match(/다시 읽기/g) || []).length, 0,
  '다시 읽기 is drawn twice — the header keeps it while the band already offers it');
assert.ok(results.staleBand.includes('이대로 계속'), 'no way to dismiss it');
/* 오래됨 is a fact, not a failure: `16` keeps red for failure only. */
assert.strictEqual(results.staleReds, 0, 'an aged Brief was painted as a failure');
/* …and it did NOT re-read: the Brief is still the one that was folded on the way in. */
assert.strictEqual(JSON.parse(results.staleState).folded, true,
  'something re-read the project without being asked — D-132 forbids it');
/* `15` SC-02 갱신 중 — F-C1-03: the old interpretation stays visible until it is replaced. */
assert.ok(results.rereadingHead.includes('다시 읽는 중'),
  `the Brief said nothing while re-reading: ${results.rereadingHead}`);
assert.ok(!results.rereadingHead.includes('다시 읽기'),
  'the 다시 읽기 button stayed pressable during its own re-read');
assert.strictEqual(results.rereadingKept, true,
  'the old Brief vanished during the re-read — F-C1-03 keeps it until it is replaced');
assert.ok(!results.afterReread.includes('다시 읽는 중'), 'the re-read never finished');
assert.strictEqual(JSON.parse(results.afterRereadState).stale, null,
  'a completed re-read left the 오래됨 verdict standing');

assert.strictEqual(results.staleAfterKeep, null, '이대로 계속 left the announcement on screen');
assert.strictEqual(results.staleAnswersAfterKeep, results.staleAnswers,
  '이대로 계속 changed the Brief instead of only dismissing the notice');
assert.strictEqual(results.animating, 0,
  'an animation is still running under prefers-reduced-motion: reduce');

/* ── WBS-37 · 화면 구성 차별화 · 전환 모션 (D-136 · `17`) ─────────────────────────────────── */
{
  /* `Runtime.evaluate` with `returnByValue` hands these back as objects already; only
   * `drawerGeom` is a string, because it stringifies inside the page. */
  const { compSC01: C1, compSC02: C2, compSC03: C3, compSC04: C4 } = results;
  const geom = JSON.parse(results.drawerGeom);
  for (const [n, c] of [['SC-01', C1], ['SC-02', C2], ['SC-03', C3], ['SC-04', C4]]) {
    assert.ok(c, `${n}'s composition was never measured`);
  }

  /* `17`'s table, surface by surface. Each row is that surface's OWN sentence, in numbers —
   * not a ranking, so a change to one screen cannot silently satisfy another's rule. */

  /* SC-01 진입 — 카드가 적고 여백이 많다. */
  assert.ok(C1.cards <= 2, `SC-01 has ${C1.cards} cards — it is not the sparse entry screen`);
  assert.ok(C1.density < 0.25, `SC-01 covers ${(C1.density * 100).toFixed(0)}% of the surface`);

  /* SC-02 모듈 보드 — 크기가 다른 카드가 여럿 놓인다. By SIZE: the board is two equal columns
   * on purpose (a stack cannot overlap), so the variety is in area, not in width. */
  assert.ok(C2.cards >= 4, `SC-02 has only ${C2.cards} cards`);
  assert.ok(C2.distinctSizes >= 3, `SC-02's cards come in ${C2.distinctSizes} sizes`);

  /* SC-03 집중된 활성 Work — Work 가 화면의 주어다. The biggest card IS the Work, and it is
   * the biggest by a margin rather than by a pixel. */
  assert.strictEqual(C3.largest, 'work', `SC-03's largest card is ${C3.largest}, not the Work`);
  assert.ok(C3.dominance >= 1.8,
    `SC-03's Work is only ${C3.dominance?.toFixed(2)}× the next card — it is not the subject`);

  /* SC-04 넓은 읽기면 — 변경 묶음과 코드가 폭을 쓴다, and it is the only surface that does. */
  assert.ok(C4.widestShare >= 0.9,
    `SC-04's widest card takes ${(C4.widestShare * 100).toFixed(0)}% of the surface`);
  for (const [n, c] of [['SC-01', C1], ['SC-02', C2], ['SC-03', C3]]) {
    assert.ok(c.widestShare < C4.widestShare, `${n} is as wide a reading surface as SC-04`);
  }

  /* TD-01 종속 서랍 — 화면 위를 덮되 화면이 뒤에 남아 있는 것이 보인다. Both halves. */
  assert.ok(geom.top > 0, 'the drawer reaches the top of the window — it is a screen, not a drawer');
  assert.ok(geom.bottom >= geom.vh - 2, 'the drawer is not anchored to the bottom');
  assert.ok(geom.top < geom.vh * 0.85, 'the drawer is a sliver, not a drawer');
  assert.strictEqual(geom.behind, true, 'nothing is left behind the drawer');

  /* 텍스트만 바뀐 같은 페이지로 읽히면 실패다 — no two surfaces have the same signature. */
  const sig = (c) => `${c.cards}/${c.distinctSizes}/${Math.round(c.widestShare * 10)}/${Math.round(c.density * 10)}`;
  const sigs = [['SC-01', C1], ['SC-02', C2], ['SC-03', C3], ['SC-04', C4]].map(([n, c]) => [n, sig(c)]);
  assert.strictEqual(new Set(sigs.map((x) => x[1])).size, 4,
    `two surfaces are the same arrangement: ${sigs.map((x) => x.join('=')).join(' · ')}`);

  /* …and 하나의 디자인 시스템은 유지된다: the differentiation is composition, not a second
   * design system. Same card radius and the same type on every surface. */
  const radii = new Set([C2.radius, C3.radius, C4.radius].filter(Boolean));
  assert.strictEqual(radii.size, 1, `the card radius differs between surfaces: ${[...radii]}`);
  assert.strictEqual(new Set([C1.font, C2.font, C3.font, C4.font]).size, 1,
    'a surface uses a different typeface — that is a second design system');

  /* The three named transitions actually RUN, and nothing scrolls sideways while they do.
   * `17`: 같은 것이라는 사실이 움직임으로 보인다 — a transition that is written and never
   * fires shows nothing. */
  for (const [name, key] of [['SC-02 → SC-03', 'morphToWork'], ['SC-03 → SC-04', 'morphToReader'],
                             ['SC-04 → SC-02', 'morphToBench']]) {
    const m = JSON.parse(results[key]);
    assert.ok(m.animations >= 1, `${name} ran no transition (${m.animations})`);
    assert.strictEqual(m.overflow, 0,
      `${name} scrolled the page sideways by ${m.overflow}px while it played`);
  }

  /* …and with motion off, every one of them is GONE. Not shortened — absent. The stylesheet's
   * `animation: none !important` does not reach a Web Animations call, so this measures the
   * only thing that actually stops them. */
  for (const [name, key] of [['SC-02 → SC-03', 'morphReducedToWork'],
                             ['SC-04 → SC-02', 'morphReducedToBench']]) {
    const m = JSON.parse(results[key]);
    assert.strictEqual(m.animations, 0,
      `${name} still animates under prefers-reduced-motion: reduce (${m.animations})`);
  }
}

/* ── WBS-35 · Agent Presence, measured ─────────────────────────────────────────────────────
 * SC-02 with no Work open. `21` WBS-35: no mode is reachable by a timer alone, so after all
 * this session's waiting the mode is still the one no signal has moved. */
assert.strictEqual(results.sc02PresenceLive, 'permission',
  `SC-02 showed ${results.sc02PresenceLive} for a Work that is waiting on a permission — a History `
  + 'row only says `running`, so this is what proves SC-02 asks for the snapshot');
assert.strictEqual(results.presenceMode, 'idle',
  `the presence drifted to ${results.presenceMode} with no Work and no signal`);
assert.ok(results.presenceLabel && results.presenceLabel.trim(),
  '`16` §9 requires a label in every mode and the card has none');
assert.ok(results.presenceAria && results.presenceAria.includes(results.presenceLabel),
  'the canvas has no accessible name — the mode is invisible to a screen reader');
assert.deepStrictEqual(JSON.parse(results.presenceBox), [56, 56],
  '`16` §125: the presence canvas is 56 px and does not scale with its card');
assert.ok(results.presenceInk > 200,
  `the presence canvas is blank (${results.presenceInk} painted pixels)`);
assert.ok(results.presenceMoved,
  'the idle breath does not move — `16` §1 exempts it as the one continuous motion, and it is not there');
assert.ok(results.presenceStill,
  'the presence keeps animating under prefers-reduced-motion: reduce');
assert.strictEqual(results.presenceStillMode, 'idle',
  'turning motion off changed the MODE, which no rendering setting may do');
assert.ok(results.presenceStillInk > 200,
  `reduced motion left a blank frame instead of a static one (${results.presenceStillInk} pixels)`);

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
/* ── WBS-38 · D-136's absolute rule, on the rendered screen ──────────────────────────────── */
{
  const nva = JSON.parse(results.nextVsActions);
  for (const theme of ['light', 'dark']) {
    const { slot, acts } = nva[theme];
    assert.ok(slot, `${theme}: SC-03 has no NEXT slot — D-107 requires it always rendered`);
    assert.ok(acts, `${theme}: SC-03's finished Work has no 다음 행동 block`);
    /* Shape. The slot is text; the offer is buttons. A control in the NEXT slot would be the
     * user pressing something Claude "said". */
    assert.strictEqual(slot.buttons, 0, `${theme}: the NEXT slot contains a control`);
    assert.ok(acts.buttons >= 1, `${theme}: 다음 행동 has no buttons`);
    /* Voice. Different actor colours, and the label colours differ too — a shared accent is
     * exactly the "같은 시각 처리" `17` forbids. */
    assert.notStrictEqual(slot.borderLeftColor, acts.borderLeftColor,
      `${theme}: the two blocks carry the same accent colour`);
    assert.notStrictEqual(slot.labelColor, acts.labelColor,
      `${theme}: the two labels are painted the same`);
    /* Words. Each names its own speaker, and neither claims the other's. */
    assert.ok(acts.text.includes('다음 행동'), `${theme}: the offer is not labelled 다음 행동`);
    assert.ok(slot.text.startsWith('NEXT'), `${theme}: the slot does not open with NEXT`);
    assert.ok(!slot.text.includes('다음 행동'), `${theme}: 다음 행동 rendered inside the NEXT slot`);
    /* D-107 · this Work's fixture declares no next Step, so the slot is EMPTY — and the offer
     * is there anyway. That is the second row of `17`'s table, measured: 신호가 없으면 NEXT 는
     * 비어 있고, 다음 행동은 그대로 있다. */
    assert.ok(slot.text.includes('아직 다음 단계를 보내지 않았어요'),
      `${theme}: the empty NEXT slot says something else: ${slot.text}`);
  }
}

/* WBS-18 · the 확인됨 tool count, against the app's own signals. */
{
  const t = JSON.parse(results.toolClaim);
  assert.ok(t.shown, 'the result card has no observed-tools claim');
  assert.ok(t.blocks > t.rows,
    `the recording has no parallel tool_result (${t.rows} messages, ${t.blocks} blocks) — this `
    + 'check cannot tell the counted-messages bug from the fix');
  assert.ok(t.shown.includes(String(t.blocks)),
    `the card says "${t.shown.replace(/\n/g, ' / ')}" but the app recorded ${t.blocks} tool_result blocks`);
  assert.ok(t.shown.includes('확인됨') && t.shown.includes('signals:tool_result'),
    'the count is 확인됨 without naming what it rests on');
}

assert.strictEqual(results.screenReader, 'SC-04', `변경 읽기 did not reach SC-04 (${results.screenReader})`);

/* WBS-38 · SC-04's own 다음 행동 block (`15` SC-04 Secondary Actions). */
{
  const a = JSON.parse(results.readerActs);
  assert.ok(a, 'SC-04 has no 다음 행동 block on its populated state');
  assert.strictEqual(a.n, 2, `SC-04's 다음 행동 offers ${a.n} actions, not two`);
  assert.ok(a.text.includes('다음 행동'), 'the block is not labelled');
  assert.ok(a.text.includes('이해했어요'), '이해했어요 · 다음 요청으로 is not offered on SC-04');
  assert.ok(a.text.includes('원하던 결과가'), '원하던 결과가 아니에요 is not offered on SC-04');
  /* D-115 · WBS-19: no undo button, and the panel says so before offering the only thing that
   * exists — a NEW Work. */
  assert.ok(results.readerUnwanted, '원하던 결과가 아니에요 opened nothing on SC-04');
  assert.ok(results.readerUnwanted.includes('되돌리기 버튼은 없어요'),
    'the SC-04 unwanted panel does not say there is no undo');
  /* …and it does NOT offer 먼저 변경 더 읽기, which navigates to the screen we are already on. */
  assert.ok(!results.readerUnwanted.includes('먼저 변경 더 읽기'),
    'SC-04 offers a button that navigates to SC-04');
}
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

/* ── WBS-19 · the correction path ─────────────────────────────────────────────────────── */
assert.ok(results.unwantedText, '원하던 결과가 아니에요 opened no panel');
assert.ok(results.unwantedText.includes('되돌리기 버튼은 없어요'),
  `the panel does not say there is no undo: ${results.unwantedText}`);
assert.ok(results.unwantedText.includes('원래 그대로 돌아간다고 약속하진 못해요'),
  'the panel promises a restoration it cannot deliver');
assert.strictEqual(results.unwantedReds, 0, 'the correction panel renders red — wanting something else is not a failure');
/* D-115 · `21` WBS-19: this screen has no rollback control at all. */
assert.ok(!/되돌리기|롤백|undo|revert/i.test(results.sc03Rollback),
  `SC-03 offers a rollback control: ${results.sc03Rollback}`);

assert.strictEqual(results.afterCorrection, 'SC-02', '고치는 작업 요청 did not return to the workbench');
assert.ok(results.correctionIntent && results.correctionIntent.includes('README.md 의 첫 줄을 바꿔줘'),
  `the correction does not quote the user's own words: ${results.correctionIntent}`);
/* Prefilled, NOT sent: `12` treats 보내기 as consent to change files, so a Work must not have
   started on the user's behalf. */
assert.strictEqual(results.correctionWorkCount, 1,
  'the correction started a Work by itself — sending is the user\'s act');

assert.ok(results.sc02CardCount >= 3, `the overlap check saw ${results.sc02CardCount} cards — it proves nothing`);
assert.strictEqual(results.sc02Overlaps, 0, 'SC-02 draws cards on top of each other');
assert.strictEqual(results.sc02Clipped2, 0, 'an SC-02 card clips its own content');
/* The NEXT slot is always rendered, and empty is the right answer here (D-107). */
assert.ok(results.nextSlot && results.nextSlot.includes('Claude Code가 아직 다음 단계를 보내지 않았어요'),
  `NEXT slot: ${results.nextSlot}`);
assert.ok(results.liveness && !/\d+\s*%/.test(results.liveness), 'the liveness line shows a percentage');
assert.deepStrictEqual(JSON.parse(results.sc03Cards).sort(), ['about', 'presence', 'steps', 'work'],
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
/* ── the drawer belongs to ONE project (batch-12 HIGH, found untested by a mutation sweep) ── */
{
  const a = JSON.parse(results.drawerCardA);
  assert.strictEqual(a.open, true, 'the drawer did not open in the first project');
  assert.ok(a.card, 'no Quick Command card was produced to carry across the switch');
  assert.strictEqual(a.phrase, '깃상태');

  assert.strictEqual(results.screenAfterSwitch, 'SC-02', 'switching projects did not reach SC-02');
  const b = JSON.parse(results.drawerAfterSwitch);
  assert.strictEqual(b.open, true, 'the drawer did not reopen in the second project');
  assert.strictEqual(b.card, null,
    'a Quick Command card CONFIRMED in one project survived into another — `실행` reads the '
    + 'project at click time, so it would have run there');
  assert.strictEqual(b.phrase, '', `the other project's sentence was carried across: ${b.phrase}`);
  assert.strictEqual(b.run, null, 'a run from another project is still on screen');
}

assert.ok(results.recentLast, 'a recent row carries no last-Work summary (`15` UF-RETURN)');
assert.ok(results.recentLast.includes('마지막 작업'),
  `the summary is not labelled: ${results.recentLast}`);
assert.ok(results.recentLast.includes('README.md 의 첫 줄을 바꿔줘'),
  `the summary does not quote the user's own request: ${results.recentLast}`);

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
    { cwd: ROOT, detached: true, env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: bad, JUQODE_USER_DATA: USER_DATA } });
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

  /* WAIT for the renderer, do not assume it. A fixed 4 s sleep is a guess about how long a
   * second Electron takes to boot, and under load it was wrong — `window.__screen is not a
   * function`, which reads as "the app failed" when the app was merely still starting. The
   * deadline is still bounded, so a renderer that never loads still fails, and says which. */
  const ready = await ev2(`(async () => {
    for (let i = 0; i < 200; i++) {
      if (typeof window.__screen === 'function') return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false; })()`);
  assert.strictEqual(ready, true, 'the refused-store window never finished loading its renderer');

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
