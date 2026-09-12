/* WBS-19b · 되돌리기 — the narrow claim D-115 leaves room for.
 *
 * D-115 forbids promising a GLOBAL undo, and these tests do not test one. What they hold the
 * code to is the sentence the screen is allowed to say: the files this Work changed come back
 * to the bytes the before-basis recorded, and every way that can be incomplete is REPORTED.
 *
 * A restore that silently half-works is worse than no restore at all, so the four shapes a
 * change can take are each measured against the disk afterwards rather than against a return
 * value alone: edited, created, deleted, and not-text.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { tempDir } = require(path.join(__dirname, 'tmp.js'));
const gitEvidence = require(path.join(R, 'app/main/evidence/git.js'));

/** A real repository with one commit — `capture()` reads the user's objects as an alternate. */
function repoWith(files) {
  const root = tempDir('juqode-revert-');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  execFileSync('git', ['init', '-q'], { cwd: root, env });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root, env });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root, env });
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), body);
  }
  execFileSync('git', ['add', '-A'], { cwd: root, env });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root, env });
  return { root, store: path.join(tempDir('juqode-revstore-'), 'evidence') };
}

test('되돌리기: edited · created · deleted files all come back to the before-basis', () => {
  const { root, store } = repoWith({
    'src/app.js': 'const a = 1;\n',
    'src/gone.js': 'export const kept = true;\n',
    'README.md': '# hi\n',
  });

  const before = gitEvidence.capture(root, store, 'before');

  /* What a Work does: edits one file, creates another, deletes a third. */
  fs.writeFileSync(path.join(root, 'src/app.js'), 'const a = 2;\nconst b = 3;\n');
  fs.writeFileSync(path.join(root, 'src/new.js'), 'export const added = 1;\n');
  fs.rmSync(path.join(root, 'src/gone.js'));

  const after = gitEvidence.capture(root, store, 'after');
  const done = gitEvidence.restore(root, store, before.ref, after.ref);

  assert.equal(done.filter((d) => d.action === 'failed').length, 0, 'nothing may fail here');
  assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'const a = 1;\n',
    'an edited file is put back to its before content');
  assert.equal(fs.existsSync(path.join(root, 'src/new.js')), false,
    'a file the Work CREATED is absent before, so removing it is the restore');
  assert.equal(fs.readFileSync(path.join(root, 'src/gone.js'), 'utf8'), 'export const kept = true;\n',
    'a file the Work DELETED is written back');
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '# hi\n',
    'a file the Work never touched is not in the change list and is not rewritten');
});

test('되돌리기: bytes, not text — a non-text file survives the round trip', () => {
  /* `fileAt` decodes as UTF-8. Restoring through it would replace every invalid sequence with
   * U+FFFD and hand the user a corrupt file while reporting success. */
  const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01, 0x02]);
  const { root, store } = repoWith({ 'logo.png': original });

  const before = gitEvidence.capture(root, store, 'before');
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x00, 0x00]));
  const after = gitEvidence.capture(root, store, 'after');
  gitEvidence.restore(root, store, before.ref, after.ref);

  assert.deepEqual(fs.readFileSync(path.join(root, 'logo.png')), original);
});

test('되돌리기: a deleted executable comes back executable', () => {
  /* Recreating a file gives it the umask's mode. A script that comes back without `+x` fails
   * at the next run with a permission error that names nothing the user did. */
  const { root, store } = repoWith({ 'run.sh': '#!/bin/sh\necho hi\n' });
  fs.chmodSync(path.join(root, 'run.sh'), 0o755);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  execFileSync('git', ['add', '-A'], { cwd: root, env });
  execFileSync('git', ['commit', '-qm', 'x'], { cwd: root, env });

  const before = gitEvidence.capture(root, store, 'before');
  fs.rmSync(path.join(root, 'run.sh'));
  const after = gitEvidence.capture(root, store, 'after');
  gitEvidence.restore(root, store, before.ref, after.ref);

  assert.equal(fs.existsSync(path.join(root, 'run.sh')), true);
  assert.equal(fs.statSync(path.join(root, 'run.sh')).mode & 0o111 ? true : false, true,
    'the before-basis records the mode; the restore must carry it');
});

test('되돌리기: a Work that changed nothing restores nothing and says so', () => {
  const { root, store } = repoWith({ 'a.txt': 'x\n' });
  const before = gitEvidence.capture(root, store, 'before');
  const after = gitEvidence.capture(root, store, 'after');
  assert.deepEqual(gitEvidence.restore(root, store, before.ref, after.ref), []);
});

/* ── the supervisor's refusals ───────────────────────────────────────────────────────── */

const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));

test('되돌리기: a manifest basis cannot be reverted, and that is a reason not a failure', () => {
  /* A hash manifest holds hashes, not content. There is nothing to put back, and saying
   * `restore-failed` about it would blame the machine for a fact about the project. */
  const db = {
    prepare: () => ({ get: () => ({ kind: 'hash_manifest', ref: 'h', excluded: null }) }),
  };
  const out = supervisor.revert(db, 'w1', { path: '/nowhere' }, '/store');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not-git-basis');
});

test('되돌리기: 되돌리지 못한 제외 파일은 이름으로 보고된다', () => {
  /* D-126a keeps `.env` out of every basis, so a restore cannot reach it — and neither can
   * 저장, which uses the same list. The file is recoverable from nowhere, and a COUNT leaves
   * the user guessing which one. The ledger records (path, size, mtimeNs) and never opens the
   * file, so naming it gives away nothing. */
  const { root, store } = repoWith({ 'app.js': 'const a = 1;\n' });
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=old\n');

  const before = gitEvidence.capture(root, store, 'before');
  fs.writeFileSync(path.join(root, 'app.js'), 'const a = 2;\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=rotated-by-the-work\n');
  const after = gitEvidence.capture(root, store, 'after');

  /* The rows the store would hold, built from the real captures. */
  const rows = { before: { kind: 'git_tree', ref: before.ref, excluded: JSON.stringify(before.excluded) },
                 after:  { kind: 'git_tree', ref: after.ref,  excluded: JSON.stringify(after.excluded) } };
  const db = { prepare: () => ({ get: (_w, phase) => rows[phase] }) };

  const out = supervisor.revert(db, 'w1', { path: root }, store);
  assert.equal(out.ok, true);
  assert.deepEqual(out.excludedChanged, ['.env'], 'the changed excluded file is not named');
  assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'const a = 1;\n',
    'the tracked file still comes back');
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'SECRET=rotated-by-the-work\n',
    'the excluded file must NOT be touched — it was never in the basis');
});

test('되돌리기: 제외 파일이 그대로면 이름을 지어내지 않는다', () => {
  const { root, store } = repoWith({ 'app.js': 'x\n' });
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  const before = gitEvidence.capture(root, store, 'before');
  fs.writeFileSync(path.join(root, 'app.js'), 'y\n');
  const after = gitEvidence.capture(root, store, 'after');
  const rows = { before: { kind: 'git_tree', ref: before.ref, excluded: JSON.stringify(before.excluded) },
                 after:  { kind: 'git_tree', ref: after.ref,  excluded: JSON.stringify(after.excluded) } };
  const out = supervisor.revert({ prepare: () => ({ get: (_w, p) => rows[p] }) }, 'w1', { path: root }, store);
  assert.deepEqual(out.excludedChanged, []);
  assert.equal(out.excluded, 1, 'the basis still reports that one path was held out of it');
});

test('되돌리기: no basis at all is `no-basis`, not a crash', () => {
  const db = { prepare: () => ({ get: () => undefined }) };
  const out = supervisor.revert(db, 'w1', { path: '/nowhere' }, '/store');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-basis');
});

/* ── WBS-27 · 잘린 diff 의 blob 파일 ─────────────────────────────────────────────────── */

const repo = require(path.join(R, 'app/main/db/repo.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));

test('큰 diff 를 가지치기하면 그 blob 파일도 같이 지운다', () => {
  /* MEASURED: `pruneDiffs` 는 지우기 직전에 `unified_ref`(파일 경로)를 SELECT 해 놓고 한 번도
   * 쓰지 않았다. 그래서 큰 파일을 되돌린 재시도마다 `diffs/<sha256>.patch` 가 하나씩 남았고,
   * 그 파일을 가리키던 유일한 행은 방금 지워졌으므로 **다시는 찾을 수 없었다.** 저장소는
   * 가지치기할 때마다 고아 파일 하나씩 커졌다. */
  const db = openDb(':memory:');
  const store = tempDir('juqode-blob-');
  const project = repo.openProject(db, tempDir('juqode-bp-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;

  const big = `--- a/big.ts\n+++ b/big.ts\n${'+x\n'.repeat(200000)}`;
  repo.saveDiff(db, workId, { file: 'big.ts', patch: big }, store);
  repo.saveDiff(db, workId, { file: 'small.ts', patch: '+y\n' }, store);

  const blobs = () => {
    try { return fs.readdirSync(path.join(store, 'diffs')); } catch { return []; }
  };
  assert.equal(blobs().length, 1, '큰 diff 의 blob 이 쓰이지 않았다 — 검사가 아무것도 재지 못한다');

  /* `small.ts` 만 남기는 재시도. `big.ts` 의 행도 blob 도 사라져야 한다. */
  repo.pruneDiffs(db, workId, ['small.ts'], store);
  assert.deepEqual(repo.diffsFor(db, workId).map((d) => d.file), ['small.ts']);
  assert.deepEqual(blobs(), [], `고아 blob 이 남았다: ${blobs().join(', ')}`);
  db.close();
});

test('다른 행이 아직 가리키는 blob 은 지우지 않는다', () => {
  /* blob 이름은 내용의 sha256 이므로, 서로 다른 두 파일이 같은 내용을 가지면 **같은 blob 을
   * 가리킨다.** 한쪽을 가지치기했다고 지우면 남은 쪽의 원문이 사라진다. */
  const db = openDb(':memory:');
  const store = tempDir('juqode-blob2-');
  const project = repo.openProject(db, tempDir('juqode-bp2-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;

  const same = `--- a/f\n+++ b/f\n${'+x\n'.repeat(200000)}`;
  repo.saveDiff(db, workId, { file: 'a.ts', patch: same }, store);
  repo.saveDiff(db, workId, { file: 'b.ts', patch: same }, store);
  assert.equal(fs.readdirSync(path.join(store, 'diffs')).length, 1, '같은 내용이 두 blob 이 됐다');

  repo.pruneDiffs(db, workId, ['b.ts'], store);
  assert.equal(fs.readdirSync(path.join(store, 'diffs')).length, 1,
    '아직 b.ts 가 가리키는 blob 을 지웠다 — 남은 행의 원문이 사라진다');
  assert.equal(repo.diffsFor(db, workId)[0].ref, fs.readdirSync(path.join(store, 'diffs'))
    .map((n) => `diffs/${n}`)[0], '남은 행의 참조가 실제 파일과 다르다');
  db.close();
});
