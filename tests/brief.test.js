/* WBS-05 · Brief fold · stale · refresh — `19` §C1 ⑤, D-132, `21` WBS-05.
 *
 * Two rules, and both are about what the product must NOT do on its own:
 *   · 자동 재읽기 없음 — staleness is ANNOUNCED; the re-read is the user's.
 *   · 갱신 실패 시 이전 해석이 살아남는다 — a refresh that could not read the folder must not
 *     replace six answers the user can still read with a card that says nothing was read.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));

const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
process.on('exit', () => {
  for (const d of juqodeTempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});

function bench() {
  const dir = tempDir('juqode-brief-');
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ name: 'todo', scripts: { dev: 'vite' }, dependencies: { vite: '^5' } }, null, 2));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3}');
  fs.writeFileSync(path.join(dir, 'README.md'), '# todo\n');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, path.basename(dir));
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x',
                           push: () => {}, claudeBin: () => '/nonexistent-cli' });
  return { dir, db, project, h };
}

/* ───────── stale is DERIVED and ANNOUNCED — never acted on ───────── */

test('a project with no interpretation yet has no staleness verdict', () => {
  const b = bench();
  const r = b.h['juqode:brief'](null, b.project.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.interpretation, null);
  assert.strictEqual(r.stale, null, 'nothing has been read, so nothing can be out of date');
});

test('a Brief taken from the current tree is not stale', async () => {
  const b = bench();
  await b.h['juqode:interpret'](null, b.project.id);
  const r = b.h['juqode:brief'](null, b.project.id);
  assert.strictEqual(r.stale.changed, false);
  assert.strictEqual(r.stale.days, 0);
});

test('a new dependency ages the Brief; editing a file body does not', async () => {
  /* `19` §C1 ⑤: the hash covers the MANIFESTS and the SHAPE of the tree. A content edit inside
   * a file does not by itself age the Brief — the six answers are about structure. */
  const b = bench();
  await b.h['juqode:interpret'](null, b.project.id);

  fs.writeFileSync(path.join(b.dir, 'README.md'), '# todo\n\n한참 더 긴 내용이 생겼어요.\n');
  assert.strictEqual(b.h['juqode:brief'](null, b.project.id).stale.changed, false,
    'a body edit aged the Brief — the hash is about structure');

  fs.writeFileSync(path.join(b.dir, 'package.json'),
    JSON.stringify({ name: 'todo', scripts: { dev: 'vite' }, dependencies: { vite: '^5', react: '^18' } }, null, 2));
  assert.strictEqual(b.h['juqode:brief'](null, b.project.id).stale.changed, true,
    'a new dependency did not age the Brief');
});

test('a new top-level folder ages the Brief', async () => {
  const b = bench();
  await b.h['juqode:interpret'](null, b.project.id);
  fs.mkdirSync(path.join(b.dir, 'server'));
  fs.writeFileSync(path.join(b.dir, 'server', 'index.js'), 'x\n');
  assert.strictEqual(b.h['juqode:brief'](null, b.project.id).stale.changed, true);
});

test('the staleness check WRITES nothing — it never re-reads on its own', async () => {
  /* D-132 · `19` §C1 ⑤: 자동 재읽기 없음. The check is a read; the re-read is a user action. */
  const b = bench();
  await b.h['juqode:interpret'](null, b.project.id);
  const before = repo.currentInterpretation(b.db, b.project.id);

  fs.writeFileSync(path.join(b.dir, 'package.json'),
    JSON.stringify({ name: 'todo', scripts: { dev: 'vite', build: 'x' } }, null, 2));
  for (let i = 0; i < 3; i++) b.h['juqode:brief'](null, b.project.id);

  const after = repo.currentInterpretation(b.db, b.project.id);
  assert.strictEqual(after.id, before.id, 'the staleness check started a new interpretation');
  assert.strictEqual(after.source_hash, before.source_hash);
  assert.strictEqual(b.db.prepare('select count(*) c from interpretation').get().c, 1,
    'a second interpretation row appeared without the user asking');
});

test('a folder that cannot be read says nothing about whether the Brief aged', async () => {
  const b = bench();
  await b.h['juqode:interpret'](null, b.project.id);
  fs.rmSync(b.dir, { recursive: true, force: true });

  const r = b.h['juqode:brief'](null, b.project.id);
  assert.strictEqual(r.stale.changed, false,
    'a scan that failed was read as evidence that the project changed');
  assert.ok(r.interpretation, 'the Brief we already have is still there');
});

/* ───────── a failed refresh keeps the Brief that works ───────── */

test('a refresh that cannot read the folder keeps the previous interpretation', async () => {
  /* `21` WBS-05 acceptance. `saveInterpretation` retires the current row and inserts a new one,
   * so writing a failed scan over a good Brief replaces six readable answers with a card that
   * says nothing was read. A failed REFRESH is not a failed project. */
  const b = bench();
  const first = await b.h['juqode:interpret'](null, b.project.id);
  assert.strictEqual(first.interpretation.answers.length, 6);
  const goodId = repo.currentInterpretation(b.db, b.project.id).id;

  fs.rmSync(b.dir, { recursive: true, force: true });
  const second = await b.h['juqode:interpret'](null, b.project.id);

  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.refreshFailed, 'ENOENT', 'the refresh failure is not reported at all');
  assert.strictEqual(second.interpretation.answers.length, 6, 'the old answers were thrown away');
  assert.notStrictEqual(second.interpretation.status, 'failed',
    'a failed refresh marked the PROJECT as unreadable');

  const still = repo.currentInterpretation(b.db, b.project.id);
  assert.strictEqual(still.id, goodId, 'the good interpretation was retired');
  assert.strictEqual(b.db.prepare('select count(*) c from interpretation').get().c, 1);
});

test('a FIRST read that fails is still a failure — there is nothing to keep', () => {
  /* The counterpart: the rule is "keep what works", not "never report a read failure". */
  const db = openDb(':memory:');
  const gone = path.join(tempDir('juqode-gone-'), 'not-here');
  const project = repo.openProject(db, gone, 'gone');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });

  return h['juqode:interpret'](null, project.id).then((r) => {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.interpretation.status, 'failed');
    assert.strictEqual(r.interpretation.failedCode, 'ENOENT', '`15` asks for the REASON');
    assert.ok(!r.refreshFailed, 'a first read is not a refresh');
  });
});

test('a refresh that succeeds does replace the Brief', async () => {
  /* A rule that never replaced would pass the test above and make 다시 읽기 do nothing. */
  const b = bench();
  await b.h['juqode:interpret'](null, b.project.id);
  const firstId = repo.currentInterpretation(b.db, b.project.id).id;

  fs.writeFileSync(path.join(b.dir, 'package.json'),
    JSON.stringify({ name: 'todo', scripts: { dev: 'vite', build: 'vite build' } }, null, 2));
  const again = await b.h['juqode:interpret'](null, b.project.id);

  assert.ok(!again.refreshFailed);
  const now = repo.currentInterpretation(b.db, b.project.id);
  assert.notStrictEqual(now.id, firstId, '다시 읽기 did not produce a new reading');
  assert.strictEqual(b.h['juqode:brief'](null, b.project.id).stale.changed, false,
    'the re-read did not clear the staleness it was asked about');
});
