'use strict';
/* Foundation unit tests. Small on purpose — WBS-01 is a shell, not a library. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

test('security: renderer defaults are locked down', () => {
  const { WEB_PREFERENCES } = require('../app/main/security');
  assert.strictEqual(WEB_PREFERENCES.contextIsolation, true);
  assert.strictEqual(WEB_PREFERENCES.nodeIntegration, false);
  assert.strictEqual(WEB_PREFERENCES.nodeIntegrationInWorker, false);
  assert.strictEqual(WEB_PREFERENCES.nodeIntegrationInSubFrames, false);
  assert.strictEqual(WEB_PREFERENCES.sandbox, true);
  assert.strictEqual(WEB_PREFERENCES.webSecurity, true);
  assert.strictEqual(WEB_PREFERENCES.webviewTag, false);
});

test('security: web preferences cannot be mutated at runtime', () => {
  const { WEB_PREFERENCES } = require('../app/main/security');
  assert.throws(() => { 'use strict'; WEB_PREFERENCES.nodeIntegration = true; });
});

test('preload exposes exactly the named API, and never ipcRenderer', () => {
  const src = read('app/preload/preload.js');
  assert.match(src, /exposeInMainWorld\('juqode'/);
  assert.doesNotMatch(src, /exposeInMainWorld\([^)]*ipcRenderer/);
  // no generic passthrough that would widen the surface to every channel
  assert.doesNotMatch(src, /invoke:\s*\(\s*channel/);
  assert.doesNotMatch(src, /require\(['"]child_process/);
});

test('theme tokens: dark is defined in BOTH guards so the toggle wins either way', () => {
  const css = read('app/renderer/design/tokens.css');
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test('theme tokens: every state-grammar colour exists in light AND dark', () => {
  const css = read('app/renderer/design/tokens.css');
  // parse the actual rule blocks, not every textual mention (the header comment names them too)
  const rule = (sel) => {
    const i = css.indexOf('\n' + sel);
    assert.ok(i > -1, `rule ${sel} not found`);
    const open = css.indexOf('{', i);
    return css.slice(open, css.indexOf('\n}', open));
  };
  const light = rule(':root {');
  const dark = rule(':root[data-theme="dark"] {');
  const auto = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  assert.match(auto, /:root:not\(\[data-theme="light"\]\)/);
  for (const t of ['--fail', '--part', '--wait', '--unk', '--grey', '--rec', '--claude', '--juq', '--ink', '--board', '--card']) {
    assert.match(light, new RegExp(`${t}\\s*:`), `${t} missing from light`);
    assert.match(dark, new RegExp(`${t}\\s*:`), `${t} missing from dark`);
  }
});

test('base css: reduced motion disables transition AND animation', () => {
  const css = read('app/renderer/design/base.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition:\s*none\s*!important/);
  assert.match(css, /animation:\s*none\s*!important/);
});

test('base css: partial(fill) and waiting(outline) are visually distinct', () => {
  const css = read('app/renderer/design/base.css');
  // they share the amber hue by design, so they must differ by more than colour
  assert.match(css, /\.chip\.part::before/);
  assert.match(css, /\.chip\.wait::before/);
  assert.match(css, /\.chip\.wait\s*\{[^}]*border-left-width:\s*3px/);
});

test('no fabricated progress anywhere in the renderer', () => {
  const files = ['app/renderer/screens/sc01.js', 'app/renderer/screens/sc01.css',
                 'app/renderer/design/base.css', 'app/renderer/copy.js', 'app/renderer/index.html'];
  for (const f of files) {
    // strip comments first: a comment that FORBIDS these words is exactly what we want to see
    const s = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    for (const banned of ['progressbar', 'aria-valuenow', 'role="progress', '생각 중', 'ETA', '남은 시간', '거의 다', '곧 끝']) {
      assert.ok(!s.includes(banned), `${f} contains banned progress affordance: ${banned}`);
    }
    // a percentage may appear as a CSS length; it must never be rendered as text to the user
    assert.ok(!/[>'"`]\s*\d+\s*%/.test(s), `${f} appears to render a percentage to the user`);
  }
});

test('copy is transcribed from Canon 18, not invented', () => {
  const { readFileSync } = require('node:fs');
  const copy = read('app/renderer/copy.js');
  const canon = '/home/skkse12/Desktop/Projects/Team/JuQode-Private/docs/current/18_KOREAN_UX_COPY.md';
  let dict;
  try { dict = readFileSync(canon, 'utf8'); } catch { return; }  // Canon repo absent in CI
  for (const s of ['프로젝트 열기', '이미 있는 폴더를 고르면 돼요. 새로 만들지는 않아요.',
                   '폴더를 읽고 있어요…', '최근에 연 프로젝트', '아직 기록이 없어요 — 처음 열기']) {
    assert.ok(copy.includes(s), `copy.js missing "${s}"`);
    assert.ok(dict.includes(s), `"${s}" is not in Canon 18 — copy must not be invented`);
  }
});

test('index.html: CSP forbids remote content', () => {
  const html = read('app/renderer/index.html');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//);   // no external asset of any kind
});

test('scope containment: no WBS-02+ capability is implemented', () => {
  const main = read('app/main/main.js');
  // folder open must answer "not yet", not open a dialog
  assert.doesNotMatch(main, /showOpenDialog/);
  assert.match(main, /ok:\s*false/);
  for (const later of ['node-pty', 'child_process', 'sqlite', 'better-sqlite3', 'claude']) {
    assert.ok(!main.includes(later), `main.js reaches into WBS-02+ territory: ${later}`);
  }
});
