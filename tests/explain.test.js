/* WBS-26 · Change Groups — D-128 / REC-013, `19` §C5-X.
 *
 * The named risk on this package is OVERCLAIMING, and the model is the one party in the loop
 * with no way to check itself. So almost every test here hands `groupsFrom` a response that
 * claims MORE than the evidence supports, and asserts the claim did not survive.
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
const E = require(path.join(R, 'app/main/change/explain.js'));
const { KIND } = require(path.join(R, 'app/main/work/reducer.js'));

/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));


/** A Work with real raw_diff rows — the groups have to cite these and nothing else. */
function bench(files = { 'a.ts': '+one\n', 'b.ts': '+two\n' }) {
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-exp-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  for (const [file, patch] of Object.entries(files)) repo.saveDiff(db, workId, { file, patch });
  return { db, project, workId, diffs: repo.diffsFor(db, workId) };
}

const idOf = (diffs, file) => diffs.find((d) => d.file === file).id;
/* An OBSERVED RUN: a Bash tool_use and the tool_result that closed it, as the CLI actually
 * emits them. `19` §C5-X ties 확인됨 to a test/run result specifically — a Read or an Edit
 * returning proves nothing about whether the change works — so the fixture has to carry the
 * tool NAME, which lives on the use and not on the result. */
const bashUse = (id = 'tu_1') => ({
  id: `s-${id}`, kind: KIND.TOOL_USE,
  payload: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } }),
});
const toolResult = (id = 'tu_1', sid = 's1') => ({
  id: sid, kind: KIND.TOOL_RESULT,
  payload: JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false }] } }),
});
const RAN = [bashUse(), toolResult()];

/* ───────────── ① 모든 change_group 이 실제 raw_diff 를 인용한다 ───────────── */

test('a group citing a file this Work did not change loses that citation', () => {
  const { diffs } = bench();
  const { groups, dropped } = E.groupsFrom(
    JSON.stringify([{ title: 'T', what: 'w', files: ['a.ts', '../../etc/passwd', 'never-touched.ts'] }]),
    { diffs, signals: [] });

  assert.deepStrictEqual(dropped, ['../../etc/passwd', 'never-touched.ts']);
  assert.deepStrictEqual(groups[0].files, [idOf(diffs, 'a.ts')],
    'a group cites raw_diff ROWS — a path the model invented resolves to nothing');
});

test('a group that cites only invented files is not a group at all', () => {
  const { diffs } = bench();
  const { groups } = E.groupsFrom(JSON.stringify([{ title: 'ghost', what: 'w', files: ['nope.ts'] }]),
                                  { diffs, signals: [] });
  assert.ok(!groups.some((g) => g.title === 'ghost'), 'it cited no evidence, so it is not a group');
  assert.strictEqual(groups.length, 1, 'what remains is the 설명 못함 group for the real files');
  assert.strictEqual(groups[0].explainable, false);
});

test('a raw_diff belongs to exactly one group (D-121)', () => {
  const { diffs } = bench();
  const { groups } = E.groupsFrom(JSON.stringify([
    { title: 'first', files: ['a.ts', 'b.ts'] },
    { title: 'second', files: ['a.ts'] },
  ]), { diffs, signals: [] });

  const owners = groups.flatMap((g) => g.files);
  assert.strictEqual(new Set(owners).size, owners.length, 'no diff row is owned twice');
  assert.ok(!groups.some((g) => g.title === 'second'), 'the second claimant kept nothing, so it is empty');
});

/* ───────────── ② 확인됨 은 관측된 실행 결과가 있을 때만 (D-114) ───────────── */

test('확인됨 does not survive without an observed run', () => {
  const { diffs } = bench();
  const { groups, downgraded } = E.groupsFrom(
    JSON.stringify([{ title: 'T', what: '테스트가 통과합니다', confidence: 'confirmed', files: ['a.ts', 'b.ts'] }]),
    { diffs, signals: [] });

  assert.strictEqual(groups[0].confidence, 'expected', 'the model saying so is 예상됨, never 확인됨');
  assert.strictEqual(groups[0].sourceRef, null);
  assert.strictEqual(downgraded, 1);
});

test('확인됨 survives WITH an observed run, and names the signal it rests on', () => {
  /* The counterpart: a rule that downgraded everything unconditionally would pass the test
   * above and be wrong. `19` §C5-X allows 확인됨 exactly here. */
  const { diffs } = bench();
  const { groups, downgraded } = E.groupsFrom(
    JSON.stringify([{ title: 'T', confidence: 'confirmed', files: ['a.ts', 'b.ts'] }]),
    { diffs, signals: RAN });

  assert.strictEqual(groups[0].confidence, 'confirmed');
  assert.strictEqual(groups[0].sourceRef, 'signal:s1', 'the chip is a promise the user can check');
  assert.strictEqual(downgraded, 0);
});

test('a tool that only STARTED is not an observed result', () => {
  const { diffs } = bench();
  const started = [bashUse()];                 // the run began; nothing came back
  assert.strictEqual(E.observedRun(started).observed, false);
  const { groups } = E.groupsFrom(JSON.stringify([{ title: 'T', confidence: 'confirmed', files: ['a.ts', 'b.ts'] }]),
                                  { diffs, signals: started });
  assert.strictEqual(groups[0].confidence, 'expected');
});

test('a Work that only EDITED files observes no run, whatever tools returned', () => {
  /* Measured by the batch-06 review: `observedRun` counted every `tool_result`, so a Work that
   * only read and edited files let the model's own "confirmed" stand on every group — and the
   * `sourceRef` pointed at whichever tool happened to return last. `19` §C5-X says test/run
   * result, and a Read returning proves nothing about whether the change works. */
  const { diffs } = bench();
  const edited = [
    { id: 'u1', kind: KIND.TOOL_USE,
      payload: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_e', name: 'Edit', input: {} }] } }) },
    toolResult('tu_e', 'r1'),
    { id: 'u2', kind: KIND.TOOL_USE,
      payload: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_r', name: 'Read', input: {} }] } }) },
    toolResult('tu_r', 'r2'),
  ];
  assert.strictEqual(E.observedRun(edited).observed, false, 'an Edit and a Read are not a run');

  const { groups, downgraded } = E.groupsFrom(
    JSON.stringify([{ title: 'T', what: '테스트가 통과합니다', confidence: 'confirmed', files: ['a.ts', 'b.ts'] }]),
    { diffs, signals: edited });
  assert.strictEqual(groups[0].confidence, 'expected');
  assert.strictEqual(downgraded, 1);
});

test('a run that started and returned IS observed, and the citation is that result', () => {
  const { diffs } = bench();
  const signals = [bashUse('tu_x'), toolResult('tu_x', 'sig-run')];
  const o = E.observedRun(signals);
  assert.strictEqual(o.observed, true);
  assert.strictEqual(o.sourceRef, 'signal:sig-run');
  assert.strictEqual(E.groupsFrom(JSON.stringify([{ title: 'T', confidence: 'confirmed', files: ['a.ts', 'b.ts'] }]),
                                  { diffs, signals }).groups[0].confidence, 'confirmed');
});

test('an unparseable signal payload contributes nothing rather than throwing', () => {
  assert.strictEqual(E.observedRun([{ id: 'x', kind: KIND.TOOL_USE, payload: 'not json' }]).observed, false);
  assert.strictEqual(E.observedRun([{ id: 'x', kind: KIND.TOOL_USE, payload: null }]).observed, false);
  assert.strictEqual(E.observedRun([]).observed, false);
});

test('a confidence word outside D-114 becomes 예상됨, not itself', () => {
  const { diffs } = bench();
  for (const bogus of ['certain', '확실함', true, 99, null]) {
    const { groups } = E.groupsFrom(JSON.stringify([{ title: 'T', confidence: bogus, files: ['a.ts', 'b.ts'] }]),
                                    { diffs, signals: RAN });
    assert.strictEqual(groups[0].confidence, 'expected', `${JSON.stringify(bogus)} is not a confidence`);
  }
});

/* ───────────── ③ 설명 실패 → 설명 못함, 이유를 만들지 않는다 ───────────── */

test('a refusal, a crash and silence all become 설명 못함 — with no invented reason', () => {
  const { diffs } = bench();
  for (const response of [null, '', '설명할 수 없습니다', '{"oops":1}', 'not json at all', undefined]) {
    const { groups } = E.groupsFrom(response, { diffs, signals: RAN });
    assert.strictEqual(groups.length, 1, `one 설명 못함 group for: ${String(response)}`);
    assert.strictEqual(groups[0].explainable, false);
    assert.strictEqual(groups[0].why, null, 'no reason is invented for a failure to explain');
    assert.strictEqual(groups[0].what, null);
    assert.strictEqual(groups[0].confidence, null, '설명 못함 makes no confidence claim either');
    assert.strictEqual(groups[0].files.length, diffs.length, 'and no change is lost');
  }
});

test('files the pass skipped are collected, not dropped', () => {
  const { diffs } = bench({ 'a.ts': '+1\n', 'b.ts': '+2\n', 'c.ts': '+3\n' });
  const { groups } = E.groupsFrom(JSON.stringify([{ title: 'T', what: 'w', files: ['a.ts'] }]),
                                  { diffs, signals: [] });
  const unexplained = groups.find((g) => !g.explainable);
  assert.ok(unexplained, 'the two files nobody explained still have to appear');
  assert.strictEqual(unexplained.files.length, 2);
  assert.strictEqual(groups.flatMap((g) => g.files).length, 3, 'every change is in exactly one group');
});

test('a fenced or prefaced JSON answer is still read', () => {
  const { diffs } = bench();
  const wrapped = '알겠습니다.\n```json\n[{"title":"T","what":"w","files":["a.ts","b.ts"]}]\n```\n';
  const { groups } = E.groupsFrom(wrapped, { diffs, signals: [] });
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].explainable, true);
  assert.strictEqual(groups[0].title, 'T');
});

test('brackets in the preamble do not swallow the answer', () => {
  /* A mutant that deleted the fence handling survived: with a clean fence the bracket scan
   * finds the array anyway. It only matters when the model writes a bracket BEFORE the fence,
   * which is what a preamble in Korean routinely does. */
  const wrapped = '아래와 같이 묶었어요 [참고: 2개]\n```json\n[{"title":"T","what":"w","files":["a.ts","b.ts"]}]\n```';
  const { groups } = E.groupsFrom(wrapped, { diffs: bench().diffs, signals: [] });
  assert.strictEqual(groups.length, 1, 'the answer is inside the fence, not between the first [ and the last ]');
  assert.strictEqual(groups[0].title, 'T');
  assert.strictEqual(groups[0].explainable, true);
});

test('an empty title falls back to the file names, which are facts', () => {
  const { diffs } = bench();
  const { groups } = E.groupsFrom(JSON.stringify([{ title: '   ', what: 'w', files: ['a.ts'] }]),
                                  { diffs, signals: [] });
  assert.strictEqual(groups[0].title, 'a.ts', 'a title made of file names is measured; an invented one is not');
});

/* ───────────── persistence ───────────── */

test('groups round-trip through the database with their files', () => {
  const { db, workId, diffs } = bench();
  const { groups } = E.groupsFrom(JSON.stringify([{ title: 'T', what: 'w', why: 'y', affects: 'a', files: ['a.ts'] }]),
                                  { diffs, signals: [] });
  repo.saveChangeGroups(db, workId, groups);

  const back = repo.changeGroupsFor(db, workId);
  assert.strictEqual(back.length, 2);
  assert.deepStrictEqual(back[0].files, ['a.ts']);
  assert.strictEqual(back[0].what, 'w');
  assert.strictEqual(back[1].explainable, false);
  assert.deepStrictEqual(back[1].files, ['b.ts']);
});

test('re-running the pass replaces the groups instead of doubling their owners', () => {
  const { db, workId, diffs } = bench();
  repo.saveChangeGroups(db, workId,
    E.groupsFrom(JSON.stringify([{ title: 'first', files: ['a.ts', 'b.ts'] }]), { diffs, signals: [] }).groups);
  repo.saveChangeGroups(db, workId,
    E.groupsFrom(JSON.stringify([{ title: 'second', files: ['a.ts'] }]), { diffs, signals: [] }).groups);

  const back = repo.changeGroupsFor(db, workId);
  assert.deepStrictEqual(back.map((g) => g.title), ['second', 'b.ts']);
  const owners = back.flatMap((g) => g.files);
  assert.strictEqual(new Set(owners).size, owners.length, 'D-121: one owner per diff, after a re-run too');
});

test('an unknown confidence is refused by the database, not just by us', () => {
  /* The vocabulary is a foreign key in `20`. If the guard in `groupsFrom` were ever removed,
   * this is the second wall — and this test proves the wall is actually standing. */
  const { db, workId, diffs } = bench();
  assert.throws(() => repo.saveChangeGroups(db, workId, [
    { ord: 0, title: 'T', confidence: 'certain', explainable: true, files: [idOf(diffs, 'a.ts')] },
  ]), /FOREIGN KEY|constraint/i);
});

test('a group cannot cite a diff row belonging to another Work', () => {
  const { db, project, diffs } = bench();
  const other = repo.beginWork(db, project.id, 'y');
  assert.strictEqual(other.ok, false, 'D-117 still holds — one active Work per project');
  assert.throws(() => repo.saveChangeGroups(db, 'no-such-work', [
    { ord: 0, title: 'T', explainable: true, files: [idOf(diffs, 'a.ts')] },
  ]), /FOREIGN KEY|constraint/i);
});

/* ───────────── the prompt hands over the diff; it does not hand over the project ───────────── */

test('the pass is given the diff text JuQode already measured', () => {
  /* This test used to be named "…and no tools" and asserted nothing about tools — the argv
   * assertion that actually checks that is further down. A name that claims more than the body
   * checks is how the missing restriction survived review. */
  const { diffs } = bench();
  const prompt = E.promptFor(diffs);
  assert.ok(prompt.includes('a.ts') && prompt.includes('+one'), 'the diff JuQode measured goes in the prompt');
  assert.ok(prompt.includes('파일을 고치지 마세요'));
  assert.deepStrictEqual(E.PROMPT_BUDGET, 120 * 1024);
});

test('a prompt over budget elides files instead of growing without bound', () => {
  const big = '+x\n'.repeat(80 * 1024);
  const { diffs } = bench({ 'big1.ts': big, 'big2.ts': big, 'big3.ts': big });
  const prompt = E.promptFor(diffs);
  assert.ok(prompt.length < E.PROMPT_BUDGET * 2, `prompt was ${prompt.length}`);
  assert.ok(prompt.includes('(생략됨)'), 'and it says which files it could not carry');
  for (const f of ['big1.ts', 'big2.ts', 'big3.ts']) {
    assert.ok(prompt.includes(f), `${f} is still named, so nothing silently disappears`);
  }
});

/* ───────────── the live pass, through a real child process ───────────── */

/** A CLI that answers with exactly the given text, in the stream-json shape the app parses. */
function fakeCli(answer, { silent = false } = {}) {
  const home = tempDir('juqode-cli-');
  const script = path.join(home, 'fake.js');
  const bin = path.join(home, 'fake');
  const events = silent ? [] : [
    { type: 'system', subtype: 'init', session_id: 's', cwd: '/p' },
    { type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: answer },
  ];
  fs.writeFileSync(script,
    'for (const e of ' + JSON.stringify(events) + ') process.stdout.write(JSON.stringify(e) + "\\n");\n');
  fs.writeFileSync(bin, '#!/bin/sh\nexec ' + process.execPath + ' ' + script + ' "$@"\n', { mode: 0o755 });
  return bin;
}

test('the pass runs, and what it returns is persisted', async () => {
  const { db, project, workId } = bench();
  const bin = fakeCli('[{"title":"인증 갱신","what":"토큰을 다시 받아요","files":["a.ts","b.ts"]}]');

  const out = await E.explain(db, workId, { bin, cwd: project.path });
  assert.strictEqual(out.ok, true);
  const back = repo.changeGroupsFor(db, workId);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].title, '인증 갱신');
  assert.deepStrictEqual(back[0].files, ['a.ts', 'b.ts']);
});

test('a pass that says nothing at all leaves every change 설명 못함', async () => {
  const { db, project, workId } = bench();
  const out = await E.explain(db, workId, { bin: fakeCli('', { silent: true }), cwd: project.path });

  assert.strictEqual(out.reason, 'no-response');
  const back = repo.changeGroupsFor(db, workId);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].explainable, false);
  assert.strictEqual(back[0].why, null);
  assert.deepStrictEqual(back[0].files, ['a.ts', 'b.ts'], 'the changes are still all accounted for');
});

test('a Work with no changes needs no explanation and invents none', async () => {
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-exp-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;

  const out = await E.explain(db, workId, { bin: fakeCli('[]'), cwd: project.path });
  assert.strictEqual(out.reason, 'no-changes');
  assert.deepStrictEqual(repo.changeGroupsFor(db, workId), []);
});

test('the live pass downgrades 확인됨 exactly as the pure one does', async () => {
  const { db, project, workId } = bench();
  const bin = fakeCli('[{"title":"T","confidence":"confirmed","files":["a.ts","b.ts"]}]');

  const out = await E.explain(db, workId, { bin, cwd: project.path });
  assert.strictEqual(out.downgraded, 1, 'this Work observed no run');
  assert.strictEqual(repo.changeGroupsFor(db, workId)[0].confidence, 'expected');
});

/* ───────────── batch-06 review · what a FAILED pass must not destroy ───────────── */

test('a file named twice in one group does not throw the whole pass away', () => {
  /* Measured by the review: `claimed` de-duplicated ACROSS groups but not WITHIN one, so
   * `files: ["a.ts","a.ts"]` — an ordinary model slip — reached `change_group_file`'s composite
   * primary key as a duplicate insert. The write threw out of `explain()`, the whole pass was
   * discarded, and the user got a re-enabled button and no message. */
  const { db, workId, diffs } = bench();
  const { groups } = E.groupsFrom(JSON.stringify([{ title: 'T', what: 'w', files: ['a.ts', 'a.ts', 'b.ts'] }]),
                                  { diffs, signals: [] });
  assert.strictEqual(groups[0].files.length, 2, 'the duplicate is dropped, not carried');
  assert.doesNotThrow(() => repo.saveChangeGroups(db, workId, groups));
  assert.deepStrictEqual(repo.changeGroupsFor(db, workId)[0].files, ['a.ts', 'b.ts']);
});

test('a pass that explains nothing does not erase a pass that explained something', async () => {
  /* Measured: the 설명 받기 button sits on the 설명 못함 card — which is exactly the card a
   * PARTIALLY explained Work still has. Pressing it with the CLI unavailable replaced two good
   * groups with one 설명 못함 group covering every file, and still reported success. */
  const { db, project, workId } = bench({ 'a.ts': '+1\n', 'b.ts': '+2\n', 'c.ts': '+3\n' });

  const good = fakeCli('[{"title":"인증 갱신","what":"토큰을 다시 받아요","files":["a.ts","b.ts"]}]');
  await E.explain(db, workId, { bin: good, cwd: project.path });
  const before = repo.changeGroupsFor(db, workId);
  assert.strictEqual(before.filter((g) => g.explainable).length, 1);

  /* Now the pass fails — the CLI says nothing at all. */
  const out = await E.explain(db, workId, { bin: fakeCli('', { silent: true }), cwd: project.path });
  assert.strictEqual(out.ok, false, 'a failure that changed nothing must not report success');
  assert.strictEqual(out.kept, true);

  const after = repo.changeGroupsFor(db, workId);
  assert.deepStrictEqual(after.map((g) => g.title), before.map((g) => g.title),
    'the good explanation survived the failed re-run');
  assert.strictEqual(after.find((g) => g.explainable).what, '토큰을 다시 받아요');
});

test('a pass that explains something DOES replace an earlier one', () => {
  /* The counterpart: a rule that never overwrote would pass the test above and make the
   * explanation un-redoable. */
  const { db, workId, diffs } = bench();
  repo.saveChangeGroups(db, workId,
    E.groupsFrom(JSON.stringify([{ title: 'first', what: 'w1', files: ['a.ts', 'b.ts'] }]), { diffs, signals: [] }).groups);
  repo.saveChangeGroups(db, workId,
    E.groupsFrom(JSON.stringify([{ title: 'second', what: 'w2', files: ['a.ts', 'b.ts'] }]), { diffs, signals: [] }).groups);
  assert.deepStrictEqual(repo.changeGroupsFor(db, workId).map((g) => g.title), ['second']);
});

test('the prompt is bounded even when the file COUNT is what is large', () => {
  /* MEDIUM: only the included chunks were counted, so the elision lines themselves grew the
   * prompt without bound — the very lines meant to keep it small. */
  const files = {};
  for (let i = 0; i < 4000; i++) files[`f${i}.ts`] = '+x\n'.repeat(200);
  const { diffs } = bench(files);
  const prompt = E.promptFor(diffs);
  assert.ok(prompt.length < E.PROMPT_BUDGET * 1.2, `prompt was ${prompt.length} for ${diffs.length} files`);
  assert.ok(/그 밖에 \d+개 파일은/.test(prompt),
    'files that did not fit at all must still be COUNTED — one that vanishes silently is never mentioned again');
});

/* ───────────── the read model SC-04 is built from ─────────────
 * `readerFor` had no test at all, and the branch it takes once a pass HAS explained something —
 * the branch a user reaches the moment they press 설명 받기 — was executed by nothing in the
 * repository, unit or e2e. Four separate mutations to it survived the whole suite, including
 * one that ignored every persisted group forever. */

const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));

test('readerFor returns the PERSISTED groups once a pass has explained something', () => {
  /* The survivor: `let groups = []` in place of `repo.changeGroupsFor(...)`. With it, a user
   * runs the pass, it succeeds, and SC-04 keeps showing 설명 못함 forever. */
  const { db, project, workId, diffs } = bench();
  repo.saveChangeGroups(db, workId,
    E.groupsFrom(JSON.stringify([{ title: '인증 갱신', what: '토큰을 다시 받아요', why: 'y', affects: 'a',
                                   files: ['a.ts', 'b.ts'] }]), { diffs, signals: [] }).groups);

  const reader = supervisor.readerFor(db, workId, project, null);
  assert.strictEqual(reader.groups.length, 1);
  assert.strictEqual(reader.groups[0].title, '인증 갱신');
  assert.strictEqual(reader.groups[0].what, '토큰을 다시 받아요');
  assert.strictEqual(reader.groups[0].explainable, true);
  assert.ok(!reader.groups[0].pending, 'an explained group is not pending');
});

test('readerFor hands SC-04 file PATHS, never raw_diff ids', () => {
  /* Another survivor: dropping the id→path map. SC-04 would then print UUIDs where file names
   * belong, and every per-file lookup in the reader would miss. */
  const { db, project, workId } = bench();
  const reader = supervisor.readerFor(db, workId, project, null);
  const names = reader.groups.flatMap((g) => g.files.map((f) => f.file));
  assert.deepStrictEqual(names.sort(), ['a.ts', 'b.ts']);
  for (const n of names) {
    assert.ok(!/^[0-9a-f-]{36}$/.test(n), `${n} is a row id, not a file name`);
  }
});

test('a Work nobody has explained yet is PENDING, not failed', () => {
  /* `18` reader.unexplained means "LLM 설명 실패/거부". Announcing it for a pass that was never
   * run is the product reporting its own failure for work it never attempted. */
  const { db, project, workId } = bench();
  const reader = supervisor.readerFor(db, workId, project, null);
  assert.strictEqual(reader.groups.length, 1);
  assert.strictEqual(reader.groups[0].explainable, false);
  assert.strictEqual(reader.groups[0].pending, true, 'nothing has failed — nothing was asked');
});

test('a group that a pass DID fail on is not pending', () => {
  const { db, project, workId, diffs } = bench();
  /* The pass ran and explained one file; the other is a real 설명 못함. */
  repo.saveChangeGroups(db, workId,
    E.groupsFrom(JSON.stringify([{ title: 'T', what: 'w', files: ['a.ts'] }]), { diffs, signals: [] }).groups);
  const reader = supervisor.readerFor(db, workId, project, null);
  const failed = reader.groups.find((g) => !g.explainable);
  assert.ok(failed, 'the unexplained file still has a group');
  assert.ok(!failed.pending, 'a pass ran and did not explain it — that is 설명 못함, not pending');
});

test('a diff carries its displayability through to the screen', () => {
  /* Survivor: `displayable: true` unconditionally, which renders a binary file as an empty
   * text pane instead of the 표시 불가 sentence. */
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-exp-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  repo.saveDiff(db, workId, { file: 'logo.png', patch: '', displayable: false });
  repo.saveDiff(db, workId, { file: 'a.ts', patch: '+1\n', displayable: true });

  const files = supervisor.readerFor(db, workId, project, null).groups.flatMap((g) => g.files);
  assert.strictEqual(files.find((f) => f.file === 'logo.png').displayable, false);
  assert.strictEqual(files.find((f) => f.file === 'a.ts').displayable, true);
});

test('a Work with no stored patch does not claim it changed nothing', () => {
  /* The product blocker: SC-04's empty state carries (확인됨). Only a git basis produces a
   * patch, so a non-Git Work reached that sentence while SC-03 said 변경 3개 one click earlier.
   * `12` has a state for "we could not tell" and none for telling the user the opposite. */
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-exp-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;

  const reader = supervisor.readerFor(db, workId, project, null);
  assert.strictEqual(reader.groups.length, 0);
  assert.strictEqual(reader.unknown, true, 'no basis at all means UNKNOWN, never "nothing changed"');
});

test('a 확인됨 group persists the evidence it names, and one without evidence is downgraded', () => {
  /* D-114: 확인됨 names the fact it rests on. `interpretation_answer` has a CHECK saying so;
   * `change_group` had no column at all, so the reference was computed, asserted on in a test,
   * and dropped on the floor — a group re-read from the store showed a ✓ 확인됨 chip citing
   * nothing. SQLite cannot ADD a CHECK to an existing table, so the rule lives in the writer,
   * and this is what holds the writer to it. CANON_FINDINGS CF-13. */
  const { db, workId, diffs } = bench();
  repo.saveChangeGroups(db, workId, [
    { ord: 0, title: 'sourced', confidence: 'confirmed', sourceRef: 'signal:s1',
      explainable: true, files: [idOf(diffs, 'a.ts')] },
    { ord: 1, title: 'unsourced', confidence: 'confirmed', sourceRef: null,
      explainable: true, files: [idOf(diffs, 'b.ts')] },
  ]);

  const back = repo.changeGroupsFor(db, workId);
  assert.strictEqual(back[0].confidence, 'confirmed');
  assert.strictEqual(back[0].sourceRef, 'signal:s1', 'the citation survives the round trip');
  assert.strictEqual(back[1].confidence, 'expected', 'a 확인됨 with no evidence is not 확인됨');
  assert.strictEqual(back[1].sourceRef, null);
});

test('an existing store gains the source_ref column rather than being rebuilt', () => {
  /* Forward-only migrations, and this is the first one. A store written before this batch must
   * keep its History — `20`'s promise is that History never disappears. */
  const file = path.join(tempDir('juqode-mig-'), 'old.db');
  const old = openDb(file);
  const project = repo.openProject(old, tempDir('juqode-p-'), 'p');
  const workId = repo.beginWork(old, project.id, 'x').work.id;
  repo.saveDiff(old, workId, { file: 'a.ts', patch: '+1\n' });
  old.exec('drop table change_group');
  old.exec(`create table change_group (
    id uuid primary key, work_id uuid not null references work(id) on delete cascade,
    ord smallint not null, title text not null, what text, why text, affects text,
    confidence text references confidence(code),
    explainable boolean not null default true, unique (work_id, ord))`);
  /* Put the store back at version 1, the shape it had before this migration existed. Each
   * applied version is its own row, so the later ones are removed rather than renumbered. */
  old.exec('delete from schema_version where version > 1');
  old.close();

  const reopened = openDb(file);
  const cols = reopened.prepare('select * from pragma_table_info(?)').all('change_group').map((c) => c.name);
  assert.ok(cols.includes('source_ref'), `the migration did not run: ${cols.join(',')}`);
  assert.deepStrictEqual(repo.diffsFor(reopened, workId).map((d) => d.file), ['a.ts'],
    'the store kept everything it already held');
  reopened.close();
});

/* ───────────── the tool restriction, asserted on the ARGV that actually leaves ───────────── */

/** A fake CLI that records exactly what argv it received, then answers. */
function argvCli(answer = '[]') {
  const home = tempDir('juqode-argv-');
  const log = path.join(home, 'ARGV.log');
  const script = path.join(home, 'fake.js');
  const bin = path.join(home, 'fake');
  fs.writeFileSync(script, [
    `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    `process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', cwd: '/p' }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: ${JSON.stringify(answer)} }) + '\\n');`,
  ].join('\n'));
  fs.writeFileSync(bin, '#!/bin/sh\nexec ' + process.execPath + ' ' + script + ' "$@"\n', { mode: 0o755 });
  return { bin, argv: () => (fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8').split('\n')[0]) : null) };
}

test('the explanation pass really is launched with the built-in tool set EMPTIED', async () => {
  /* This is the assertion that was missing, and its absence let a BLOCKER through: the pass
   * used `allowedTools: []`, an EMPTY ALLOW LIST, which makes `session.run` push no argument at
   * all — so a pass documented as "no tools at all" ran with the CLI's entire default set, in
   * the user's project directory, after the Work had already ended. The old test was named
   * "…and no tools" and checked only the prompt text.
   *
   * MEASURED separately (Claude Code 2.1.266, disposable scratch dir): asked to edit a file
   * with `--tools ""`, the CLI produced a text-only turn and the file was byte-identical. */
  const { db, project, workId } = bench();
  const { bin, argv } = argvCli('[{"title":"T","what":"w","files":["a.ts","b.ts"]}]');

  await E.explain(db, workId, { bin, cwd: project.path });

  const args = argv();
  assert.ok(args, 'the pass never spawned anything');
  const at = args.indexOf('--tools');
  assert.ok(at !== -1, `no tool restriction reached the CLI: ${JSON.stringify(args)}`);
  assert.strictEqual(args[at + 1], '', '`--tools ""` is what empties the set; anything else grants tools');
  assert.ok(!args.includes('--allowedTools'),
    'an ALLOW list grants tools — it is the opposite of the restriction this pass needs');
});

test('a Work turn is NOT tool-restricted — the flag belongs only to the read-only pass', async () => {
  /* The counterpart. A restriction applied everywhere would pass the test above and stop Claude
   * Code from doing the Work at all. */
  const { session } = { session: require(path.join(R, 'app/main/claude/session.js')) };
  const { bin, argv } = argvCli();
  await session.run({ cwd: tempDir('juqode-run-'), bin, sessionId: 'sid', prompt: 'x', onSignal: () => {} });
  assert.ok(!argv().includes('--tools'), `a Work turn carried a tool restriction: ${JSON.stringify(argv())}`);
});
