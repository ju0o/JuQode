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

const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
process.on('exit', () => {
  for (const d of juqodeTempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});

/** A Work with real raw_diff rows — the groups have to cite these and nothing else. */
function bench(files = { 'a.ts': '+one\n', 'b.ts': '+two\n' }) {
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-exp-'), 'p');
  const workId = repo.beginWork(db, project.id, 'x').work.id;
  for (const [file, patch] of Object.entries(files)) repo.saveDiff(db, workId, { file, patch });
  return { db, project, workId, diffs: repo.diffsFor(db, workId) };
}

const idOf = (diffs, file) => diffs.find((d) => d.file === file).id;
const RAN = [{ id: 's1', kind: KIND.TOOL_RESULT, payload: '{}' }];

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
  const started = [{ id: 's1', kind: KIND.TOOL_USE, payload: '{}' }];
  assert.strictEqual(E.observedRun(started).observed, false);
  const { groups } = E.groupsFrom(JSON.stringify([{ title: 'T', confidence: 'confirmed', files: ['a.ts', 'b.ts'] }]),
                                  { diffs, signals: started });
  assert.strictEqual(groups[0].confidence, 'expected');
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

test('the pass is given the diff text and no tools', () => {
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
