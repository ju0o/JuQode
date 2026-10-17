/* The FIRST journey, on the real Electron renderer, against the fixture CLI (no model, no login):
 *
 *   empty Board → 새 작업 → request written → 보내기 (the person's consent) → Work in progress
 *
 * and the keyboard behaviour of the screens it crosses. Two things the older suite never asked:
 *   - what an EMPTY board tells a person who has never used it (it used to be five blank columns, with the way in
 *     a small `+ 새 작업` in the rail and the request field hidden until it was pressed), and
 *   - what a SAVED Task with no attempt offers (it offered nothing: the field was hidden and 보내기 on an empty
 *     field does nothing).
 * Nothing here starts an Agent except the one explicit 보내기 at the end, and that is the fixture CLI.
 *
 * Screenshots go to JUQODE_E2E_SHOT_DIR (default tmp-journey/) — never into the tracked goldens. */
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
const { DB, USER_DATA, SEED, SEED2, SEED3, FAKE_CLI } = await import('./fixture.mjs');

/* Projects can only be opened if the product OFFERED them (openPath answers `not-offered` otherwise — a security rule, not a
 * bug), so the cases that each need a project of their own are registered in the store BEFORE the app starts, the way
 * fixture.mjs seeds its own. Folders live under os.tmpdir() (this run's scratch). */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EXTRA = [0, 1, 2].map((n) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `juqode-journey${n}-`))); fs.writeFileSync(path.join(d, 'README.md'), '# journey fixture\n'); return d; });
{
  const { openDb } = require(path.join(ROOT, 'app/main/db/db.js'));
  const repo = require(path.join(ROOT, 'app/main/db/repo.js'));
  const db = openDb(DB);
  for (const d of EXTRA) { repo.openProject(db, d, path.basename(d)); const t = Date.now(); while (Date.now() === t) { /* distinct ms */ } }
  db.close();
}

const OUT = path.resolve(process.env.JUQODE_E2E_SHOT_DIR || path.join(ROOT, 'tmp-journey'));
fs.mkdirSync(OUT, { recursive: true });
const PORT = await findFreePortBlock(Number(process.env.JUQODE_E2E_PORT || 9323), 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (m) => process.stderr.write(`  · ${m}\n`);

const [file, argv] = launchArgs(['.', '--no-sandbox', `--remote-debugging-port=${PORT}`]);
const app = spawn(file, argv, { cwd: ROOT, detached: !WIN, env: { ...process.env, JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA,
  JUQODE_QUIET_MS: '2500', JUQODE_CLAUDE_BIN: FAKE_CLI } });
process.on('exit', () => killTree(app));
await sleep(4000);

let page = null;
for (let i = 0; i < 20 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  if (!page) await sleep(750);
}
assert.ok(page, 'no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0; const pending = new Map();
ws.onmessage = (m) => { const g = JSON.parse(m.data); if (g.id && pending.has(g.id)) { pending.get(g.id)(g); pending.delete(g.id); } };
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++nextId;
  const t = setTimeout(() => { pending.delete(n); rej(new Error(`CDP timeout: ${method}`)); }, 20000);
  pending.set(n, (g) => { clearTimeout(t); res(g); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
/* A screenshot named -light or -dark must BE that theme: the attribute is set first, then the page's real background is
 * measured and the file is only written if it agrees (an earlier "light" capture was a dark page — the OS preference won). */
const shotThemes = {};
const shot = async (name) => {
  const m = name.match(/-(light|dark)(?:-|$)/);
  if (m) {
    await ev(`document.documentElement.setAttribute('data-theme','${m[1]}')`); await sleep(180);
    const probe = JSON.parse(await ev(`(() => { const bg = getComputedStyle(document.body).backgroundColor; const [r, g, b] = bg.match(/[\\d.]+/g).map(Number);
      return JSON.stringify({ attr: document.documentElement.getAttribute('data-theme'), bg, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }); })()`));
    shotThemes[name] = probe;
    assert.strictEqual(probe.attr, m[1], `${name}: data-theme is ${probe.attr}`);
    assert.ok(m[1] === 'light' ? probe.lum > 0.6 : probe.lum < 0.25, `${name}: the page background ${probe.bg} is not a ${m[1]} theme`);
  }
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
};
const key = async (k, code, vk) => {
  /* Enter needs a 'keyDown' carrying text, or Chromium never turns it into a click on a button. */
  await send('Input.dispatchKeyEvent', k === 'Enter' ? { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: '\r' }
    : { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  await sleep(120);
};
const VIS = `const vis = (n) => n && n.offsetParent !== null;`;
const priButtons = `(() => { ${VIS} return [...document.querySelectorAll('.btn.pri')].filter(vis).map((b) => b.innerText.trim()); })()`;
const theme = (t) => ev(`document.documentElement.setAttribute('data-theme','${t}')`);

const out = {};
try {
  for (let i = 0; i < 100 && !(await ev(`typeof window.__screen === 'function'`)); i++) await sleep(50);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 773, deviceScaleFactor: 1, mobile: false });
  await theme('light');
  const openRow = (dir) => ev(`[...document.querySelectorAll('[data-el="recent-row"]')].find((r) => r.innerText.includes(${JSON.stringify(path.basename(dir))}))?.click()`);
  /* An EMPTY folder first: its Brief says so and has its own way to start, and the board must still have exactly
   * one primary action — a second one would tell the person to begin in two places. */
  await openRow(SEED3);
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-el="board-start"]')`)); i++) await sleep(250);
  out.emptyFolder = JSON.parse(await ev(`(() => { ${VIS} return JSON.stringify({ pri: [...document.querySelectorAll('.btn.pri')].filter(vis).map((b) => b.innerText.trim()),
    brief: document.querySelector('[data-card="brief"]')?.innerText ?? '', briefStart: !!document.querySelector('[data-card="brief"] .row-acts .btn') }); })()`));
  await shot('empty-folder-1200-light');
  assert.deepStrictEqual(out.emptyFolder.pri, ['새 작업'], `an empty folder shows more than one primary action: ${JSON.stringify(out.emptyFolder.pri)}`);
  assert.ok(out.emptyFolder.brief.includes('이 폴더는 아직 비어 있어요') && out.emptyFolder.briefStart, 'the empty-folder explanation or its own start went missing');
  /* ── P8: ONE emphasised start per situation; the KEY does what the emphasised button does; one decision = one Work ── */
  const works = async () => JSON.parse(await ev(`(async () => JSON.stringify((await window.juqode.history(window.__project().id)).works.length))()`));
  const tasks = async () => JSON.parse(await ev(`(async () => JSON.stringify((await window.juqode.taskList(window.__project().id)).tasks.length))()`));
  const priNow = () => ev(`(() => { ${VIS} return JSON.stringify({ pri: [...document.querySelectorAll('.btn.pri')].filter(vis).map((b) => b.innerText.trim()),
    submit: document.querySelector('[data-act="submit-intent"]').innerText.trim(), draftShown: !document.querySelector('[data-el="composer-draft"]').hidden,
    notes: [...document.querySelectorAll('.start-note')].filter(vis).map((n) => n.innerText.trim()) }); })()`).then(JSON.parse);
  const type = (t) => ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = ${JSON.stringify(t)}; f.dispatchEvent(new Event('input', { bubbles: true })); f.focus(); })()`);
  const enterFast = async () => { /* no pause: two of these are two key presses in the same instant */
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
  const settle = async (n, ms = 10000) => { for (let i = 0; i < ms / 250 && (await works()) === n; i++) await sleep(250); await sleep(1500); };
  /* One active Work per project (D-117), and a cancelled Work holds the writer slot until its end is confirmed — so each case
   * that must START a Work gets its own fresh project, registered through the product's own openPath. The folders are made
   * under os.tmpdir() (this run's scratch) and are never touched by anything but this test. */
  const goToPicker = async () => { await backToBoard(); await ev(`[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.includes('다른 프로젝트'))?.click()`);
    for (let i = 0; i < 40 && (await ev('window.__screen()')) !== 'SC-01'; i++) await sleep(250); };
  let extraUsed = 0;
  const freshProject = async () => {
    const dir = EXTRA[extraUsed++];
    await goToPicker(); await openRow(dir);
    for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-act="board-start"]')`)); i++) await sleep(250);
    if (!(await ev(`!!document.querySelector('[data-act="board-start"]')`))) throw new Error(`fresh project ${dir}: no board-start; screen=${await ev('window.__screen()')}`);
    await ev(`document.querySelector('[data-act="board-start"]').click()`); await sleep(250);
  };
  const backToBoard = async () => { if ((await ev('window.__screen()')) !== 'SC-02') { await ev(`[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.includes('작업대로'))?.click()`); for (let i = 0; i < 40 && (await ev('window.__screen()')) !== 'SC-02'; i++) await sleep(250); } };
  const newWork = async () => { await ev(`document.querySelector('.nav-new').click()`); await sleep(250); };
  await ev(`document.querySelector('[data-act="board-start"]').click()`); await sleep(200);
  const n0 = await works();
  await type('회원가입 화면에 이메일 칸을 추가해 주세요'); await sleep(200);
  out.p8a = await priNow(); out.p8aWorksTyped = await works(); out.p8aTheme = await ev(`document.documentElement.getAttribute('data-theme')`);
  await shot('p8-typed-no-task-1200-light');
  assert.deepStrictEqual(out.p8a.pri, ['새 일로 맡기기'], `a typed sentence has more than one emphasised start: ${JSON.stringify(out.p8a)}`);
  assert.strictEqual(out.p8a.submit, '저장 없이 한 번만 보내기');
  assert.ok(out.p8a.notes.some((t) => t.includes('Claude가 바로 시작해요')), `nothing says that pressing starts Claude: ${JSON.stringify(out.p8a.notes)}`);
  assert.strictEqual(out.p8aWorksTyped, n0, 'typing a sentence / seeing the proposal started a Work');
  /* (1) Enter with an INVALID condition: the same validation as the button, no Work, no single-shot fallback */
  await ev(`(() => { const c = document.querySelector('[data-el="composer-draft"] textarea'); c.value = ''; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('[data-el="intent"]').focus()`);
  await enterFast(); await sleep(1500);
  out.p8InvalidEnter = { works: await works(), tasks: await tasks(), note: await ev(`document.querySelector('[data-el="composer-draft"]').innerText`) };
  assert.strictEqual(out.p8InvalidEnter.works, n0, 'Enter with no completion condition started a Work (it must show the validation message, not run another way)');
  assert.strictEqual(out.p8InvalidEnter.tasks, 0);
  assert.ok(out.p8InvalidEnter.note.includes('조건') , `Enter did not show the condition validation: ${out.p8InvalidEnter.note}`);
  /* (2) Enter = 새 일로 맡기기, pressed twice in the same instant: Work +1, linked to the saved Task */
  await type('회원가입 화면에 이메일 칸을 추가해 주세요'); await sleep(200);
  /* the person cleared the condition box above, so it stays theirs: write a condition back, as a person would */
  await ev(`(() => { const c = document.querySelector('[data-el="composer-draft"] textarea'); c.value = '이메일 칸이 보여요'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('[data-el="intent"]').focus()`);
  await enterFast(); await enterFast();
  await settle(n0);
  out.p8EnterDouble = { works: await works(), tasks: await tasks() };
  assert.strictEqual(out.p8EnterDouble.works, n0 + 1, `Enter twice made ${out.p8EnterDouble.works - n0} Works`);
  assert.strictEqual(out.p8EnterDouble.tasks, 1, 'Enter (= 새 일로 맡기기) must save exactly one Task');
  out.p8aLinked = JSON.parse(await ev(`(async () => { const h = await window.juqode.history(window.__project().id); const w = h.works.find((x) => x.status !== 'ended');
    const d = await window.juqode.workGet(w.id); return JSON.stringify({ task: d?.work?.work?.task_id ?? null }); })()`));
  assert.ok(out.p8aLinked.task, 'Enter started a Work that is not attached to the Task it just saved');
  /* (3) a click and an Enter in the same instant are one decision */
  await freshProject(); const n1 = await works(), t1 = await tasks();
  await type('로그인 오류 고쳐줘'); await sleep(200);
  /* the same tick, so the first decision cannot have finished before the second arrives */
  await ev(`(() => { document.querySelector('[data-act="commit-task"]').click(); const f = document.querySelector('[data-el="intent"]'); f.focus();
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  await settle(n1);
  out.p8Race = { works: (await works()) - n1, tasks: (await tasks()) - t1 };
  out.p8RaceDom = await ev(`document.querySelector('[data-card="intent"]')?.innerText ?? null`);
  assert.strictEqual(out.p8Race.works, 1, `a click plus Enter made ${out.p8Race.works} Works: ${out.p8RaceDom}`);
  assert.strictEqual(out.p8Race.tasks, 1, `a click plus Enter saved ${out.p8Race.tasks} Tasks`);
  /* (4) Enter on an EMPTY field does nothing */
  await freshProject(); const n2 = await works();
  await type(''); await ev(`document.querySelector('[data-el="intent"]').focus()`); await enterFast(); await sleep(1200);
  assert.strictEqual(await works(), n2, 'Enter on an empty field started a Work');
  /* (5) the single-shot route is still there, explicit, one Work, NO Task, and no stray Task from the other button */
  const t2 = await tasks();
  await type('로그인 오류 고쳐줘'); await sleep(200);
  await ev(`(() => { const b = document.querySelector('[data-act="submit-intent"]'); b.click(); b.click(); document.querySelector('[data-act="commit-task"]').click(); })()`);
  for (let i = 0; i < 40 && (await ev('window.__screen()')) !== 'SC-03'; i++) await sleep(250);
  await sleep(1500);
  out.p8Single = { works: (await works()) - n2, tasks: (await tasks()) - t2,
    task: await ev(`(async () => { const d = await window.juqode.workGet(window.__work().id); return d?.work?.work?.task_id ?? null; })()`) };
  assert.strictEqual(out.p8Single.works, 1, `a double click on 한 번만 보내기 made ${out.p8Single.works} Works`);
  assert.strictEqual(out.p8Single.task, null, 'the no-Task path attached the Work to a Task');
  assert.strictEqual(out.p8Single.tasks, 0, `the second button saved a Task nobody asked for (${out.p8Single.tasks})`);
  /* P5: the unlinked attempt says it is not linked to a saved Task — and is still a way into that attempt's record */
  await backToBoard();
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('[data-el="unlinked-run"]')`)); i++) await sleep(250);
  out.p5 = JSON.parse(await ev(`(() => { const t = document.querySelector('[data-el="unlinked-run"]'); return JSON.stringify({ text: t?.innerText ?? null, isButton: t?.tagName === 'BUTTON' }); })()`));
  assert.ok(out.p5.text?.includes('저장된 작업과 연결되지 않은 시도예요') && !out.p5.text.includes('맡은 일로 저장되지'), `P5: ${JSON.stringify(out.p5)}`);
  assert.ok(out.p5.isButton, 'the unlinked attempt is no longer a way into its record');
  await goToPicker(); await openRow(SEED);
  step('opened the seeded project');
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-el="board-start"]')`)); i++) await sleep(250);

  /* ── ① the empty Board ─────────────────────────────────────────────────────────────── */
  out.empty = JSON.parse(await ev(`(() => { ${VIS}
    const s = document.querySelector('[data-el="board-start"]');
    return JSON.stringify({ visible: vis(s), text: s?.innerText ?? '',
      cols: document.querySelectorAll('[data-column]').length, pri: [...document.querySelectorAll('.btn.pri')].filter(vis).map((b) => b.innerText.trim()),
      intentVisible: vis(document.querySelector('[data-card="intent"]')), rail: vis(document.querySelector('.nav-new')),
      inspector: document.querySelector('[data-region="inspector"]') ? true : false });
  })()`));
  for (const w of [880, 1024, 1200, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: w === 880 ? 600 : w === 1024 ? 700 : w === 1200 ? 773 : 900, deviceScaleFactor: 1, mobile: false });
    for (const t of ['light', 'dark']) { await theme(t); await sleep(200); await shot(`empty-${w}-${t}`);
      const m = JSON.parse(await ev(`JSON.stringify({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ctaInView: (() => { const b = document.querySelector('[data-act="board-start"]').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })() })`));
      assert.strictEqual(m.overflow, 0, `empty board overflows at ${w} ${t}`);
      assert.ok(m.ctaInView, `the empty board's CTA is below the fold at ${w} ${t}`);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 773, deviceScaleFactor: 1, mobile: false });
  await theme('light'); await ev(`document.documentElement.style.zoom = '1.5'`); await sleep(200); await shot('empty-1200-light-zoom150');
  out.emptyZoomCtaInView = await ev(`(() => { const b = document.querySelector('[data-act="board-start"]').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && document.documentElement.scrollWidth <= document.documentElement.clientWidth; })()`);
  await ev(`document.documentElement.style.zoom = ''`);

  /* the keyboard reaches it: Tab from the page top until the CTA, counting the stops */
  out.emptyTabStops = await (async () => {
    await ev(`document.activeElement?.blur?.(); window.scrollTo(0, 0)`);
    for (let i = 1; i <= 25; i++) {
      await key('Tab', 'Tab', 9);
      if (await ev(`document.activeElement?.getAttribute('data-act') === 'board-start'`)) return i;
    }
    return null;
  })();
  assert.ok(out.empty.visible, 'the empty board shows no invitation');
  assert.ok(out.empty.text.includes('무엇을 맡길까요?') && out.empty.text.includes('아직 맡은 일이 없어요'), `the empty board does not ask, or does not say it is empty: ${out.empty.text}`);
  assert.ok(out.empty.text.includes('보내면'), 'the invitation does not say that sending is what starts Claude');
  assert.deepStrictEqual(out.empty.pri, ['새 작업'], `the empty board must have exactly one primary action: ${JSON.stringify(out.empty.pri)}`);
  assert.strictEqual(out.empty.cols, 5, 'the five-column board is gone');
  assert.strictEqual(out.empty.intentVisible, false, 'the request field was already open on an empty board');
  assert.ok(out.empty.rail, 'the rail\'s 새 작업 was removed');
  assert.ok(out.emptyTabStops, 'the keyboard never reaches 새 작업 in 25 Tabs');
  out.worksBefore = JSON.parse(await ev(`(async () => JSON.stringify(await window.juqode.history(window.__project().id)))()`)).works.length;

  /* ── ② clicking it opens the field and NOTHING else ───────────────────────────────── */
  await key('Enter', 'Enter', 13); await sleep(300);
  out.afterCta = JSON.parse(await ev(`(() => { ${VIS} return JSON.stringify({ focus: document.activeElement?.getAttribute('data-el'),
    intentVisible: vis(document.querySelector('[data-card="intent"]')), startVisible: vis(document.querySelector('[data-el="board-start"]')),
    pri: [...document.querySelectorAll('.btn.pri')].filter(vis).map((b) => b.innerText.trim()), screen: window.__screen() }); })()`));
  out.worksAfterCta = JSON.parse(await ev(`(async () => JSON.stringify(await window.juqode.history(window.__project().id)))()`)).works.length;
  assert.strictEqual(out.afterCta.focus, 'intent', 'focus did not move to the request field');
  assert.strictEqual(out.afterCta.intentVisible, true);
  assert.strictEqual(out.afterCta.startVisible, false, 'the invitation stayed on screen beside the field it opened');
  assert.deepStrictEqual(out.afterCta.pri, ['보내기'], `after opening the field the one primary is 보내기: ${JSON.stringify(out.afterCta.pri)}`);
  assert.strictEqual(out.worksAfterCta, out.worksBefore, 'pressing 새 작업 started a Work');
  await shot('after-cta-1200-light');

  /* ── ③ a saved Task with no attempt has a way forward ─────────────────────────────── */
  await ev(`window.juqode.taskCreate(window.__project().id, { goal: '로그인 버튼 고치기', acceptanceCriteria: [{ text: '버튼을 누르면 로그인된다' }] })`);
  const other = (re) => ev(`[...document.querySelectorAll('.nav-item')].find((b) => ${re})?.click()`);
  await other(`b.innerText.includes('seed2')`); await sleep(2500);
  await other(`b.innerText.includes('seed-') && !b.innerText.includes('seed2') && !b.innerText.includes('seed3')`); await sleep(2500);
  await ev(`document.querySelector('.task-pick')?.click()`); await sleep(600);
  out.unrun = JSON.parse(await ev(`(() => { ${VIS} const b = document.querySelector('[data-act="task-write-request"]');
    return JSON.stringify({ btn: b ? b.innerText : null, vis: vis(b), intentVisible: vis(document.querySelector('[data-card="intent"]')),
      pri: [...document.querySelectorAll('.btn.pri')].filter(vis).map((x) => x.innerText.trim()) }); })()`));
  await shot('unrun-task-1200-light');
  assert.ok(out.unrun.vis, 'a saved Task with no attempt offers no way to write its request');
  assert.strictEqual(out.unrun.intentVisible, false);
  assert.deepStrictEqual(out.unrun.pri, ['이 작업으로 요청 쓰기'], JSON.stringify(out.unrun.pri));
  /* READ-ONLY measurement, SC-02: a keyboard user presses Enter on a Task tile. Selecting it repaints the whole
   * board; the key must still have a home afterwards, and it must be the same Task's tile. */
  out.sc02TileEnter = JSON.parse(await ev(`(async () => {
    const t = document.querySelector('.task-pick'); t.focus(); const before = t;
    return JSON.stringify({ focusedFirst: document.activeElement === t });
  })()`));
  await key('Enter', 'Enter', 13); await sleep(500);
  out.sc02TileEnter.after = await ev(`(() => { const a = document.activeElement; return a === document.body ? 'BODY' : (a.getAttribute('data-task-id') ? 'tile' : a.tagName + ':' + (a.textContent || '').trim().slice(0, 20)); })()`);
  assert.strictEqual(out.sc02TileEnter.after, 'tile', `Enter on a Task tile dropped keyboard focus to ${out.sc02TileEnter.after}`);
  await ev(`document.querySelector('[data-act="task-write-request"]').click()`); await sleep(300);
  out.written = JSON.parse(await ev(`(() => { ${VIS} return JSON.stringify({ value: document.querySelector('[data-el="intent"]').value,
    focus: document.activeElement?.getAttribute('data-el'), draftHidden: document.querySelector('[data-el="composer-draft"]').hidden,
    again: vis(document.querySelector('[data-act="task-write-request"]')),
    pri: [...document.querySelectorAll('.btn.pri')].filter(vis).map((x) => x.innerText.trim()) }); })()`));
  out.worksAfterWrite = JSON.parse(await ev(`(async () => JSON.stringify(await window.juqode.history(window.__project().id)))()`)).works.length;
  assert.strictEqual(out.written.value, '로그인 버튼 고치기');
  assert.strictEqual(out.written.focus, 'intent');
  assert.strictEqual(out.written.draftHidden, true, '새 일로 맡기기 would save a SECOND Task for a sentence that already is one');
  assert.strictEqual(out.written.again, false, 'the write-request button stayed beside the open field');
  assert.deepStrictEqual(out.written.pri, ['보내기']);
  assert.strictEqual(out.worksAfterWrite, out.worksBefore, 'writing the request started a Work');
  await ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value += ' 그리고 오류 문구도'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.strictEqual(await ev(`document.querySelector('[data-el="composer-draft"]').hidden`), false, 'editing the sentence did not bring the proposal back');
  out.p8c = await priNow();
  assert.deepStrictEqual(out.p8c.pri, ['이 작업에 보내기'], `with a Task selected the one emphasised start continues THAT Task: ${JSON.stringify(out.p8c)}`);
  assert.ok(out.p8c.notes.some((t) => t.includes('선택한 작업에 이어서')), JSON.stringify(out.p8c.notes));
  await ev(`(() => { const f = document.querySelector('[data-el="intent"]'); f.value = '로그인 버튼 고치기'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  /* ── ④ 보내기 is the consent: the Work starts, bound to THAT Task ─────────────────── */
  /* with a Task selected the key is 이 작업에 보내기 — one Enter, one Work, bound to that Task */
  await ev(`document.querySelector('[data-el="intent"]').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  for (let i = 0; i < 40 && (await ev('window.__screen()')) !== 'SC-03'; i++) await sleep(250);
  out.started = JSON.parse(await ev(`JSON.stringify({ screen: window.__screen(), work: window.__work() })`));
  assert.strictEqual(out.started.screen, 'SC-03', 'pressing 보내기 did not reach the Run');
  const taskId = JSON.parse(await ev(`(async () => JSON.stringify((await window.juqode.taskList(window.__project().id)).tasks[0].id))()`));
  const detail = JSON.parse(await ev(`(async () => JSON.stringify(await window.juqode.workGet(window.__work().id)))()`));
  out.boundTask = detail?.work?.work?.task_id ?? null;
  assert.strictEqual(out.boundTask, taskId, `the Work is not bound to the Task the request was written for: ${JSON.stringify(detail).slice(0, 200)}`);
  /* the permission wait is the next state; 허용 is still the person's choice */
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.sc03 [data-el="permission"]')`)); i++) await sleep(250);
  out.permission = await ev(`document.querySelector('.sc03 [data-el="permission"]')?.innerText ?? null`);
  assert.ok(out.permission, 'the fixture Work did not reach a permission wait');

  /* ── ⑤ the NEXT block under a permission wait is quiet, and still there ───────────── */
  out.next = JSON.parse(await ev(`(() => { const n = document.querySelector('[data-el="next"]');
    const b = document.querySelector('[data-el="permission"] button, .sc03 [data-card="work"] .btn.pri');
    const px = (x) => x ? parseFloat(getComputedStyle(x).fontSize) : 0;
    return JSON.stringify({ text: n?.innerText ?? null, quiet: n?.classList.contains('is-quiet') ?? false,
      valueSize: px(n?.querySelector('div')), buttonSize: px(b) }); })()`));
  assert.ok(out.next.text?.includes('Claude Code가 아직 다음 단계를 보내지 않았어요'), 'the No-Step sentence is gone from the permission screen');
  assert.strictEqual(out.next.quiet, true, 'an empty NEXT under a permission wait is drawn at full weight');
  assert.ok(out.next.valueSize < 14, `the empty NEXT is still ${out.next.valueSize}px`);
  await shot('permission-1200-light');

  /* ── input_waiting, SYNTHETIC: no CLI path produces it today (headless Claude never asks; reducer.js is the only
   * producer of the status), so a real snapshot of this Work is turned into one and drawn by the REAL SC-03 into a
   * scratch container, then drawn AGAIN the way a push does. This is the real renderer on a made-up state — said so. */
  out.inputWaitSynthetic = JSON.parse(await ev(`(async () => {
    const { renderSC03 } = await import('./screens/sc03.js');
    const d = await window.juqode.workGet(window.__work().id);
    const snap = structuredClone(d.work); snap.status = 'input_waiting'; snap.permission = null; snap.inputRequest = { text: '어느 파일을 고칠까요?' };
    const host = document.createElement('div'); document.body.appendChild(host);
    const state = { project: window.__project(), workSnapshot: snap };
    const nav = { toWork() {}, toWorkbench() {}, toReader() {} };
    renderSC03(host, window.juqode, nav, state);
    const first = host.querySelector('[data-el="answer"]');
    const had = !!first && !!host.querySelector('[data-el="input"]');
    first.value = '로그인 버튼이에요'; first.focus(); first.setSelectionRange(2, 5);
    renderSC03(host, window.juqode, nav, state);           // what a pushed snapshot does
    const again = host.querySelector('[data-el="answer"]');
    const r = { had, fresh: again !== first, value: again.value, focused: document.activeElement === again, start: again.selectionStart, end: again.selectionEnd,
      labelled: again.getAttribute('aria-label') };
    host.remove(); document.body.focus(); return JSON.stringify(r); })()`));
  assert.ok(out.inputWaitSynthetic.had && out.inputWaitSynthetic.fresh, `the synthetic input_waiting did not draw / redraw: ${JSON.stringify(out.inputWaitSynthetic)}`);
  assert.deepStrictEqual([out.inputWaitSynthetic.value, out.inputWaitSynthetic.focused, out.inputWaitSynthetic.start, out.inputWaitSynthetic.end],
    ['로그인 버튼이에요', true, 2, 5], `the typed answer / caret / selection did not survive a redraw: ${JSON.stringify(out.inputWaitSynthetic)}`);
  assert.ok(out.inputWaitSynthetic.labelled, 'the answer box has no accessible name');

  /* ── P4 branches, SYNTHETIC (real SC-03 on a real snapshot with the result edited): ended_unknown must say a file
   * change of zero ONLY when the comparison itself succeeded, and a Task Run only when its evidence row says known. */
  out.p4 = JSON.parse(await ev(`(async () => {
    const { renderSC03 } = await import('./screens/sc03.js');
    const d = await window.juqode.workGet(window.__work().id);
    const nav = { toWork() {}, toWorkbench() {}, toReader() {} };
    const draw = (edit) => { const snap = structuredClone(d.work); snap.status = 'ended'; snap.work.status = 'ended'; snap.outcome = 'ended_unknown'; snap.work.outcome = 'ended_unknown';
      snap.permission = null; snap.result = { summary: null, whatFailed: null, items: [], claims: [] }; snap.runEvidence = []; edit(snap);
      const host = document.createElement('div'); document.body.appendChild(host); renderSC03(host, window.juqode, nav, { project: window.__project(), workSnapshot: snap });
      const t = host.querySelector('[data-card="result"]')?.innerText ?? ''; host.remove(); document.body.focus(); return t; };
    return JSON.stringify({
      measuredZero: draw((s) => { s.work.task_id = null; s.result.claims = [{ kind: 'changed-files', data: { files: [] }, confidence: 'confirmed', sourceRef: 'evidence:before→after' }]; }),
      unmeasured:   draw((s) => { s.work.task_id = null; s.result.claims = [{ kind: 'changes-unknown', data: null, confidence: 'unconfirmed', sourceRef: null }]; }),
      taskKnownZero: draw((s) => { s.work.task_id = 't'; s.runEvidence = [{ id: 'e1', kind: 'changed_files', details: { known: true, files: [] } }]; }),
      taskUnknown:  draw((s) => { s.work.task_id = 't'; s.runEvidence = [{ id: 'e1', kind: 'changed_files', details: { known: false, files: [] } }]; }),
      taskMissing:  draw((s) => { s.work.task_id = 't'; s.runEvidence = []; }),
    }); })()`));
  const ZERO = '시작 전과 비교한 파일 변경은 관측되지 않았어요', CORE = '지금은 작업 상태를 확인할 수 없어요';
  for (const k of ['measuredZero', 'taskKnownZero']) {
    assert.ok(out.p4[k].includes(CORE) && out.p4[k].includes(ZERO) && out.p4[k].indexOf(CORE) < out.p4[k].indexOf(ZERO), `P4 ${k}: the core status leads and the measured scope follows: ${out.p4[k]}`);
    assert.ok(!out.p4[k].includes('작업이 끝났는지 확인할 수 없어요'), `P4 ${k}: a second status headline repeats the first: ${out.p4[k]}`);
  }
  for (const k of ['unmeasured', 'taskUnknown', 'taskMissing']) {
    assert.ok(!out.p4[k].includes(ZERO) && !out.p4[k].includes('바뀐 파일이 없어요') && !out.p4[k].includes('변경 없음'), `P4 ${k}: an unmeasured comparison must never say zero: ${out.p4[k]}`);
  }

  /* ── ⑥ focus survives the REAL pushed redraw, wherever it is ─────────────────────── */
  await ev(`document.documentElement.setAttribute('data-theme','light')`);
  out.pushFocus = JSON.parse(await ev(`(async () => {
    const find = () => [...document.querySelectorAll('.sc03 button')].find((n) => n.textContent.includes('허용하고 다시 해 보기'));
    const b = find(); b.focus();
    for (let i = 0; i < 100 && b.isConnected; i++) await new Promise((r) => setTimeout(r, 100));
    const a = document.activeElement;
    return JSON.stringify({ redrawn: !b.isConnected, after: a === document.body ? 'BODY' : a.textContent.trim() });
  })()`));
  assert.ok(out.pushFocus.redrawn, 'no real snapshot push replaced the button within 10 s — the probe measured nothing');
  assert.strictEqual(out.pushFocus.after, '허용하고 다시 해 보기', `a real push dropped focus: ${JSON.stringify(out.pushFocus)}`);

  /* The shared module, on the cases the one real button cannot make: two identical buttons, a control that goes
   * away, one that becomes disabled, and a text field with a caret, a selection and an unsent answer. A scratch
   * container inside the live document, driven through the SAME functions the screen calls. */
  out.focusCases = JSON.parse(await ev(`(async () => {
    const { rememberFocus, restoreFocus } = await import('./focus.js');
    const host = document.createElement('div'); document.body.appendChild(host);
    const card = (inner) => '<div data-card="work">' + inner + '</div>';
    const redraw = (html) => { const mem = rememberFocus(host); host.innerHTML = html; restoreFocus(host, mem); };
    const res = {};
    /* same words, twice: the SECOND one had focus */
    host.innerHTML = card('<button>확인</button><button>확인</button>');
    host.querySelectorAll('button')[1].focus();
    redraw(card('<button>확인</button><button>확인</button>'));
    res.duplicate = [...host.querySelectorAll('button')].indexOf(document.activeElement);
    /* two Tasks with the same words, and the one that had focus moved to the top of the board */
    host.innerHTML = '<button data-task-id="a">고치기</button><button data-task-id="b">고치기</button>';
    host.querySelector('[data-task-id="b"]').focus();
    redraw('<button data-task-id="b">고치기</button><button data-task-id="a">고치기</button>');
    res.reordered = document.activeElement?.getAttribute?.('data-task-id');
    /* the focused control is gone: focus must not fall to the page, and must not land on a different button */
    host.innerHTML = card('<button data-act="allow">허용</button><button data-act="stop">취소</button>');
    host.querySelector('[data-act="allow"]').focus();
    redraw(card('<button data-act="stop">취소</button>'));
    res.vanishedOnButton = document.activeElement?.tagName === 'BUTTON';
    res.vanishedOnCard = document.activeElement === host.querySelector('[data-card="work"]');
    /* the focused control is now disabled */
    host.innerHTML = card('<button data-act="allow">허용</button><button data-act="stop">취소</button>');
    host.querySelector('[data-act="allow"]').focus();
    redraw(card('<button data-act="allow" disabled>허용</button><button data-act="stop">취소</button>'));
    res.disabledOnCard = document.activeElement === host.querySelector('[data-card="work"]');
    res.disabledOnOther = document.activeElement?.tagName === 'BUTTON';
    /* a field: unsent answer, caret and a selection */
    host.innerHTML = card('<textarea class="answerfield" aria-label="답"></textarea>');
    let t = host.querySelector('textarea'); t.value = '네, 로그인 버튼이에요'; t.focus(); t.setSelectionRange(3, 7);
    redraw(card('<textarea class="answerfield" aria-label="답"></textarea>'));
    t = host.querySelector('textarea');
    res.field = { value: t.value, focused: document.activeElement === t, start: t.selectionStart, end: t.selectionEnd };
    /* a field that is NOT focused still keeps what was typed, and a newer value is never overwritten */
    host.innerHTML = card('<textarea aria-label="답"></textarea><button>보내기</button>');
    host.querySelector('textarea').value = '쓰던 답'; host.querySelector('button').focus();
    redraw(card('<textarea aria-label="답"></textarea><button>보내기</button>'));
    res.unfocusedValue = host.querySelector('textarea').value;
    const mem = rememberFocus(host); host.innerHTML = card('<textarea aria-label="답">새 값</textarea>'); restoreFocus(host, mem);
    res.notOverwritten = host.querySelector('textarea').value;
    host.remove(); document.body.focus();
    return JSON.stringify(res);
  })()`));
  const fc = out.focusCases;
  assert.strictEqual(fc.duplicate, 1, `two identical buttons: focus went to #${fc.duplicate}, not the second`);
  assert.strictEqual(fc.reordered, 'b', `a Task tile that moved lost its focus to ${fc.reordered}`);
assert.ok(fc.vanishedOnCard && !fc.vanishedOnButton, `the focused control vanished: focus ${fc.vanishedOnCard ? 'is on the card' : 'is elsewhere'}${fc.vanishedOnButton ? ' (on another button — a guess)' : ''}`);
  assert.ok(fc.disabledOnCard && !fc.disabledOnOther, `a control that became disabled: focus is ${fc.disabledOnCard ? 'on the card' : 'not on the card'}${fc.disabledOnOther ? ', on another button' : ''}`);
  assert.deepStrictEqual(fc.field, { value: '네, 로그인 버튼이에요', focused: true, start: 3, end: 7 }, `a field lost its text, caret or selection: ${JSON.stringify(fc.field)}`);
  assert.strictEqual(fc.unfocusedValue, '쓰던 답', 'an unfocused unsent answer was lost in a redraw');
  assert.strictEqual(fc.notOverwritten, '새 값', 'a restored draft overwrote a newer value');

  out.shotThemes = shotThemes;
  console.log(JSON.stringify(out, null, 2));
} finally {
  ws.close();
  killTree(app);
}
