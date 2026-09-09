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
  // No generic passthrough. Renaming the parameter must not defeat this, so assert on the
  // shape: every exposed value must invoke a STRING LITERAL channel.
  const body = src.slice(src.indexOf('exposeInMainWorld'));
  const invocations = [...body.matchAll(/ipcRenderer\.invoke\(([^,)]+)/g)].map((m) => m[1].trim());
  assert.ok(invocations.length > 0, 'preload exposes nothing');
  for (const arg of invocations) {
    assert.match(arg, /^'[^']+'$/, `preload forwards a non-literal channel: ${arg}`);
  }
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
  const decls = (block) => {
    const out = {};
    for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  };
  const L = decls(light), D = decls(dark), A = decls(auto);

  for (const t of ['--fail', '--part', '--wait', '--unk', '--grey', '--rec', '--claude', '--juq', '--ink', '--board', '--card']) {
    assert.ok(L[t], `${t} missing from light`);
    assert.ok(D[t], `${t} missing from dark`);
    assert.notStrictEqual(D[t], L[t], `${t} is identical in light and dark — the theme does nothing`);
  }

  // THE regression that shipped a 1.83:1 button: a token redefined in the media block but
  // NOT in [data-theme="dark"] is correct only while the OS already prefers dark. The two
  // dark paths must declare exactly the same set, with the same values.
  const missing = Object.keys(A).filter((k) => !(k in D));
  assert.deepStrictEqual(missing, [],
    `token(s) in the prefers-color-scheme block but not in [data-theme="dark"]: ${missing.join(', ')} — the toggle would not win`);
  for (const k of Object.keys(A)) {
    assert.strictEqual(D[k], A[k], `${k} differs between the two dark blocks`);
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
                 'app/renderer/screens/sc02.js', 'app/renderer/screens/sc02.css',
                 'app/renderer/design/base.css', 'app/renderer/copy.js', 'app/renderer/index.html',
                 'app/renderer/renderer.js', 'app/renderer/dom.js'];
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

test('every Korean string is either Canon 18 verbatim or a marked Canon gap', () => {
  const canon = process.env.JUQODE_CANON ||
    '/home/skkse12/Desktop/Projects/Team/JuQode-Private/docs/current/18_KOREAN_UX_COPY.md';
  let dict;
  try { dict = fs.readFileSync(canon, 'utf8'); }
  catch {
    // Skipping silently is how invented copy got in. Fail loudly instead; CI must set the path.
    assert.fail(`Canon 18 not readable at ${canon} — set JUQODE_CANON. Refusing to pass vacuously.`);
  }

  // Enumerate EVERY Korean string in the renderer, rather than whitelisting a few.
  const hangul = /['"`]([^'"`]*[\uAC00-\uD7A3][^'"`]*)['"`]/g;
  const found = new Map();
  for (const f of ['app/renderer/copy.js', 'app/renderer/screens/sc01.js',
                   'app/renderer/screens/sc02.js', 'app/renderer/dom.js',
                   'app/renderer/renderer.js', 'app/main/main.js', 'app/main/project.js',
                   'app/main/claude-detect.js', 'app/main/db/db.js', 'app/main/db/repo.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(hangul)) found.set(m[1], f);
  }
  assert.ok(found.size >= 10, `expected to find the SC-01 copy, found ${found.size} strings`);

  // ONE block in copy.js may hold strings Canon 18 does not carry: `gap:`, a state 18 has
  // no key for. A `dev:` block used to be allowed too; it shipped unapproved copy onto SC-02
  // under a comment claiming it never would, so DEV-ONLY product copy is now banned outright.
  /* Comments are stripped first. A comment that QUOTES a Canon string in order to explain
     why a nearby key departs from it is documentation, not a string the product renders. */
  const copySrc = read('app/renderer/copy.js');
  const copyCode = copySrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const block = (name) => copyCode.split(`${name}: {`)[1]?.split('},')[0] ?? '';
  const gapBlock = block('gap');
  assert.ok(gapBlock, 'copy.js lost its gap: marker — the exemption must stay explicit');
  assert.ok(!/\bdev:\s*\{/.test(copyCode),
    'copy.js has a dev: block again — DEV-ONLY copy on a real screen is how unapproved words shipped');

  for (const [s, f] of found) {
    if (gapBlock.includes(s)) continue;
    assert.ok(dict.includes(s), `"${s}" (${f}) is not in Canon 18 and is not a marked Canon gap`);
  }

  // The gap block must not become a dumping ground: if Canon 18 DOES carry the string, the
  // approved key should have been used instead.
  for (const m of gapBlock.matchAll(/['"]([^'"]*[\uAC00-\uD7A3][^'"]*)['"]/g)) {
    assert.ok(!dict.includes(m[1]),
      `"${m[1]}" is in Canon 18 — move it out of copy.js gap: and use the approved key`);
  }

  // Main never ships a user-facing sentence: reasons cross IPC as machine codes.
  for (const f of ['app/main/project.js', 'app/main/main.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/[\uAC00-\uD7A3]/.test(src),
      `${f} contains Korean in code — the renderer owns copy, main sends machine reasons`);
  }
});

test('index.html: CSP forbids remote content', () => {
  const html = read('app/renderer/index.html');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//);   // no external asset of any kind
});

test('capability containment: each privileged capability lives in exactly one module', () => {
  // Walk the WHOLE tree. Reading one file lets a capability hide in any other.
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs|cjs|html)$/.test(e.name)) files.push(rel);
    }
  })('app');
  assert.ok(files.length >= 10, `expected to scan the app tree, found ${files.length} files`);

  // token -> the single file allowed to contain it
  const OWNER = {
    'showOpenDialog':  'app/main/project.js',
    'child_process':   'app/main/claude-detect.js',
    'execFile':        'app/main/claude-detect.js',
    'node:sqlite':     'app/main/db/db.js',
    'DatabaseSync':    'app/main/db/db.js',
  };
  // never, anywhere: nothing in the built packages needs these, and each is a real hazard
  const NEVER = [
    'node-pty', 'openExternal', 'execSync', 'eval(', 'new Function',
    'better-sqlite3', 'nodeIntegration: true', 'webSecurity: false',
  ];

  for (const f of files) {
    // strip comments — a comment naming a capability is documentation, not code
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const b of NEVER) assert.ok(!src.includes(b), `${f} uses a forbidden capability: ${b}`);
    for (const [tok, owner] of Object.entries(OWNER)) {
      if (src.includes(tok)) assert.strictEqual(f, owner, `${tok} appears in ${f}; only ${owner} may have it`);
    }
  }

  // The renderer is not privileged: no node built-in reaches it, and it never touches ipcRenderer.
  for (const f of files.filter((f) => f.startsWith(path.join('app', 'renderer')))) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const b of ['require(', 'ipcRenderer', 'process.', "node:"]) {
      assert.ok(!src.includes(b), `renderer file ${f} reaches outside its sandbox: ${b}`);
    }
  }

  // Packages NOT yet built must not have a half-implementation hiding in the tree.
  const all = files.map((f) => read(f)).join('\n');
  for (const notYet of ['work_signal', 'evidence_basis', 'change_group', '--allowedTools', '--resume']) {
    const inCode = all.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!inCode.includes(notYet), `a later WBS package leaked into app/: ${notYet}`);
  }
});

test('visual test writes to an untracked path unless goldens are explicitly updated', () => {
  const src = read('tests/e2e/visual.mjs');
  // default output must not be the tracked evidence directory
  assert.match(src, /const UPDATE = /);
  assert.match(src, /UPDATE \? GOLDEN : path\.join\(ROOT, 'tmp-visual'\)/);
  assert.match(src, /const GOLDEN = path\.join\(ROOT, 'docs', 'dev-evidence', 'screens'\)/);
  // and the untracked path must actually be ignored
  const ignore = read('.gitignore');
  assert.match(ignore, /^tmp-visual\/$/m, 'tmp-visual/ is not gitignored — test output would be committed');
});
