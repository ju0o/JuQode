/* WBS-04 · the Brief's narrative layer — `19` §C1 ②, REC-008, D-114.
 *
 * The named risk is the same as WBS-26's and it has the same shape: the model is the one party
 * here that cannot check itself, and this layer speaks to the three questions where JuQode
 * measured NOTHING. So almost every test below hands `merge` an answer that claims more than
 * the facts support, and asserts the claim did not survive.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const N = require(path.join(R, 'app/main/interpret/narrate.js'));
const { answers } = require(path.join(R, 'app/main/interpret/answers.js'));
const { scan } = require(path.join(R, 'app/main/interpret/scan.js'));

const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
process.on('exit', () => {
  for (const d of juqodeTempDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});

/** A real project, scanned by the real facts layer — not a hand-written six rows. */
function bench(files = {}) {
  const dir = tempDir('juqode-nar-');
  const all = {
    'package.json': JSON.stringify({ name: 'todo', scripts: { dev: 'vite', test: 'node --test' },
                                     dependencies: { vite: '^5' } }, null, 2),
    'package-lock.json': '{"lockfileVersion":3}',
    'README.md': '# todo\n\n할 일을 적는 작은 앱이에요.\n',
    '.env': 'SECRET_TOKEN=juqode-synthetic-fixture-marker\n',
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'export const hi = 1;\n');

  const scanned = scan(dir);
  return { dir, scanned, deterministic: answers(scanned), readFiles: scanned.readFiles };
}

const answerFor = (rows, q) => rows.find((r) => r.q === q);

/* ───────── ① a measured answer is never replaced ───────── */

test('the narrative layer cannot overwrite a measured answer', () => {
  const b = bench();
  const tech = answerFor(b.deterministic, 3);
  assert.strictEqual(tech.confidence, 'confirmed', 'the fixture must actually have a measured row');

  const { answers: merged, refused } = N.merge(
    JSON.stringify([{ q: 3, text: '이 프로젝트는 러스트로 만들었어요', cites: b.readFiles }]),
    b);

  const after = answerFor(merged, 3);
  assert.deepStrictEqual(after, tech, 'a model sentence replaced a manifest');
  assert.ok(refused.includes('q3:measured'));
});

test('a question the facts layer owns is not the narrative layer\'s to answer', () => {
  /* `19` §C1 splits the six. ⑤ 실행 방법 comes from declared scripts or from nowhere; a model
   * answer for it would be an invented way to run the project — the thing §C4 forbids too. */
  const b = bench({ 'package.json': JSON.stringify({ name: 'x' }) });   // no scripts at all
  assert.strictEqual(answerFor(b.deterministic, 5).confidence, 'unconfirmed');

  const { answers: merged, refused } = N.merge(
    JSON.stringify([{ q: 5, text: 'npm start 로 실행해요', cites: b.readFiles }]), b);

  assert.strictEqual(answerFor(merged, 5).kind, 'no-scripts', 'a way to run it was invented');
  assert.ok(!answerFor(merged, 5).data, 'the invented command was carried anyway');
  assert.ok(refused.includes('q5:not-narrative'));
});

/* ───────── ② the narrative layer is never 확인됨ple ───────── */

test('no narrative answer is ever 확인됨, however it is cited', () => {
  /* `19` §C1 ①: only the facts layer's own output can be 확인됨 — and for these three questions
   * the facts layer measured nothing. `20` also requires a `source_ref` on every confirmed row,
   * and a sentence has no file to name. */
  const b = bench();
  for (const claim of ['confirmed', 'expected', 'unconfirmed', '확인됨', true, null]) {
    const { answers: merged } = N.merge(
      JSON.stringify([{ q: 1, text: '할 일 앱이에요', cites: ['README.md'], confidence: claim }]), b);
    const a = answerFor(merged, 1);
    assert.notStrictEqual(a.confidence, 'confirmed', `the model's "${claim}" reached the screen`);
    assert.strictEqual(a.sourceRef, null, 'a narrative answer named a source it does not have');
  }
});

test('a citation the scan actually read makes it 예상됨', () => {
  const b = bench();
  assert.ok(b.readFiles.includes('README.md'), 'the fixture must have read the README');
  const { answers: merged, grounded } = N.merge(
    JSON.stringify([{ q: 1, text: '할 일을 적는 앱이에요', cites: ['README.md'] }]), b);

  const a = answerFor(merged, 1);
  assert.strictEqual(a.confidence, 'expected');
  assert.strictEqual(a.kind, 'narrative');
  assert.deepStrictEqual(a.data.cites, ['README.md']);
  assert.strictEqual(grounded, 1);
});

test('a citation nobody read is 확인 못함 — and the sentence is still shown', () => {
  /* "we think this, and we cannot show you why" is a real state, and `18` has a chip for it.
   * Dropping the sentence would hide the only answer there is; promoting it would be a lie. */
  const b = bench();
  const { answers: merged, grounded, filled } = N.merge(
    JSON.stringify([{ q: 1, text: '결제 시스템이에요', cites: ['does-not-exist.ts', '/etc/passwd'] }]), b);

  const a = answerFor(merged, 1);
  assert.strictEqual(a.confidence, 'unconfirmed');
  assert.strictEqual(a.data.text, '결제 시스템이에요', 'the answer was dropped instead of marked');
  assert.deepStrictEqual(a.data.cites, [], 'a path nobody read must not be shown as evidence');
  assert.strictEqual(grounded, 0);
  assert.strictEqual(filled, 1);
});

test('an excluded file can never become a citation', () => {
  /* `19` §C1 ④ keeps `.env*` out of the read entirely, so it is not in `readFiles` and cannot
   * survive the filter. The exclusion holds because the pass is handed the LIST, not the disk. */
  const b = bench();
  assert.ok(!b.readFiles.some((f) => f.includes('.env')), 'the scan read a .env file');

  const { answers: merged } = N.merge(
    JSON.stringify([{ q: 1, text: '토큰을 쓰는 앱이에요', cites: ['.env'] }]), b);
  const a = answerFor(merged, 1);
  assert.deepStrictEqual(a.data.cites, []);
  assert.strictEqual(a.confidence, 'unconfirmed');
});

/* ───────── ③ a failed pass is 부분, not 실패 ───────── */

test('a refusal, a crash and silence all leave the facts exactly as they were', () => {
  const b = bench();
  for (const response of [null, undefined, '', '설명할 수 없습니다', 'not json', '{"oops":1}', []]) {
    const { answers: merged, filled } = N.merge(response, b);
    assert.deepStrictEqual(merged, b.deterministic, `the facts changed for: ${String(response)}`);
    assert.strictEqual(filled, 0);
  }
});

test('a partial answer fills what it answered and leaves the rest alone', () => {
  /* `19` §C1 ⑥: 부분 ≠ 실패. Two of three answered is two answers, not a failure. */
  const b = bench();
  const { answers: merged, filled } = N.merge(
    JSON.stringify([{ q: 1, text: '할 일 앱', cites: ['README.md'] }]), b);

  assert.strictEqual(filled, 1);
  assert.strictEqual(answerFor(merged, 1).kind, 'narrative');
  assert.deepStrictEqual(answerFor(merged, 2), answerFor(b.deterministic, 2), 'q2 was touched');
  assert.deepStrictEqual(answerFor(merged, 4), answerFor(b.deterministic, 4), 'q4 was touched');
});

test('an empty or non-string answer is not an answer', () => {
  const b = bench();
  for (const text of ['', '   ', null, 42, {}, []]) {
    const { answers: merged, filled } = N.merge(JSON.stringify([{ q: 1, text, cites: ['README.md'] }]), b);
    assert.deepStrictEqual(answerFor(merged, 1), answerFor(b.deterministic, 1), `"${text}" became an answer`);
    assert.strictEqual(filled, 0);
  }
});

test('a second answer to the same question does not overwrite the first', () => {
  const b = bench();
  const { answers: merged } = N.merge(JSON.stringify([
    { q: 1, text: '첫 번째 답', cites: ['README.md'] },
    { q: 1, text: '두 번째 답', cites: ['README.md'] },
  ]), b);
  assert.strictEqual(answerFor(merged, 1).data.text, '첫 번째 답',
    'saying it twice is not more true than saying it once');
});

test('a non-numeric or out-of-range question is ignored', () => {
  const b = bench();
  for (const q of ['one', null, 0, 7, 99, 1.5]) {
    const { answers: merged } = N.merge(JSON.stringify([{ q, text: 'x', cites: ['README.md'] }]), b);
    assert.strictEqual(merged.length, 6, 'the six questions are a closed set');
    assert.deepStrictEqual(merged.map((a) => a.q), [1, 2, 3, 4, 5, 6]);
  }
});

/* ───────── the prompt hands over the facts, not the filesystem ───────── */

test('the prompt carries the facts and the file list, and no secret', () => {
  const b = bench();
  const prompt = N.promptFor({ deterministic: b.deterministic, readFiles: b.readFiles, facts: b.scanned.facts });

  assert.ok(prompt.includes('README.md'), 'the file list is what bounds the citations');
  assert.ok(prompt.includes('지어내지 마세요'));
  assert.ok(!prompt.includes('SECRET_TOKEN'), 'a secret VALUE reached the prompt');
  assert.ok(!/\.env\b/.test(prompt), 'an excluded path reached the prompt');
  assert.ok(prompt.length <= N.PROMPT_BUDGET, `prompt was ${prompt.length}`);
});

test('a project with thousands of read files still produces a bounded prompt', () => {
  const b = bench();
  const many = Array.from({ length: 20000 }, (_, i) => `src/very/deep/path/file-${i}.ts`);
  const prompt = N.promptFor({ deterministic: b.deterministic, readFiles: many, facts: b.scanned.facts });
  assert.ok(prompt.length <= N.PROMPT_BUDGET, `prompt was ${prompt.length}`);
});

test('the budget holds even when the file list alone is bigger than it', () => {
  /* Capping the COUNT is not the same as capping the SIZE, and a mutant that removed the size
   * cap survived because 20 000 short paths never reached the budget. Two hundred paths of
   * five hundred characters do — deep monorepo paths are exactly this shape. */
  const b = bench();
  const long = Array.from({ length: 200 }, (_, i) => `${'nested/'.repeat(70)}file-${i}.ts`);
  assert.ok(long.join('\n').length > N.PROMPT_BUDGET, 'the fixture must actually exceed the budget');

  const prompt = N.promptFor({ deterministic: b.deterministic, readFiles: long, facts: b.scanned.facts });
  assert.ok(prompt.length <= N.PROMPT_BUDGET + 32, `prompt was ${prompt.length}`);
  assert.ok(prompt.includes('생략됨'), 'a prompt that was cut must say it was cut');
});

/* ───────── the live pass ───────── */

/** A CLI that answers with the given text, in the stream-json shape the app parses. */
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

test('the live pass fills the three open questions', async () => {
  const b = bench();
  const bin = fakeCli(JSON.stringify([
    { q: 1, text: '할 일을 적는 앱이에요', cites: ['README.md'] },
    { q: 2, text: '추가 · 삭제 · 목록', cites: ['README.md'] },
    { q: 4, text: 'src 에 소스가 있어요', cites: ['README.md'] },
  ]));

  const out = await N.narrate({ ...b, cwd: b.dir, bin });
  assert.strictEqual(out.filled, 3);
  assert.strictEqual(out.reason, null);
  for (const q of [1, 2, 4]) {
    assert.strictEqual(answerFor(out.answers, q).confidence, 'expected', `q${q}`);
  }
  /* …and the measured rows came through untouched. */
  assert.deepStrictEqual(answerFor(out.answers, 3), answerFor(b.deterministic, 3));
});

test('a pass that says nothing leaves a facts-only Brief', async () => {
  /* `19` §C1 ⑥: 서술 실패 → 사실 층만으로 Brief(부분). Not a failure card. */
  const b = bench();
  const out = await N.narrate({ ...b, cwd: b.dir, bin: fakeCli('', { silent: true }) });

  assert.strictEqual(out.reason, 'no-response');
  assert.deepStrictEqual(out.answers, b.deterministic, 'a failed narrative lost the facts');
  assert.strictEqual(out.filled, 0);
});

test('the narrative pass is launched with the built-in tool set EMPTIED', async () => {
  /* Same contract as the change-explanation pass, and the same reason: a read-only pass that
   * can open files is not read-only, and `19` §C1 ④'s exclusions are enforced by what it is
   * HANDED, which only holds if it cannot go and look. */
  const home = tempDir('juqode-argv-');
  const log = path.join(home, 'argv.json');
  const script = path.join(home, 'fake.js');
  const bin = path.join(home, 'fake');
  fs.writeFileSync(script, [
    `require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));`,
    `process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', cwd: '/p' }) + '\\n');`,
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: '[]' }) + '\\n');`,
  ].join('\n'));
  fs.writeFileSync(bin, '#!/bin/sh\nexec ' + process.execPath + ' ' + script + ' "$@"\n', { mode: 0o755 });

  const b = bench();
  await N.narrate({ ...b, cwd: b.dir, bin });

  const argv = JSON.parse(fs.readFileSync(log, 'utf8'));
  const at = argv.indexOf('--tools');
  assert.ok(at !== -1, `no tool restriction reached the CLI: ${JSON.stringify(argv)}`);
  assert.strictEqual(argv[at + 1], '', '`--tools ""` is what empties the set');
  assert.ok(!argv.includes('--allowedTools'), 'an ALLOW list grants tools — the opposite restriction');
});

/* ───────── the handler: enrichment, never replacement ───────── */

function handlerBench(projectFiles = {}) {
  const { openDb } = require(path.join(R, 'app/main/db/db.js'));
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const b = bench(projectFiles);
  const db = openDb(':memory:');
  const project = repo.openProject(db, b.dir, path.basename(b.dir));
  return { ...b, db, repo, project,
           make: (bin) => makeHandlers({ db: () => db, dbFault: () => null,
                                         evidenceStore: () => tempDir('juqode-store-'),
                                         push: () => {}, claudeBin: () => bin }) };
}

test('the Brief keeps its measured answers when the narrative pass fails', async () => {
  /* `19` §C1 ⑥: 서술 실패 → 사실 층만으로 Brief(부분). The failure must not reach the screen as
   * a failed interpretation, and it must not cost the facts. */
  const h = handlerBench();
  const out = await h.make(fakeCli('', { silent: true }))['juqode:interpret'](null, h.project.id);

  assert.strictEqual(out.ok, true);
  assert.notStrictEqual(out.interpretation.status, 'failed', 'a narrative failure failed the Brief');
  const tech = answerFor(out.interpretation.answers, 3);
  assert.strictEqual(tech.confidence, 'confirmed');
  assert.ok(tech.sourceRef, '`20` requires a source_ref on every confirmed row');
  assert.strictEqual(out.narrative.filled, 0);
});

test('a successful pass fills the three open questions and persists them', async () => {
  const h = handlerBench();
  const bin = fakeCli(JSON.stringify([
    { q: 1, text: '할 일을 적는 앱이에요', cites: ['README.md'] },
    { q: 4, text: 'src 에 소스가 있어요', cites: ['README.md'] },
  ]));
  const out = await h.make(bin)['juqode:interpret'](null, h.project.id);

  assert.strictEqual(out.narrative.filled, 2);
  assert.strictEqual(out.narrative.grounded, 2);

  /* …and it is on the row, not only in the return value. */
  const back = h.repo.currentInterpretation(h.db, h.project.id);
  assert.strictEqual(answerFor(back.answers, 1).confidence, 'expected');
  assert.strictEqual(answerFor(back.answers, 1).data.text, '할 일을 적는 앱이에요');
  assert.strictEqual(answerFor(back.answers, 3).confidence, 'confirmed', 'the measured row survived the write');
});

test('the narrative pass does not run while a Work is running', async () => {
  /* `19` §C1 ⑦ — D-117's spirit. A Work is what the user asked for; the Brief is not, so the
   * Brief is the one that waits. The facts still reach the screen either way. */
  const h = handlerBench();
  assert.strictEqual(h.repo.beginWork(h.db, h.project.id, '진행 중인 작업').ok, true);

  const bin = fakeCli(JSON.stringify([{ q: 1, text: '이건 안 실려야 해요', cites: ['README.md'] }]));
  const out = await h.make(bin)['juqode:interpret'](null, h.project.id);

  assert.deepStrictEqual(out.narrative, { skipped: true });
  assert.strictEqual(answerFor(out.interpretation.answers, 1).kind, 'needs-narrative',
    'a second Claude Code session ran in a project that already had one');
  assert.strictEqual(answerFor(out.interpretation.answers, 3).confidence, 'confirmed',
    'the facts layer must still answer while a Work is running');
});

test('a scan that failed does not get a narrative pass on top of it', () => {
  /* `19` §C1 ⑥ separates the two failures: a scan failure is a 읽기 실패 card. Asking a model to
   * narrate a project nobody could read would produce an answer with nothing under it. */
  const { openDb } = require(path.join(R, 'app/main/db/db.js'));
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const db = openDb(':memory:');
  const gone = path.join(tempDir('juqode-gone-'), 'not-here');
  const project = repo.openProject(db, gone, 'gone');

  let spawned = false;
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x',
                           push: () => {}, claudeBin: () => { spawned = true; return '/bin/false'; } });
  return h['juqode:interpret'](null, project.id).then((out) => {
    assert.strictEqual(out.ok, true, 'a scan failure is a card, not a dead channel');
    assert.deepStrictEqual(out.narrative, { skipped: true });
    assert.strictEqual(spawned, false, 'a model was asked about a project nobody could read');
  });
});

test('a narrative pass that THROWS still leaves the facts on screen', () => {
  /* `19` §C1 ⑥ has no exception clause: however the narrative layer goes wrong, the Brief is
   * the facts layer's six rows. `narrate()` catches its own failures, so the handler's guard is
   * for the ones it cannot — and a guard nothing exercises is a guard nobody has checked. */
  const h = handlerBench();
  const narrateModule = require(path.join(R, 'app/main/interpret/narrate.js'));
  const real = narrateModule.narrate;
  narrateModule.narrate = () => { throw new Error('boom'); };

  return h.make('/bin/false')['juqode:interpret'](null, h.project.id)
    .then((out) => {
      assert.strictEqual(out.ok, true);
      assert.strictEqual(answerFor(out.interpretation.answers, 3).confidence, 'confirmed',
        'a thrown narrative pass took the measured answers with it');
      assert.strictEqual(out.interpretation.answers.length, 6, 'the six questions are a closed set');
    })
    .finally(() => { narrateModule.narrate = real; });
});

test('a pass whose CLI is broken says so in the detail, not only in the reason', () => {
  /* `19` §C1 ⑥ makes every narrative failure the same 부분 Brief on screen, so the run log is
   * the only place the cause survives. A fixture with a syntax error and a model that declined
   * to answer both produce `no-response`; only the child's stderr tells them apart — which is
   * exactly how a broken fixture was identified as broken rather than as a refusal. */
  const home = tempDir('juqode-broken-');
  const script = path.join(home, 'fake.js');
  const bin = path.join(home, 'fake');
  fs.writeFileSync(script, 'this is not javascript (\n');
  fs.writeFileSync(bin, '#!/bin/sh\nexec ' + process.execPath + ' ' + script + ' "$@"\n', { mode: 0o755 });

  const b = bench();
  return N.narrate({ ...b, cwd: b.dir, bin }).then((out) => {
    assert.strictEqual(out.reason, 'no-response');
    assert.ok(out.detail, 'the child said something on stderr and it was thrown away');
    assert.ok(/SyntaxError/i.test(out.detail), `the detail does not name the cause: ${out.detail}`);
    assert.deepStrictEqual(out.answers, b.deterministic, 'a broken CLI cost the facts');
  });
});

test('a pass that answered carries no detail, even when it wrote to stderr', () => {
  /* A CLI that prints a deprecation warning and then answers correctly has not failed. Reporting
   * its stderr would put a failure detail on every healthy run and make the one that matters
   * indistinguishable from noise. */
  const home = tempDir('juqode-noisy-');
  const script = path.join(home, 'fake.js');
  const bin = path.join(home, 'fake');
  const six = [{ q: 1, text: '할 일 앱', cites: ['README.md'] }];
  const NL = String.raw`\n`;              // a literal backslash-n INSIDE the generated script
  fs.writeFileSync(script, [
    `process.stderr.write('(node:1) Warning: something deprecated${NL}');`,
    `process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', cwd: '/p' }) + '${NL}');`,
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: ${JSON.stringify(JSON.stringify(six))} }) + '${NL}');`,
  ].join('\n'));
  fs.writeFileSync(bin, '#!/bin/sh\nexec ' + process.execPath + ' ' + script + ' "$@"\n', { mode: 0o755 });

  const b = bench();
  return N.narrate({ ...b, cwd: b.dir, bin }).then((out) => {
    assert.strictEqual(out.reason, null, 'a warning on stderr was read as a failure');
    assert.strictEqual(out.detail, null, 'a successful pass reported a failure detail');
    assert.strictEqual(out.filled, 1, 'the answer was lost');
  });
});

test('확인 못한 것 stops listing a question the narrative layer answered', () => {
  /* The card has to agree with itself. Before this, 하는 일 was shown WITH an answer and an
   * 예상됨 chip, and three rows below, 하는 일 was listed among the things still unanswered —
   * the exact self-contradiction `answers.js` warns about in its own comment on this row. */
  const b = bench();
  const before = answerFor(b.deterministic, 6).data.questions;
  assert.ok(before.includes('what') && before.includes('features') && before.includes('folder-roles'),
    `the fixture must start with these unanswered: ${JSON.stringify(before)}`);

  const { answers: merged } = N.merge(JSON.stringify([
    { q: 1, text: '할 일 앱', cites: ['README.md'] },
    { q: 4, text: 'src 는 소스', cites: ['README.md'] },
  ]), b);

  const after = answerFor(merged, 6).data.questions;
  assert.ok(!after.includes('what'), 'q1 was answered and is still listed as unanswered');
  assert.ok(!after.includes('folder-roles'), 'q4 was answered and is still listed as unanswered');
  /* …and what really is still unanswered stays listed. */
  assert.ok(after.includes('features'), 'q2 was not answered and vanished from the list');
  assert.ok(after.includes('tech-meaning'), 'a sub-claim nobody answered was dropped');

  /* The row itself is untouched otherwise — it is still the scan's own measured statement. */
  const row = answerFor(merged, 6);
  assert.strictEqual(row.confidence, 'confirmed');
  assert.strictEqual(row.sourceRef, 'scan');
  assert.strictEqual(row.data.readCount, answerFor(b.deterministic, 6).data.readCount);
});

test('an UNGROUNDED narrative answer still counts as answered for 확인 못한 것', () => {
  /* 확인 못함 with a sentence is not the same as no sentence: the question WAS answered, and the
   * chip is what says how much to trust it. Listing it again under 확인 못한 것 would say the
   * product has nothing, while the row above it shows something. */
  const b = bench();
  const { answers: merged } = N.merge(
    JSON.stringify([{ q: 1, text: '결제 시스템이에요', cites: ['nobody-read-this.ts'] }]), b);

  assert.strictEqual(answerFor(merged, 1).confidence, 'unconfirmed');
  assert.ok(!answerFor(merged, 6).data.questions.includes('what'));
});

test('a narrative pass that answered nothing leaves 확인 못한 것 exactly as it was', () => {
  const b = bench();
  const { answers: merged } = N.merge(null, b);
  assert.deepStrictEqual(answerFor(merged, 6), answerFor(b.deterministic, 6));
});
