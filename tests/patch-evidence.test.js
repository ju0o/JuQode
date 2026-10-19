'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { computePatch, sideFromManifest, fsReader, sideFromGit, gitSides, stateOfRow, PATCH_STATES } =
  require(path.join(__dirname, '..', 'app/main/evidence/patch.js'));
const gitEv = require(path.join(__dirname, '..', 'app/main/evidence/git.js'));
const manifest = require(path.join(__dirname, '..', 'app/main/evidence/manifest.js'));
const { tempDir } = require('./tmp.js');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/* An in-memory side that records every path it was asked to read. */
const mem = (obj, reads = []) => ({
  files: Object.entries(obj).map(([p, v]) => ({ path: p, size: Buffer.from(v).length })),
  read: (p) => { reads.push(p); return obj[p] === undefined ? null : Buffer.from(obj[p]); },
});
const run = (b, a, opts) => computePatch({ before: mem(b), after: mem(a) }, opts);
const one = (r, p) => r.files.find((f) => f.path === p);

test('modified UTF-8 text gets a unified diff and content-addressed blobs; sink receives them', () => {
  const put = [];
  const r = run({ 'a.txt': 'one\ntwo\nthree\n' }, { 'a.txt': 'one\n2\nthree\n' }, { sink: { put: (d, b) => put.push([d, b]) } });
  const f = one(r, 'a.txt');
  assert.equal(f.patch_state, 'stored');
  assert.equal(f.patch_text, '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n');
  assert.equal(f.bytes, Buffer.byteLength(f.patch_text));
  assert.equal(f.before_digest, sha('one\ntwo\nthree\n'));
  assert.deepEqual(r.blobs.map((b) => b.digest).sort(), [f.before_digest, f.after_digest].sort());
  assert.equal(put.length, 2);
  assert.equal(computePatch({ before: mem({ 'a.txt': 'x\n' }), after: mem({ 'a.txt': 'y\n' }) }).blobs.length, 2, 'no sink is fine');
});

test('added and deleted files diff against an empty side', () => {
  const r = run({ 'gone.txt': 'bye\n' }, { 'new.txt': 'hi\n' });
  assert.equal(one(r, 'new.txt').patch_text, '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+hi\n');
  assert.equal(one(r, 'gone.txt').patch_text, '--- a/gone.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye\n');
  assert.equal(one(r, 'new.txt').before_digest, null);
  assert.equal(one(r, 'gone.txt').after_digest, null);
});

test('a missing trailing newline is a real difference and is marked', () => {
  const f = one(run({ 'a': 'x\n' }, { 'a': 'x' }), 'a');
  assert.equal(f.patch_state, 'stored');
  assert.match(f.patch_text, /-x\n\+x\n\\ No newline at end of file\n$/);
});

test('binary (NUL or invalid UTF-8) keeps digests only, no diff text', () => {
  const nul = Buffer.from([0x61, 0, 0x62]);
  const bad = Buffer.from([0xff, 0xfe, 0x41]);
  const r = computePatch({ before: mem({ n: 'x', b: 'x' }), after: { files: [{ path: 'n' }, { path: 'b' }], read: (p) => (p === 'n' ? nul : bad) } });
  for (const p of ['n', 'b']) {
    const f = one(r, p);
    assert.equal(f.patch_state, 'binary');
    assert.equal(f.patch_text, null);
    assert.equal(f.bytes, 0);
    assert.equal(f.before_digest, sha('x'));
    assert.match(f.after_digest, /^[0-9a-f]{64}$/);
  }
  assert.equal(r.blobs.length, 0);
});

test('a side over the per-file cap is too_large with digests only', () => {
  const r = run({ big: 'a\n'.repeat(10) }, { big: 'b\n'.repeat(10) }, { maxSideBytes: 19 });
  assert.equal(one(r, 'big').patch_state, 'too_large');
  assert.equal(one(r, 'big').patch_text, null);
  assert.equal(one(r, 'big').after_digest, sha('b\n'.repeat(10)));
  assert.equal(run({ s: 'a\n' }, { s: 'b\n' }, { maxSideBytes: 2 }).files[0].patch_state, 'stored', 'exactly at the cap is within it');
});

test('Run-level cap: later files (in path order) become too_large; no file is truncated', () => {
  const b = { a: 'a1\n', b: 'b1\n', c: 'c1\n' };
  const a = { a: 'a2\n', b: 'b2\n', c: 'c2\n' };
  const one1 = run({ a: 'a1\n' }, { a: 'a2\n' }).files[0].bytes;
  const r = run(b, a, { maxPatchBytes: one1 * 2 });
  assert.deepEqual(r.files.map((f) => f.patch_state), ['stored', 'stored', 'too_large']);
  assert.equal(r.files[2].patch_text, null);
  assert.ok(r.patch_bytes <= one1 * 2);
  assert.equal(r.blobs.length, 4, 'blobs only for stored files (2 files x 2 sides)');
});

test('pathological line counts return too_large instead of hanging', () => {
  const t0 = Date.now();
  const mk = (x) => Array.from({ length: 6000 }, (_, i) => `${x}${i}`).join('\n') + '\n';
  const r = run({ f: mk('a') }, { f: mk('b') });   // 6000 x 6000 fully differing = 36M cells
  assert.equal(one(r, 'f').patch_state, 'too_large');
  assert.equal(one(r, 'f').patch_text, null);
  const many = run({ g: 'x\n' }, { g: 'y\n'.repeat(20001) });
  assert.equal(one(many, 'g').patch_state, 'too_large');
  assert.ok(Date.now() - t0 < 10000);
});

test('sensitive names are excluded by name and never read (spy on reader)', () => {
  const reads = [];
  const r = computePatch({
    before: mem({ '.env': 'S=1', 'k/id_rsa': 'x', 'cfg/.env/inner': 'y', 'ok.txt': 'a\n' }, reads),
    after: mem({ '.env': 'S=2', 'k/id_rsa': 'z', 'cfg/.env/inner': 'w', 'ok.txt': 'b\n' }, reads),
  });
  for (const p of ['.env', 'k/id_rsa', 'cfg/.env/inner']) {
    const f = one(r, p);
    assert.equal(f.patch_state, 'sensitive_excluded');
    assert.equal(f.patch_text, null);
    assert.equal(f.before_digest, null);
    assert.equal(f.after_digest, null);
  }
  assert.deepEqual([...new Set(reads)], ['ok.txt']);
});

test('sensitive file on disk is never opened by the real reader (fs.readFileSync/openSync spied)', (t) => {
  const root = tempDir('patch-sens');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  const opened = [];
  for (const m of ['readFileSync', 'openSync']) {
    const orig = fs[m];
    t.mock.method(fs, m, (...args) => { opened.push(String(args[0])); return orig(...args); });
  }
  const side = { files: [{ path: '.env' }, { path: 'a.txt' }], read: fsReader(root) };
  const r = computePatch({ before: { files: [], read: () => null }, after: side });
  assert.equal(one(r, '.env').patch_state, 'sensitive_excluded');
  assert.equal(one(r, 'a.txt').patch_state, 'stored');
  assert.ok(!opened.some((p) => p.includes('.env')), `opened: ${opened}`);
});

test('dirty-before file untouched by the Run is unchanged with no diff; touched one is attributed', () => {
  // `dirty.txt` already differed from its commit before the Run started; the Run's before snapshot has that content.
  const dirty = 'edited before the run\n';
  const r = run({ 'dirty.txt': dirty, 'x.txt': 'x\n' }, { 'dirty.txt': dirty, 'x.txt': 'y\n' });
  assert.equal(one(r, 'dirty.txt').patch_state, 'unchanged');
  assert.equal(one(r, 'dirty.txt').patch_text, null);
  assert.equal(one(r, 'x.txt').patch_state, 'stored');
  const r2 = run({ 'dirty.txt': dirty }, { 'dirty.txt': dirty + 'run line\n' });
  assert.equal(one(r2, 'dirty.txt').patch_text, '--- a/dirty.txt\n+++ b/dirty.txt\n@@ -1,1 +1,2 @@\n edited before the run\n+run line\n');
});

test('equal manifest digests are unchanged without reading anything', () => {
  const reads = [];
  const side = { files: [{ path: 'a', size: 3, sha256: 'd' }], read: (p) => { reads.push(p); return Buffer.from('abc'); } };
  const r = computePatch({ before: side, after: side });
  assert.equal(r.files[0].patch_state, 'unchanged');
  assert.deepEqual(reads, []);
});

test('unsafe paths are unavailable and never read', () => {
  const reads = [];
  const bad = ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', ''];
  const obj = Object.fromEntries(bad.map((p) => [p, 'v']));
  const r = computePatch({ before: { files: [], read: () => null }, after: mem(obj, reads) });
  assert.deepEqual(r.files.map((f) => f.patch_state), bad.map(() => 'unavailable'));
  assert.deepEqual(reads, []);
});

test('fsReader refuses a symlink that escapes the root; the target is not read', (t) => {
  const root = tempDir('patch-root');
  const out = tempDir('patch-outside');
  fs.writeFileSync(path.join(out, 'secret.txt'), 'outside\n');
  fs.symlinkSync(path.join(out, 'secret.txt'), path.join(root, 'link.txt'));
  fs.writeFileSync(path.join(root, 'in.txt'), 'in\n');
  const reads = [];
  const orig = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...a) => { reads.push(String(a[0])); return orig(...a); });
  const r = computePatch({ before: { files: [], read: () => null }, after: { files: [{ path: 'link.txt' }, { path: 'in.txt' }], read: fsReader(root) } });
  assert.equal(one(r, 'link.txt').patch_state, 'unavailable');
  assert.equal(one(r, 'in.txt').patch_state, 'stored');
  assert.ok(!reads.some((p) => p.includes('secret.txt')));
});

test('non-Git end to end: two real manifest captures plus byte readers', () => {
  const root = tempDir('patch-e2e');
  fs.writeFileSync(path.join(root, 'keep.txt'), 'same\n');
  fs.writeFileSync(path.join(root, 'edit.txt'), 'v1\n');
  fs.writeFileSync(path.join(root, 'del.txt'), 'bye\n');
  fs.writeFileSync(path.join(root, '.env'), 'S=1\n');
  const m1 = manifest.capture(root);
  const snap = {};
  for (const f of m1.files) snap[f.path] = fs.readFileSync(path.join(root, f.path));   // the caller's before-blob store
  fs.writeFileSync(path.join(root, 'edit.txt'), 'v2\n');
  fs.rmSync(path.join(root, 'del.txt'));
  fs.writeFileSync(path.join(root, 'add.txt'), 'new\n');
  fs.writeFileSync(path.join(root, '.env'), 'S=2\n');
  const m2 = manifest.capture(root);
  const r = computePatch({ before: sideFromManifest(m1, (p) => snap[p] ?? null), after: sideFromManifest(m2, fsReader(root)) });
  assert.deepEqual(r.files.map((f) => [f.path, f.patch_state]),
    [['add.txt', 'stored'], ['del.txt', 'stored'], ['edit.txt', 'stored'], ['keep.txt', 'unchanged']]);
  assert.ok(!r.files.some((f) => f.path === '.env'), 'manifest already leaves secrets out');
  assert.ok(fs.readdirSync(root).sort().join() === '.env,add.txt,edit.txt,keep.txt', 'nothing written into the project');
});

test('deterministic: same input, same output, regardless of listing order', () => {
  const b = { 'z.txt': 'a\n', 'a.txt': 'a\n', 'm/n.txt': 'a\n' };
  const a = { 'z.txt': 'b\n', 'a.txt': 'b\n', 'm/n.txt': 'b\n' };
  const r1 = run(b, a);
  const rev = (o) => Object.fromEntries(Object.entries(o).reverse());
  const r2 = run(rev(b), rev(a));
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.files.map((f) => f.path), ['a.txt', 'm/n.txt', 'z.txt']);
});

test('rows without patch evidence (past hash-only Runs) are unavailable', () => {
  assert.equal(stateOfRow(null), 'unavailable');
  assert.equal(stateOfRow({}), 'unavailable');
  assert.equal(stateOfRow({ patch_state: 'bogus' }), 'unavailable');
  assert.equal(stateOfRow({ patch_state: 'stored' }), 'stored');
  assert.deepEqual([...PATCH_STATES].sort(), ['binary', 'sensitive_excluded', 'stored', 'too_large', 'unavailable', 'unchanged']);
});

test('the produced diff applies with git apply (round trip)', () => {
  const root = tempDir('patch-apply');
  const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const after = before.replace('line 3\n', 'THREE\nextra\n').replace('line 25\n', '');
  fs.writeFileSync(path.join(root, 'f.txt'), before);
  const f = one(run({ 'f.txt': before }, { 'f.txt': after }), 'f.txt');
  fs.writeFileSync(path.join(root, 'p.diff'), f.patch_text);
  execFileSync('git', ['apply', '--no-index', 'p.diff'], { cwd: root });
  assert.equal(fs.readFileSync(path.join(root, 'f.txt'), 'utf8'), after);
});

/* ---- QA round 1 ---- */
const applyTo = (before, patch) => {
  const root = tempDir('patch-apply2');
  if (before !== null) fs.writeFileSync(path.join(root, 'f.txt'), before);
  fs.writeFileSync(path.join(root, 'p.diff'), patch);
  execFileSync('git', ['apply', '--no-index', 'p.diff'], { cwd: root });
  return fs.existsSync(path.join(root, 'f.txt')) ? fs.readFileSync(path.join(root, 'f.txt')) : null;
};
const liveSide = (root, p) => ({ files: [{ path: p }], read: fsReader(root) });
const readsSpy = (t) => {
  const opened = [];
  for (const m of ['readFileSync', 'openSync']) {
    const orig = fs[m];
    t.mock.method(fs, m, (...a) => { opened.push(String(a[0])); return orig(...a); });
  }
  return opened;
};

test('an in-root symlink to a sensitive file is sensitive_excluded: no state leak, no blob, no read', (t) => {
  const root = tempDir('patch-symsens');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.mkdirSync(path.join(root, 'cfg'));
  fs.writeFileSync(path.join(root, 'cfg', 'id_rsa'), 'KEY\n');
  fs.writeFileSync(path.join(root, 'x.pem'), 'PEM\n');
  fs.mkdirSync(path.join(root, '.env.d'));
  fs.writeFileSync(path.join(root, '.env.d', 'inner.txt'), 'IN\n');
  fs.symlinkSync('.env', path.join(root, 'link1.txt'));
  fs.symlinkSync('cfg/id_rsa', path.join(root, 'link2.txt'));
  fs.symlinkSync('x.pem', path.join(root, 'link3.txt'));
  fs.symlinkSync('.env.d', path.join(root, 'dirlink'));
  const opened = readsSpy(t);
  const paths = ['link1.txt', 'link2.txt', 'link3.txt', 'dirlink/inner.txt'];
  const r = computePatch({ before: { files: [], read: () => null },
    after: { files: paths.map((p) => ({ path: p })), read: fsReader(root) } });
  for (const p of paths) {
    const f = one(r, p);
    assert.equal(f.patch_state, 'sensitive_excluded', p);
    assert.equal(f.patch_text, null);
    assert.equal(f.after_digest, null);
  }
  assert.equal(r.blobs.length, 0);
  assert.ok(!opened.some((p) => /\.env|id_rsa|x\.pem/.test(p)), `opened: ${opened}`);
});

test('a BOM-only change is a visible diff that applies', () => {
  const after = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x\n')]);
  const r = computePatch({ before: mem({ 'f.txt': 'x\n' }), after: { files: [{ path: 'f.txt' }], read: () => after } });
  const f = one(r, 'f.txt');
  assert.equal(f.patch_state, 'stored');
  assert.match(f.patch_text, /@@/);
  assert.deepEqual(applyTo('x\n', f.patch_text), after);
});

test('an empty file added or deleted has a truthful, applicable git-style patch', () => {
  const add = one(computePatch({ before: { files: [], read: () => null }, after: mem({ 'f.txt': '' }) }), 'f.txt');
  assert.equal(add.patch_state, 'stored');
  assert.equal(add.patch_text, 'diff --git a/f.txt b/f.txt\nnew file mode 100644\n');
  assert.equal(applyTo(null, add.patch_text).length, 0);
  const del = one(computePatch({ before: mem({ 'f.txt': '' }), after: { files: [], read: () => null } }), 'f.txt');
  assert.equal(del.patch_text, 'diff --git a/f.txt b/f.txt\ndeleted file mode 100644\n');
  assert.equal(applyTo('', del.patch_text), null);
});

test('paths with newline, CR or other control characters are unavailable and never read', () => {
  const reads = [];
  const bad = ['a\nb', 'a\rb', 'a\0b', 'a\tb', 'a\x7fb'];
  const r = computePatch({ before: { files: [], read: () => null }, after: mem(Object.fromEntries(bad.map((p) => [p, 'v'])), reads) });
  assert.deepEqual(r.files.map((f) => f.patch_state), bad.map(() => 'unavailable'));
  assert.deepEqual(reads, []);
});

test('real 1 MiB per-side boundary, both sides; and the default 8 MiB Run cap', () => {
  const M = 1024 * 1024;
  const at = (c, n = M) => c.repeat(n);
  const st = (b, a) => run({ f: b }, { f: a }).files[0].patch_state;
  assert.equal(st(at('a'), at('b')), 'stored', 'exactly 1 MiB each side');
  assert.equal(st(at('a', M + 1), at('b')), 'too_large', 'before side over');
  assert.equal(st(at('a'), at('b', M + 1)), 'too_large', 'after side over');
  assert.equal(st('', at('b', M + 1)), 'too_large', 'added file over');
  const b = {};
  const a = {};
  for (const n of ['1', '2', '3', '4']) { b[n] = at('a'); a[n] = at('b'); }
  const r = run(b, a);
  assert.deepEqual(r.files.map((f) => f.patch_state), ['stored', 'stored', 'stored', 'too_large']);
  assert.ok(r.patch_bytes <= 8 * M);
});

test('fsReader refuses a symlink into a sibling directory sharing the root name prefix', () => {
  const base = tempDir('patch-sib');
  fs.mkdirSync(path.join(base, 'root'));
  fs.mkdirSync(path.join(base, 'root-evil'));
  fs.writeFileSync(path.join(base, 'root-evil', 's.txt'), 'evil\n');
  fs.symlinkSync('../root-evil/s.txt', path.join(base, 'root', 'link.txt'));
  const r = computePatch({ before: { files: [], read: () => null }, after: liveSide(path.join(base, 'root'), 'link.txt') });
  assert.equal(r.files[0].patch_state, 'unavailable');
  assert.equal(r.blobs.length, 0);
});

test('a listed file whose read returns null is unavailable', () => {
  const side = { files: [{ path: 'a.txt' }], read: () => null };
  assert.equal(computePatch({ before: { files: [], read: () => null }, after: side }).files[0].patch_state, 'unavailable');
  assert.equal(computePatch({ before: side, after: { files: [], read: () => null } }).files[0].patch_state, 'unavailable');
});

test('the unchanged shortcut needs equal size too: equal sha256 with different size still reads', () => {
  const reads = [];
  const mk = (size, txt) => ({ files: [{ path: 'a', size, sha256: 'same' }], read: (p) => { reads.push(p); return Buffer.from(txt); } });
  const r = computePatch({ before: mk(4, 'abc\n'), after: mk(5, 'abd!\n') });
  assert.deepEqual(reads, ['a', 'a']);
  assert.equal(r.files[0].patch_state, 'stored');
});

test('far-apart edits make separate hunks with exactly 3 lines of context', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
  const mod = lines.slice();
  mod[1] = 'X2';
  mod[17] = 'X18';
  const bt = lines.join('\n') + '\n';
  const at = mod.join('\n') + '\n';
  const f = run({ 'f.txt': bt }, { 'f.txt': at }).files[0];
  assert.deepEqual(f.patch_text.split('\n').filter((l) => l.startsWith('@@')), ['@@ -1,5 +1,5 @@', '@@ -15,6 +15,6 @@']);
  assert.ok(!f.patch_text.includes(' l6\n') && !f.patch_text.includes(' l14\n'));
  assert.equal(applyTo(bt, f.patch_text).toString(), at);
});

/* ── slice B: fsReader hardening ─────────────────────────────────────────────────────────── */
const fsSide = (root, names) => ({ files: names.map((path_) => ({ path: path_ })), read: fsReader(root) });
const fsOne = (root, name, opts) => one(computePatch({ before: { files: [], read: () => null }, after: fsSide(root, [name]) }, opts), name);

test('hardlink to a secret under a harmless name is unavailable and its bytes are never read', (t) => {
  const root = tempDir('patch-hl');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=abc\n');
  fs.linkSync(path.join(root, '.env'), path.join(root, 'notes.txt'));
  fs.writeFileSync(path.join(root, 'plain.txt'), 'ok\n');
  const orig = fs.readFileSync; const reads = [];
  t.mock.method(fs, 'readFileSync', (...a) => { reads.push(a[0]); return orig(...a); });
  const f = fsOne(root, 'notes.txt');
  assert.equal(f.patch_state, 'unavailable');
  assert.equal(f.patch_text, null);
  assert.equal(f.after_digest, null);
  assert.equal(reads.length, 0, 'no read at all');
  assert.equal(fsOne(root, 'plain.txt').patch_state, 'stored');
});

test('symlink that resolves into a manifest SKIP_DIR is unavailable', () => {
  const root = tempDir('patch-skip');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'node_modules/x.js'), 'x\n');
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref\n');
  fs.symlinkSync('node_modules/x.js', path.join(root, 'l1.txt'));
  fs.symlinkSync('.git', path.join(root, 'gl'));
  assert.equal(fsOne(root, 'l1.txt').patch_state, 'unavailable');
  assert.equal(fsOne(root, 'gl/HEAD').patch_state, 'unavailable');
});

test('oversize file: size decided from fstat BEFORE the read; streamed digest, no body load, too_large', (t) => {
  const root = tempDir('patch-big');
  const big = Buffer.alloc(300 * 1024, 'a');
  fs.writeFileSync(path.join(root, 'big.txt'), big);
  const orig = fs.readFileSync; let whole = 0;
  t.mock.method(fs, 'readFileSync', (...a) => { whole++; return orig(...a); });
  const f = fsOne(root, 'big.txt', { maxSideBytes: 100 * 1024 });
  assert.equal(f.patch_state, 'too_large');
  assert.equal(f.patch_text, null);
  assert.equal(f.after_digest, sha(big), 'digest streamed in 64 KiB chunks');
  assert.equal(whole, 0, 'file never loaded whole');
});

test('oversize on both sides with equal bytes is unchanged; a differing oversize side is too_large', () => {
  const a = tempDir('patch-bigA'); const b = tempDir('patch-bigB');
  for (const d of [a, b]) fs.writeFileSync(path.join(d, 'f'), Buffer.alloc(2000, 'z'));
  const opts = { maxSideBytes: 1000 };
  const same = computePatch({ before: fsSide(a, ['f']), after: fsSide(b, ['f']) }, opts);
  assert.equal(one(same, 'f').patch_state, 'unchanged');
  fs.writeFileSync(path.join(b, 'f'), Buffer.alloc(2000, 'y'));
  const diff = computePatch({ before: fsSide(a, ['f']), after: fsSide(b, ['f']) }, opts);
  assert.equal(one(diff, 'f').patch_state, 'too_large');
  assert.notEqual(one(diff, 'f').before_digest, one(diff, 'f').after_digest);
});

test('exactly at the cap is still read and diffed', () => {
  const root = tempDir('patch-cap');
  fs.writeFileSync(path.join(root, 'e.txt'), 'x'.repeat(99) + '\n');
  assert.equal(fsOne(root, 'e.txt', { maxSideBytes: 100 }).patch_state, 'stored');
});

/* ── slice B: Git side ───────────────────────────────────────────────────────────────────── */
function gitRig() {
  const root = tempDir('patch-git');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const g = (...a) => execFileSync('git', a, { cwd: root, env, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const w = (n, v) => { fs.mkdirSync(path.dirname(path.join(root, n)), { recursive: true }); fs.writeFileSync(path.join(root, n), v); };
  return { root, g, w, store: path.join(tempDir('patch-gitstore'), 'evidence') };
}

test('Git: before/after tree pair gives the same per-file result as the non-Git path; dirty-before file is not in the Run patch', () => {
  const { root, g, w, store } = gitRig();
  w('edit.txt', 'one\ntwo\nthree\n'); w('dirty.txt', 'base\n'); w('gone.txt', 'bye\n'); w('bin.dat', 'x'); w('same.txt', 's\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  w('dirty.txt', 'dirty before the run\n');                    // dirty at Run start, untouched afterwards
  const before = gitEv.capture(root, store, 'before');
  const snapFiles = fs.readdirSync(root).filter((n) => n !== '.git');
  const memBefore = Object.fromEntries(snapFiles.map((n) => [n, fs.readFileSync(path.join(root, n))]));
  w('edit.txt', 'one\n2\nthree\n'); fs.rmSync(path.join(root, 'gone.txt')); w('new.txt', 'hi\n');
  w('bin.dat', Buffer.from([0, 1, 2, 0xff]));
  const after = gitEv.capture(root, store, 'after');
  const memAfter = Object.fromEntries(fs.readdirSync(root).filter((n) => n !== '.git').map((n) => [n, fs.readFileSync(path.join(root, n))]));

  const { before: sb, after: sa } = gitSides(root, store, before.ref, after.ref);
  const rg = computePatch({ before: sb, after: sa });
  const rm = computePatch({ before: mem(memBefore), after: mem(memAfter) });
  const pick = (r) => r.files.filter((f) => f.patch_state !== 'unchanged').map((f) => [f.path, f.change, f.patch_state, f.before_digest, f.after_digest, f.patch_text]);
  assert.deepEqual(pick(rg), pick(rm));
  assert.deepEqual(rg.files.map((f) => f.path), ['bin.dat', 'edit.txt', 'gone.txt', 'new.txt'], 'dirty.txt and same.txt are not in the Run');
  assert.equal(one(rg, 'bin.dat').patch_state, 'binary');
  assert.equal(one(rg, 'edit.txt').patch_state, 'stored');
});

test('Git: sensitive names never reach bytesAt/sizeAt, even when the tree holds one', (t) => {
  const { root, g, w, store } = gitRig();
  w('ok.txt', 'a\n'); w('.env', 'SECRET=1\n'); w('keys/server.pem', 'PEM\n');
  g('add', '-A'); g('add', '-f', '.env', 'keys/server.pem'); g('commit', '-qm', 'secret committed');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  const asked = [];
  for (const fn of ['bytesAt', 'sizeAt']) { const o = gitEv[fn]; t.mock.method(gitEv, fn, (r, s, ref, p) => { asked.push(p); return o(r, s, ref, p); }); }
  const side = sideFromGit(root, store, 'HEAD', null);
  assert.ok(side.files.some((f) => f.path === '.env'), 'precondition: the secret is in the tree');
  const r = computePatch({ before: { files: [], read: () => null }, after: side });
  assert.equal(one(r, '.env').patch_state, 'sensitive_excluded');
  assert.equal(one(r, 'keys/server.pem').patch_state, 'sensitive_excluded');
  assert.equal(one(r, '.env').after_digest, null);
  assert.deepEqual([...new Set(asked)], ['ok.txt'], 'only the harmless file was requested');
  assert.throws(() => side.read('.env'), { code: 'SENSITIVE' });
});

test('Git: symlink and submodule/gitlink entries are unavailable, no escape, link target text is not diffed', () => {
  const { root, g, w, store } = gitRig();
  w('real.txt', 'r\n'); fs.symlinkSync('/etc/hostname', path.join(root, 'lnk'));
  g('add', '-A'); g('commit', '-qm', 'base');
  const blob = g('rev-parse', 'HEAD:real.txt').toString().trim();
  g('update-index', '--add', '--cacheinfo', `160000,${g('rev-parse', 'HEAD').toString().trim()},sub`);
  g('commit', '-qm', 'gitlink');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  const side = sideFromGit(root, store, 'HEAD', null);
  const r = computePatch({ before: { files: [], read: () => null }, after: side });
  assert.equal(one(r, 'lnk').patch_state, 'unavailable');
  assert.equal(one(r, 'sub').patch_state, 'unavailable');
  assert.equal(one(r, 'lnk').patch_text, null);
  assert.equal(one(r, 'real.txt').patch_state, 'stored');
  assert.ok(blob);
});

test('Git: oversize blob is refused by size before bytesAt; real streamed digest', (t) => {
  const { root, g, w, store } = gitRig();
  w('big.txt', 'a'.repeat(5000)); w('s.txt', 'x\n'); g('add', '-A'); g('commit', '-qm', 'base');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  const asked = []; const o = gitEv.bytesAt;
  t.mock.method(gitEv, 'bytesAt', (r, s, ref, p) => { asked.push(p); return o(r, s, ref, p); });
  const r = computePatch({ before: { files: [], read: () => null }, after: sideFromGit(root, store, 'HEAD', null, { maxBytes: 1000 }) }, { maxSideBytes: 1000 });
  assert.equal(one(r, 'big.txt').patch_state, 'too_large');
  assert.equal(one(r, 'big.txt').after_digest, sha('a'.repeat(5000)));
  assert.equal(one(r, 'big.txt').patch_text, null);
  assert.ok(!asked.includes('big.txt'));
  assert.equal(one(r, 's.txt').patch_state, 'stored');
});

test('Git: a path listed in the tree whose blob cannot be read is unavailable, never "absent"', (t) => {
  const { root, g, w, store } = gitRig();
  w('a.txt', 'a\n'); g('add', '-A'); g('commit', '-qm', 'base');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  t.mock.method(gitEv, 'bytesAt', () => null);
  const r = computePatch({ before: { files: [], read: () => null }, after: sideFromGit(root, store, 'HEAD', null) });
  assert.equal(one(r, 'a.txt').patch_state, 'unavailable');
});

test('Git: capture leaves the user git config alone (no config writes by sideFromGit)', () => {
  const { root, g, w, store } = gitRig();
  w('a.txt', 'a\n'); g('add', '-A'); g('commit', '-qm', 'base');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  const cfg = fs.readFileSync(path.join(root, '.git/config'));
  sideFromGit(root, store, 'HEAD', null).read('a.txt');
  assert.deepEqual(fs.readFileSync(path.join(root, '.git/config')), cfg);
});

/* ── slice B fix round ───────────────────────────────────────────────────────────────────── */
test('Git: 2 MiB blob keeps a real sha256 (independent check); chmod-only change is unchanged', () => {
  const { root, g, w, store } = gitRig();
  const big = Buffer.alloc(2 * 1024 * 1024, 'q');
  w('big.bin', big); w('other.txt', 'o\n'); g('add', '-A'); g('commit', '-qm', 'base');
  const before = gitEv.capture(root, store, 'before');
  fs.chmodSync(path.join(root, 'big.bin'), 0o755);
  w('other.txt', 'p\n');
  const after = gitEv.capture(root, store, 'after');
  const { before: sb, after: sa } = gitSides(root, store, before.ref, after.ref);
  const r = computePatch({ before: sb, after: sa });
  assert.equal(one(r, 'big.bin').patch_state, 'unchanged');
  assert.equal(one(r, 'big.bin').before_digest, sha(big));
  assert.equal(one(r, 'other.txt').patch_state, 'stored');
  // changed oversize: too_large with both real digests
  const big2 = Buffer.alloc(2 * 1024 * 1024, 'r');
  w('big.bin', big2);
  const a3 = gitEv.capture(root, store, 'after2');
  const g2 = gitSides(root, store, before.ref, a3.ref);
  const r2 = computePatch(g2);
  assert.equal(one(r2, 'big.bin').patch_state, 'too_large');
  assert.equal(one(r2, 'big.bin').before_digest, sha(big));
  assert.equal(one(r2, 'big.bin').after_digest, sha(big2));
  assert.equal(one(r2, 'big.bin').patch_text, null);
  assert.deepEqual(fs.readdirSync(store).filter((n) => n.endsWith('.tmp')), [], 'scratch removed');
});

test('Git: blob exactly at the cap is stored, one over is too_large', () => {
  const { root, g, w, store } = gitRig();
  w('at.txt', 'x'.repeat(99) + '\n'); w('over.txt', 'x'.repeat(100) + '\n'); g('add', '-A'); g('commit', '-qm', 'b');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  const r = computePatch({ before: { files: [], read: () => null }, after: sideFromGit(root, store, 'HEAD', null, { maxBytes: 100 }) }, { maxSideBytes: 100 });
  assert.equal(one(r, 'at.txt').patch_state, 'stored');
  assert.equal(one(r, 'over.txt').patch_state, 'too_large');
});

test('fsReader: a FIFO is unavailable and does not hang (child process with timeout); a directory is unavailable', () => {
  const root = tempDir('patch-fifo');
  execFileSync('mkfifo', [path.join(root, 'pipe')]);
  fs.mkdirSync(path.join(root, 'adir'));
  const script = `const {fsReader}=require(${JSON.stringify(path.join(__dirname, '..', 'app/main/evidence/patch.js'))});
    const rd=fsReader(${JSON.stringify(root)}); const out=[];
    for (const n of ['pipe','adir']) { try { rd(n); out.push('read'); } catch (e) { out.push(e.message); } }
    console.log(out.join());`;
  const out = execFileSync(process.execPath, ['-e', script], { timeout: 8000, encoding: 'utf8' }).trim();
  assert.equal(out, 'not-a-file,not-a-file');
  assert.equal(fsOne(root, 'adir') .patch_state, 'unavailable');
});

test('SKIP_DIRS: nested segment, symlinked dir with deeper skip segment; project root under build/ is fine', () => {
  const root = tempDir('patch-skip2');
  fs.mkdirSync(path.join(root, 'src/vendor'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/vendor/x.txt'), 'x\n');
  fs.symlinkSync('src/vendor/x.txt', path.join(root, 'ln.txt'));
  fs.symlinkSync('src', path.join(root, 'd'));
  assert.equal(fsOne(root, 'ln.txt').patch_state, 'unavailable');
  assert.equal(fsOne(root, 'd/vendor/x.txt').patch_state, 'unavailable');
  const proj = path.join(tempDir('patch-under'), 'build', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'ok.txt'), 'ok\n');
  assert.equal(fsOne(proj, 'ok.txt').patch_state, 'stored', 'a build/ ABOVE the root does not count');
});

test('before side through fsReader gets the same cap pass-through: never loaded whole', (t) => {
  const a = tempDir('patch-bsA'); const b = tempDir('patch-bsB');
  fs.writeFileSync(path.join(a, 'f'), Buffer.alloc(5000, 'a'));
  fs.writeFileSync(path.join(b, 'f'), 'small\n');
  const orig = fs.readFileSync; let whole = 0;
  t.mock.method(fs, 'readFileSync', (...x) => { whole++; return orig(...x); });
  const r = computePatch({ before: fsSide(a, ['f']), after: fsSide(b, ['f']) }, { maxSideBytes: 1000 });
  assert.equal(one(r, 'f').patch_state, 'too_large');
  assert.equal(one(r, 'f').before_digest, sha(Buffer.alloc(5000, 'a')));
  assert.equal(whole, 1, 'only the small after side was read whole');
});

test('a file that shrinks between fstat and read is unavailable (size and digest never disagree)', (t) => {
  const root = tempDir('patch-shrink');
  fs.writeFileSync(path.join(root, 'f'), Buffer.alloc(3000, 'a'));
  const o = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', (fd, ...x) => { const st = o(fd, ...x); return Object.create(st, { size: { value: 9000 } }); });
  assert.equal(fsOne(root, 'f', { maxSideBytes: 1000 }).patch_state, 'unavailable');
});

test('Git: streamed byte count that disagrees with the blob size is unavailable', (t) => {
  const { root, g, w, store } = gitRig();
  w('big.txt', 'a'.repeat(5000)); g('add', '-A'); g('commit', '-qm', 'b');
  fs.mkdirSync(path.join(store, 'objects'), { recursive: true });
  t.mock.method(gitEv, 'blobDigestAt', () => ({ sha256: 'f'.repeat(64), bytes: 4999 }));
  const r = computePatch({ before: { files: [], read: () => null }, after: sideFromGit(root, store, 'HEAD', null, { maxBytes: 1000 }) }, { maxSideBytes: 1000 });
  assert.equal(one(r, 'big.txt').patch_state, 'unavailable');
});
