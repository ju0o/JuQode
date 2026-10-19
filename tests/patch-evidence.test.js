'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { computePatch, sideFromManifest, fsReader, stateOfRow, PATCH_STATES } =
  require(path.join(__dirname, '..', 'app/main/evidence/patch.js'));
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
