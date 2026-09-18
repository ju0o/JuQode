/* WBS-21 persistence · WBS-02 project open · WBS-09 Claude Code detection.
 *
 * These run against the real modules and the real SQLite engine — the same `node:sqlite`
 * that ships inside Electron. Nothing here is mocked except the Claude Code binary, which
 * is a script printing the CLI's real output shapes (`21` WBS-09: "unit with fake CLI outputs").
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { code: srcOf, text: rawOf } = require(path.join(__dirname, 'src.js'));

/* One helper for the whole suite — see tests/tmp.js. Eight private copies each cleaned up
 * only in `process.on('exit')`, which a killed run never reaches; the leftovers filled the
 * tmpfs and made the suite flaky in a different place every run. */
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const { openDb, DbError, LATEST } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const project = require(path.join(R, 'app/main/project.js'));
const claude = require(path.join(R, 'app/main/claude-detect.js'));

const tmp = () => tempDir('juqode-test-');
const asRoot = process.getuid && process.getuid() === 0;

/* ─────────────────────────── WBS-21 · store ─────────────────────────── */

test('fresh store: the Canon schema is applied whole', () => {
  const db = openDb(':memory:');
  const tables = db.prepare("select count(*) n from sqlite_master where type='table'").get().n;
  assert.strictEqual(tables, 26, '20 / schema.sql declares 26 tables');
  assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, LATEST);
  db.close();
});

/* `last_opened_at` is an ISO string, so it is millisecond-resolution. Three inserts inside
 * one millisecond tie, and SQLite leaves ties unordered — so the test makes them distinct
 * rather than asserting an order the store never promised. */
const tick = () => { const t = Date.now(); while (Date.now() === t) { /* next millisecond */ } };

test('recent projects are newest-first and honour the limit', () => {
  const db = openDb(':memory:');
  for (const p of ['/a', '/b', '/c']) { repo.openProject(db, p, p); tick(); }
  assert.deepStrictEqual(repo.recentProjects(db, 2).map((r) => r.path), ['/c', '/b']);
  assert.deepStrictEqual(repo.recentProjects(db).map((r) => r.path), ['/c', '/b', '/a']);
  tick();
  repo.openProject(db, '/a', '/a');                        // reopening moves it to the front
  assert.strictEqual(repo.recentProjects(db, 1)[0].path, '/a');
  db.close();
});

test('reopening a store keeps every row', () => {
  const dir = tmp(), f = path.join(dir, 'a.db');
  let db = openDb(f);
  const p = repo.openProject(db, '/tmp/one', 'one');
  db.close();
  db = openDb(f);
  const rows = repo.recentProjects(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].id, p.id, 'a reopened store must not re-key the project');
  db.close();
});

test('a file we cannot understand is REFUSED and left byte-identical', () => {
  const dir = tmp();
  for (const [name, bytes] of [['garbage.db', Buffer.from('this is not a database')],
                               ['empty-ish.db', Buffer.alloc(4096, 7)]]) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, bytes);
    const before = fs.readFileSync(f);
    assert.throws(() => openDb(f), (e) => e instanceof DbError && e.code === 'db-corrupt', name);
    assert.deepStrictEqual(fs.readFileSync(f), before, `${name}: refusing must not rewrite the file`);
  }
});

test('a truncated JuQode store is refused, not repaired', () => {
  const dir = tmp(), f = path.join(dir, 'c.db');
  openDb(f).close();
  const whole = fs.readFileSync(f);
  fs.writeFileSync(f, whole.subarray(0, Math.floor(whole.length / 2)));
  const before = fs.readFileSync(f);
  assert.throws(() => openDb(f), (e) => e.code === 'db-corrupt');
  assert.deepStrictEqual(fs.readFileSync(f), before);
});

test('a store below the seeded version is refused too — forward only cuts both ways', () => {
  const dir = tmp(), f = path.join(dir, 'old.db');
  const db = openDb(f);
  /* Every applied version is a ROW. Setting them all to 0 collides on the primary key, so the
   * store is put below the floor by keeping one row and lowering it. */
  db.prepare('delete from schema_version where version > 0').run();
  db.prepare('insert into schema_version values (0, ?)').run(new Date().toISOString());
  db.close();
  const before = fs.readFileSync(f);
  assert.throws(() => openDb(f), (e) => e.code === 'db-corrupt',
    'version 0 is not a version this build ever wrote — adopting it runs no migration at all');
  assert.deepStrictEqual(fs.readFileSync(f), before);
});

test('migrations are forward only: a newer store is refused, never downgraded', () => {
  const dir = tmp(), f = path.join(dir, 'd.db');
  const db = openDb(f);
  db.prepare('insert into schema_version values (?, ?)').run(LATEST + 5, new Date().toISOString());
  db.close();
  assert.throws(() => openDb(f), (e) => e.code === 'db-newer');
});

test('a migration applies once, moves the version forward, and is not re-run', () => {
  const dir = tmp(), f = path.join(dir, 'm.db');
  openDb(f).close();                                     // a store at version 1
  const { MIGRATIONS } = require(path.join(R, 'app/main/db/db.js'));
  /* Numbered AFTER the migrations the product actually ships — a probe that reuses a real
   * version number collides on `schema_version`'s primary key and fails for the wrong reason. */
  const shipped = MIGRATIONS.length;
  const probeAt = 2 + shipped;
  MIGRATIONS.push({ to: probeAt, sql: 'create table migration_probe (a integer)' });
  try {
    let db = openDb(f);
    assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, probeAt);
    db.prepare('insert into migration_probe values (1)').run();
    db.close();

    db = openDb(f);                                      // second open must not re-run it
    assert.strictEqual(db.prepare('select count(*) n from migration_probe').get().n, 1,
      'the migration ran a second time and wiped the table');
    assert.deepStrictEqual(db.prepare('select version from schema_version order by version').all()
      .map((r) => r.version),
      Array.from({ length: probeAt }, (_, i) => i + 1));
    db.close();
  } finally { MIGRATIONS.length = shipped; }
});

test('a migration that fails leaves the store on the version it was, with the real error', () => {
  const dir = tmp(), f = path.join(dir, 'mf.db');
  openDb(f).close();
  const { MIGRATIONS } = require(path.join(R, 'app/main/db/db.js'));
  const shipped = MIGRATIONS.length;
  MIGRATIONS.push({ to: 2 + shipped, sql: 'create table project (nope integer)' });   // already exists
  try {
    assert.throws(() => openDb(f), (e) => {
      assert.strictEqual(e.code, 'db-corrupt');
      /* An unguarded rollback throws "no transaction is active" and masks the real cause. */
      assert.ok(!/no transaction is active/.test(String(e.cause?.message ?? '')),
        'the rollback masked the real migration failure');
      return true;
    });
  } finally { MIGRATIONS.length = shipped; }
  const db = openDb(f);                        // the probe is gone → back to what the build ships
  assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, LATEST);
  db.close();
});

test('a valid SQLite file that is not our store is refused, not adopted', () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = tmp(), f = path.join(dir, 'foreign.db');
  const d = new DatabaseSync(f);
  d.exec('create table schema_version (version integer primary key, applied_at text)');
  d.prepare('insert into schema_version values (1, ?)').run('x');
  d.exec('create table totally_unrelated (a integer)');
  d.close();
  const before = fs.readFileSync(f);
  assert.throws(() => openDb(f), (e) => e.code === 'db-corrupt',
    'a file with schema_version but none of our tables must not be adopted');
  assert.deepStrictEqual(fs.readFileSync(f), before);
});

test('a store whose first run was interrupted is refused, not adopted', () => {
  /* The realistic shape of the case above: schema.sql seeds schema_version before it
   * creates most tables, so a crash midway used to leave an adoptable half-store. */
  const { DatabaseSync } = require('node:sqlite');
  const dir = tmp(), f = path.join(dir, 'half.db');
  const sql = rawOf('app/main/db/schema.sql');
  const half = sql.slice(0, sql.indexOf('create table interpretation ('));
  const d = new DatabaseSync(f);
  d.exec('pragma foreign_keys = on');
  d.exec(half);
  d.close();
  assert.throws(() => openDb(f), (e) => e.code === 'db-corrupt');
});

test('a store already at the current version applies nothing again', () => {
  const dir = tmp(), f = path.join(dir, 'e.db');
  openDb(f).close();
  const db = openDb(f);
  const versions = db.prepare('select version from schema_version order by version').all().map((r) => r.version);
  /* One row per applied version — the seed plus every migration this build ships. Reopening
   * must add none of them a second time. */
  assert.deepStrictEqual(versions, Array.from({ length: LATEST }, (_, i) => i + 1),
    'reopening re-applied something');
  db.close();
});

test('D-117: the engine rejects a second non-ended Work — app code does not have to', () => {
  const db = openDb(':memory:');
  const p = repo.openProject(db, '/tmp/p', 'p');
  const add = (id, status) => db.prepare(
    'insert into work (id, project_id, intent, status, requested_at, started_at) values (?,?,?,?,?,?)'
  ).run(id, p.id, 'i', status, 't', 't');

  add('w1', 'running');
  /* SQLite reports the COLUMNS, not the index name. `work.project_id` is unique nowhere else
   * in the schema, so this message can only come from work_one_active_per_project. */
  assert.throws(() => add('w2', 'input_waiting'), /UNIQUE constraint failed: work\.project_id/,
    'a second active Work must be refused by work_one_active_per_project');

  // ending the first frees the slot — the guard is "one ACTIVE", not "one ever"
  db.prepare("update work set status='ended', outcome='complete', ended_at='t' where id='w1'").run();
  assert.doesNotThrow(() => add('w3', 'running'));
  db.close();
});

test('foreign keys are on: a Work cannot point at a project that is not there', () => {
  const db = openDb(':memory:');
  assert.throws(() => db.prepare(
    'insert into work (id, project_id, intent, status, requested_at, started_at) values (?,?,?,?,?,?)'
  ).run('w', 'no-such-project', 'i', 'running', 't', 't'), /FOREIGN KEY/i);
  db.close();
});

test('the shipped schema.sql has not drifted from Canon', () => {
  const canon = process.env.JUQODE_CANON_DATA ||
    '/home/skkse12/Desktop/Projects/Team/JuQode-Private/docs/data/schema.sql';
  let want;
  try { want = fs.readFileSync(canon); }
  catch { assert.fail(`Canon schema not readable at ${canon} — set JUQODE_CANON_DATA. Refusing to pass vacuously.`); }
  assert.deepStrictEqual(fs.readFileSync(path.join(R, 'app/main/db/schema.sql')), want,
    'app/main/db/schema.sql must be a verbatim copy of Canon docs/data/schema.sql');
});

/* ─────────────────────────── WBS-02 · project open ─────────────────────────── */

test('opening the same folder twice is one project, and it is the same one', () => {
  const db = openDb(':memory:');
  const dir = fs.realpathSync(tmp());
  const a = project.openPath(db, dir);
  const b = project.openPath(db, dir);
  assert.ok(a.ok && b.ok);
  assert.strictEqual(a.project.id, b.project.id);
  assert.strictEqual(db.prepare('select count(*) n from project').get().n, 1);
  assert.ok(b.project.last_opened_at >= a.project.last_opened_at);
  db.close();
});

test('a symlink to a folder is the same project as the folder', () => {
  const db = openDb(':memory:');
  const dir = fs.realpathSync(tmp());
  const real = path.join(dir, 'real');
  const link = path.join(dir, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link);
  const a = project.openPath(db, real);
  const b = project.openPath(db, link);
  assert.strictEqual(a.project.id, b.project.id, 'realpath must collapse the two names into one row');
  db.close();
});

test('a folder that cannot be opened names the reason instead of failing silently', () => {
  const dir = fs.realpathSync(tmp());
  const file = path.join(dir, 'a-file.txt');
  fs.writeFileSync(file, 'x');

  assert.strictEqual(project.inspect(path.join(dir, 'nope')).reason, 'missing');
  assert.strictEqual(project.inspect(file).reason, 'not-a-folder');

  const ok = project.inspect(dir);
  assert.ok(ok.ok && ok.path === dir && ok.name === path.basename(dir));
});

test('the readability check actually ran — it was not skipped away', () => {
  /* A skipped test is a green board that proves nothing. If the suite runs as root, mode
   * bits do not apply and the case below silently disappears; say so rather than pass. */
  assert.ok(!asRoot, 'suite is running as root, so the unreadable-folder case cannot run — use a normal user');
});

test('an unreadable folder is a failure with a reason, and is not opened anyway', { skip: asRoot && 'root bypasses mode bits' }, () => {
  const db = openDb(':memory:');
  const dir = fs.realpathSync(tmp());
  const locked = path.join(dir, 'locked');
  fs.mkdirSync(locked, { mode: 0o000 });
  try {
    assert.strictEqual(project.inspect(locked).reason, 'unreadable');
    const r = project.openPath(db, locked);
    assert.strictEqual(r.ok, false, 'openPath opened a folder inspect() refused');
    assert.strictEqual(r.path, locked, 'the failure must carry the folder so 다시 시도 has a target');
    assert.strictEqual(db.prepare('select count(*) n from project').get().n, 0,
      'a folder that cannot be read must not become a project row');
  } finally {
    fs.chmodSync(locked, 0o700);
    db.close();
  }
});

test('a failure carries technical detail for the disclosure, and only that', () => {
  const dir = fs.realpathSync(tmp());
  const r = project.inspect(path.join(dir, 'nope'));
  assert.ok(!r.ok);
  assert.match(r.detail, /ENOENT/);
  assert.ok(!/[가-힣]/.test(r.detail), 'detail is technical output, never Korean copy');
});

/* ─────────────────────────── WBS-09 · Claude Code detection ─────────────────────────── */

/** Write a fake `claude` that prints the given outputs. Never runs the real CLI. */
function fakeClaude(dir, { version = '2.1.266 (Claude Code)', auth = '{"loggedIn":true}', authExit = 0, versionExit = 0, hang = false, ignoreTerm = false, versionStderr = '' } = {}) {
  const f = path.join(dir, 'claude');
  const lines = [
    '#!/bin/sh',
    ignoreTerm ? 'trap "" TERM' : '',
    versionStderr ? `if [ "$1" = "--version" ]; then echo '${versionStderr}' 1>&2; exit ${versionExit}; fi` : '',
    `if [ "$1" = "--version" ]; then echo '${version}'; exit ${versionExit}; fi`,
    'if [ "$1" = "auth" ]; then',
    hang ? '  sleep 30' : '',
    `  echo '${auth}'`,
    `  exit ${authExit}`,
    'fi',
    'exit 1',
  ].filter(Boolean);
  fs.writeFileSync(f, lines.join('\n') + '\n', { mode: 0o755 });
  return f;
}

function withBin(bin, fn) {
  const prev = process.env.JUQODE_CLAUDE_BIN;
  process.env.JUQODE_CLAUDE_BIN = bin;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = prev;
  });
}

test('Claude Code missing from the machine is 설치되지 않음, not an error', async () => {
  const r = await withBin(path.join(tmp(), 'no-such-binary'), () => claude.detect());
  assert.deepStrictEqual(r, { available: false, reason: 'not-installed' });
});

test('installed and logged in is available, and reports the version it actually printed', async () => {
  const r = await withBin(fakeClaude(tmp()), () => claude.detect());
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.version, '2.1.266');
});

test('installed but logged out is 로그인 필요 — never treated as a failure', async () => {
  const r = await withBin(fakeClaude(tmp(), { auth: '{"loggedIn":false}' }), () => claude.detect());
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'logged-out');
});

test('auth output we cannot parse is reported as such, not guessed as logged in', async () => {
  const r = await withBin(fakeClaude(tmp(), { auth: 'not json at all' }), () => claude.detect());
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'unreadable-auth');
});

test('detection NEVER carries account identity out of the CLI — on ANY exit path', async () => {
  const LEAKS = ['someone@example.test', 'org-abc-123', 'Some Org', 'authMethod'];
  const identity = (loggedIn) => JSON.stringify({
    loggedIn, email: LEAKS[0], orgId: LEAKS[1], orgName: LEAKS[2], authMethod: 'claude.ai',
  }).replace(/'/g, '');

  // exit 0 + logged in
  const ok = await withBin(fakeClaude(tmp(), { auth: identity(true) }), () => claude.detect());
  assert.deepStrictEqual(Object.keys(ok).sort(), ['available', 'version']);

  /* exit NON-ZERO with the object still on stdout — the normal shape for a logged-out CLI,
   * and the path where `detail: stdout` used to ship the whole identity into the DOM. */
  const out = await withBin(fakeClaude(tmp(), { auth: identity(false), authExit: 1 }), () => claude.detect());
  assert.strictEqual(out.reason, 'logged-out');

  for (const r of [ok, out]) {
    const blob = JSON.stringify(r);
    for (const leak of LEAKS) {
      assert.ok(!blob.includes(leak), `detect() leaked ${leak} — WBS-09 says no credential handling`);
    }
  }
});

test('a missing loggedIn field is unreadable-auth, never quietly "available"', async () => {
  const r = await withBin(fakeClaude(tmp(), { auth: '{"somethingElse":true}' }), () => claude.detect());
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'unreadable-auth');
});

test('a CLI that ignores SIGTERM still produces 응답 없음 instead of hanging forever', async () => {
  /* `execFile`'s timeout sends ONE SIGTERM. A child that ignores it — and an orphan that
   * keeps the stdout pipe open after the shell dies — both leave the callback pending, so
   * the guarantee has to come from a deadline the child cannot influence. */
  const prev = process.env.JUQODE_CLAUDE_TIMEOUT_MS;
  process.env.JUQODE_CLAUDE_TIMEOUT_MS = '300';
  delete require.cache[require.resolve(path.join(R, 'app/main/claude-detect.js'))];
  const fast = require(path.join(R, 'app/main/claude-detect.js'));
  try {
    const started = Date.now();
    const r = await withBin(fakeClaude(tmp(), { hang: true, ignoreTerm: true }), () => fast.detect());
    const took = Date.now() - started;
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.reason, 'no-response');
    assert.ok(took < 5000, `detection took ${took} ms — the deadline did not hold`);
  } finally {
    if (prev === undefined) delete process.env.JUQODE_CLAUDE_TIMEOUT_MS;
    else process.env.JUQODE_CLAUDE_TIMEOUT_MS = prev;
    delete require.cache[require.resolve(path.join(R, 'app/main/claude-detect.js'))];
  }
});

/* ---------------------------------------------------------------- Windows launch + stop
 *
 * Both are pure decisions ABOUT a platform, exported so the Windows answer is checkable from
 * Linux. The bug they pin was real and silent: detection wrapped `claude.cmd` through cmd.exe
 * and the session spawner did not, so on Windows the app reported Claude Code as available
 * and then failed to start every single Work. */

test('a Windows .cmd shim is launched through cmd.exe — Node refuses to spawn one directly', () => {
  const w = claude.launchArgv('C:\\npm\\claude.cmd', ['-p', '--x']);
  if (process.platform === 'win32') {
    assert.match(w.file, /cmd\.exe$/i);
    assert.deepStrictEqual(w.argv, ['/d', '/s', '/c', 'C:\\npm\\claude.cmd', '-p', '--x']);
  } else {
    /* off Windows the same shim is just a path: the wrapper is platform-conditional, and
     * wrapping everywhere would break every POSIX launch */
    assert.deepStrictEqual(w, { file: 'C:\\npm\\claude.cmd', argv: ['-p', '--x'] });
  }
});

test('a plain binary is never wrapped, on any platform', () => {
  const r = claude.launchArgv('/usr/local/bin/claude', ['-p']);
  assert.deepStrictEqual(r, { file: '/usr/local/bin/claude', argv: ['-p'] });
});

test('the user arguments survive the wrapper unchanged and in order', () => {
  const args = ['-p', '--output-format', 'stream-json', '--allowedTools', 'Read,Edit'];
  const r = claude.launchArgv('claude.bat', args);
  assert.deepStrictEqual(r.argv.slice(-args.length), args);
});

test('cancel reaches the whole tree on both platforms — Windows has no process group', () => {
  const { killPlan } = require(path.join(R, 'app/main/claude/session.js'));

  /* POSIX: the negative pid is the group the detached child owns. Positive would signal
   * JuQode's own process, which is the accident the group rule exists to prevent. */
  assert.deepStrictEqual(killPlan('linux', 4242, false), { kind: 'group', pid: -4242, signal: 'SIGTERM' });
  assert.deepStrictEqual(killPlan('darwin', 4242, true), { kind: 'group', pid: -4242, signal: 'SIGKILL' });

  /* Windows: `kill(-pid)` throws there, and the pid we hold is the cmd.exe wrapper — without
   * /T the real claude process and its node child would survive a cancel. */
  const soft = killPlan('win32', 4242, false);
  assert.strictEqual(soft.kind, 'taskkill');
  assert.ok(soft.argv.includes('/T'), 'a Windows cancel that omits /T leaves the tree running');
  assert.ok(!soft.argv.includes('/F'), 'the first tier must not be forced');
  assert.deepStrictEqual(killPlan('win32', 4242, true).argv, ['/PID', '4242', '/T', '/F']);
});

test('a CLI that fails to start at all is reported as an error, with its own words', async () => {
  const r = await withBin(fakeClaude(tmp(), { versionExit: 3, version: 'boom' }), () => claude.detect());
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'error');
});

test('a version probe that DIES on a signal is 응답 없음, not an error', async () => {
  /* FOUND BY MUTATION: `if (v.err.killed || v.err.signal)` had no test — the existing
   * `no-response` case comes from the DEADLINE race in `detect()`, which never reaches this
   * branch inside `probe()`.
   *
   * The distinction matters on screen. `19` §C3 / `15` SC-02 separate 설치되지 않음 ·
   * 로그인 필요 · 응답 없음, and a CLI killed by the OS (OOM, a policy agent, a crash) has not
   * "errored" in a way whose stderr means anything — there is usually none. Calling it `error`
   * would put an empty 자세한 내용 보기 in front of the user. */
  const dir = tmp();
  const f = path.join(dir, 'claude');
  /* Kills ITSELF, so `execFile` reports `signal` rather than an exit code. */
  fs.writeFileSync(f, '#!/bin/sh\nif [ "$1" = "--version" ]; then kill -9 $$; fi\nexit 1\n', { mode: 0o755 });
  const r = await withBin(f, () => claude.detect());
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'no-response',
    `a CLI killed by a signal was reported as ${r.reason}`);
  /* …and nothing about the version survives a probe that never printed one. */
  assert.ok(!r.version, `a version was reported from a probe that died: ${r.version}`);
});

test('the error detail is the CLI\'s OWN stderr, not our description of it', async () => {
  /* FOUND BY MUTATION: `cap(v.stderr || v.err.message)` could become `&&` and nothing noticed,
   * because the test above asserts the REASON and never looks at the detail.
   *
   * `18` §0.7 puts machine words behind 자세한 내용 보기 rather than in a sentence — but they
   * have to be THERE, and they have to be the CLI's. Our own wrapper message ("Command failed
   * with exit code 3") tells the user nothing they can act on. */
  const r = await withBin(fakeClaude(tmp(), { versionExit: 3, versionStderr: 'claude: unsupported libc' }),
    () => claude.detect());
  assert.strictEqual(r.reason, 'error');
  assert.ok(r.detail, 'the error carries no detail at all');
  assert.ok(r.detail.includes('unsupported libc'),
    `the detail is not the CLI's own stderr: ${JSON.stringify(r.detail)}`);
  /* …and ONLY the CLI's. Node's own wrapper message repeats the stderr, so "contains it" is
   * satisfied by both — the assertion that separates them is that our sentence is NOT there.
   * `Command failed: /path/to/claude --version` tells the user about our plumbing. */
  assert.ok(!/Command failed/.test(r.detail),
    `the detail is our wrapper message rather than the CLI's: ${JSON.stringify(r.detail)}`);
  /* …and it is bounded — a CLI that prints a novel does not become a card. */
  const long = await withBin(fakeClaude(tmp(), { versionExit: 3, versionStderr: 'x'.repeat(3000) }),
    () => claude.detect());
  assert.ok(long.detail.length <= 400, `the detail is ${long.detail.length} characters`);
});

/* ─────────────────────────── the bridge ─────────────────────────── */

test('navigation away from the app file is refused, and so is every new window', () => {
  const { lockNavigation } = require(path.join(R, 'app/main/security.js'));
  const on = {};
  const contents = {
    on: (name, fn) => { on[name] = fn; },
    setWindowOpenHandler: (fn) => { on.open = fn; },
  };
  lockNavigation(contents, 'file:///app/index.html');

  let stopped = false;
  on['will-navigate']({ preventDefault: () => { stopped = true; } }, 'https://evil.example');
  assert.ok(stopped, 'navigation away from the app file was not refused');

  stopped = false;
  on['will-navigate']({ preventDefault: () => { stopped = true; } }, 'file:///app/index.html');
  assert.ok(!stopped, 'the app must be allowed to navigate to itself');

  assert.deepStrictEqual(on.open(), { action: 'deny' });
  let attached = false;
  on['will-attach-webview']({ preventDefault: () => { attached = true; } });
  assert.ok(attached, 'a webview attach was not refused');
});

test('the allowed navigation URL is a real file URL, not string concatenation', () => {
  const src = srcOf('app/main/window.js');
  assert.match(src, /pathToFileURL\(RENDERER\)\.href/,
    'building it as `file://${path}` cannot match what the browser reports, so the allowlist becomes deny-all');
});

test('preload exposes exactly the channels main handles — no more, no less', () => {
  const pre = srcOf('app/preload/preload.js');
  const main = srcOf('app/main/main.js');

  const used = [...pre.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]).sort();
  /* Read from the handler TABLE, not from the file's text: the handlers are registered in a
     loop now, so a source grep would find none of them. */
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const handled = Object.keys(makeHandlers({ db: () => null })).sort();
  assert.deepStrictEqual(used, handled, 'the preload surface and the main handlers must match exactly');

  /* One push channel, listened to on one side and sent on the other. A renderer that could
     name the channel could listen to anything main ever sends. */
  const listened = [...pre.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]).sort();
  const sent = [...main.matchAll(/webContents\.send\('([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(listened, sent, 'the push channels must match exactly');
  assert.ok(!/\(_event,\s*\.\.\.|\(event[,)]/.test(pre.split('onWorkUpdate')[1] ?? ''),
    'the raw IpcRendererEvent must never reach the renderer — it carries `sender`');

  // channels are string literals: a computed channel name would make the surface unbounded
  assert.ok(!/invoke\(\s*[^'\s)]/.test(pre), 'preload must not build a channel name at runtime');
  /* Every mention of ipcRenderer must be one of three literal forms. Counting rather than
   * pattern-banning is what catches an alias — `raw: ipcRenderer.invoke.bind(ipcRenderer)`
   * matches no ban and would otherwise expose the whole bridge. */
  const body = pre.split('exposeInMainWorld')[1] ?? '';
  const total = (body.match(/ipcRenderer/g) || []).length;
  const allowed = (body.match(/ipcRenderer\.invoke\('/g) || []).length
                + (body.match(/ipcRenderer\.on\('/g) || []).length
                + (body.match(/ipcRenderer\.removeListener\(/g) || []).length;
  assert.strictEqual(total, allowed,
    `${total - allowed} ipcRenderer reference(s) in the exposed object are not a literal channel form`);
});

test('openPath refuses a folder that was never offered to the renderer', async () => {
  /* Driven through the handler, not grepped out of the source. A string-shape assertion holds
     while the behaviour is gone — every IPC mutation survived when this was a regex. */
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const db = openDb(':memory:');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });

  for (const bad of ['/etc', '', null, 42, { path: '/etc' }]) {
    const r = await h['juqode:open-path'](null, bad);
    assert.strictEqual(r.ok, false, `openPath(${JSON.stringify(bad)}) was accepted`);
    assert.strictEqual(r.reason, 'not-offered');
  }
  /* …and a folder that IS in the recent list opens. */
  const dir = tempDir('juqode-ipc-');
  repo.openProject(db, dir, 'p');
  assert.strictEqual((await h['juqode:open-path'](null, dir)).ok, true);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every Work channel refuses an id it was never given', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const db = openDb(':memory:');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });

  for (const ch of ['juqode:work-get', 'juqode:work-cancel', 'juqode:work-signals',
                    'juqode:work-changes', 'juqode:work-allow', 'juqode:work-answer']) {
    for (const id of ['no-such-work', '', null, 7, {}]) {
      const r = await h[ch](null, id, 'x');
      assert.strictEqual(r.ok, false, `${ch} accepted ${JSON.stringify(id)}`);
      assert.strictEqual(r.reason, 'no-work', `${ch} answered ${r.reason}`);
    }
  }
  /* a permission id must be a string when it is given at all */
  const p = repo.openProject(db, '/p', 'p');
  const w = repo.beginWork(db, p.id, 'x').work;
  assert.strictEqual((await h['juqode:work-allow'](null, w.id, 99)).reason, 'bad-permission-id');
  db.close();
});

test('every channel answers when the store was refused, and none of them throws', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const h = makeHandlers({ db: () => null, dbFault: () => 'db-corrupt', evidenceStore: () => '/tmp/x', push: () => {} });
  for (const [channel, fn] of Object.entries(h)) {
    if (channel === 'juqode:versions' || channel === 'juqode:claude-detect') continue;
    const r = await fn(null, 'anything', 'more');
    assert.ok(r && typeof r === 'object', `${channel} answered nothing`);
    if (channel === 'juqode:boot') { assert.strictEqual(r.store.ok, false); continue; }
    if (channel === 'juqode:route-intent') { assert.strictEqual(r.ok, true); continue; }
    assert.strictEqual(r.ok, false, `${channel} acted without a store`);
    assert.strictEqual(r.reason, 'no-store', `${channel} answered ${r.reason}`);
  }
});

test('a Work is not started for an unknown project, or for an empty request', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const db = openDb(':memory:');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });
  assert.strictEqual((await h['juqode:work-start'](null, 'no-such-project', 'x')).reason, 'no-project');
  const p = repo.openProject(db, '/p', 'p');
  for (const bad of ['', '   ', null, 42]) {
    assert.strictEqual((await h['juqode:work-start'](null, p.id, bad)).reason, 'empty-intent',
      `an empty request started a Work: ${JSON.stringify(bad)}`);
  }
  db.close();
});

test('the main-process handler wrapper answers instead of rejecting, and refuses a sub-frame', () => {
  /* The wrapper stays in main.js because it needs ipcMain. What it must do is checked here:
     a throwing handler becomes an ANSWER (a rejected invoke blanks the window, because the
     renderer's boot is a top-level await), and a sub-frame is refused. */
  const src = srcOf('app/main/main.js');
  const body = src.split('const handle = (channel, fn)')[1].slice(0, 900);
  assert.match(body, /senderFrame && e\.senderFrame\.parent/, 'the sub-frame check is gone');
  assert.match(body, /bad-sender/);
  assert.match(body, /catch \(err\)/, 'a throwing handler would reject the invoke');
  assert.match(body, /ok: false, reason: 'internal'/);
});

test('an interpretation the app died inside becomes 실패, not 읽는 중 forever', () => {
  /* WBS-34 · `20`: an interpretation still `interpreting` whose process is gone becomes
   * `failed` with an `ended_at`. A Brief that says 읽는 중 about a read that stopped days ago
   * is the same lie as a Work stuck at 진행 중 — and the whole app is ONE process, so a row in
   * this state means that process is gone. There is no handle to ask about. */
  const dir = tmp(), f = path.join(dir, 'i.db');
  let db = openDb(f);
  const project = repo.openProject(db, '/p/one', 'one');
  repo.saveInterpretation(db, project.id, {
    status: 'interpreting', sourceHash: 'h', skippedNote: null,
    answers: [{ q: 1, text: '읽는 중', confidence: 'unconfirmed', sourceRef: null }],
    readFiles: ['package.json'],
  });
  db.close();

  db = openDb(f);
  const ids = repo.reconcileInterpretations(db);
  assert.strictEqual(ids.length, 1);

  const row = db.prepare('select * from interpretation where id = ?').get(ids[0]);
  assert.strictEqual(row.status, 'failed', 'a stalled read must not stay 읽는 중');
  assert.ok(row.ended_at, 'it ended — the row has to say when');

  /* The answers it DID have are kept. Nothing is invented to fill the gap. */
  const answers = db.prepare('select * from interpretation_answer where interpretation_id = ?').all(ids[0]);
  assert.strictEqual(answers.length, 1);
  assert.strictEqual(answers[0].confidence, 'unconfirmed');
  db.close();
});

test('a finished interpretation is left alone', () => {
  /* The counterpart: a rule that rewrote every interpretation would pass the test above and
   * destroy every Brief the product has ever produced. */
  const dir = tmp(), f = path.join(dir, 'i2.db');
  const db = openDb(f);
  const project = repo.openProject(db, '/p/two', 'two');
  repo.saveInterpretation(db, project.id, {
    status: 'interpreted', sourceHash: 'h', skippedNote: null,
    answers: [{ q: 1, text: 'Node.js 프로젝트예요.', confidence: 'confirmed', sourceRef: 'package.json' }],
    readFiles: ['package.json'],
  });
  assert.deepStrictEqual(repo.reconcileInterpretations(db), []);
  assert.strictEqual(repo.currentInterpretation(db, project.id).status, 'interpreted');
  db.close();
});

test('the orientation sentence describes the LATEST Work, not any Work ever', async () => {
  /* `21` WBS-20 / WBS-34: `확인 불가` is reserved for a Work whose process could not be found.
   * The check was `works.some(w => w.outcome === 'ended_unknown')`, so ONE reconciled Work — a
   * laptop closed mid-run, once — made SC-02 say `이전 작업이 지금 어떤 상태인지 확인할 수
   * 없어요` for the rest of the project's life, with completed Works listed underneath it.
   * `18` writes the sentence in the singular because it is about the one the user just left. */
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const db = openDb(':memory:');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });
  const dir = tempDir('juqode-orient-');
  const project = repo.openProject(db, dir, 'p');

  const endWork = (intent, outcome) => {
    const w = repo.beginWork(db, project.id, intent).work;
    repo.setWorkState(db, w.id, { status: 'ended', outcome });
    return w;
  };

  /* An old Work whose process was lost, and a newer one that finished cleanly. */
  endWork('오래된 작업', 'ended_unknown');
  await new Promise((r) => setTimeout(r, 5));            // distinct started_at
  endWork('최근 작업', 'complete');

  const after = await h['juqode:history'](null, project.id);
  assert.strictEqual(after.orientation, 'finished',
    'a completed latest Work is described by its own outcome, not by an older Work\'s');

  /* …and the reserved word IS used when the latest Work is the reconciled one. */
  await new Promise((r) => setTimeout(r, 5));
  endWork('마지막 작업', 'ended_unknown');
  const unknown = await h['juqode:history'](null, project.id);
  assert.strictEqual(unknown.orientation, 'unknown');

  /* A Work still running outranks both — it is what the user is actually in. */
  const running = repo.beginWork(db, project.id, '지금 도는 작업');
  assert.strictEqual(running.ok, true);
  assert.strictEqual((await h['juqode:history'](null, project.id)).orientation, 'running');
});

test('a project with no Works at all is idle, not unknown', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const db = openDb(':memory:');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });
  const project = repo.openProject(db, tempDir('juqode-orient-'), 'p');
  assert.strictEqual((await h['juqode:history'](null, project.id)).orientation, 'idle');
});

/* ───────────── WBS-20 · the History handler, driven through IPC ───────────── */

function historyBench() {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const db = openDb(':memory:');
  const dir = tempDir('juqode-hist-');
  const project = repo.openProject(db, dir, 'p');
  const h = makeHandlers({ db: () => db, dbFault: () => null,
                           evidenceStore: () => tempDir('juqode-hstore-'), push: () => {} });
  return { db, project, h };
}

const endWork = (db, projectId, intent, outcome) => {
  const w = repo.beginWork(db, projectId, intent).work;
  repo.setWorkState(db, w.id, { status: 'ended', outcome });
  return w;
};

test('History lists every Work, newest first, whatever its outcome', async () => {
  /* `12` F-C2-04: History never disappears, and a failed or cancelled Work stays in it. */
  const { db, project, h } = historyBench();
  /* Deliberately inserted inside ONE millisecond, with no `tick()`. `started_at` is an ISO
   * string, so four Works this close all carry the same timestamp — and History still has to
   * come back in a defined order, because `orientationOf` reads `works[0]`. The `rowid`
   * tiebreaker is what makes that true, and this is the fixture that would catch its removal. */
  for (const o of ['complete', 'failed', 'cancelled_partial', 'cancelled_nochange']) {
    endWork(db, project.id, `일 ${o}`, o);
  }
  const r = await h['juqode:history'](null, project.id);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.works.length, 4, 'a Work went missing from History');
  assert.deepStrictEqual(r.works.map((w) => w.outcome),
    ['cancelled_nochange', 'cancelled_partial', 'failed', 'complete'], 'newest first');
  db.close();
});

test('변경 n개 is a MEASURED number, or it is not shown at all', async () => {
  /* The rule this handler exists to keep: `changes()` answers `known: false` when the evidence
   * pair cannot tell, and that has to travel as `null`. Printing 0 in its place would be the
   * product asserting a measurement nobody made — and a mutation doing exactly that survived
   * the whole suite until this test existed. */
  const { db, project, h } = historyBench();
  endWork(db, project.id, '기준 없는 일', 'complete');      // no evidence basis was ever written

  const r = await h['juqode:history'](null, project.id);
  assert.strictEqual(r.works[0].changes, null,
    'a Work with no evidence basis reported a change COUNT, which nobody measured');
  db.close();
});

test('a Work still running reports no count either, and orients as 진행 중', async () => {
  const { db, project, h } = historyBench();
  repo.beginWork(db, project.id, '도는 일');
  const r = await h['juqode:history'](null, project.id);
  assert.strictEqual(r.works[0].changes, null, 'a running Work has no final count to report');
  assert.strictEqual(r.orientation, 'running');
  db.close();
});

test('the orientation sentence is the one that is true', async () => {
  /* `18` orient.*, and `21` WBS-20 reserves `확인 불가` for a Work whose process could not be
   * found. It is never a stand-in for "we have not looked". */
  const empty = historyBench();
  assert.strictEqual((await empty.h['juqode:history'](null, empty.project.id)).orientation, 'idle');
  empty.db.close();

  const done = historyBench();
  endWork(done.db, done.project.id, '끝난 일', 'complete');
  assert.strictEqual((await done.h['juqode:history'](null, done.project.id)).orientation, 'finished');

  /* A Work that FAILED still states its outcome — failure is known, not unknown. */
  const failed = historyBench();
  endWork(failed.db, failed.project.id, '실패한 일', 'failed');
  assert.strictEqual((await failed.h['juqode:history'](null, failed.project.id)).orientation, 'finished');
  failed.db.close();

  /* Only a reconciled Work — the one WBS-34 could not decide about — earns 확인 불가. */
  const lost = historyBench();
  endWork(lost.db, lost.project.id, '잃어버린 일', 'ended_unknown');
  assert.strictEqual((await lost.h['juqode:history'](null, lost.project.id)).orientation, 'unknown');

  /* …and it does not haunt the project forever: a later Work that ended normally is what the
   * user just left, so that is what the sentence is about. */
  endWork(lost.db, lost.project.id, '그 다음 일', 'complete');
  assert.strictEqual((await lost.h['juqode:history'](null, lost.project.id)).orientation, 'finished',
    'one reconciled Work made the sentence 확인 불가 for the rest of the project\'s life');
  lost.db.close();
  done.db.close();
});

test('History refuses a project id it does not know', async () => {
  const { db, h } = historyBench();
  assert.deepStrictEqual(await h['juqode:history'](null, 'no-such-project'), { ok: false, reason: 'no-project' });
  db.close();
});

test('two Works begun in the SAME millisecond still come back newest first', () => {
  /* `started_at` is an ISO string at millisecond resolution, so a tie is not exotic — it is what
   * happens whenever two Works are created inside one millisecond, which is exactly what a test
   * fixture and a fast retry both do. A tie left SQLite free to return either order, so History
   * ordered itself at random and SC-02's orientation sentence (which reads `works[0]`) followed.
   *
   * The tie is FORCED here rather than raced for: the timestamps are made equal on purpose. */
  const repo = require(path.join(R, 'app/main/db/repo.js'));
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-order-'), 'p');

  const ids = [];
  for (const intent of ['첫째', '둘째', '셋째']) {
    const w = repo.beginWork(db, project.id, intent).work;
    repo.setWorkState(db, w.id, { status: 'ended', outcome: 'complete' });
    ids.push(w.id);
  }
  db.prepare('update work set started_at = ? where project_id = ?').run('2026-01-01T00:00:00.000Z', project.id);

  const order = repo.worksFor(db, project.id).map((w) => w.intent);
  assert.deepStrictEqual(order, ['셋째', '둘째', '첫째'],
    `History is not newest-first when the timestamps tie: ${JSON.stringify(order)}`);

  /* …and it is the same answer every time, not merely one plausible answer once. */
  for (let i = 0; i < 20; i++) {
    assert.deepStrictEqual(repo.worksFor(db, project.id).map((w) => w.intent), order);
  }

  /* The orientation sentence rides on that order, so it settles too. */
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '/tmp/x', push: () => {} });
  repo.setWorkState(db, ids[2], { status: 'ended', outcome: 'ended_unknown' });
  const r = h['juqode:history'](null, project.id);
  assert.strictEqual(r.orientation, 'unknown', 'the LATEST Work is the reconciled one');
  assert.deepStrictEqual(r.works.map((w) => w.intent), ['셋째', '둘째', '첫째']);
});
