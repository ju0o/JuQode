'use strict';
/* Foundation unit tests. Small on purpose — WBS-01 is a shell, not a library. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..');
/* Comments stripped — see `tests/src.js`. Three times in this run a scan was fooled by a
 * file DESCRIBING what it does not do; `raw()` is there for the few checks whose subject IS
 * the whole file. */
const { code: read, text: raw } = require(path.join(__dirname, 'src.js'));

/* Block comments, whole-line comments, AND trailing ones. Stripping only the first two let a
   trailing `// …` carry Korean past the copy check — a comment explaining a rule was read as
   product copy that broke it. `\s+//` cannot match a `://` inside a string literal. */
const stripComments = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s+\/\/[^\n]*/g, '');

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
  /* Enumerated from the tree, not listed by hand: a hand-written list exempted `sc03.js` — the
     screen with the liveness line, the one place a spinner or an ETA would ever appear — from
     the check by construction, so the assertion could not fail for it. */
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|css|html)$/.test(e.name)) files.push(rel);
    }
  })(path.join('app', 'renderer'));
  assert.ok(files.length >= 12, `expected the renderer tree, found ${files.length} files`);
  for (const f of files) {
    // strip comments first: a comment that FORBIDS these words is exactly what we want to see
    const s = stripComments(read(f));
    /* The `rules:` block states the PROHIBITION in Canon's own words, so it necessarily
       contains the phrase it forbids. Everything outside that block must not. */
    const outsideRules = s.replace(/rules:\s*\{[\s\S]*?\},/, '');
    for (const banned of ['progressbar', 'aria-valuenow', 'role="progress', '생각 중', 'ETA', '남은 시간', '거의 다', '곧 끝']) {
      assert.ok(!outsideRules.includes(banned), `${f} contains banned progress affordance: ${banned}`);
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
  /* Every renderer file, enumerated — plus the main-process files, which must contain no
     Korean at all. A hand-written list is a list that forgets the newest screen. */
  const rendererFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.js$/.test(e.name)) rendererFiles.push(rel);
    }
  })(path.join('app', 'renderer'));
  assert.ok(rendererFiles.length >= 7, `expected the renderer tree, found ${rendererFiles.length}`);

  for (const f of [...rendererFiles, 'app/main/main.js', 'app/main/ipc.js', 'app/main/project.js',
                   'app/main/claude-detect.js', 'app/main/db/db.js', 'app/main/db/repo.js',
                   'app/main/work/supervisor.js', 'app/main/work/reducer.js']) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(hangul)) found.set(m[1], f);
  }
  assert.ok(found.size >= 10, `expected to find the SC-01 copy, found ${found.size} strings`);

  // ONE block in copy.js may hold strings Canon 18 does not carry: `gap:`, a state 18 has
  // no key for. A `dev:` block used to be allowed too; it shipped unapproved copy onto SC-02
  // under a comment claiming it never would, so DEV-ONLY product copy is now banned outright.
  /* Comments are stripped first. A comment that QUOTES a Canon string in order to explain
     why a nearby key departs from it is documentation, not a string the product renders. */
  const copySrc = read('app/renderer/copy.js');
  const copyCode = stripComments(copySrc);
  /* Brace-matched, not split on the first `},`: a nested object inside the block truncated the
     extraction and silently pushed every later entry OUT of the exemption. */
  const block = (name) => {
    const at = copyCode.indexOf(`${name}: {`);
    if (at === -1) return '';
    let depth = 0;
    for (let i = copyCode.indexOf('{', at); i < copyCode.length; i++) {
      if (copyCode[i] === '{') depth += 1;
      else if (copyCode[i] === '}' && --depth === 0) return copyCode.slice(at, i + 1);
    }
    return '';
  };
  const gapBlock = block('gap');
  assert.ok(gapBlock, 'copy.js lost its gap: marker — the exemption must stay explicit');
  assert.ok(!/\bdev:\s*\{/.test(copyCode),
    'copy.js has a dev: block again — DEV-ONLY copy on a real screen is how unapproved words shipped');

  for (const [s, f] of found) {
    if (gapBlock.includes(s)) continue;
    assert.ok(dict.includes(s), `"${s}" (${f}) is not in Canon 18 and is not a marked Canon gap`);
  }

  /* The gap block must not become a dumping ground: if Canon 18 DOES carry the string, the
     approved key should have been used instead.
     Compared against Canon's ENTRIES, not against the file as text — a substring test flags a
     short label like `바뀐 파일` because a different, longer Canon sentence happens to contain
     it, which is a false positive that would push a real gap out of the block. */
  const entries = new Set(
    dict.split('\n')
      .filter((l) => l.startsWith('| `'))
      .map((l) => l.split('|')[2]?.trim())
      .filter(Boolean)
      .map((v) => v.replace(/\*\*/g, '')),
  );
  assert.ok(entries.size > 150, `expected Canon 18's entries, parsed ${entries.size}`);
  for (const m of gapBlock.matchAll(/['"]([^'"]*[\uAC00-\uD7A3][^'"]*)['"]/g)) {
    assert.ok(!entries.has(m[1]),
      `"${m[1]}" is a Canon 18 entry — move it out of copy.js gap: and use the approved key`);
  }

  // Main never ships a user-facing sentence: reasons cross IPC as machine codes.
  for (const f of ['app/main/project.js', 'app/main/main.js', 'app/main/ipc.js',
                   'app/main/work/supervisor.js', 'app/main/work/reducer.js']) {
    const src = stripComments(read(f));
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
  /* token -> the file(s) allowed to contain it. A privileged capability lives in ONE place, so
     an audit of that place is an audit of the capability. */
  const OWNER = {
    'showOpenDialog': ['app/main/project.js'],
    'node:sqlite':    ['app/main/db/db.js'],
    'DatabaseSync':   ['app/main/db/db.js'],
    /* FOUR modules spawn a process, and each spawns exactly one kind of thing:
         claude-detect  — `claude --version` / `auth status`, constant arguments
         claude/session — the headless Claude Code session, constant flags + stdin
         evidence/git   — `git`, never a shell. The arguments are NOT all constant: staged
                          paths and tree oids flow in, always after `--` or as 40-hex ids
         qc/run         — WBS-22's Quick Command, from `qc/availability`'s argv: `<pm> run
                          <script>` with the script name from a closed list, or a fixed vector.
                          Never a shell, and never anything the user typed (`19` §C4) */
    /* …and a FIFTH, added when DV-11 was judged (PM · 2026-09-10 · pipe shell):
         term/session  — WBS-25 · `15` TD-01's Primary Action. This is the ONE place in the
                         product with a shell, and the one place where what runs is what the
                         USER typed. `19` §C4 makes that explicit rather than hiding it: the
                         product does not filter and does not pretend to. Keeping it in a file
                         of its own is what makes "where can a typed string reach a shell?"
                         answerable in one place — everything else spawns an argv. */
    'child_process':  ['app/main/claude-detect.js', 'app/main/claude/session.js',
                       'app/main/evidence/git.js', 'app/main/qc/run.js',
                       'app/main/term/session.js'],
    'execFile':       ['app/main/claude-detect.js', 'app/main/evidence/git.js'],
    'spawn(':         ['app/main/claude/session.js', 'app/main/qc/run.js',
                       'app/main/term/session.js'],
    /* the ONLY synchronous spawn in the product: Windows cancel, which has no process group
       to signal and so must call `taskkill /T` on the child's own pid */
    'spawnSync(':     ['app/main/claude/session.js'],
    'taskkill':       ['app/main/claude/session.js'],
  };
  // never, anywhere: nothing in the built packages needs these, and each is a real hazard
  const NEVER = [
    'node-pty', 'openExternal', 'execSync', 'eval(', 'new Function',
    'better-sqlite3', 'nodeIntegration: true', 'webSecurity: false',
  ];

  for (const f of files) {
    // strip comments — a comment naming a capability is documentation, not code
    const src = stripComments(read(f));
    for (const b of NEVER) assert.ok(!src.includes(b), `${f} uses a forbidden capability: ${b}`);
    for (const [tok, owners] of Object.entries(OWNER)) {
      if (src.includes(tok)) {
        assert.ok(owners.includes(f), `${tok} appears in ${f}; only ${owners.join(' / ')} may have it`);
      }
    }
  }

  // The renderer is not privileged: no node built-in reaches it, and it never touches ipcRenderer.
  for (const f of files.filter((f) => f.startsWith(path.join('app', 'renderer')))) {
    const src = stripComments(read(f));
    for (const b of ['require(', 'ipcRenderer', 'process.', "node:"]) {
      assert.ok(!src.includes(b), `renderer file ${f} reaches outside its sandbox: ${b}`);
    }

    /* Nothing is ever PARSED AS MARKUP. The renderer displays a raw diff, a model's sentences
       and a project's file names — all of it content from the user's own machine — and a
       mutation swapping one `textContent` for `innerHTML` passed the entire unit suite AND the
       e2e, because the fixture patches happened to contain no markup. A comment said the patch
       is never parsed as markup; nothing enforced it.

       Clearing a container is the one allowed use, and it is spelled exactly `innerHTML = ''`. */
    for (const m of src.matchAll(/\.(innerHTML|outerHTML)\s*=\s*([^;\n]*)/g)) {
      assert.strictEqual(m[2].trim(), "''",
        `renderer file ${f} assigns ${m[1]} something other than '' — that parses content as markup`);
    }
    for (const b of ['insertAdjacentHTML', 'document.write', 'createContextualFragment']) {
      assert.ok(!src.includes(b), `renderer file ${f} parses markup via ${b}`);
    }
  }

  // Packages NOT yet built must not have a half-implementation hiding in the tree.
  const all = files.map((f) => read(f)).join('\n');
  /* `raw_diff` landed with WBS-17/27; `change_group` with WBS-26. `code_block` is still not
     persisted — blocks are derived on demand from the stored patch, which is deterministic and
     costs nothing to recompute (CANON_FINDINGS CF-10). The day a block needs an id that
     survives a restart, this line is what says so out loud. */
  for (const notYet of ['code_block']) {
    assert.ok(!all.includes(notYet), `a later WBS package leaked into app/: ${notYet}`);
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

test('no copy block declares the same key twice', () => {
  /* A duplicate key in an object literal is silent: the LAST one wins and the first is dead.
   * Seven of these had accumulated — `brief.failTitle`, `gap.readerCopied` and five more — and
   * they happened to hold identical values, so nothing was visibly wrong. The next one will not
   * be identical, and the copy that loses is the one a reviewer read. */
  const src = read('app/renderer/copy.js');
  const blocks = [];
  for (const m of src.matchAll(/^  ([A-Za-z_]\w*): \{/gm)) blocks.push({ name: m[1], start: m.index });
  assert.ok(blocks.length >= 8, `expected the copy blocks, found ${blocks.length}`);
  blocks.forEach((b, i) => { b.end = i + 1 < blocks.length ? blocks[i + 1].start : src.length; });

  const dupes = [];
  for (const b of blocks) {
    const seen = new Set();
    for (const m of src.slice(b.start, b.end).matchAll(/^    ([A-Za-z_]\w*)\s*:/gm)) {
      if (seen.has(m[1])) dupes.push(`${b.name}.${m[1]}`);
      seen.add(m[1]);
    }
  }
  assert.deepStrictEqual(dupes, [], `a copy key is declared twice in one block: ${dupes.join(', ')}`);
});

test('every copy key the renderer NAMES actually exists', () => {
  /* The provenance test above checks that every Korean STRING came from Canon 18. It cannot see
   * the opposite failure: a screen naming a key `copy.js` does not have. That renders `undefined`
   * — or, for a button, an empty label nobody can click.
   *
   * Both happened and both shipped. `sc03.js`'s 원하던 결과가 아니에요 panel and `sc04.js`'s
   * 사용 불가 / 원문 복사 were committed against keys that did not exist; so were the Brief's
   * `failTitle` and `failNote`, which meant the 프로젝트를 읽지 못했어요 band drew a blank title.
   * A string test cannot catch a missing string. */
  const copySrc = read('app/renderer/copy.js');
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.js$/.test(e.name) && e.name !== 'copy.js') files.push(rel);
    }
  })(path.join('app', 'renderer'));
  assert.ok(files.length >= 6, `expected the renderer tree, found ${files.length}`);

  /* The blocks of `copy.js`, brace-matched, so a key is looked up in ITS OWN block. */
  const block = (name) => {
    const at = copySrc.indexOf(`  ${name}: {`);
    if (at === -1) return null;
    let depth = 0;
    for (let i = copySrc.indexOf('{', at); i < copySrc.length; i++) {
      if (copySrc[i] === '{') depth += 1;
      else if (copySrc[i] === '}' && --depth === 0) return copySrc.slice(at, i + 1);
    }
    return null;
  };

  const missing = [];
  for (const f of files) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(/\bC\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
      const [, group, key] = m;
      const b = block(group);
      if (!b) { missing.push(`${f}: C.${group} (no such block)`); continue; }
      /* `q[0]` style indexing and nested objects both appear, so the test is that the KEY is
       * declared somewhere in the block — not where, and not what it holds. */
      if (!new RegExp(`(^|[{\\s,])${key}\\s*:`, 'm').test(b)) missing.push(`${f}: C.${group}.${key}`);
    }
  }
  assert.deepStrictEqual(missing, [], `the renderer names copy keys that do not exist:\n  ${missing.join('\n  ')}`);
});

test('every copy key is used by a screen — dead copy goes stale and then lies', () => {
  /* `copy.js`'s own header: *Keys not yet needed by a built screen are deliberately absent.*
   * Two keys had outlived that rule, and both had become FALSE:
   *
   *   gap.notBuiltPaths     '여기서 이어서 할 수 있는 것은 아직 만드는 중이에요.'
   *   gap.notBuiltTerminal  '터미널은 아직 없어요.'
   *
   * They were written when WBS-04, 22 and 25 had not shipped. All three have. A sentence that
   * says a path does not exist, still sitting in the dictionary after it does, is one careless
   * render away from being on screen — and `15` asks for those paths as BUTTONS.
   *
   * So: a key nobody renders is not allowed to sit here. The check is what keeps the "deliberately
   * absent" rule true instead of aspirational.
   */
  const src = read('app/renderer/copy.js');

  /* Every renderer file that could reference a key. */
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(R, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.js$/.test(e.name) && rel !== path.join('app', 'renderer', 'copy.js')) files.push(rel);
    }
  })(path.join('app', 'renderer'));
  /* Comments stripped. A key NAMED in a comment is not a key a screen renders, and leaving them
   * in made `history.more` look used because some other file's prose mentioned the word. */
  const uses = files
    .map((f) => read(f))
    .join('\n');

  /* Parse the leaf keys with their parent path. Indentation gives the nesting — this file is
   * one object literal formatted consistently, and a parser is not worth writing for it. */
  const stack = [];
  const leaves = [];
  for (const line of src.split('\n')) {
    const open = /^(\s+)([A-Za-z_$][\w$]*):\s*\{\s*$/.exec(line);
    if (open) { stack[open[1].length] = open[2]; for (const k of Object.keys(stack)) if (+k > open[1].length) delete stack[k]; continue; }
    const leaf = /^(\s+)([A-Za-z_$][\w$]*):\s*(?!\{)/.exec(line);
    if (!leaf) continue;
    const depth = leaf[1].length;
    const parents = Object.keys(stack).map(Number).filter((d) => d < depth).sort((a, b) => a - b).map((d) => stack[d]);
    leaves.push({ parent: parents.at(-1) ?? null, key: leaf[2] });
  }
  assert.ok(leaves.length > 100, `only ${leaves.length} copy keys parsed — the parser lost the file`);

  /* A parent read with a computed index (`C.orient[…]`, `C.gap.signal[…]`) uses ALL its leaves;
   * naming them individually would be a list to forget to update. */
  const dynamicParents = new Set(
    [...uses.matchAll(/C(?:\.[A-Za-z_$][\w$]*)*\.([A-Za-z_$][\w$]*)\[/g)].map((m) => m[1]));

  /* PENDING — `15` elements `18` has copy for and no screen draws yet.
   *
   * This is a to-do list, not an exemption: every entry is a state or a control `15` names, and
   * each one leaves. It is written down here rather than left implicit so the guard stays live
   * while the backlog shrinks — an allow-list nobody can add to without saying why.
   *
   * A key that is DELETED rather than rendered must be justified in the batch report; two were
   * (gap.notBuiltPaths · gap.notBuiltTerminal, both of which had become false). */
  const PENDING = new Set([
    /* `15` SC-03 liveness line: `마지막 관측: 파일 수정 · 12초 전`.
     *
     * DECIDED, not pending. A relative time is only true while it keeps refreshing, and the
     * only push that could refresh it is `watchQuiet`'s 15 s tick — so `12초 전` would be shown
     * when it had been 27. `17` M-06 asks for a second-by-second tick; a per-second redraw with
     * no signal behind it is the thing this product refuses everywhere else, and it would buy a
     * fact the wall-clock timestamp already states exactly and never gets wrong.
     *
     * The duration IS on screen where it carries a decision: `18` `work.nosignalTitle` —
     * 2분 동안 새 활동이 보이지 않아요 — and that panel is refreshed by the tick that judges it.
     * See BATCH-22. */
    'work.ago',
    /* DV-11 was judged (PM · 2026-09-10 · pipe shell) and three of these four are now rendered
     * by TD-01's shell line — 지금 안 됨 is a shell that failed to start, which the product can
     * finally enter. `term.mock` is the ONE that stays: it names the MOCK shell, and the mock
     * was the option NOT chosen. It is kept rather than deleted because `18` carries it and
     * this file mirrors `18`; rendering it would be drawing a state the product cannot enter. */
    'term.mock',
    /* `출력 전체 보기` needs a full output to show. `20` bounds `quick_command_run.output_head`
     * at 64 KB and puts the rest behind `output_ref`; nothing writes one yet, and what the head
     * keeps is a genuine PREFIX with the rest gone (see `qc/run.js`). A button that opened the
     * same 64 KB again would be lying about what it offers. */
    'qc.full',
  ]);

  const unused = leaves
    .filter(({ parent, key }) => !dynamicParents.has(parent) && !new RegExp(`\\b${key}\\b`).test(uses))
    .map((u) => `${u.parent ?? 'C'}.${u.key}`)
    .filter((k) => !PENDING.has(k));
  assert.deepStrictEqual(unused, [],
    'copy keys no screen renders — render them, or delete them and say why in the batch report');

  /* …and the PENDING list may not outlive what it names: an entry that HAS been rendered is a
   * stale exemption, and a stale exemption is how an allow-list turns permanent. */
  const stale = [...PENDING].filter((k) => {
    const key = k.split('.').at(-1);
    return new RegExp(`\\b${key}\\b`).test(uses);
  });
  assert.deepStrictEqual(stale, [], 'PENDING names copy that is now rendered — remove the entry');
});

test('no test reads product source without going through tests/src.js', () => {
  /* THREE times in this run a check was fooled by a file describing what it does not do:
   * `presence.js`'s comment naming `setInterval`, `nextaction.js` explaining what a declared
   * Step is, `main.js`'s comment naming `app.getPath('userData')`. And once the other way —
   * `history.more` looked used because some other file's prose contained the word.
   *
   * The fix cannot be "remember to strip". `tests/src.js` has `code()` (stripped) and `text()`
   * (raw, for the checks whose subject IS what the file says), and this makes going around it
   * a test failure rather than a habit.
   */
  const testFiles = fs.readdirSync(path.join(R, 'tests'))
    .filter((f) => f.endsWith('.test.js'));
  assert.ok(testFiles.length >= 10, `only ${testFiles.length} test files found`);

  const offenders = [];
  for (const f of testFiles) {
    for (const line of raw(path.join('tests', f)).split('\n')) {
      /* A read of something under `app/` — the product. Fixtures, temp directories and this
       * repository's own docs are not what the rule is about. */
      /* Only reads that produce TEXT. A byte-for-byte comparison against Canon's own
       * `schema.sql` is not a source scan and must not be decoded at all — stripping comments
       * out of it would defeat the comparison. */
      if (!/readFileSync\s*\([^)]*['"`]app\//.test(line)) continue;
      if (!/utf8/.test(line)) continue;
      offenders.push(`${f}: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    'read product source with `code()` from tests/src.js — or `text()`, and say why');

  /* …and the helper is the real thing, not a re-export of readFileSync: a `code()` that did
   * not strip would satisfy every line above while changing nothing. */
  const { code, text } = require(path.join(R, 'tests', 'src.js'));
  const withComment = text('app/renderer/presence.js');
  assert.ok(withComment.includes('setInterval'), 'presence.js no longer names setInterval anywhere');
  assert.ok(!code('app/renderer/presence.js').includes('setInterval'),
    'code() does not strip comments — every check built on it is reading prose');
});

test('the suite cannot hang — every test has a deadline', () => {
  /* MEASURED during a mutation sweep: a mutant left `await r.done` waiting forever and the run
   * sat there. `node --test` has NO default per-test timeout, so a hang is not a failure — it
   * is a CI job that never reports, and the diagnosis is "it was slow" rather than "this test
   * did not finish".
   *
   * This repository has already been burned once by a suite that failed in ways nobody could
   * read (see `tests/tmp.js`), and the lesson was the same: make the failure legible. */
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:unit'], /--test-timeout=\d+/,
    'the unit suite has no per-test deadline — a hung test hangs the run');
  const ms = Number(/--test-timeout=(\d+)/.exec(pkg.scripts['test:unit'])[1]);
  assert.ok(ms >= 20_000 && ms <= 300_000, `the deadline is ${ms} ms — too tight to be safe, or too loose to help`);
});
