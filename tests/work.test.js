/* WBS-08 evidence basis · WBS-10 session launch · WBS-11 stream → state reducer.
 *
 * The reducer is driven by a REAL recorded stream, not by a hand-written imitation of one:
 * `tests/fixtures/stream-permission-denied.ndjson`. The evidence tests build throwaway git
 * repositories under the OS temp directory and assert the user's repository is byte-identical
 * afterwards — `07` §1 is the rule the whole mechanism exists to keep.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { code: srcOf } = require(path.join(__dirname, 'src.js'));

/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const G = require(path.join(R, 'app/main/evidence/git.js'));
const M = require(path.join(R, 'app/main/evidence/manifest.js'));
const { ledger, ledgerDiff, isSecretName, isExcludedPath, pathspec } = require(path.join(R, 'app/main/evidence/exclude.js'));
const { toSignal, reduce, replay, initial, openPermission, openPermissions, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
const { allowSpec, grantedSignal, run, stop } = require(path.join(R, 'app/main/claude/session.js'));

const MARK = 'JUQODE_SYNTHETIC_SECRET';   // synthetic, clearly labelled; never a real credential

function repo(files, { commit = true, gitignore = 'node_modules/\n*.log\n' } = {}) {
  const dir = tempDir('juqode-ev-');
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  if (gitignore !== null) fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'gc.auto', '0');
  if (commit) { g('add', '-A', '.'); g('commit', '-qm', 'baseline'); }
  return { dir, git: g, store: tempDir('juqode-store-') };
}

/** Everything about the user's repository that a capture must not disturb.
 *
 * `.git/index` is hashed FIRST, before any git command runs. The earlier version ran a plain
 * `git status` inside the fingerprint — which stat-refreshes and REWRITES the index — and only
 * then hashed the tree, so both sides came back normalised to the same post-refresh bytes and
 * an index rewrite was invisible to it. That is the same "the subject cannot differ" shape that
 * hid the secret-exclusion regression a batch ago, in the one test that guards `07` §1.
 * Every git call here also carries `--no-optional-locks`, so the measurement cannot be the
 * thing that causes the damage it is looking for. */
const fingerprint = (dir) => execFileSync('bash', ['-c',
  `sha256sum .git/index 2>/dev/null || echo "no-index"; ` +
  `git --no-optional-locks ls-files -s; git --no-optional-locks diff --cached; ` +
  `git --no-optional-locks status --porcelain=v2; ` +
  `find . -type f -not -path './.git/objects/*' -print0 | xargs -0 sha256sum | sort`,
], { cwd: dir, encoding: 'utf8' });

/* ───────────────────────── WBS-08 · the corrected contract ───────────────────────── */

test('a capture leaves the user repository byte-identical', () => {
  const { dir, store } = repo({ 'src/a.ts': 'export const a = 1;\n', 'README.md': '# r\n' });
  /* partial staging, an untracked file: the states `07` §1 says must survive */
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\nexport const staged = 2;\n');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\nexport const staged = 2;\nexport const unstaged = 3;\n');
  fs.writeFileSync(path.join(dir, 'src/new.ts'), 'export const untracked = 1;\n');

  const before = fingerprint(dir);
  const basis = G.capture(dir, store, 'before');
  assert.match(basis.ref, /^[0-9a-f]{40}$/, 'no tree was written');
  assert.strictEqual(fingerprint(dir), before,
    'the capture changed the user index or worktree — 07 §1 forbids it absolutely');
});

test('objects go to a JuQode directory, never into the user repository', () => {
  const { dir, store } = repo({ 'a.txt': '1\n' });
  const objectsBefore = execFileSync('bash', ['-c', 'find .git/objects -type f | wc -l'], { cwd: dir, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'brand new content that has never been hashed\n');
  G.capture(dir, store, 'before');
  const objectsAfter = execFileSync('bash', ['-c', 'find .git/objects -type f | wc -l'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.strictEqual(objectsAfter, objectsBefore, 'JuQode wrote objects into the user repository');
  /* `existsSync` on the directory cannot fail — capture mkdirs it unconditionally. What can
   * differ is whether anything was WRITTEN there. */
  const written = execFileSync('bash', ['-c', 'find objects -type f | wc -l'], { cwd: store, encoding: 'utf8' }).trim();
  assert.notStrictEqual(written, '0', 'the JuQode object store received nothing — capture wrote elsewhere');
});

test('a secret the user ALREADY COMMITTED is kept out of the basis tree', () => {
  /* A secret the user COMMITTED is the hard case: it is not ignored, not untracked, and a
   * pathspec that only filters what `add` considers would leave it in the tree through the
   * index. The basis now starts from an EMPTY index (see `git.js` — a copied one carries a
   * stat cache that intermittently misses a real change), so the pathspec is what keeps it out
   * here. The assertions below are about the RESULT, not about which step produced it. */
  const { dir, store } = repo({
    'src/a.ts': 'export const a = 1;\n',
    '.env': `${MARK}_ENV=aaa\n`,
    '.env.production': `${MARK}_PROD=bbb\n`,
    'keys/server.pem': `${MARK}_PEM\n`,
    'src/nested/local.key': `${MARK}_NESTED\n`,
  });   // .gitignore does NOT list them — that is the point

  const basis = G.capture(dir, store, 'before');
  const paths = G.treePaths(dir, store, basis.ref);
  assert.deepStrictEqual(paths.filter((p) => isSecretName(path.basename(p))), [],
    `the basis tree contains secret paths: ${paths}`);
  assert.ok(paths.includes('src/a.ts'), 'the basis lost the actual source files');

  /* And no object JuQode wrote carries the bytes. */
  const objs = execFileSync('git', ['--no-optional-locks', 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects') } })
    .split('\n').filter(Boolean);
  let leaked = 0;
  for (const o of objs) {
    const body = execFileSync('bash', ['-c', `git cat-file -p ${o} 2>/dev/null || true`], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(dir, '.git/objects') },
    });
    if (body.includes(MARK)) leaked += 1;
  }
  assert.strictEqual(leaked, 0, `${leaked} object(s) JuQode wrote contain the synthetic secret`);
});

test('an UNTRACKED secret is never hashed into the JuQode object store', () => {
  /* The drop step covers a secret that was already committed. The PATHSPEC's job is the other
   * half — an untracked secret must never be staged, because staging it writes its plaintext
   * blob into JuQode's own object store, where the basis tree not referencing it is no comfort
   * at all. Every secret in the test above was already committed, so nothing exercised this. */
  const { dir, store } = repo({ 'a.ts': '1\n' });
  fs.writeFileSync(path.join(dir, '.env'), `${MARK}=untracked-never-committed\n`);
  fs.mkdirSync(path.join(dir, 'src/deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/deep/x.pem'), `${MARK}=nested-untracked\n`);

  const basis = G.capture(dir, store, 'before');
  assert.deepStrictEqual(basis.droppedFromIndex, [],
    'an untracked secret was STAGED — the pathspec let its blob into the object store');
  const paths = G.treePaths(dir, store, basis.ref);
  assert.deepStrictEqual(paths.filter((f) => isSecretName(path.basename(f))), [], `basis tree: ${paths}`);
  assert.ok(paths.includes('a.ts'), 'the basis lost the source file');

  const objs = execFileSync('git', ['--no-optional-locks', 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects') } })
    .split('\n').filter(Boolean);
  for (const o of objs) {
    const body = execFileSync('bash', ['-c', `git cat-file -p ${o} 2>/dev/null || true`], {
      cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(dir, '.git/objects') },
    });
    assert.ok(!body.includes(MARK), `JuQode wrote the secret's plaintext into its own store (object ${o})`);
  }
});

test('a secret name git has to quote is still excluded', () => {
  /* `git ls-files` C-quotes any path that is not plain ASCII, so a Korean secret filename came
   * back as `"\\355\\202\\244.pem"`: the basename ended in a quote, the name check missed it, and
   * the blob stayed in the basis tree. For a Korean-market product that IS the ordinary name. */
  const { dir, store } = repo({ 'ok.txt': 'ok\n' });
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  for (const name of ['키.pem', 'клюц.key', 'we ird.pem']) {
    fs.writeFileSync(path.join(dir, name), `${MARK}\n`);
    g('add', '-f', name);
  }
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'secrets');

  const basis = G.capture(dir, store, 'before');
  const paths = G.treePaths(dir, store, basis.ref);
  assert.ok(!paths.some((f) => /\.(pem|key)/i.test(f)), `a quoted secret name reached the basis tree: ${paths}`);
  assert.ok(paths.includes('ok.txt'), 'the basis lost the ordinary file, so it proves nothing');
});

test('a DIRECTORY named .env is excluded, contents and all', () => {
  /* `.env/config` has the basename `config`, and a git glob pathspec does not cross `/`, so
   * neither the name check nor the pathspec matched it. A secret directory is a secret. */
  const { dir, store } = repo({ 'ok.txt': 'ok\n' });
  fs.mkdirSync(path.join(dir, '.env'));
  fs.writeFileSync(path.join(dir, '.env/config'), `${MARK}\n`);
  execFileSync('git', ['add', '-f', '.env/config'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'envdir'], { cwd: dir });

  const basis = G.capture(dir, store, 'before');
  assert.ok(!G.treePaths(dir, store, basis.ref).includes('.env/config'), '.env/ contents reached the basis tree');
  assert.ok(basis.excluded.some((e) => e.path === '.env/config'), '.env/ contents are in no ledger either');
});

test('a case-variant untracked secret is never hashed at all', () => {
  /* The name check is case-INsensitive; a git pathspec is case-SENSITIVE by default. So an
   * untracked `.ENV` passed the pathspec, git hashed it and wrote the plaintext blob into
   * JuQode's own store, and only then did the drop step clean the tree. */
  const { dir, store } = repo({ 'ok.txt': 'ok\n' });
  fs.writeFileSync(path.join(dir, '.ENV'), `${MARK}_UPPER\n`);
  fs.writeFileSync(path.join(dir, 'server.KEY'), `${MARK}_KEY\n`);

  const basis = G.capture(dir, store, 'before');
  assert.deepStrictEqual(basis.droppedFromIndex, [], 'a case-variant secret was staged — its blob is in the store');
  const objs = execFileSync('git', ['--no-optional-locks', 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects') } })
    .split('\n').filter(Boolean);
  for (const o of objs) {
    const body = execFileSync('bash', ['-c', `git cat-file -p ${o} 2>/dev/null || true`], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(dir, '.git/objects') },
    });
    assert.ok(!body.includes(MARK), 'the plaintext of a case-variant secret is in the JuQode store');
  }
});

test('a split index does not leave a file behind in the user repository', () => {
  /* `GIT_INDEX_FILE` redirects the index, but the SHARED half is written to `$GIT_DIR`. Every
   * capture left a new `sharedindex.*` there — a write into the user's repository. */
  const { dir, store } = repo({ 'a.txt': '1\n' });
  execFileSync('git', ['config', 'core.splitIndex', 'true'], { cwd: dir });
  const list = () => fs.readdirSync(path.join(dir, '.git')).sort();
  const before = list();
  G.capture(dir, store, 'before');
  G.capture(dir, store, 'after');
  assert.deepStrictEqual(list(), before, `capture added ${list().filter((f) => !before.includes(f))} to the user's .git`);
});

test('a change to a gitignored file is still reportable', () => {
  /* D-126a's whole purpose: what the evidence does not cover is still ACCOUNTED FOR. A
   * `.gitignore`d path is outside the tree diff by design, so if it is outside the ledger too
   * the change is invisible in every channel — the silence the correction was written to end. */
  const { dir, store } = repo({ 'a.txt': '1\n', 'build/out.js': 'v1\n' }, { gitignore: 'build/\n' });
  const before = G.capture(dir, store, 'before');
  fs.writeFileSync(path.join(dir, 'build/out.js'), 'v2-CHANGED\n');
  const after = G.capture(dir, store, 'after');

  assert.strictEqual(before.ref, after.ref, 'an ignored file is not in the tree — that part is by design');
  assert.deepStrictEqual(ledgerDiff(before.excluded, after.excluded), [{ path: 'build/out.js', change: 'modified' }],
    'the change is in neither the diff nor the ledger, so nothing can report it');
});

test('a nested repository is excluded AND reported', () => {
  const { dir, store } = repo({ 'a.txt': '1\n' });
  fs.mkdirSync(path.join(dir, 'vendor/inner'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor/inner/i.txt'), 'v1\n');
  /* Deliberately WITHOUT a commit: `add -A` fails outright on that shape unless the nested
   * repository is excluded, so a basis could not be taken at all. */
  execFileSync('git', ['init', '-q', '.'], { cwd: path.join(dir, 'vendor/inner') });

  /* FOUND BY MUTATION: the walk's `.git` skip was only checked by a file at the nested repo's
   * ROOT, where the skip cannot matter — it decides which SUBDIRECTORIES are entered. So a
   * file one level down is here too, and it is the one that fails if the skip is inverted. */
  fs.mkdirSync(path.join(dir, 'vendor/inner/src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor/inner/src/deep.txt'), 'd1\n');

  const before = G.capture(dir, store, 'before');
  assert.deepStrictEqual(before.nestedRepos, ['vendor/inner'], 'D-126 requires a nested repo to be reported');
  /* …and the ledger accounts for the nested repo's OWN files, not its git internals. A ledger
   * full of `.git/objects` entries would report "changes" every time git touched itself. */
  const paths = before.excluded.map((e) => e.path);
  assert.ok(paths.includes('vendor/inner/src/deep.txt'),
    `a file below the nested repo's root is not accounted for: ${paths.join(' · ')}`);
  assert.deepStrictEqual(paths.filter((p) => p.includes('/.git/')), [],
    'the nested-repo ledger carries git internals');

  fs.writeFileSync(path.join(dir, 'vendor/inner/i.txt'), 'v2-CHANGED\n');
  fs.writeFileSync(path.join(dir, 'vendor/inner/src/deep.txt'), 'd2-CHANGED\n');
  const after = G.capture(dir, store, 'after');
  assert.deepStrictEqual(ledgerDiff(before.excluded, after.excluded),
    [{ path: 'vendor/inner/i.txt', change: 'modified' },
     { path: 'vendor/inner/src/deep.txt', change: 'modified' }],
    'a change inside a nested repository was invisible in every channel');
});

test('an unreadable FILE is refused, not thrown', { skip: process.getuid?.() === 0 && 'root' }, () => {
  /* `firstUnreadable` used to check directories only, so `capture()` threw an uncaught error
   * from git instead of producing 확립 불가 with a reason. */
  const { dir } = repo({ 'a.txt': '1\n', 'secretish.txt': '2\n' });
  fs.chmodSync(path.join(dir, 'secretish.txt'), 0o000);
  try {
    assert.strictEqual(G.refusal(dir)?.reason, G.REFUSE.UNREADABLE);
  } finally { fs.chmodSync(path.join(dir, 'secretish.txt'), 0o600); }
});

test('an unreadable directory under node_modules is refused too', { skip: process.getuid?.() === 0 && 'root' }, () => {
  /* It was skipped by the check, and `add -A` only warns — so the basis silently shrank. */
  const { dir } = repo({ 'a.txt': '1\n', 'node_modules/pkg/priv/x.js': '1\n' }, { gitignore: null });
  fs.chmodSync(path.join(dir, 'node_modules/pkg/priv'), 0o000);
  try {
    assert.strictEqual(G.refusal(dir)?.reason, G.REFUSE.UNREADABLE);
  } finally { fs.chmodSync(path.join(dir, 'node_modules/pkg/priv'), 0o700); }
});

/* ── `toSignal`: the CLI's event shapes → `20`'s signal vocabulary ────────────────────────── */

test('every event shape maps to the signal kind Canon names for it', () => {
  /* FOUND BY MUTATION: `system/status` had no coverage at all — inverting either half of
   * `t === 'system' && st === 'status'` passed the whole suite. The recorded fixture does not
   * contain one, and a recording is the only other place this mapping was exercised, so the
   * kinds the fixture happens not to carry were mapped by nobody.
   *
   * Written down as a table rather than derived: a derived expectation tracks whatever the
   * function does and cannot fail, which is the shape of test this run keeps finding. */
  const cases = [
    [{ type: 'system', subtype: 'init', session_id: 's1', cwd: '/p', claude_code_version: '9.9' },
     KIND.SESSION_START, { sessionId: 's1', cwd: '/p', version: '9.9' }],
    [{ type: 'system', subtype: 'status', message: '읽는 중' }, KIND.STATUS, { text: '읽는 중' }],
    [{ type: 'system', subtype: 'status' }, KIND.STATUS, { text: null }],
    [{ type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 't1', message: 'no' },
     KIND.PERMISSION_DENIED, { tool: 'Edit', toolUseId: 't1', message: 'no' }],
    [{ type: 'rate_limit_event', rate_limit_info: { retryAfter: 30 } }, KIND.RATE_LIMIT, { retryAfter: 30 }],
    [{ type: 'rate_limit_event' }, KIND.RATE_LIMIT, null],
  ];
  for (const [event, kind, payload] of cases) {
    const sig = toSignal(event);
    assert.strictEqual(sig.kind, kind, `${JSON.stringify(event)} became ${sig.kind}`);
    assert.deepStrictEqual(sig.payload, payload, `${kind} carried the wrong payload`);
  }

  /* A `system` subtype nobody wrote down is `raw` — an outcome, never a guess. `15` still shows
   * it as 그 밖의 신호, because hiding an observation is the one thing the screen may not do. */
  const unknown = toSignal({ type: 'system', subtype: 'something_new' });
  assert.strictEqual(unknown.kind, KIND.RAW);
  assert.deepStrictEqual(unknown.payload, { type: 'system', subtype: 'something_new' });
  /* …and so is an event with no type at all, and a non-event. */
  for (const junk of [{}, null, undefined, { subtype: 'status' }]) {
    assert.strictEqual(toSignal(junk).kind, KIND.RAW, `${JSON.stringify(junk)} was classified`);
  }

  /* Every kind this function can produce is one `20` declares. */
  const produced = new Set([...cases.map(([, k]) => k), KIND.RAW, KIND.TOOL_USE, KIND.TOOL_RESULT, KIND.FINISH]);
  for (const k of produced) assert.ok(Object.values(KIND).includes(k), `${k} is not in the signal vocabulary`);
});

test('an assistant or user message with no blocks is raw, not a lost signal', () => {
  /* The two branches that fall through to `raw` after looking for blocks. Neither was covered:
   * the recording's assistant messages all carry a `tool_use`. */
  const talk = toSignal({ type: 'assistant', message: { content: [{ type: 'text', text: '했어요' }] } });
  assert.strictEqual(talk.kind, KIND.RAW);
  assert.strictEqual(talk.payload.text, '했어요', 'the model\'s words were dropped');

  const empty = toSignal({ type: 'user', message: { content: [] } });
  assert.strictEqual(empty.kind, KIND.RAW);
  assert.strictEqual(empty.payload, null);

  /* …and a tool_use still wins over text in the same message. */
  const mixed = toSignal({ type: 'assistant', message: { content: [
    { type: 'text', text: 'ignore me' },
    { type: 'tool_use', id: 'u1', name: 'Edit', input: { file_path: 'a.ts' } }] } });
  assert.strictEqual(mixed.kind, KIND.TOOL_USE);
  assert.strictEqual(mixed.payload.tool, 'Edit');
  assert.strictEqual(mixed.payload.all.length, 1);
});

test('an unreadable ROOT is refused — and the refusal is truthy', { skip: process.getuid?.() === 0 && 'root' }, () => {
  /* FOUND BY MUTATION. `firstUnreadable` answers `rel || '.'`, and the root's `rel` is the
   * EMPTY STRING — so without the `|| '.'` the function returns `''`, `refusal()` reads it as
   * falsy, and a project whose root cannot be listed at all is allowed to start a Work. The
   * basis would then be built by `add -A`, which only WARNS about what it cannot read.
   *
   * Nothing exercised the root case: every other test made an unreadable file or subdirectory,
   * where `rel` is non-empty and the fallback never matters. */
  const { dir } = repo({ 'a.txt': '1\n' });
  /* Execute but not READ: `git --version` can still resolve the cwd (otherwise the refusal
   * would be `git-unavailable` and this path would never be reached), while `readdirSync`
   * throws — which is exactly the shape `firstUnreadable` has to answer for. */
  fs.chmodSync(dir, 0o111);
  try {
    const r = G.refusal(dir);
    assert.ok(r, 'a project whose root cannot be listed was allowed to start a Work');
    assert.strictEqual(r.reason, G.REFUSE.UNREADABLE);
    /* The detail is what the card shows. `''` would render as an empty reason. */
    assert.ok(r.detail, 'the refusal names nothing');
  } finally { fs.chmodSync(dir, 0o700); }
});

test('the size cap measures the WORKING TREE, and not `.git`', () => {
  /* FOUND BY MUTATION. `measure()` skips `.git` — the repository's own object store is not the
   * user's project, and counting it would refuse projects for having history. Nothing checked
   * WHICH tree it walks, so inverting the skip (measure `.git` only) passed the whole suite:
   * `19` §E's size ceiling would have stopped firing, silently, on every real project. */
  /* The big file is in a SUBDIRECTORY, and that is the whole point: the `.git` skip decides
   * which directories are ENTERED, so a file at the root is counted either way and a test that
   * put it there proved nothing. (Measured — the first version of this test did exactly that,
   * and the mutant survived it.) */
  const big = 'x'.repeat(200_000);
  const { dir } = repo({ 'a.txt': '1\n', 'assets/big.bin': big });

  /* Over the cap because of the working tree. */
  const over = G.refusal(dir, { maxBytes: 100_000 });
  assert.ok(over, 'a project past the size cap was not refused');
  assert.strictEqual(over.reason, G.REFUSE.TOO_LARGE);
  assert.ok(Number(over.detail) >= 200_000, `the reported size is ${over.detail}`);

  /* …and generously under it with the same repository, so the number is the tree's and not a
   * constant. `.git` holds the committed copy of that 200 KB file; if `measure` counted it the
   * total here would be far over. */
  assert.strictEqual(G.refusal(dir, { maxBytes: 5_000_000 }), null,
    'the same project was refused under a cap it is comfortably below');
  const gitBytes = (() => {
    let n = 0;
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const c = path.join(d, e.name);
      if (e.isDirectory()) walk(c); else if (e.isFile()) n += fs.statSync(c).size; } };
    walk(path.join(dir, '.git'));
    return n;
  })();
  assert.ok(gitBytes > 0, 'the fixture has no .git to have skipped');
  assert.ok(Number(over.detail) < 200_000 + gitBytes,
    `the measured size ${over.detail} includes .git (${gitBytes} bytes)`);
});

test('an inherited GIT_DIR cannot redirect the basis at another repository', () => {
  const { dir, store } = repo({ 'a.txt': '1\n' });
  const other = repo({ 'other.txt': 'OTHERREPO\n' });
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(other.dir, '.git');
  try {
    const basis = G.capture(dir, store, 'before');
    assert.deepStrictEqual(G.treePaths(dir, store, basis.ref).filter((f) => f === 'other.txt'), [],
      'the basis was taken against an unrelated repository');
  } finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved; }
});

test('after a capture, JuQode\'s own index carries no excluded path', () => {
  /* Two guards were designed for the basis: the `:(exclude)` pathspec, and `rm --cached` on the
   * index. The index is now always EMPTY at the start of a capture (see `git.js`), so the
   * pathspec is the one that actually fires and `rm --cached` currently has nothing to catch —
   * it stays as the wall that closes the moment anything ever seeds that index again.
   *
   * Rather than assert which step ran, this asserts the POST-CONDITION both exist for: nothing
   * excluded is in the index JuQode built, so nothing excluded can reach `write-tree`. */
  const { dir, store } = repo({
    '.env': `${MARK}=x\n`, 'keys/server.pem': `${MARK}\n`, 'a.ts': '1\n',
  });
  assert.ok(pathspec().some((p) => p.includes('.env')), 'the pathspec lost its .env exclusion');

  const basis = G.capture(dir, store, 'before');
  const env = { ...process.env, GIT_INDEX_FILE: path.join(store, 'index.before'),
                GIT_OBJECT_DIRECTORY: path.join(store, 'objects'),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(dir, '.git/objects') };
  const staged = execFileSync('git', ['ls-files', '-z'], { cwd: dir, env, encoding: 'utf8' })
    .split('\0').filter(Boolean);

  assert.deepStrictEqual(staged.filter((f) => isExcludedPath(f)), [],
    `JuQode's index carries an excluded path: ${staged}`);
  assert.ok(staged.includes('a.ts'), 'the index is empty, so this test proves nothing');
  assert.ok(!G.treePaths(dir, store, basis.ref).some((f) => isSecretName(path.basename(f))),
    'a secret reached the basis tree');
});

test('an excluded file that changes is DETECTED, without being read', () => {
  const { dir } = repo({ '.env': `${MARK}=x\n`, 'a.ts': '1\n' });
  const before = ledger(dir);
  assert.ok(before.some((e) => e.path === '.env'), 'the ledger does not cover .env');
  assert.ok(before.every((e) => !('content' in e) && !('sha256' in e)),
    'the ledger carries something other than metadata — a secret could leak through it');

  /* Nanoseconds, not milliseconds. A millisecond ledger passes a test that deliberately waits
   * for the next millisecond, so waiting would remove the discrimination this is for: two
   * writes inside one millisecond is exactly the shape of an automated credential rotation. */
  assert.match(before.find((e) => e.path === '.env').mtimeNs, /^\d{16,}$/,
    'the ledger is not recording nanosecond mtime — a same-millisecond change is invisible');

  /* A SAME-SIZE edit, with no wait. `statSync` without `{ bigint: true }` has no `mtimeNs` at
   * all, so the ledger recorded the string "undefined" and only a size change was detectable. */
  fs.writeFileSync(path.join(dir, '.env'), `${MARK}=y\n`);
  const changed = ledgerDiff(before, ledger(dir));
  assert.deepStrictEqual(changed, [{ path: '.env', change: 'modified' }],
    'a same-size edit to an excluded file went unnoticed');
});

test('ledgerDiff reports a change that only the SIZE shows', () => {
  /* FOUND BY MUTATION: `prev.size !== e.size || prev.mtimeNs !== e.mtimeNs` — the size half
   * could be inverted and every test still passed, because the file tests all change the mtime
   * too and the OR carries them.
   *
   * The two halves are deliberately belt-and-braces (D-126a: the ledger must never MISS a
   * change to something it is not allowed to read), so the redundant one needs its own check.
   * Driven as data, because producing a real size-only change means defeating the filesystem's
   * own timestamping — which would be testing the filesystem, not the ledger. */
  const at = (path, size, mtimeNs) => ({ path, size, mtimeNs });
  assert.deepStrictEqual(
    ledgerDiff([at('.env', 10, '111')], [at('.env', 20, '111')]),
    [{ path: '.env', change: 'modified' }], 'a size change with an unchanged mtime was missed');
  assert.deepStrictEqual(
    ledgerDiff([at('.env', 10, '111')], [at('.env', 10, '222')]),
    [{ path: '.env', change: 'modified' }], 'an mtime change with an unchanged size was missed');
  /* …and nothing is reported when nothing moved. A ledger that cried every time would train
   * the user to ignore it, which is the same failure as silence. */
  assert.deepStrictEqual(ledgerDiff([at('.env', 10, '111')], [at('.env', 10, '111')]), []);
});

test('the ledger never walks into `.git`', () => {
  /* FOUND BY MUTATION: `child === '.git' || child.endsWith('/.git')` could become `&&`, which
   * matches nothing, and the suite passed. `.git` is the repository's own store — it is not
   * the user's project, and an evidence ledger that reported git's internal churn as "an
   * excluded file changed" would say it on every single Work. */
  const { dir } = repo({ '.env': `${MARK}=x\n` });
  fs.mkdirSync(path.join(dir, '.git/juq'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git/juq/leak.pem'), 'not-a-real-key\n');
  fs.mkdirSync(path.join(dir, 'vendor/inner/.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor/inner/.git/deep.pem'), 'not-a-real-key\n');

  const paths = ledger(dir).map((e) => e.path);
  assert.ok(paths.includes('.env'), 'the ledger stopped covering .env');
  assert.deepStrictEqual(paths.filter((p) => p.includes('.git')), [],
    `the ledger walked into a .git directory: ${paths.join(' · ')}`);
});

test('the ledger reports additions and removals too', () => {
  const { dir } = repo({ '.env': `${MARK}=x\n` });
  const before = ledger(dir);
  fs.writeFileSync(path.join(dir, '.env.local'), `${MARK}=new\n`);
  fs.rmSync(path.join(dir, '.env'));
  assert.deepStrictEqual(ledgerDiff(before, ledger(dir)), [
    { path: '.env', change: 'removed' },
    { path: '.env.local', change: 'added' },
  ]);
});

test('a change Work is refused when no honest basis can be built', () => {
  const plain = tempDir('juqode-nogit-');
  assert.strictEqual(G.refusal(plain)?.reason, G.REFUSE.NOT_GIT);

  const { dir } = repo({ 'a.ts': '1\n' });
  assert.strictEqual(G.refusal(dir), null, 'an ordinary repository must not be refused');

  /* mid-merge: the worktree is already a half-state that is not the user's intent */
  fs.writeFileSync(path.join(dir, '.git/MERGE_HEAD'), 'deadbeef\n');
  assert.strictEqual(G.refusal(dir)?.reason, G.REFUSE.MID_MERGE);
  fs.rmSync(path.join(dir, '.git/MERGE_HEAD'));

  /* a size cap, expressed as a refusal rather than a truncated basis */
  assert.strictEqual(G.refusal(dir, { maxBytes: 1 })?.reason, G.REFUSE.TOO_LARGE);
});

test('an unreadable directory is refused BEFORE capture, not warned about during it', {
  skip: process.getuid?.() === 0 && 'root',
}, () => {
  const { dir } = repo({ 'a.ts': '1\n', 'locked/inner.ts': '2\n' });
  fs.chmodSync(path.join(dir, 'locked'), 0o000);
  try {
    /* `add -A` only WARNS about a path it cannot read, so the basis would silently shrink. */
    assert.strictEqual(G.refusal(dir)?.reason, G.REFUSE.UNREADABLE);
  } finally { fs.chmodSync(path.join(dir, 'locked'), 0o700); }
});

test('a SAME-SIZE edit in the same second is still seen', () => {
  /* `19` §E lists racy-git among the shapes q19 did not validate, and this is its exact form:
   * a file whose size does not change, written in the same second the basis was taken. A
   * rotated credential and a one-character fix both look like this. Measured 0 misses in 60
   * consecutive runs on this host; if that ever changes, this test is where it shows. */
  const { dir, store } = repo({ 'a.txt': 'one\n' });
  const before = G.capture(dir, store, 'before');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  const after = G.capture(dir, store, 'after');
  assert.notStrictEqual(after.ref, before.ref,
    'a same-size edit written in the same second was not seen at all');
  assert.match(G.diff(dir, store, before.ref, after.ref), /^\+two$/m);
});

test('the diff between two bases is the work that happened', () => {
  const { dir, store } = repo({ 'a.ts': 'export const a = 1;\n', 'keep.ts': 'export const k = 1;\n' });
  const before = G.capture(dir, store, 'before');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(dir, 'added.ts'), 'export const n = 1;\n');
  const after = G.capture(dir, store, 'after');

  const patch = G.diff(dir, store, before.ref, after.ref);
  const touched = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  assert.deepStrictEqual(touched, ['a.ts', 'added.ts']);
  assert.ok(!patch.includes('keep.ts'), 'an untouched file appears in the diff');
  /* Direction matters and a file list cannot show it: reversed, the same two files appear. */
  assert.match(patch, /^\+export const a = 2;$/m, 'the diff is reversed — “after” is being shown as “before”');
  assert.match(patch, /^-export const a = 1;$/m);
});

test('non-Git projects get a basis too, with the same exclusions', () => {
  const dir = tempDir('juqode-plain-');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), '1\n');
  fs.writeFileSync(path.join(dir, '.env'), `${MARK}=x\n`);
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules/big.js'), 'x'.repeat(100));

  const before = M.capture(dir);
  assert.strictEqual(before.kind, 'hash_manifest');
  assert.deepStrictEqual(before.files.map((f) => f.path), ['src/a.js'],
    'the manifest covered a secret or a vendored tree');
  /* `JSON.stringify(...).includes(MARK)` cannot fail — the manifest stores digests, never
   * bytes — so the assertion that can differ is whether a secret was HASHED at all. */
  assert.ok(!before.files.some((f) => isSecretName(path.basename(f.path))), 'a secret was hashed into the manifest');
  assert.ok(before.excluded.some((e) => e.path === '.env'), 'the manifest basis lost its excluded-path ledger');

  fs.writeFileSync(path.join(dir, 'src/a.js'), '2\n');
  fs.writeFileSync(path.join(dir, 'src/b.js'), '3\n');
  const after = M.capture(dir);
  assert.notStrictEqual(after.ref, before.ref, 'the manifest digest did not move');
  assert.deepStrictEqual(M.diff(before, after), [
    { path: 'src/a.js', change: 'modified' },
    { path: 'src/b.js', change: 'added' },
  ]);

  fs.rmSync(path.join(dir, 'src/a.js'));
  assert.deepStrictEqual(M.diff(after, M.capture(dir)), [{ path: 'src/a.js', change: 'removed' }],
    'a deleted file is a change too');

  assert.strictEqual(M.capture(dir, { maxBytes: 1 })?.error, 'too-large', 'the size cap does nothing');

  /* FOUND BY MUTATION: `bytes > maxBytes` could become `>=` and nothing noticed. The cap is a
   * CEILING — a project that is exactly at it is inside it, and refusing there would refuse a
   * project for measuring precisely what it is allowed to. */
  const total = M.capture(dir).files.reduce((n, f) => n + f.size, 0);
  assert.ok(total > 0, 'the fixture measures nothing');
  assert.ok(!M.capture(dir, { maxBytes: total })?.error,
    `a project of exactly ${total} bytes was refused by a ${total}-byte cap`);
  assert.strictEqual(M.capture(dir, { maxBytes: total - 1 })?.error, 'too-large',
    'one byte over the cap was accepted');
});

test('the non-Git basis refuses an unreadable ROOT, and says which path', { skip: process.getuid?.() === 0 && 'root' }, () => {
  /* FOUND BY MUTATION, and it is the same hole as `git.js`'s — in the OTHER evidence mechanism.
   * `detail: rel || '.'` names the path that could not be read, and the root's `rel` is the
   * empty string. Without the fallback the refusal card would name nothing.
   *
   * Every existing manifest test made a readable tree, so the `catch` around `readdirSync` was
   * never reached at all. */
  const dir = tempDir('juqode-manifest-unreadable-');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), '1\n');
  fs.chmodSync(dir, 0o111);
  try {
    const r = M.capture(dir);
    assert.strictEqual(r.error, 'unreadable-path', 'an unreadable root produced a basis');
    assert.strictEqual(r.detail, '.', `the refusal names ${JSON.stringify(r.detail)}`);
    assert.ok(r.code, 'the refusal carries no errno for 자세한 내용 보기');
  } finally { fs.chmodSync(dir, 0o700); }

  /* …and a subdirectory nobody can read is named as itself, not as the root. */
  const dir2 = tempDir('juqode-manifest-unreadable2-');
  fs.mkdirSync(path.join(dir2, 'priv'), { recursive: true });
  fs.writeFileSync(path.join(dir2, 'a.js'), '1\n');
  fs.chmodSync(path.join(dir2, 'priv'), 0o000);
  try {
    const r = M.capture(dir2);
    assert.strictEqual(r.error, 'unreadable-path');
    assert.strictEqual(r.detail, 'priv');
  } finally { fs.chmodSync(path.join(dir2, 'priv'), 0o700); }
});

test('a file nobody can read is reported as UNKNOWN, never as unchanged', () => {
  /* FOUND BY MUTATION: `prev.size !== f.size` inside the unreadable branch could be inverted
   * and nothing noticed — no test ever produced a manifest entry with `unreadable: true`.
   *
   * The branch exists because an unreadable file has `sha256: null` on BOTH sides and
   * `null !== null` is false, so a file that went from 10 bytes to 29 read as unchanged. `19`
   * §E and D-114: what we could not read is 확인 못함, and a size that moved is a change even
   * when the content is not ours to compare. */
  const at = (path, size, extra = {}) => ({ path, size, sha256: null, ...extra });
  const before = { files: [at('x.bin', 10, { unreadable: true })] };
  assert.deepStrictEqual(M.diff(before, { files: [at('x.bin', 29, { unreadable: true })] }),
    [{ path: 'x.bin', change: 'modified', unreadable: true }],
    'an unreadable file that grew was reported as unchanged');
  assert.deepStrictEqual(M.diff(before, { files: [at('x.bin', 10, { unreadable: true })] }),
    [{ path: 'x.bin', change: 'unknown', unreadable: true }],
    'an unreadable file of the same size was settled as unchanged — nobody knows that');
  /* One side unreadable is enough to reach the branch: a file that BECAME unreadable is not
   * evidence that it stayed the same. */
  assert.deepStrictEqual(
    M.diff({ files: [{ path: 'x.bin', size: 10, sha256: 'aa' }] }, { files: [at('x.bin', 10, { unreadable: true })] }),
    [{ path: 'x.bin', change: 'unknown', unreadable: true }]);
});

test('each basis gets its own copied index, so the two phases cannot share one', () => {
  const { dir, store } = repo({ 'a.ts': '1\n' });
  G.capture(dir, store, 'before');
  fs.writeFileSync(path.join(dir, 'a.ts'), '2\n');
  const after = G.capture(dir, store, 'after');
  assert.ok(fs.existsSync(path.join(store, 'index.before')) && fs.existsSync(path.join(store, 'index.after')),
    'both phases wrote to one index file — the before basis is no longer the before state');
  assert.ok(after.head, 'the basis lost the commit it was taken against');
});

/* ───────────────────────── WBS-11 · the reducer, on a real stream ───────────────────────── */

const RECORDED = fs.readFileSync(path.join(R, 'tests/fixtures/stream-permission-denied.ndjson'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('a recorded session replays to the state its events justify', () => {
  const signals = RECORDED.map(toSignal);
  assert.ok(signals.some((s) => s.kind === KIND.SESSION_START), 'system/init was not recognised');
  assert.strictEqual(signals.filter((s) => s.kind === KIND.TOOL_USE).length, 3);
  assert.strictEqual(signals.filter((s) => s.kind === KIND.PERMISSION_DENIED).length, 1);
  assert.strictEqual(signals.at(-1).kind, KIND.FINISH);

  /* The state AT the denial, not only at the end: FINISH re-enters permission_waiting, so a
   * reducer that ended the Work on the denial would be invisible in the terminal state. */
  const upTo = signals.slice(0, signals.findIndex((s) => s.kind === KIND.PERMISSION_DENIED) + 1);
  const mid = replay(upTo);
  assert.strictEqual(mid.status, 'permission_waiting', 'the Work must enter permission_waiting AT the denial');
  assert.strictEqual(mid.outcome, null, 'a Work with an unanswered refusal has not ended');

  const state = replay(signals);
  /* The turn ended, but under contract B the user can still allow and the SAME Work resumes in
   * the SAME session — so ending it here would throw away what the card is for. */
  assert.strictEqual(state.status, 'permission_waiting');
  assert.strictEqual(state.outcome, null, 'a Work with an unanswered refusal has not ended');
  assert.strictEqual(openPermission(state).tool, 'Edit');
});

test('a denial can never be read from the exit code — the CLI reports success', () => {
  const finish = RECORDED.at(-1);
  assert.strictEqual(finish.type, 'result');
  assert.strictEqual(finish.subtype, 'success');
  assert.strictEqual(finish.is_error, false,
    'the recording no longer shows the measured behaviour: a denied run reports success');
  assert.strictEqual(finish.permission_denials.length, 1);
  assert.ok(finish.permission_denials[0].tool_input,
    'the denial carries the tool INPUT — that is what makes a narrowly-scoped retry possible');

  /* …and the signal must carry all of it through. The assertions above are a fixture-integrity
   * guard: no change to any module could fail them. These can. */
  const sig = toSignal(finish);
  assert.strictEqual(sig.kind, KIND.FINISH);
  assert.strictEqual(sig.payload.isError, false);
  assert.strictEqual(sig.payload.denials.length, 1, 'toSignal dropped the result\'s permission_denials');
  assert.strictEqual(sig.payload.denials[0].tool, 'Edit');
  assert.ok(sig.payload.denials[0].input?.file_path, 'the tool INPUT did not survive into the signal');
});

test('a refusal reported only in the result is still a refusal', () => {
  /* The recording always precedes its result with a `system/permission_denied`, so the merge
   * path that reads `result.permission_denials` is never exercised by it. */
  const s = reduce(initial(), {
    kind: KIND.FINISH,
    payload: { subtype: 'success', isError: false, denials: [{ tool: 'Edit', toolUseId: 'tu_1', input: { file_path: '/p/x' } }] },
  });
  /* It is a refusal the user has not answered, so it gets a card like any other — the Work
   * stays open rather than ending as 부분 with no way to allow it. */
  assert.strictEqual(s.status, 'permission_waiting');
  assert.strictEqual(s.outcome, null);
  assert.strictEqual(s.denials.length, 1, 'a denial reported only in the result was discarded');
  assert.ok(openPermission(s).input?.file_path, 'the card has no target to scope a grant to');
});

test('the states no recording happens to contain', () => {
  /* `failed`, `input_waiting` and the answer that leaves it were unreachable from the whole
   * suite: nothing asserted them, so nothing would notice them breaking. */
  assert.strictEqual(reduce(initial(), { kind: KIND.FINISH, payload: { isError: true, denials: [] } }).outcome, 'failed');

  let q = reduce(initial(), { kind: KIND.INPUT_REQUEST, payload: { question: 'x' } });
  assert.strictEqual(q.status, 'input_waiting');
  assert.strictEqual(reduce(q, { kind: KIND.ANSWER, payload: null }).status, 'running',
    'answering must return to the SAME Work, never start a new one');

  /* an answer arriving when nothing asked for one changes nothing */
  assert.strictEqual(reduce(initial(), { kind: KIND.ANSWER, payload: null }).status, 'running');

  /* session_start carries what the session actually reported about itself */
  const init = toSignal(RECORDED.find((e) => e.type === 'system' && e.subtype === 'init'));
  assert.strictEqual(init.payload.sessionId, '11111111-2222-3333-4444-555555555555');
  assert.strictEqual(init.payload.cwd, '/fixture/proj');

  /* every observed event is recorded as its own kind, so 기술 출력 보기 can tell them apart */
  const kinds = RECORDED.map((e) => toSignal(e).kind);
  assert.ok(kinds.includes(KIND.TOOL_RESULT), 'tool results are being flattened into raw');
  assert.ok(kinds.includes(KIND.RATE_LIMIT), 'a rate-limit event is being flattened into raw');

  /* the FIRST tool_use of a message is the one reported — the order is the record */
  const firstUse = RECORDED.find((e) => e.type === 'assistant' && (e.message?.content ?? []).some((b) => b.type === 'tool_use'));
  assert.strictEqual(toSignal(firstUse).payload.tool, firstUse.message.content.find((b) => b.type === 'tool_use').name);
});

test('openPermission answers about an UNANSWERED refusal only', () => {
  let s = replay(RECORDED.map(toSignal));
  assert.ok(openPermission(s), 'an unanswered refusal is not being reported');
  s = reduce(s, grantedSignal(s.denials[0], 'Edit(note.txt)'));
  assert.strictEqual(openPermission(s), null, 'a refusal the user answered is still being reported as open');
});

test('granting one refusal does not resolve a different one', () => {
  let s = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: 'tu_1' } });
  s = reduce(s, { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'tu_2' } });
  s = reduce(s, grantedSignal({ tool: 'Edit', toolUseId: 'tu_1' }, 'Edit(a.txt)'));
  assert.deepStrictEqual(s.denials.map((d) => [d.toolUseId, d.resolved === true]), [['tu_1', true], ['tu_2', false]],
    'allowing one tool marked an unrelated refusal as allowed');
  /* The second refusal is still unanswered, so the Work is still waiting on the user and the
   * card for it must still exist — losing it means asking a question the user never sees. */
  assert.strictEqual(s.status, 'permission_waiting');
  assert.deepStrictEqual(openPermissions(s).map((d) => d.toolUseId), ['tu_2']);
  /* The turn finishing does not end the Work while a refusal is still unanswered. */
  const fin = reduce(s, { kind: KIND.FINISH, payload: { isError: false, denials: [] } });
  assert.strictEqual(fin.status, 'permission_waiting');
  assert.strictEqual(fin.outcome, null);
  /* …and once the user stops instead of allowing, it ends as 부분. */
  const stopped = reduce(reduce(fin, { kind: KIND.CANCEL_REQUEST, payload: null }),
    { kind: KIND.FINISH, payload: { isError: false, denials: [] } });
  assert.strictEqual(stopped.outcome, 'cancelled_nochange', 'no tool ran, so nothing was changed');
});

test('a grant with no id resolves ONE refusal, not every outstanding one', () => {
  let s = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: null } });
  s = reduce(s, { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: null } });
  s = reduce(s, grantedSignal({ tool: 'Edit', toolUseId: null }, 'Edit(a.txt)'));
  assert.strictEqual(openPermissions(s).length, 1,
    'one click resolved refusals the user never answered — the Work would report 완료 with unapproved refusals in it');
});

test('a grant resolves the refusal it NAMES, and nothing when it names none', () => {
  /* FOUND BY MUTATION: every existing test granted the FIRST outstanding refusal, so a matcher
   * that ignored the id entirely and resolved "the first unresolved one" passed all of them.
   * D-116 turns on this: the record says a PERSON approved a specific action, and a grant that
   * resolves whatever happens to be first makes that record a guess.
   *
   * `19` §C3-P: not granting is always safe. A grant naming nothing resolves nothing. */
  const two = () => reduce(
    reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: 'tu_1' } }),
    { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'tu_2' } });
  const openIds = (st) => openPermissions(st).map((d) => d.toolUseId);

  /* The SECOND one, by id. The first must be left alone. */
  const second = reduce(two(), grantedSignal({ tool: 'Bash', toolUseId: 'tu_2' }, 'Bash(ls:*)'));
  assert.deepStrictEqual(openIds(second), ['tu_1'],
    'a grant naming the second refusal resolved the first');

  /* An id that names nothing resolves NOTHING — not the first, not the closest. */
  const stranger = reduce(two(), grantedSignal({ tool: 'Edit', toolUseId: 'tu_999' }, 'Edit(a.txt)'));
  assert.deepStrictEqual(openIds(stranger), ['tu_1', 'tu_2'],
    'a grant naming an unknown id resolved a refusal the user never answered');

  /* No id at all falls back to the TOOL — and only to a matching one. */
  const byTool = reduce(two(), grantedSignal({ tool: 'Bash', toolUseId: null }, 'Bash(ls:*)'));
  assert.deepStrictEqual(openIds(byTool), ['tu_1'], 'the tool fallback resolved the wrong refusal');

  const noSuchTool = reduce(two(), grantedSignal({ tool: 'Write', toolUseId: null }, 'Write(a.txt)'));
  assert.deepStrictEqual(openIds(noSuchTool), ['tu_1', 'tu_2'],
    'a grant for a tool nobody was refused resolved something anyway');

  /* …and a grant carrying neither an id nor a tool resolves nothing at all. */
  const empty = reduce(two(), { kind: KIND.PERMISSION_GRANTED, payload: {} });
  assert.deepStrictEqual(openIds(empty), ['tu_1', 'tu_2'],
    'an empty grant resolved a refusal');
  const nothing = reduce(two(), { kind: KIND.PERMISSION_GRANTED, payload: null });
  assert.deepStrictEqual(openIds(nothing), ['tu_1', 'tu_2']);
});

test('an ended Work cannot be reopened by a stray signal', () => {
  let s = reduce(initial(), { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(s.status, 'ended');
  for (const stray of [grantedSignal({ tool: 'Edit' }, 'Edit(a)'), { kind: KIND.TOOL_USE, payload: { tool: 'Edit' } },
                       { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash' } }, { kind: KIND.INPUT_REQUEST, payload: null }]) {
    const next = reduce(s, stray);
    assert.strictEqual(next.status, 'ended', `${stray.kind} reopened a finished Work and re-took the D-117 slot`);
    assert.strictEqual(next.outcome, 'complete');
  }
  /* Reconciliation is the one thing allowed to speak about an ended Work, and it only confirms. */
  assert.strictEqual(reduce(s, { kind: KIND.RECONCILED, payload: null }).status, 'ended');
});

test('a cancelled Work is never reported as 완료', () => {
  /* `07` §8.1: a cancelled child exits 0, and `result.is_error` is just as blind to it. The
   * result normally arrives BEFORE our own cancel-confirmed signal, so this is the ordinary
   * ordering rather than a race. */
  let s = reduce(initial(), { kind: KIND.TOOL_USE, payload: { tool: 'Edit' } });
  s = reduce(s, { kind: KIND.CANCEL_REQUEST, payload: null });
  s = reduce(s, { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(s.outcome, 'cancelled_partial', 'a cancelled Work reported itself complete');

  let t = reduce(initial(), { kind: KIND.CANCEL_REQUEST, payload: null });
  t = reduce(t, { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(t.outcome, 'cancelled_nochange');
});

test('a turn that ran out of turns is not 완료', () => {
  /* `19` §C3-L reads is_error, the terminal reason and the exit code TOGETHER. `error_max_turns`
   * reports `is_error: false`, so reading that field alone called it a success. */
  for (const payload of [
    { subtype: 'error_max_turns', isError: false, denials: [] },
    { subtype: 'error_during_execution', isError: false, denials: [] },
    { subtype: 'success', isError: false, apiErrorStatus: 529, denials: [] },
    { subtype: 'success', isError: false, terminalReason: 'max_tokens', denials: [] },
  ]) {
    assert.strictEqual(reduce(initial(), { kind: KIND.FINISH, payload }).outcome, 'failed',
      `${JSON.stringify(payload)} was reported as a success`);
  }
  assert.strictEqual(reduce(initial(), { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, terminalReason: 'end_turn', denials: [] } }).outcome, 'complete');
});

test('parallel tool calls in one message are all counted', () => {
  const sig = toSignal({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'a', name: 'Read', input: {} },
    { type: 'tool_use', id: 'b', name: 'Grep', input: {} },
  ] } });
  assert.strictEqual(sig.payload.all.length, 2, 'a batched tool call was dropped');
  assert.strictEqual(reduce(initial(), sig).toolsUsed, 2);
});

test('allowing narrows to one tool and one target, never to the tool as a whole', () => {
  assert.strictEqual(allowSpec({ tool: 'Edit', input: { file_path: '/p/note.txt' } }, '/p'), 'Edit(note.txt)');
  /* `Edit(/abs)` with ONE leading slash is read as a cwd-relative glob and silently denies. */
  assert.strictEqual(allowSpec({ tool: 'Edit', input: { file_path: '/elsewhere/x' } }, '/p'), 'Edit(//elsewhere/x)');
  assert.strictEqual(allowSpec({ tool: 'Bash', input: { command: 'npm test' } }, '/p'), 'Bash(npm test:*)');
  assert.strictEqual(allowSpec({ tool: 'Bash', input: {} }, '/p'), null,
    'with nothing to scope to, the answer is no grant — never a grant of the whole tool');
  assert.strictEqual(allowSpec({}, '/p'), null);

  /* `tool_input` is chosen by the MODEL, so a repository file can influence it. Two measured
   * consequences: a glob target produced `Edit(*)`, which is the bare-tool grant D-133 bans
   * outright while the card showed one path; and `)` plus `,` closed the spec and opened a
   * second, independent one. Anything that could mean more than one thing is refused. */
  for (const bad of ['/p/*', '/p/**', '/p/a?', '/p/[abc]', '/p/a),Bash(rm -rf ~', '/p/a),Edit', '/p/x\ny']) {
    assert.strictEqual(allowSpec({ tool: 'Edit', input: { file_path: bad } }, '/p'), null,
      `${JSON.stringify(bad)} produced a grant`);
  }
  assert.strictEqual(allowSpec({ tool: 'Bash', input: { command: 'ls),Edit' } }, '/p'), null);
  assert.strictEqual(allowSpec({ tool: 'Edit; rm -rf /', input: { file_path: '/p/a' } }, '/p'), null,
    'the tool name is not validated');

  /* A relative path is the PROJECT's, not JuQode's working directory. */
  assert.strictEqual(allowSpec({ tool: 'Edit', input: { file_path: 'sub/a.txt' } }, '/p'), 'sub/a.txt'
    ? 'Edit(sub/a.txt)' : null);
});

test('the whole permission lifecycle, driven by signals alone', () => {
  const denied = RECORDED.map(toSignal);
  let s = replay(denied);
  assert.strictEqual(s.status, 'permission_waiting');

  /* The user allows. JuQode records that a PERSON approved — D-116 must stay queryable. */
  const denial = s.denials[0];
  s = reduce(s, grantedSignal(denial, 'Edit(note.txt)'));
  assert.strictEqual(s.status, 'running');
  assert.strictEqual(openPermission(s), null);

  /* the retry turn finishes cleanly */
  s = reduce(s, { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.outcome, 'complete',
    'a refusal the user then allowed is resolved — reporting 부분 완료 describes something the user did not see');
});

test('an unresolved refusal ends the Work as 부분 once the user stops', () => {
  let s = replay(RECORDED.map(toSignal));
  s = reduce(s, { kind: 'stop_requested_by_user', payload: null });      // unknown kind: no change
  assert.strictEqual(s.status, 'permission_waiting', 'an unrecognised signal changed the state');

  /* The user chose 그만두기 rather than allowing. The refusal stays unresolved, so the Work
   * ends 부분 — something was asked for and not done. */
  s = reduce(s, { kind: KIND.CANCEL_REQUEST, payload: null });
  s = reduce(s, { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.outcome, 'cancelled_partial', 'stopping with work already done is a partial cancel');
});

test('no state is set that no signal justifies', () => {
  let s = initial();
  assert.strictEqual(s.status, 'running');
  for (const kind of ['raw', 'status', 'rate_limit', 'tool_result', 'unknown_future_event']) {
    const next = reduce(s, { kind, payload: null });
    assert.strictEqual(next.status, s.status, `${kind} moved the Work's state on its own`);
    assert.strictEqual(next.outcome, null);
    s = next;
  }
  /* …but every one of them is still OBSERVED — the liveness line is made of these. */
  assert.strictEqual(s.lastObserved.kind, 'unknown_future_event');
});

test('cancellation is judged from an observed exit, never from the exit code', () => {
  let s = reduce(initial(), { kind: KIND.TOOL_USE, payload: { tool: 'Edit' } });
  s = reduce(s, { kind: KIND.CANCEL_REQUEST, payload: null });
  assert.strictEqual(s.status, 'cancel_requested');
  s = reduce(s, { kind: KIND.CANCEL_CONFIRMED, payload: null });
  assert.strictEqual(s.outcome, 'cancelled_partial', 'a tool had already run, so changes may exist');

  let t = reduce(initial(), { kind: KIND.CANCEL_REQUEST, payload: null });
  t = reduce(t, { kind: KIND.CANCEL_CONFIRMED, payload: null });
  assert.strictEqual(t.outcome, 'cancelled_nochange');
});

test('a lost process is closed as 확인 불가, never as success', () => {
  const s = reduce(initial(), { kind: KIND.RECONCILED, payload: null });
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.outcome, 'ended_unknown');
});

/* ───────────────────────── WBS-10 · the session runner ───────────────────────── */

test('a stream split mid-character is not corrupted', async () => {
  /* Real stdout arrives in pipe-sized chunks. Concatenating each Buffer as a string turned a
   * Korean character split across a boundary into U+FFFD — and `unparsed` stayed 0, because
   * corrupted text is still valid JSON, so nothing flagged it. */
  const dir = tempDir('juqode-utf8-');
  const bin = path.join(dir, 'claude');
  const line = JSON.stringify({ type: 'system', subtype: 'status', message: '변경 증거 기준을 세우는 중' });
  /* Written out seven bytes at a time, so multi-byte characters straddle the boundaries. */
  fs.writeFileSync(`${bin}.js`, `const b = Buffer.from(${JSON.stringify(line)} + "\\n", "utf8");
for (let i = 0; i < b.length; i += 7) process.stdout.write(b.subarray(i, i + 7));
`);
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${process.execPath} "${bin}.js"\n`, { mode: 0o755 });
  const lines = [];
  await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, onSignal: (_s, _raw, text) => lines.push(text) });
  assert.ok(!lines.join('').includes('\uFFFD'), `the stream was corrupted: ${lines[0]}`);
  assert.strictEqual(JSON.parse(lines[0]).message, '변경 증거 기준을 세우는 중');
});

test('an orphan that leaves the process group cannot pin the Work forever', async () => {
  /* `07` §8.7 measured this orphan class. Resolution used to hang off `close`, which waits for
   * every inherited pipe — a `setsid` grandchild holds stdout open, so the promise never
   * settled, the Work stayed `running`, and D-117's single slot was never released. */
  const dir = tempDir('juqode-orphan-');
  const bin = path.join(dir, 'claude');
  /* The orphan sleeps only briefly and clears itself. It is NOT reaped with `pkill -f` here:
   * a pattern broad enough to match the fixture also matches the test runner's own command
   * line, and the suite kills itself (measured — exit 144). */
  fs.writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
setsid sleep 6 &
sleep 6
`, { mode: 0o755 });
  const t0 = Date.now();
  const r = await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, timeoutMs: 1200, onSignal: () => {} });
  const took = Date.now() - t0;
  assert.ok(took < 5000, `the session never settled (${took} ms) — the Work would stay running forever`);
  assert.strictEqual(r.startFailed, false);
});

test('a session that produces no event at all did not start', async () => {
  const dir = tempDir('juqode-nostart-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, '#!/bin/sh\necho "boom" >&2\nexit 9\n', { mode: 0o755 });
  const seen = [];
  const r = await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, onSignal: (s) => seen.push(s) });
  assert.strictEqual(r.startFailed, true, '`20`: a Work that never started writes no row');
  assert.strictEqual(seen.length, 0);
  assert.match(r.stderr, /boom/, 'the CLI\'s own words must survive for 자세한 출력 보기');
});

test('every line reaches the record, including one we cannot parse', async () => {
  const dir = tempDir('juqode-raw-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
echo 'this line is not json'
printf '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  const seen = [];
  const r = await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, onSignal: (s) => seen.push(s) });
  assert.strictEqual(r.startFailed, false);
  assert.strictEqual(seen.length, 3, 'a line was dropped — 기술 출력 보기 must show everything');
  assert.strictEqual(r.unparsed, 1);
  assert.deepStrictEqual(seen.map((s) => s.kind), ['session_start', 'raw', 'finish']);
  assert.strictEqual(replay(seen).status, 'ended', 'the trailing line without a newline was lost');
});

test('the prompt goes on stdin, so a variadic flag cannot swallow it', async () => {
  /* Measured: `--allowedTools <tools...>` is variadic, and a prompt passed as a positional
   * after it became a second tool grant. The retry silently never ran. */
  const dir = tempDir('juqode-args-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
printf '%s' "$*" > "${dir}/argv.txt"
cat > "${dir}/stdin.txt"
echo '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  await run({ cwd: dir, sessionId: 'sid', prompt: '로그인 오류 고쳐줘', allowedTools: ['Edit(a.txt)'], bin, onSignal: () => {} });
  const argv = fs.readFileSync(path.join(dir, 'argv.txt'), 'utf8');
  assert.ok(!argv.includes('로그인 오류 고쳐줘'), 'the prompt was passed as an argument');
  assert.ok(argv.includes('Edit(a.txt)'), 'the scoped grant did not reach the CLI');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8'), '로그인 오류 고쳐줘');

  /* The flags that make the stream parseable and the session resumable. Without the session
   * id there is nothing for a retry to resume; without the format there is nothing to parse. */
  assert.match(argv, /--session-id sid/, 'no session id was requested — a retry could never resume');
  assert.match(argv, /--output-format stream-json/);
  assert.match(argv, /--verbose/);
});

test('the child is its own process group, so stopping it cannot reach JuQode', async () => {
  /* `07` §8.2, measured: `process.kill(-pgid)` on a group that contains JuQode kills JuQode —
   * the spike driver exited 143. `detached: true` is what keeps that from being possible, and
   * nothing tested it. */
  const dir = tempDir('juqode-pg-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
ps -o pgid= -p $$ | tr -d ' ' > "${dir}/pgid.txt"
echo '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, onSignal: () => {} });
  const childGroup = fs.readFileSync(path.join(dir, 'pgid.txt'), 'utf8').trim();
  const ourGroup = String(process.getpgrp?.() ?? process.pid);
  assert.notStrictEqual(childGroup, ourGroup,
    'the child shares JuQode\'s process group — killing the child would kill JuQode');
});

test('a resume asks for the same session and adds only the scoped grant', async () => {
  const dir = tempDir('juqode-resume-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
printf '%s' "$*" > "${dir}/argv.txt"
echo '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  await run({ cwd: dir, sessionId: 'the-session', resume: true, allowedTools: ['Edit(note.txt)'], prompt: 'x', bin, onSignal: () => {} });
  const argv = fs.readFileSync(path.join(dir, 'argv.txt'), 'utf8');
  assert.match(argv, /--resume the-session/, 'the retry started a different session');
  assert.match(argv, /--allowedTools Edit\(note\.txt\)/);
  assert.ok(!/--session-id/.test(argv), '--session-id and --resume must not both be sent');
});

test('a project that gitignores its own .env can still have a basis taken', () => {
  /* MEASURED (git 2.53.0), found by the SC-04 e2e: the moment any `:(exclude)` element is in
   * the pathspec, `git add` treats an ignored file as EXPLICITLY named and exits 1 — while
   * writing a perfectly correct index. `git add -A -- .` without excludes exits 0 on the same
   * tree. Every fixture in this suite happened to have no `.gitignore`, so `capture()` threw
   * for most REAL projects and nothing here could tell.
   *
   * `-f` is not the fix — it would stage the secret. The index is checked instead. */
  const dir = tempDir('juqode-ignored-');
  const store = tempDir('juqode-store-');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET_TOKEN=juqode-synthetic-fixture-marker\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const basis = G.capture(dir, store);
  assert.ok(basis.ref, 'no basis could be taken for a project with an ordinary .gitignore');

  const tree = G.treePaths(dir, store, basis.ref);
  assert.deepStrictEqual(tree.slice().sort(), ['.gitignore', 'app.js'].sort(),
    `the basis tree is wrong: ${JSON.stringify(tree)}`);
  assert.ok(!tree.some((f) => f.includes('.env')), 'the ignored secret reached the basis tree');
  assert.ok(!tree.some((f) => f.includes('node_modules')), 'node_modules reached the basis tree');

  /* D-126a: the excluded set is reported as METADATA. The paths are named; nothing is opened. */
  const paths = basis.excluded.map((e) => e.path);
  assert.ok(paths.includes('.env'), `the ignored secret is not in the ledger either: ${paths}`);
  assert.ok(!JSON.stringify(basis).includes('SECRET_TOKEN'), 'a secret VALUE reached the basis record');
});

test('an empty project has an empty basis, and that is not a failure', () => {
  /* The name used to say "an add that genuinely produces nothing is still REFUSED", which is
   * the opposite of what the body asserts and of what is correct: a repository with no files
   * has a legitimately empty basis. The refusal path is covered by the unreadable-path test
   * below, which is the case that actually needs refusing. */
  const dir = tempDir('juqode-empty-');
  const store = tempDir('juqode-store-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  /* An empty repository stages nothing — and that is a legitimate empty basis, not a failure. */
  const basis = G.capture(dir, store);
  assert.ok(basis.ref, 'an empty project has an empty basis, which is a fact and not an error');
  assert.deepStrictEqual(G.treePaths(dir, store, basis.ref), []);
});

test('an add that git ABORTED does not become a silent "nothing changed"', () => {
  /* MEASURED by the batch-06 technical review, and it is a regression this run introduced.
   *
   * A file `git add` cannot read makes git exit 128 and abort WITHOUT writing the index. The
   * index here is a COPY of the user's, so it still holds every tracked file — which means
   * "the index is non-empty" is NOT evidence that the add worked. `capture()` returned the
   * BEFORE tree as the AFTER tree, `changedPaths` came back empty, and the product would have
   * said 바뀐 파일이 없어요 ✓확인됨 about a file the Work had just rewritten.
   *
   * A basis that is wrong is worse than a basis that could not be taken: `12` has a state for
   * "we could not tell" and none for "we told you the opposite". */
  const dir = tempDir('juqode-unreadable-');
  const store = tempDir('juqode-store-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const before = G.capture(dir, store);

  /* The Work changes a file AND leaves behind one git cannot read. Claude Code producing an
   * unreadable artefact mid-Work is an ordinary event, not an exotic one. */
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  const locked = path.join(dir, 'locked.bin');
  fs.writeFileSync(locked, 'x\n');
  fs.chmodSync(locked, 0o000);

  /* Running as root defeats the fixture — the file is readable and there is nothing to detect. */
  let readable = true;
  try { fs.readFileSync(locked); } catch { readable = false; }
  if (readable) {
    fs.chmodSync(locked, 0o600);
    return;                       // cannot construct the condition here; not a silent pass
  }

  let after = null, threw = null;
  try { after = G.capture(dir, store, 'after'); } catch (e) { threw = e; }
  fs.chmodSync(locked, 0o600);

  assert.ok(threw, 'capture accepted a basis git never wrote');
  assert.strictEqual(threw.code, 'unreadable-path');
  assert.ok(String(threw.detail).includes('locked.bin'), `the refusal must name the path: ${threw.detail}`);
  assert.strictEqual(after, null);

  /* The specific lie the old code told: before.ref === after.ref, so nothing looked changed. */
  assert.ok(before.ref, 'the before basis itself was fine');
});

test('a benign ignored-file complaint is still accepted', () => {
  /* The counterpart. A refusal rule that refused BOTH causes would pass the test above and
   * break every project with a .gitignore — which is the bug the tolerance was added for. */
  const dir = tempDir('juqode-benign-');
  const store = tempDir('juqode-store-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET_TOKEN=juqode-synthetic-fixture-marker\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const basis = G.capture(dir, store);
  assert.ok(basis.ref);
  assert.ok(basis.addWarning, 'git did complain, and the complaint is carried rather than dropped');
  assert.deepStrictEqual(G.treePaths(dir, store, basis.ref).sort(), ['.env', '.gitignore', 'a.txt']
    .filter((f) => f !== '.env').sort());
});

test('a same-size edit made against a racy index is still seen as a change', () => {
  /* The mechanism behind a measured evidence-integrity failure.
   *
   * Git re-checks an index entry against its CONTENT when the entry's mtime is not older than
   * the index FILE's own mtime — the "racily clean" rule, which exists because two stamps that
   * close mean the file could have changed after git last looked. `copyFileSync` stamps the
   * copy with the time of the COPY, which is newer than every entry, so nothing is ever racy
   * and git trusts the inherited stat cache completely.
   *
   * Measured under load before the fix: the after-basis came back byte-identical to the
   * before-basis while the file on disk held the new content, `git status` against the copied
   * index reported nothing, and `changes()` said 바뀐 파일이 없어요 with known: true. The loop
   * suite flaked 2-3 in 14; with the user's index mtime preserved, 0 in 14 under the same load.
   *
   * Dating the copy to the epoch is NOT the fix and measured worse — git skips racy handling
   * entirely when the index timestamp is zero.
   *
   * Here the racy condition is forced rather than waited for: the file is given the index's own
   * mtime, and the edit keeps both the size and that mtime. */
  const dir = tempDir('juqode-racy-');
  const store = tempDir('juqode-store-');
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const idx = fs.statSync(path.join(dir, '.git', 'index'));
  fs.utimesSync(f, idx.atime, idx.mtime);            // entry mtime == index mtime: racy
  const before = G.capture(dir, store, 'before');

  fs.writeFileSync(f, 'two\n');                      // four bytes either way
  fs.utimesSync(f, idx.atime, idx.mtime);            // …and the stamp says nothing happened
  const after = G.capture(dir, store, 'after');

  assert.notStrictEqual(before.ref, after.ref,
    'the two bases are identical, so a real edit is invisible — the evidence-integrity class');
  assert.deepStrictEqual(G.changedPaths(dir, store, before.ref, after.ref), ['a.txt']);
});

test('a same-size edit is still a change', () => {
  /* `one\n` → `two\n`: four bytes either way, so nothing but the CONTENT distinguishes them.
   * This is the shape the racy-clean bug hid, and the shape a config-value edit really has. */
  const dir = tempDir('juqode-samesize-');
  const store = tempDir('juqode-store-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const before = G.capture(dir, store, 'before');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  const after = G.capture(dir, store, 'after');

  assert.notStrictEqual(before.ref, after.ref, 'the two bases are identical, so no change is visible');
  assert.deepStrictEqual(G.changedPaths(dir, store, before.ref, after.ref), ['a.txt']);
});

test('a capture never reads the user\'s index — the basis starts empty', () => {
  /* The defect this prevents is intermittent (measured 0/300 with an empty index; a copied one
   * inherits a stat cache that misses a same-size edit), so no deterministic test can catch a
   * revert by observing behaviour. This catches it structurally instead: if `capture` ever
   * reads `.git/index` again, the stat cache is back and so is the missed change. CF-14. */
  /* `srcOf` strips comments — see `tests/src.js`. The comment above `capture` NAMES
   * `copyFileSync` in order to say why it is not used any more; documentation of a ban is not
   * the ban being broken. */
  const src = srcOf('app/main/evidence/git.js');
  const capture = src.slice(src.indexOf('function capture('), src.indexOf('function fileAt('));
  assert.ok(!/copyFileSync/.test(capture),
    'capture() copies a file again — if that is the user index, the stat cache is back');
  assert.ok(/fs\.rmSync\(index\)/.test(capture),
    'capture() no longer starts from a removed (empty) index');

  /* …and the property itself, on a real repo: the index JuQode builds is its own. */
  const dir = tempDir('juqode-idx-');
  const store = tempDir('juqode-store-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');

  const userIndex = path.join(dir, '.git', 'index');
  const before = fs.readFileSync(userIndex);
  G.capture(dir, store, 'before');
  assert.deepStrictEqual(fs.readFileSync(userIndex), before,
    'the user\'s own index was modified — D-126a exists to prevent exactly that');
});

/* ── `stop()` never signals a pid that is no longer ours ──────────────────────────────────── */

test('stopping a child that has already ended signals nothing', () => {
  /* FOUND BY MUTATION: both guards in `stop()` could be weakened and the suite passed —
   * nothing ever called it with a dead child, or with no child at all.
   *
   * `07` §8.5: a pid is REUSABLE. `process.kill(-pid, …)` on a child that already exited is a
   * signal to whatever process group now holds that number, which on a busy machine is an
   * unrelated process tree. Not signalling is always safe; signalling the wrong thing is not
   * recoverable. */
  const sent = [];
  const realKill = process.kill;
  process.kill = (pid, sig) => { sent.push([pid, sig]); };
  try {
    /* Already exited. */
    stop({ pid: 4242, exitCode: 0, signalCode: null, once: () => {} });
    /* Already signalled. */
    stop({ pid: 4243, exitCode: null, signalCode: 'SIGTERM', once: () => {} });
    /* No child at all — a cancel pressed after the handle was dropped. */
    stop(null);
    stop(undefined);
    assert.deepStrictEqual(sent, [], `stop() signalled ${JSON.stringify(sent)} for a child that was gone`);

    /* …and it DOES signal one that is still running, or the test above proves nothing. */
    stop({ pid: 4244, exitCode: null, signalCode: null, once: () => {} });
    assert.deepStrictEqual(sent, [[-4244, 'SIGTERM']],
      'stop() did not signal the process group of a live child');
  } finally { process.kill = realKill; }
});

test('the SIGKILL escalation re-checks before it fires', async () => {
  /* FOUND BY MUTATION, and it is the SECOND guard — the one inside the grace timer. The first
   * is checked above; this one only runs after the grace has elapsed, so a test that does not
   * wait cannot reach it.
   *
   * `07` §8.5 again, and worse here: SIGTERM went out five seconds ago and the child has since
   * exited. The pid is free to be reused, and SIGKILL to a recycled process GROUP takes an
   * unrelated tree down with no warning and no recovery. */
  const sent = [];
  const realKill = process.kill;
  process.kill = (pid, sig) => { sent.push([pid, sig]); };
  try {
    /* Alive when `stop` is called, gone by the time the grace expires — the ordinary case: the
     * child obeyed the SIGTERM. */
    const child = { pid: 5150, exitCode: null, signalCode: null, once: () => {} };
    stop(child, { graceMs: 20 });
    assert.deepStrictEqual(sent, [[-5150, 'SIGTERM']]);
    child.exitCode = 0;                       // it stopped, as asked
    await new Promise((r) => setTimeout(r, 80));
    assert.deepStrictEqual(sent, [[-5150, 'SIGTERM']],
      'SIGKILL was sent to a pid whose process had already exited');

    /* …and a child that IGNORED the SIGTERM does get killed, or the check above is vacuous. */
    sent.length = 0;
    stop({ pid: 5151, exitCode: null, signalCode: null, once: () => {} }, { graceMs: 20 });
    await new Promise((r) => setTimeout(r, 80));
    assert.deepStrictEqual(sent, [[-5151, 'SIGTERM'], [-5151, 'SIGKILL']],
      'a child that ignored SIGTERM was never escalated');
  } finally { process.kill = realKill; }
});
