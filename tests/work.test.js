/* WBS-08 evidence basis · WBS-10 session launch · WBS-11 stream → state reducer.
 *
 * The reducer is driven by a REAL recorded stream, not by a hand-written imitation of one:
 * `tests/fixtures/stream-permission-denied.ndjson`. The evidence tests build throwaway git
 * repositories under the OS temp directory and assert the user's repository is byte-identical
 * afterwards — `07` §1 is the rule the whole mechanism exists to keep.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const G = require(path.join(R, 'app/main/evidence/git.js'));
const M = require(path.join(R, 'app/main/evidence/manifest.js'));
const { ledger, ledgerDiff, isSecretName, pathspec } = require(path.join(R, 'app/main/evidence/exclude.js'));
const { toSignal, reduce, replay, initial, openPermission, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
const { allowSpec, grantedSignal, run } = require(path.join(R, 'app/main/claude/session.js'));

const MARK = 'JUQODE_SYNTHETIC_SECRET';   // synthetic, clearly labelled; never a real credential

function repo(files, { commit = true, gitignore = 'node_modules/\n*.log\n' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-ev-')));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  if (gitignore !== null) fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'gc.auto', '0');
  if (commit) { g('add', '-A', '.'); g('commit', '-qm', 'baseline'); }
  return { dir, git: g, store: fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-store-')) };
}

/** Everything about the user's repository that a capture must not disturb. */
const fingerprint = (dir) => execFileSync('bash', ['-c',
  `git ls-files -s; git diff --cached; git status --porcelain=v2; ` +
  `find . -type f -not -path './.git/objects/*' -print0 | xargs -0 sha256sum | sort`,
], { cwd: dir, encoding: 'utf8' });

/* ───────────────────────── WBS-08 · the corrected contract ───────────────────────── */

test('a capture leaves the user repository byte-identical', () => {
  const { dir, store } = repo({ 'src/a.ts': 'export const a = 1;\n', 'README.md': '# r\n' });
  /* partial staging, an untracked file: the states `07` §1 says must survive */
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\nexport const staged = 2;\n');
  execFileSync('git', ['add', 'src/a.ts'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'export const a = 1;\nexport const staged = 2;\nexport const unstaged = 3;\n');
  fs.writeFileSync(path.join(dir, 'src/new.ts'), 'export const untracked = 1;\n');

  const before = fingerprint(dir);
  const basis = G.capture(dir, store, 'before');
  assert.match(basis.ref, /^[0-9a-f]{40}$/, 'no tree was written');
  assert.strictEqual(fingerprint(dir), before,
    'the capture changed the user index or worktree — 07 §1 forbids it absolutely');
});

test('objects go to a JuQode directory, never into the user repository', () => {
  const { dir, store } = repo({ 'a.txt': '1\n' });
  const objectsBefore = execFileSync('bash', ['-c', 'find .git/objects -type f | wc -l'], { cwd: dir, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'brand new content that has never been hashed\n');
  G.capture(dir, store, 'before');
  const objectsAfter = execFileSync('bash', ['-c', 'find .git/objects -type f | wc -l'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.strictEqual(objectsAfter, objectsBefore, 'JuQode wrote objects into the user repository');
  assert.ok(fs.existsSync(path.join(store, 'objects')), 'the JuQode object store was not created');
});

test('a secret the user ALREADY COMMITTED is kept out of the basis tree', () => {
  /* The measured defect in the approved contract: an `:(exclude)` pathspec only filters what
   * `add` considers, so a committed `.env` survives in the copied index and `write-tree` keeps
   * referencing its blob. Both steps are needed and this is the case that proves it. */
  const { dir, store } = repo({
    'src/a.ts': 'export const a = 1;\n',
    '.env': `${MARK}_ENV=aaa\n`,
    '.env.production': `${MARK}_PROD=bbb\n`,
    'keys/server.pem': `${MARK}_PEM\n`,
    'src/nested/local.key': `${MARK}_NESTED\n`,
  });   // .gitignore does NOT list them — that is the point

  const basis = G.capture(dir, store, 'before');
  assert.deepStrictEqual(basis.droppedFromIndex.sort(),
    ['.env', '.env.production', 'keys/server.pem', 'src/nested/local.key'],
    'already-tracked secrets were not dropped from the copied index');

  const paths = G.treePaths(dir, store, basis.ref);
  assert.deepStrictEqual(paths.filter((p) => isSecretName(path.basename(p))), [],
    `the basis tree contains secret paths: ${paths}`);
  assert.ok(paths.includes('src/a.ts'), 'the basis lost the actual source files');

  /* And no object JuQode wrote carries the bytes. */
  const objs = execFileSync('git', ['--no-optional-locks', 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)'],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects') } })
    .split('\n').filter(Boolean);
  let leaked = 0;
  for (const o of objs) {
    const body = execFileSync('bash', ['-c', `git cat-file -p ${o} 2>/dev/null || true`], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OBJECT_DIRECTORY: path.join(store, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(dir, '.git/objects') },
    });
    if (body.includes(MARK)) leaked += 1;
  }
  assert.strictEqual(leaked, 0, `${leaked} object(s) JuQode wrote contain the synthetic secret`);
});

test('the pathspec alone is not enough — the drop step is what closes it', () => {
  /* A guard on the reasoning, not just the result: if someone ever removes `rm --cached`
   * believing the pathspec covers it, this states what the measurement showed. */
  const { dir, store } = repo({ '.env': `${MARK}=x\n`, 'a.ts': '1\n' });
  const basis = G.capture(dir, store, 'before');
  assert.ok(basis.droppedFromIndex.includes('.env'),
    'a committed .env was never in the copied index, so this test is no longer proving anything');
  assert.ok(pathspec().some((p) => p.includes('.env')), 'the pathspec lost its .env exclusion');
});

test('an excluded file that changes is DETECTED, without being read', () => {
  const { dir } = repo({ '.env': `${MARK}=x\n`, 'a.ts': '1\n' });
  const before = ledger(dir);
  assert.ok(before.some((e) => e.path === '.env'), 'the ledger does not cover .env');
  assert.ok(before.every((e) => !('content' in e) && !('sha256' in e)),
    'the ledger carries something other than metadata — a secret could leak through it');

  /* A SAME-SIZE edit. `statSync` without `{ bigint: true }` has no `mtimeNs` at all, so the
   * ledger recorded the string "undefined" and only a size change was ever detectable. */
  const busy = Date.now(); while (Date.now() === busy) { /* next millisecond */ }
  fs.writeFileSync(path.join(dir, '.env'), `${MARK}=y\n`);
  const changed = ledgerDiff(before, ledger(dir));
  assert.deepStrictEqual(changed, [{ path: '.env', change: 'modified' }],
    'a same-size edit to an excluded file went unnoticed');
});

test('the ledger reports additions and removals too', () => {
  const { dir } = repo({ '.env': `${MARK}=x\n` });
  const before = ledger(dir);
  fs.writeFileSync(path.join(dir, '.env.local'), `${MARK}=new\n`);
  fs.rmSync(path.join(dir, '.env'));
  assert.deepStrictEqual(ledgerDiff(before, ledger(dir)), [
    { path: '.env', change: 'removed' },
    { path: '.env.local', change: 'added' },
  ]);
});

test('a change Work is refused when no honest basis can be built', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-nogit-'));
  assert.strictEqual(G.refusal(plain)?.reason, G.REFUSE.NOT_GIT);

  const { dir } = repo({ 'a.ts': '1\n' });
  assert.strictEqual(G.refusal(dir), null, 'an ordinary repository must not be refused');

  /* mid-merge: the worktree is already a half-state that is not the user's intent */
  fs.writeFileSync(path.join(dir, '.git/MERGE_HEAD'), 'deadbeef\n');
  assert.strictEqual(G.refusal(dir)?.reason, G.REFUSE.MID_MERGE);
  fs.rmSync(path.join(dir, '.git/MERGE_HEAD'));

  /* a size cap, expressed as a refusal rather than a truncated basis */
  assert.strictEqual(G.refusal(dir, { maxBytes: 1 })?.reason, G.REFUSE.TOO_LARGE);
});

test('an unreadable directory is refused BEFORE capture, not warned about during it', {
  skip: process.getuid?.() === 0 && 'root',
}, () => {
  const { dir } = repo({ 'a.ts': '1\n', 'locked/inner.ts': '2\n' });
  fs.chmodSync(path.join(dir, 'locked'), 0o000);
  try {
    /* `add -A` only WARNS about a path it cannot read, so the basis would silently shrink. */
    assert.strictEqual(G.refusal(dir)?.reason, G.REFUSE.UNREADABLE);
  } finally { fs.chmodSync(path.join(dir, 'locked'), 0o700); }
});

test('the diff between two bases is the work that happened', () => {
  const { dir, store } = repo({ 'a.ts': 'export const a = 1;\n', 'keep.ts': 'export const k = 1;\n' });
  const before = G.capture(dir, store, 'before');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(dir, 'added.ts'), 'export const n = 1;\n');
  const after = G.capture(dir, store, 'after');

  const patch = G.diff(dir, store, before.ref, after.ref);
  const touched = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]).sort();
  assert.deepStrictEqual(touched, ['a.ts', 'added.ts']);
  assert.ok(!patch.includes('keep.ts'), 'an untouched file appears in the diff');
});

test('non-Git projects get a basis too, with the same exclusions', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-plain-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), '1\n');
  fs.writeFileSync(path.join(dir, '.env'), `${MARK}=x\n`);
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules/big.js'), 'x'.repeat(100));

  const before = M.capture(dir);
  assert.strictEqual(before.kind, 'hash_manifest');
  assert.deepStrictEqual(before.files.map((f) => f.path), ['src/a.js'],
    'the manifest covered a secret or a vendored tree');
  assert.ok(!JSON.stringify(before).includes(MARK));

  fs.writeFileSync(path.join(dir, 'src/a.js'), '2\n');
  fs.writeFileSync(path.join(dir, 'src/b.js'), '3\n');
  const after = M.capture(dir);
  assert.notStrictEqual(after.ref, before.ref, 'the manifest digest did not move');
  assert.deepStrictEqual(M.diff(before, after), [
    { path: 'src/a.js', change: 'modified' },
    { path: 'src/b.js', change: 'added' },
  ]);
});

/* ───────────────────────── WBS-11 · the reducer, on a real stream ───────────────────────── */

const RECORDED = fs.readFileSync(path.join(R, 'tests/fixtures/stream-permission-denied.ndjson'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('a recorded session replays to the state its events justify', () => {
  const signals = RECORDED.map(toSignal);
  assert.ok(signals.some((s) => s.kind === KIND.SESSION_START), 'system/init was not recognised');
  assert.strictEqual(signals.filter((s) => s.kind === KIND.TOOL_USE).length, 3);
  assert.strictEqual(signals.filter((s) => s.kind === KIND.PERMISSION_DENIED).length, 1);
  assert.strictEqual(signals.at(-1).kind, KIND.FINISH);

  const state = replay(signals);
  /* The turn ended, but under contract B the user can still allow and the SAME Work resumes in
   * the SAME session — so ending it here would throw away what the card is for. */
  assert.strictEqual(state.status, 'permission_waiting');
  assert.strictEqual(state.outcome, null, 'a Work with an unanswered refusal has not ended');
  assert.strictEqual(openPermission(state).tool, 'Edit');
});

test('a denial can never be read from the exit code — the CLI reports success', () => {
  const finish = RECORDED.at(-1);
  assert.strictEqual(finish.type, 'result');
  assert.strictEqual(finish.subtype, 'success');
  assert.strictEqual(finish.is_error, false,
    'the recording no longer shows the measured behaviour: a denied run reports success');
  assert.strictEqual(finish.permission_denials.length, 1);
  assert.ok(finish.permission_denials[0].tool_input,
    'the denial carries the tool INPUT — that is what makes a narrowly-scoped retry possible');
});

test('allowing narrows to one tool and one target, never to the tool as a whole', () => {
  assert.strictEqual(allowSpec({ tool: 'Edit', input: { file_path: '/p/note.txt' } }, '/p'), 'Edit(note.txt)');
  /* `Edit(/abs)` with ONE leading slash is read as a cwd-relative glob and silently denies. */
  assert.strictEqual(allowSpec({ tool: 'Edit', input: { file_path: '/elsewhere/x' } }, '/p'), 'Edit(//elsewhere/x)');
  assert.strictEqual(allowSpec({ tool: 'Bash', input: { command: 'npm test' } }, '/p'), 'Bash(npm test:*)');
  assert.strictEqual(allowSpec({ tool: 'Bash', input: {} }, '/p'), null,
    'with nothing to scope to, the answer is no grant — never a grant of the whole tool');
  assert.strictEqual(allowSpec({}, '/p'), null);
});

test('the whole permission lifecycle, driven by signals alone', () => {
  const denied = RECORDED.map(toSignal);
  let s = replay(denied);
  assert.strictEqual(s.status, 'permission_waiting');

  /* The user allows. JuQode records that a PERSON approved — D-116 must stay queryable. */
  const denial = s.denials[0];
  s = reduce(s, grantedSignal(denial, 'Edit(note.txt)'));
  assert.strictEqual(s.status, 'running');
  assert.strictEqual(openPermission(s), null);

  /* the retry turn finishes cleanly */
  s = reduce(s, { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.outcome, 'complete',
    'a refusal the user then allowed is resolved — reporting 부분 완료 describes something the user did not see');
});

test('an unresolved refusal ends the Work as 부분, not as complete', () => {
  let s = replay(RECORDED.map(toSignal));
  s = reduce(s, { kind: 'stop_requested_by_user', payload: null });      // unknown kind: no change
  assert.strictEqual(s.status, 'permission_waiting', 'an unrecognised signal changed the state');
  s.pendingPermission = null;                                            // the user chose 그만두기
  s = reduce(s, { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  assert.strictEqual(s.outcome, 'partial');
});

test('no state is set that no signal justifies', () => {
  let s = initial();
  assert.strictEqual(s.status, 'running');
  for (const kind of ['raw', 'status', 'rate_limit', 'tool_result', 'unknown_future_event']) {
    const next = reduce(s, { kind, payload: null });
    assert.strictEqual(next.status, s.status, `${kind} moved the Work's state on its own`);
    assert.strictEqual(next.outcome, null);
    s = next;
  }
  /* …but every one of them is still OBSERVED — the liveness line is made of these. */
  assert.strictEqual(s.lastObserved.kind, 'unknown_future_event');
});

test('cancellation is judged from an observed exit, never from the exit code', () => {
  let s = reduce(initial(), { kind: KIND.TOOL_USE, payload: { tool: 'Edit' } });
  s = reduce(s, { kind: KIND.CANCEL_REQUEST, payload: null });
  assert.strictEqual(s.status, 'cancel_requested');
  s = reduce(s, { kind: KIND.CANCEL_CONFIRMED, payload: null });
  assert.strictEqual(s.outcome, 'cancelled_partial', 'a tool had already run, so changes may exist');

  let t = reduce(initial(), { kind: KIND.CANCEL_REQUEST, payload: null });
  t = reduce(t, { kind: KIND.CANCEL_CONFIRMED, payload: null });
  assert.strictEqual(t.outcome, 'cancelled_nochange');
});

test('a lost process is closed as 확인 불가, never as success', () => {
  const s = reduce(initial(), { kind: KIND.RECONCILED, payload: null });
  assert.strictEqual(s.status, 'ended');
  assert.strictEqual(s.outcome, 'ended_unknown');
});

/* ───────────────────────── WBS-10 · the session runner ───────────────────────── */

test('a session that produces no event at all did not start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-nostart-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, '#!/bin/sh\necho "boom" >&2\nexit 9\n', { mode: 0o755 });
  const seen = [];
  const r = await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, onSignal: (s) => seen.push(s) });
  assert.strictEqual(r.startFailed, true, '`20`: a Work that never started writes no row');
  assert.strictEqual(seen.length, 0);
  assert.match(r.stderr, /boom/, 'the CLI\'s own words must survive for 자세한 출력 보기');
});

test('every line reaches the record, including one we cannot parse', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-raw-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
echo 'this line is not json'
printf '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  const seen = [];
  const r = await run({ cwd: dir, sessionId: 'x', prompt: 'hi', bin, onSignal: (s) => seen.push(s) });
  assert.strictEqual(r.startFailed, false);
  assert.strictEqual(seen.length, 3, 'a line was dropped — 기술 출력 보기 must show everything');
  assert.strictEqual(r.unparsed, 1);
  assert.deepStrictEqual(seen.map((s) => s.kind), ['session_start', 'raw', 'finish']);
  assert.strictEqual(replay(seen).status, 'ended', 'the trailing line without a newline was lost');
});

test('the prompt goes on stdin, so a variadic flag cannot swallow it', async () => {
  /* Measured: `--allowedTools <tools...>` is variadic, and a prompt passed as a positional
   * after it became a second tool grant. The retry silently never ran. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-args-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
printf '%s' "$*" > "${dir}/argv.txt"
cat > "${dir}/stdin.txt"
echo '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  await run({ cwd: dir, sessionId: 'sid', prompt: '로그인 오류 고쳐줘', allowedTools: ['Edit(a.txt)'], bin, onSignal: () => {} });
  const argv = fs.readFileSync(path.join(dir, 'argv.txt'), 'utf8');
  assert.ok(!argv.includes('로그인 오류 고쳐줘'), 'the prompt was passed as an argument');
  assert.ok(argv.includes('Edit(a.txt)'), 'the scoped grant did not reach the CLI');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8'), '로그인 오류 고쳐줘');
});

test('a resume asks for the same session and adds only the scoped grant', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-resume-'));
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh
printf '%s' "$*" > "${dir}/argv.txt"
echo '{"type":"result","subtype":"success","is_error":false}'
`, { mode: 0o755 });
  await run({ cwd: dir, sessionId: 'the-session', resume: true, allowedTools: ['Edit(note.txt)'], prompt: 'x', bin, onSignal: () => {} });
  const argv = fs.readFileSync(path.join(dir, 'argv.txt'), 'utf8');
  assert.match(argv, /--resume the-session/, 'the retry started a different session');
  assert.match(argv, /--allowedTools Edit\(note\.txt\)/);
  assert.ok(!/--session-id/.test(argv), '--session-id and --resume must not both be sent');
});
