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

/* Every fixture directory this file makes, removed when the file finishes. The suite leaked one
 * per case and filled a 7.5 GB tmpfs mid-run — after which every later failure looked like a
 * product bug rather than a full disk. */
const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
process.on('exit', () => {
  for (const d of juqodeTempDirs) {
    for (const target of [d, `${d}-cli`]) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* already gone */ }
    }
  }
});
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
  db.prepare('update schema_version set version = 0').run();
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
  MIGRATIONS.push({ to: 2, sql: 'create table migration_probe (a integer)' });
  try {
    let db = openDb(f);
    assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, 2);
    db.prepare('insert into migration_probe values (1)').run();
    db.close();

    db = openDb(f);                                      // second open must not re-run it
    assert.strictEqual(db.prepare('select count(*) n from migration_probe').get().n, 1,
      'the migration ran a second time and wiped the table');
    assert.deepStrictEqual(db.prepare('select version from schema_version order by version').all()
      .map((r) => r.version), [1, 2]);
    db.close();
  } finally { MIGRATIONS.length = 0; }
});

test('a migration that fails leaves the store on the version it was, with the real error', () => {
  const dir = tmp(), f = path.join(dir, 'mf.db');
  openDb(f).close();
  const { MIGRATIONS } = require(path.join(R, 'app/main/db/db.js'));
  MIGRATIONS.push({ to: 2, sql: 'create table project (nope integer)' });   // already exists
  try {
    assert.throws(() => openDb(f), (e) => {
      assert.strictEqual(e.code, 'db-corrupt');
      /* An unguarded rollback throws "no transaction is active" and masks the real cause. */
      assert.ok(!/no transaction is active/.test(String(e.cause?.message ?? '')),
        'the rollback masked the real migration failure');
      return true;
    });
  } finally { MIGRATIONS.length = 0; }
  const db = openDb(f);                                  // MIGRATIONS empty again → still v1
  assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, 1);
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
  const sql = fs.readFileSync(path.join(R, 'app/main/db/schema.sql'), 'utf8');
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
  const versions = db.prepare('select version from schema_version').all().map((r) => r.version);
  assert.deepStrictEqual(versions, [1], 'reopening must not re-insert the seed version');
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
function fakeClaude(dir, { version = '2.1.266 (Claude Code)', auth = '{"loggedIn":true}', authExit = 0, versionExit = 0, hang = false, ignoreTerm = false } = {}) {
  const f = path.join(dir, 'claude');
  const lines = [
    '#!/bin/sh',
    ignoreTerm ? 'trap "" TERM' : '',
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

test('a CLI that fails to start at all is reported as an error, with its own words', async () => {
  const r = await withBin(fakeClaude(tmp(), { versionExit: 3, version: 'boom' }), () => claude.detect());
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.reason, 'error');
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
  const src = fs.readFileSync(path.join(R, 'app/main/window.js'), 'utf8');
  assert.match(src, /pathToFileURL\(RENDERER\)\.href/,
    'building it as `file://${path}` cannot match what the browser reports, so the allowlist becomes deny-all');
});

test('preload exposes exactly the channels main handles — no more, no less', () => {
  const pre = fs.readFileSync(path.join(R, 'app/preload/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(R, 'app/main/main.js'), 'utf8');

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
  const src = fs.readFileSync(path.join(R, 'app/main/main.js'), 'utf8');
  const body = src.split('const handle = (channel, fn)')[1].slice(0, 900);
  assert.match(body, /senderFrame && e\.senderFrame\.parent/, 'the sub-frame check is gone');
  assert.match(body, /bad-sender/);
  assert.match(body, /catch \(err\)/, 'a throwing handler would reject the invoke');
  assert.match(body, /ok: false, reason: 'internal'/);
});
