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
