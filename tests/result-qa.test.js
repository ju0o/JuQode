/* Batch 05 technical QA regressions — WBS-18 the result, and what survives being written.
 *
 * Each test names the measured wrong behaviour it replaces. All of them failed before the fix.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const result = require(path.join(R, 'app/main/work/result.js'));
const { KIND } = require(path.join(R, 'app/main/work/reducer.js'));

/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));


const AVAILABLE = async () => ({ available: true, version: 'x' });

function bench() {
  const dir = tempDir('juqode-res-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A', '.'); g('commit', '-qm', 'baseline');
  const db = openDb(':memory:');
  return { dir, db, project: repo.openProject(db, dir, path.basename(dir)), store: tempDir('juqode-store-') };
}

/* ───────────────────── HIGH 8 · a written result is never erased ───────────────────── */

test('a second finishResult cannot replace a result built from live state', () => {
  /* Measured before the fix: on the cancel path `confirmCancel` wrote the result and released
   * the live entry, then the child's own exit called `finishResult` again — `entryFor` rebuilt
   * a bare state, `saveResult` deleted and reinserted, and SC-03 rendered a 부분 완료 card with
   * neither 된 것 nor 안 된 것. That is the one shape WBS-18's acceptance row forbids. */
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;

  repo.setWorkState(db, workId, { status: 'ended', outcome: 'partial' });
  repo.saveResult(db, workId, {
    summary: '일부만 됐어요',
    claims: [{ kind: 'changed_files', data: { n: 1 }, sourceRef: 'basis:after', confidence: 'confirmed' }],
    items: [{ kind: 'done', data: { files: ['a.txt'] }, confidence: 'confirmed' },
            { kind: 'not_done', data: { tool: 'Bash' }, confidence: 'confirmed' }],
    whatFailed: null,
  });
  const before = repo.resultFor(db, workId);
  assert.strictEqual(before.items.length, 2);

  /* No live entry exists — exactly the state the second call runs in. */
  supervisor.finishResult(db, workId, project, store);

  const after = repo.resultFor(db, workId);
  assert.strictEqual(after.items.length, 2, 'the 된 것 / 안 된 것 lists must still be there');
  assert.strictEqual(after.claims.length, before.claims.length);
  assert.strictEqual(after.summary, before.summary);
});

test('a Work with no result yet still gets one written after a restart', () => {
  /* The guard above must not become "never write from a hydrated state" — a reconciled lost
   * Work has no live entry and no result, and it is entitled to both. */
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  repo.setWorkState(db, workId, { status: 'ended', outcome: 'ended_unknown' });

  assert.strictEqual(repo.resultFor(db, workId), null);
  supervisor.finishResult(db, workId, project, store);
  assert.ok(repo.resultFor(db, workId), 'a Work that ended while the app was gone still reports');
});

/* ───────────────────── MEDIUM 3 · what the DB gives back ───────────────────── */

test('a persisted result carries its outcome, so verify() can actually run on it', () => {
  /* `resultFor` returned no `outcome`, so `verify()`'s both-lists rule was checked against
   * `undefined` and never ran on anything read back from the database. */
  const { db, project } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  repo.setWorkState(db, workId, { status: 'ended', outcome: 'partial' });
  repo.saveResult(db, workId, { summary: 's', claims: [], items: [], whatFailed: null });

  const back = repo.resultFor(db, workId);
  assert.strictEqual(back.outcome, 'partial');
  assert.deepStrictEqual(result.verify(back).sort(),
    ['partial result has no 된 것 list', 'partial result has no 안 된 것 list'].sort(),
    'the rule must fire on a result read back from the DB, not only on one still in memory');
});

test('cancelled_partial is a 부분 card and obeys the same both-lists rule', () => {
  /* `verify()` named only `partial`, so the cancel path could ship a 부분 완료 card with
   * neither list and nothing would object. */
  const problems = result.verify({ outcome: 'cancelled_partial', claims: [], items: [] });
  assert.strictEqual(problems.length, 2, 'both lists are required: ' + JSON.stringify(problems));
  assert.strictEqual(
    result.verify({ outcome: 'cancelled_partial', claims: [],
                    items: [{ kind: 'done' }, { kind: 'not_done' }] }).length, 0);
});

test("an item's confidence survives the round trip", () => {
  /* `18` §0.9: the mark is what the reader checks. Dropping `confidence` on write made every
   * item come back unmarked, which reads as a bare assertion. */
  const { db, project } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  repo.setWorkState(db, workId, { status: 'ended', outcome: 'partial' });
  repo.saveResult(db, workId, {
    summary: 's', claims: [], whatFailed: null,
    items: [{ kind: 'done', data: { files: ['a.txt'] }, confidence: 'confirmed' },
            { kind: 'not_done', data: { tool: 'Bash' }, confidence: 'expected' }],
  });
  const back = repo.resultFor(db, workId);
  assert.deepStrictEqual(back.items.map((i) => i.confidence), ['confirmed', 'expected']);
});

/* ───────────────────── HIGH 6 · the tail of a large patch ───────────────────── */

test('a patch over the head limit keeps its whole text in a blob (D-129)', () => {
  /* Measured before the fix: everything past 256 KB was destroyed and `unified_ref` said only
   * `truncated`, so the Raw view Canon promises for a large change had nothing to fall back to
   * and the change could never be read in full again. */
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  const patch = Array.from({ length: 30000 }, (_, i) => `+line ${i}`).join('\n');
  assert.ok(Buffer.byteLength(patch, 'utf8') > 256 * 1024, 'the fixture must actually be over the limit');

  repo.saveDiff(db, workId, { file: 'big.ts', patch }, store);
  const [d] = repo.diffsFor(db, workId);

  assert.strictEqual(d.truncated, true);
  assert.ok(d.ref, 'a blob reference, not the bare word `truncated`');
  const blob = fs.readFileSync(path.join(store, d.ref), 'utf8');
  assert.strictEqual(blob, patch, 'the WHOLE patch is recoverable, byte for byte');
  assert.ok(d.patch.length < patch.length, 'and the on-screen head is still bounded');
});

test('without a store the truncation is admitted, not faked', () => {
  const { db, project } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  const patch = Array.from({ length: 30000 }, (_, i) => `+line ${i}`).join('\n');
  repo.saveDiff(db, workId, { file: 'big.ts', patch });
  const [d] = repo.diffsFor(db, workId);
  assert.strictEqual(d.truncated, true);
  assert.strictEqual(d.ref, null, 'no reference is reported when none was written');
});

test('a patch under the limit is neither truncated nor blobbed', () => {
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  repo.saveDiff(db, workId, { file: 'small.ts', patch: '+one\n' }, store);
  const [d] = repo.diffsFor(db, workId);
  assert.strictEqual(d.truncated, false);
  assert.strictEqual(d.ref, null);
  assert.strictEqual(d.patch, '+one\n');
});

/* ───────────────────── HIGH 7 · blocks cut from a truncated head ───────────────────── */

test('blocks derived from a truncated patch say so', async () => {
  /* They were split from the part we KEPT and the answer looked complete. */
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  const patch = ['@@ -1,1 +1,30001 @@', ' one']
    .concat(Array.from({ length: 30000 }, (_, i) => `+line ${i}`)).join('\n');
  repo.saveDiff(db, workId, { file: 'big.ts', patch }, store);

  const [seg] = supervisor.blocksFor(db, workId, project, store);
  assert.strictEqual(seg.note, 'truncated', 'the reader must not believe the change ends there');
  assert.ok(seg.ref, 'and it must be told where the rest of it is');
});
