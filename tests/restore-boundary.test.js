'use strict';
/* V1 STEP 1 · 되돌리기 (`gitEvidence.restore`) never writes THROUGH a symlink and never leaves the project.
 * Synthetic scratch only: the "outside" is a second temp directory made by the test; /etc, user projects and auth files are never touched. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { tempDir } = require(path.join(__dirname, 'tmp.js'));
const G = require(path.join(R, 'app/main/evidence/git.js'));
const POSIX = process.platform !== 'win32';
const skip = !POSIX && 'symlinks need privileges on Windows (H1 not run)';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function world(files) {
  const root = fs.realpathSync(tempDir('juqode-rb-root-'));
  const out = fs.realpathSync(tempDir('juqode-rb-out-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const g = (...a) => execFileSync('git', a, { cwd: root, env, stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  for (const [p, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), body); }
  g('add', '-A'); g('commit', '-qm', 'base');
  const store = path.join(tempDir('juqode-rb-store-'), 'evidence');
  return { root, out, store, before: G.capture(root, store, 'before'), after: (n = 'after') => G.capture(root, store, n) };
}
const run = (w) => { const a = w.after(); return G.restore(w.root, w.store, w.before.ref, a.ref); };
const entry = (done, p) => done.find((f) => f.path === p);
const noTemp = (dir) => !fs.readdirSync(dir).some((n) => n.startsWith('.juqode-restore-'));

test('a file the Work replaced with a symlink to an OUTSIDE file: the outside file is untouched, the link is replaced by the basis content', { skip }, () => {
  const w = world({ 'a.txt': 'ORIGINAL\n' });
  const target = path.join(w.out, 'outside.txt'); fs.writeFileSync(target, 'OUTSIDE-SYNTH\n');
  const h = sha(target);
  fs.rmSync(path.join(w.root, 'a.txt')); fs.symlinkSync(target, path.join(w.root, 'a.txt'));
  const done = run(w);
  assert.strictEqual(sha(target), h, 'the outside file was changed through the link');
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'OUTSIDE-SYNTH\n');
  assert.strictEqual(entry(done, 'a.txt').action, 'restored');
  assert.ok(!fs.lstatSync(path.join(w.root, 'a.txt')).isSymbolicLink(), 'the name is a regular file again');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'a.txt'), 'utf8'), 'ORIGINAL\n');
  assert.ok(noTemp(w.root));
});

test('a DANGLING file symlink pointing outside: nothing is created outside', { skip }, () => {
  const w = world({ 'a.txt': 'ORIGINAL\n' });
  const ghost = path.join(w.out, 'does-not-exist.txt');
  fs.rmSync(path.join(w.root, 'a.txt')); fs.symlinkSync(ghost, path.join(w.root, 'a.txt'));
  const done = run(w);
  assert.ok(!fs.existsSync(ghost), 'a file appeared at the outside target of a dangling link');
  assert.deepStrictEqual(fs.readdirSync(w.out), []);
  assert.strictEqual(entry(done, 'a.txt').action, 'restored');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'a.txt'), 'utf8'), 'ORIGINAL\n');
});

test('a symlink to another file INSIDE the project: the target is not written through; the name gets the basis content', { skip }, () => {
  const w = world({ 'a.txt': 'ORIGINAL-A\n', 'b.txt': 'B-STAYS\n' });
  fs.rmSync(path.join(w.root, 'a.txt')); fs.symlinkSync(path.join(w.root, 'b.txt'), path.join(w.root, 'a.txt'));
  const done = run(w);
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'b.txt'), 'utf8'), 'B-STAYS\n', 'the link target was overwritten');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'a.txt'), 'utf8'), 'ORIGINAL-A\n');
  assert.strictEqual(entry(done, 'a.txt').action, 'restored');
});

test('a directory the Work replaced with a regular FILE: the file is removed and the directory restored - git\'s tree listing is never written into a file', () => {
  const w = world({ 'd/x.txt': 'ORIGINAL\n' });
  fs.rmSync(path.join(w.root, 'd'), { recursive: true }); fs.writeFileSync(path.join(w.root, 'd'), 'I AM A FILE NOW\n');
  const done = run(w);
  assert.ok(fs.statSync(path.join(w.root, 'd')).isDirectory(), 'd is a directory again');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'd/x.txt'), 'utf8'), 'ORIGINAL\n');
  assert.ok(!done.some((f) => f.action === 'failed'), JSON.stringify(done));
  assert.ok(noTemp(path.join(w.root, 'd')));
});

test('a file in the way of a parent that cannot be removed is REPORTED failed, never half-written', { skip: !POSIX && 'POSIX permissions' }, () => {
  const w = world({ 'd/x.txt': 'ORIGINAL\n' });
  fs.rmSync(path.join(w.root, 'd'), { recursive: true }); fs.mkdirSync(path.join(w.root, 'd'));
  fs.writeFileSync(path.join(w.root, 'd/blocker'), 'x');                         // the Work made d a non-empty dir with a file where x.txt must go
  fs.mkdirSync(path.join(w.root, 'd/x.txt'));                                    // ...and a DIRECTORY named x.txt
  fs.writeFileSync(path.join(w.root, 'd/x.txt/inner'), 'y');
  const done = run(w);
  assert.strictEqual(entry(done, 'd/x.txt').action, 'failed', 'a directory in the way must be reported, not overwritten');
  assert.ok(fs.statSync(path.join(w.root, 'd/x.txt')).isDirectory());
  assert.ok(noTemp(path.join(w.root, 'd')));
});

test('a symlink that was in the BEFORE tree is reported failed, not rewritten as a regular file holding its target text', { skip }, () => {
  const w = world({ 'real.txt': 'R\n' });
  fs.symlinkSync('real.txt', path.join(w.root, 'ln')); execFileSync('git', ['add', '-A'], { cwd: w.root }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'link'], { cwd: w.root, stdio: 'ignore' });
  const before = G.capture(w.root, w.store, 'beforeLink');
  fs.rmSync(path.join(w.root, 'ln')); fs.writeFileSync(path.join(w.root, 'ln'), 'now a file\n');
  const a = G.capture(w.root, w.store, 'afterLink');
  const done = G.restore(w.root, w.store, before.ref, a.ref);
  assert.strictEqual(entry(done, 'ln').action, 'failed');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'ln'), 'utf8'), 'now a file\n', 'the file was overwritten with link text');
});

test('regression: a directory replaced with a symlink to OUTSIDE still cannot carry the restore out', { skip }, () => {
  const w = world({ 'sub/a.txt': 'ORIGINAL\n' });
  fs.rmSync(path.join(w.root, 'sub'), { recursive: true }); fs.symlinkSync(w.out, path.join(w.root, 'sub'));
  const done = run(w);
  assert.deepStrictEqual(fs.readdirSync(w.out), [], 'the restore wrote into a directory outside the project');
  /* the escaping link is itself a change the Work made: it is removed (never followed), and the directory comes back INSIDE the project */
  assert.strictEqual(entry(done, 'sub').action, 'removed');
  assert.strictEqual(entry(done, 'sub/a.txt').action, 'restored');
  assert.ok(!fs.lstatSync(path.join(w.root, 'sub')).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'sub/a.txt'), 'utf8'), 'ORIGINAL\n');
});

test('a new directory chain under a real project directory is still created and restored (the normal path is not broken)', () => {
  const w = world({ 'keep.txt': 'k\n', 'deep/er/f.txt': 'DEEP\n' });
  fs.rmSync(path.join(w.root, 'deep'), { recursive: true });
  const done = run(w);
  assert.strictEqual(entry(done, 'deep/er/f.txt').action, 'restored');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'deep/er/f.txt'), 'utf8'), 'DEEP\n');
});

test('an existing regular file keeps its mode through a restore; a recreated executable regains +x', { skip: !POSIX && 'POSIX mode bits' }, () => {
  const w = world({ 'run.sh': '#!/bin/sh\n', 'plain.txt': 'p\n' });
  fs.chmodSync(path.join(w.root, 'run.sh'), 0o755); execFileSync('git', ['add', '-A'], { cwd: w.root }); execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: w.root, stdio: 'ignore' });
  const w2 = { ...w, before: G.capture(w.root, w.store, 'before2') };
  fs.rmSync(path.join(w.root, 'run.sh')); fs.writeFileSync(path.join(w.root, 'plain.txt'), 'changed\n'); fs.chmodSync(path.join(w.root, 'plain.txt'), 0o600);
  const a = G.capture(w.root, w.store, 'after2');
  G.restore(w.root, w.store, w2.before.ref, a.ref);
  assert.strictEqual(fs.statSync(path.join(w.root, 'run.sh')).mode & 0o111, 0o111);
  assert.strictEqual(fs.statSync(path.join(w.root, 'plain.txt')).mode & 0o777, 0o600, 'an existing file lost its mode');
  assert.strictEqual(fs.readFileSync(path.join(w.root, 'plain.txt'), 'utf8'), 'p\n');
});

test('the path is re-verified immediately before the swap: a parent swapped for an outside link mid-restore ends failed and leaves nothing outside', { skip }, () => {
  const w = world({ 'sub/a.txt': 'ORIGINAL\n' });
  fs.writeFileSync(path.join(w.root, 'sub/a.txt'), 'EDITED-BY-WORK\n');
  const a = w.after();
  const realWrite = fs.writeFileSync;
  let swapped = false;
  fs.writeFileSync = function patched(file, ...rest) {
    /* the race: the first temp file is about to be created inside `sub`; swap `sub` for a link to the outside first */
    if (!swapped && String(file).includes('.juqode-restore-')) {
      swapped = true;
      fs.renameSync(path.join(w.root, 'sub'), path.join(w.root, 'sub.moved'));
      fs.symlinkSync(w.out, path.join(w.root, 'sub'));
    }
    return realWrite.call(this, file, ...rest);
  };
  let done;
  try { done = G.restore(w.root, w.store, w.before.ref, a.ref); } finally { fs.writeFileSync = realWrite; }
  assert.ok(swapped, 'the race was not staged');
  assert.deepStrictEqual(fs.readdirSync(w.out), [], 'a file (or temp file) was left outside the project');
  assert.strictEqual(entry(done, 'sub/a.txt').action, 'failed');
});

test('source pin: the swap is a rename over the name, never a write through it, and the directory is checked twice', () => {
  const src = require(path.join(__dirname, 'src.js')).code('app/main/evidence/git.js');
  assert.ok(/renameSync\(tmp, abs\)/.test(src) && /flag: 'wx'/.test(src));
  assert.strictEqual((src.match(/realParentInside\(realRoot, abs\)/g) ?? []).length, 4, 'restore + two checks in writeReplacing + the pre-write check');
  assert.ok(!/writeFileSync\(abs,/.test(src), 'a direct write to the final path is back');
});
