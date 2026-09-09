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

/* ── batch 18 QA · the observed-tools count wore a 확인됨 chip and was wrong twice ────────── */

test('countToolResults counts BLOCKS, over the WHOLE history', () => {
  /* Two measured ways the number came out low while the card called it 확인됨:
   *
   *   · one `user` message can carry SEVERAL `tool_result` blocks (parallel calls) and becomes
   *     ONE signal. `result.js` counted signals, so it counted messages. The reducer's own
   *     `toolsUsed` had already been fixed for exactly this and the result path had not.
   *   · `signalsFor` reads at most 500 rows, so a long Work's count was capped by how much of
   *     its own history happened to be read.
   *
   * A confirmed number that undercounts is worse than no number — the chip is an invitation to
   * check it. */
  const { db, project } = bench();
  try {
    const workId = repo.beginWork(db, project.id, 'x').work.id;
    const add = (kind, payload) =>
      repo.addSignal(db, workId, { seq: repo.nextSeq(db, workId), kind, payload });

    /* TWO payload shapes, and both have to count. The supervisor persists the RAW CLI LINE, so
     * production rows carry `message.content[]`; the reducer's own signal payload carries `all`.
     * The first version of `countToolResults` read only `all` and therefore still counted every
     * production row as one — the fix looked right in a unit test and changed nothing in the
     * app. The e2e's cross-check against the app's own recorded signals is what caught it. */
    add('tool_result', { message: { content: [
      { type: 'tool_result', tool_use_id: 'a' },
      { type: 'tool_result', tool_use_id: 'b' },
      { type: 'tool_result', tool_use_id: 'c' }] } });
    add('tool_result', { toolUseId: 'd', all: [{ toolUseId: 'd' }, { toolUseId: 'e' }] });
    add('raw', null);
    assert.strictEqual(repo.countToolResults(db, workId), 5,
      'parallel tool results were counted as one');
    /* A raw line whose message carries no tool_result block at all is still one observed
     * signal — the row exists because the reducer classified it as one. */
    add('tool_result', { message: { content: [{ type: 'text', text: 'x' }] } });
    assert.strictEqual(repo.countToolResults(db, workId), 6);

    /* A payload nobody can parse is still one observed block, not zero. */
    add('tool_result', '{not json');
    assert.strictEqual(repo.countToolResults(db, workId), 7);

    /* …and past the 500-row read cap, which is where the second bug lived. */
    for (let i = 0; i < 600; i++) add('tool_result', { toolUseId: `t${i}` });
    assert.strictEqual(repo.countToolResults(db, workId), 607,
      'the count is capped by signalsFor\'s read limit');
    assert.strictEqual(repo.signalsFor(db, workId).length, 500,
      'the read cap this test exists for is gone — check whether the count still needs its own query');
  } finally { db.close(); }
});

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

/* ───────── batch-06 review · the stored diffs ───────── */

test('the head limit is a BYTE bound, not a code-unit one', () => {
  /* Measured: `over` was computed with `Buffer.byteLength` and the cut was made with
   * `String.slice`, which counts UTF-16 code units. A 600 KB Korean patch stored 600 KB — 2.3x
   * the declared bound — and SC-04 then said 앞부분만 실었어요 over a patch that was complete. */
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  const patch = '가'.repeat(300 * 1024);                 // 900 KB in UTF-8, 300 K code units
  assert.ok(Buffer.byteLength(patch, 'utf8') > 256 * 1024);

  repo.saveDiff(db, workId, { file: 'k.ts', patch }, store);
  const [d] = repo.diffsFor(db, workId);

  assert.ok(Buffer.byteLength(d.patch, 'utf8') <= 256 * 1024,
    `the stored head is ${Buffer.byteLength(d.patch, 'utf8')} bytes`);
  assert.ok(!d.patch.includes('�'), 'the cut split a character and left a replacement mark');
  assert.strictEqual(d.truncated, true);
  assert.strictEqual(fs.readFileSync(path.join(store, d.ref), 'utf8'), patch, 'the whole patch survives');
});

test('a file that no longer differs loses its stored diff', () => {
  /* `saveDiffs` only upserted, so a retry that reverted a file left its row behind for good:
   * SC-04 showed a change that no longer exists and disagreed with `changes()`, which reads git. */
  const { db, project } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  repo.saveDiff(db, workId, { file: 'a.ts', patch: '+a\n' });
  repo.saveDiff(db, workId, { file: 'b.ts', patch: '+b\n' });
  assert.strictEqual(repo.diffsFor(db, workId).length, 2);

  const dropped = repo.pruneDiffs(db, workId, ['a.ts']);
  assert.deepStrictEqual(dropped, ['b.ts']);
  assert.deepStrictEqual(repo.diffsFor(db, workId).map((d) => d.file), ['a.ts'],
    'the file that still changes is kept, and only that one');

  /* …and pruning to the SAME list removes nothing. */
  assert.deepStrictEqual(repo.pruneDiffs(db, workId, ['a.ts']), []);
  assert.strictEqual(repo.diffsFor(db, workId).length, 1);
});

test('a name list that disagrees with the patch is not zipped by index', () => {
  /* The two git calls must describe the same patch. If they ever disagree on how many files
   * there are, zipping BY INDEX files one file's diff under another's name — silently. The
   * guard drops the name list and reads the header, which is wrong for exotic paths but never
   * wrong about WHICH change belongs to WHICH file.
   *
   * The disagreement is forced here by stubbing the one call that produces the list — the same
   * module object the supervisor holds, so the stub is on the real seam. */
  const git = require(path.join(R, 'app/main/evidence/git.js'));
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;

  const g = (...a) => execFileSync('git', a, { cwd: project.path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(project.path, 'second.txt'), 'one\n');
  g('add', '-A', '.'); g('commit', '-qm', 'two files');

  const before = git.capture(project.path, store, 'before');
  repo.saveBasis(db, workId, 'before', { kind: 'git_tree', ref: before.ref, excluded: [] });
  fs.writeFileSync(path.join(project.path, 'a.txt'), 'changed\n');
  fs.writeFileSync(path.join(project.path, 'second.txt'), 'changed too\n');
  const after = git.capture(project.path, store, 'after');
  repo.saveBasis(db, workId, 'after', { kind: 'git_tree', ref: after.ref, excluded: [] });

  const real = git.changedPaths;
  git.changedPaths = (...a) => real(...a).slice(0, 1);      // one name short of the patch
  try {
    supervisor.saveDiffs(db, workId, project, store);
  } finally {
    git.changedPaths = real;
  }

  const stored = repo.diffsFor(db, workId);
  assert.deepStrictEqual(stored.map((d) => d.file).sort(), ['a.txt', 'second.txt'],
    `both files must be stored under their OWN names: ${JSON.stringify(stored.map((d) => d.file))}`);
  const added = (d) => d.patch.split('\n').filter((l) => l.startsWith('+')).join('|');
  for (const d of stored) {
    if (d.file === 'a.txt') {
      assert.ok(/\+changed$/m.test(d.patch) && !d.patch.includes('changed too'),
        `a.txt was filed with another file's patch: ${added(d)}`);
    }
    if (d.file === 'second.txt') {
      assert.ok(d.patch.includes('changed too'),
        `second.txt was filed with another file's patch: ${added(d)}`);
    }
  }
});

test('saveDiffs itself drops a file that stopped differing', () => {
  /* The prune has to run on the real path, not only when called directly: a retry re-captures
   * the after-basis, and the diff rows are a snapshot of THAT answer. */
  const git = require(path.join(R, 'app/main/evidence/git.js'));
  const { db, project, store } = bench();
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  const g = (...a) => execFileSync('git', a, { cwd: project.path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(project.path, 'b.txt'), 'one\n');
  g('add', '-A', '.'); g('commit', '-qm', 'two files');

  const before = git.capture(project.path, store, 'before');
  repo.saveBasis(db, workId, 'before', { kind: 'git_tree', ref: before.ref, excluded: [] });

  /* First turn: both files change. */
  fs.writeFileSync(path.join(project.path, 'a.txt'), 'changed\n');
  fs.writeFileSync(path.join(project.path, 'b.txt'), 'changed\n');
  let after = git.capture(project.path, store, 'after');
  repo.saveBasis(db, workId, 'after', { kind: 'git_tree', ref: after.ref, excluded: [] });
  supervisor.saveDiffs(db, workId, project, store);
  assert.deepStrictEqual(repo.diffsFor(db, workId).map((d) => d.file).sort(), ['a.txt', 'b.txt']);

  /* Retry: b.txt is put back the way it was, so it is no longer part of this change. */
  fs.writeFileSync(path.join(project.path, 'b.txt'), 'one\n');
  after = git.capture(project.path, store, 'after2');
  db.prepare('delete from evidence_basis where work_id = ? and phase = ?').run(workId, 'after');
  repo.saveBasis(db, workId, 'after', { kind: 'git_tree', ref: after.ref, excluded: [] });
  supervisor.saveDiffs(db, workId, project, store);

  assert.deepStrictEqual(repo.diffsFor(db, workId).map((d) => d.file), ['a.txt'],
    'a file that no longer differs still had a diff on SC-04');
});
