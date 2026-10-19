'use strict';
/* V1-404 · the user's "it stopped" confirmation is necessary and never enough. A stored ended_unknown runner is OBSERVED
 * (Linux /proc: pgrp/sid membership + root start time) before an acknowledgement may be written, on BOTH entry points
 * (legacy-unknown-ack, task-retry confirmPriorStopped). Real processes below are started and killed by this test only
 * (own pids / own process groups); nothing else on the host is touched and no model is called (PATH holds only `git`). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const { observeRunner } = require(path.join(R, 'app/main/work/runner-liveness.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));
const src = require(path.join(__dirname, 'src.js'));

const LINUX = process.platform === 'linux';
const HELD = 'prior-process-may-still-live';
const owned = new Set();
const spawnOwned = (cmd, args) => {
  const c = cp.spawn(cmd, args, { detached: true, stdio: 'ignore' });   // same shape as the real runner: its own session/group
  owned.add(c.pid); c.unref();
  return c;
};
const killGroup = (pid) => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } };
test.after(() => { for (const pid of owned) killGroup(pid); });
const until = async (f, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
const iso = (d = Date.now()) => new Date(d).toISOString();

async function rig(fn, { file = null, deps = {} } = {}) {
  const dir = tempDir('juqode-rl-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'true' } }));
  const git = (...a) => cp.execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('add', '-A'); git('commit', '-qm', 'base');
  const db = openDb(file ?? ':memory:');
  const project = repo.openProject(db, dir, 'p');
  const other = repo.openProject(db, tempDir('juqode-rl-other-'), 'other');
  const mk = (extra = {}) => makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => tempDir('juqode-rl-ev-'), push() {}, pushQc() {}, ...deps, ...extra });
  const task = repo.createTask(db, project.id, { goal: 'one', acceptanceCriteria: ['a'] });
  const unknownWork = (opts, identity) => {
    const w = repo.beginWork(db, project.id, 'first', opts).work;
    repo.setWorkState(db, w.id, { status: 'ended', outcome: 'ended_unknown' });
    if (identity) repo.setRunnerIdentity(db, w.id, 'sess', identity.pid, identity.startedAt);
    return w;
  };
  const oldPath = process.env.PATH; const bin = tempDir('juqode-rl-nopath-');
  fs.symlinkSync(cp.execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'));
  process.env.PATH = bin;
  try { return await fn({ db, project, other, task, h: mk(), mk, unknownWork, dir }); } finally { process.env.PATH = oldPath; }
}
const rows = (db) => JSON.stringify(['work', 'work_signal', 'quick_command_run'].map((t) => db.prepare(`select * from ${t} order by rowid`).all()));
const acks = (db, id) => db.prepare("select payload from work_signal where work_id = ? and payload like '%stoppedConfirmedByUser%'").all(id);

test('a LIVE runner root (same pid, start time agrees): both entry points refuse, nothing is written, no second Run can start', { skip: !LINUX }, async () => {
  const c = spawnOwned('sleep', ['300']);
  await rig(async ({ db, project, task, h, unknownWork }) => {
    const legacy = unknownWork({}, { pid: c.pid, startedAt: iso() });
    const before = rows(db);
    assert.strictEqual(observeRunner(repo.getWork(db, legacy.id)).verdict, 'LIVE_CONFIRMED');
    const a = h['juqode:legacy-unknown-ack'](null, project.id, legacy.id, true);
    assert.deepStrictEqual([a.ok, a.reason, a.detail?.observation], [false, HELD, 'LIVE_CONFIRMED']);
    const w2 = unknownWork({ taskId: task.id, idempotencyKey: 'k1' }, { pid: c.pid, startedAt: iso() });
    const before2 = rows(db);
    const r = await h['juqode:task-retry'](null, task.id, w2.id, 'again', 'k-r', true);
    assert.deepStrictEqual([r.ok, r.reason, r.detail?.observation], [false, HELD, 'LIVE_CONFIRMED']);
    assert.strictEqual(rows(db), before2, 'a refused acknowledgement changed a row');
    assert.strictEqual(acks(db, legacy.id).length + acks(db, w2.id).length, 0);
    const second = await h['juqode:work-start'](null, project.id, 'a second run');
    assert.strictEqual(second.reason, HELD, 'a second Run started beside a live runner');
    const q = await h['juqode:qc-run'](null, project.id, 'qc.build', 'b');
    assert.strictEqual(q.reason, 'prior-run-unknown');
    const ro = await h['juqode:qc-run'](null, project.id, 'qc.git.status', 's');
    assert.notStrictEqual(ro.reason, 'prior-run-unknown', 'read-only git.status must stay usable');
    assert.ok(before.length > 0);
  });
});

test('the root gone but a CHILD left in its group: still LIVE_CONFIRMED, still refused', { skip: !LINUX }, async () => {
  const c = spawnOwned('sh', ['-c', 'sleep 300 & wait']);
  await until(() => cp.spawnSync('pgrep', ['-g', String(c.pid), '-x', 'sleep']).status === 0);
  const startedAt = iso();
  process.kill(c.pid, 'SIGKILL');                                     // the root only
  await rig(async ({ db, project, h, unknownWork }) => {
    const w = unknownWork({}, { pid: c.pid, startedAt });
    assert.ok(await until(() => { try { process.kill(c.pid, 0); return false; } catch { return true; } }) || true);
    const o = observeRunner(repo.getWork(db, w.id));
    assert.deepStrictEqual([o.verdict, o.reason], ['LIVE_CONFIRMED', 'group-or-session-members-alive']);
    assert.ok(o.evidence.members.length >= 1);
    const before = rows(db);
    assert.strictEqual(h['juqode:legacy-unknown-ack'](null, project.id, w.id, true).ok, false);
    assert.strictEqual(rows(db), before);
  });
  killGroup(c.pid);
});

test('a runner that really ended: absence is OBSERVED, the confirmation is recorded WITH the observation, a repeat adds nothing, the next gate is the ordinary one', { skip: !LINUX }, async () => {
  const c = spawnOwned('sleep', ['300']);
  const startedAt = iso();
  killGroup(c.pid);
  await rig(async ({ db, project, task, h, unknownWork }) => {
    const w = unknownWork({ taskId: task.id, idempotencyKey: 'k2' }, { pid: c.pid, startedAt });
    assert.ok(await until(() => observeRunner(repo.getWork(db, w.id)).verdict === 'NOT_OBSERVED_WITH_EVIDENCE'), 'never observed as gone');
    const r = await h['juqode:task-retry'](null, task.id, w.id, 'again', 'k-r2', true);
    assert.strictEqual(r.reason, 'claude-unavailable', 'the ordinary gate after the hold lifted');
    const a = acks(db, w.id);
    assert.strictEqual(a.length, 1);
    const rec = JSON.parse(a[0].payload).juqodeProcess;
    assert.deepStrictEqual([rec.stoppedConfirmedByUser, rec.observation.verdict], [true, 'NOT_OBSERVED_WITH_EVIDENCE']);
    assert.ok(rec.observation.limits.length, 'the observation hides its limit');
    const again = await h['juqode:task-retry'](null, task.id, w.id, 'again', 'k-r3', true);
    assert.notStrictEqual(again.reason, HELD);
    assert.strictEqual(acks(db, w.id).length, 1, 'a duplicate confirmation added a record');
  });
});

test('pid reused by ANOTHER process (start time disagrees): the recorded runner is not that process; verdict says so, never LIVE', { skip: !LINUX }, async () => {
  const c = spawnOwned('sleep', ['300']);
  await rig(async ({ db, unknownWork }) => {
    const w = unknownWork({}, { pid: c.pid, startedAt: iso(Date.now() - 3600_000) });   // claimed to have started an hour before this process did
    const o = observeRunner(repo.getWork(db, w.id));
    assert.deepStrictEqual([o.verdict, o.reason], ['NOT_OBSERVED_WITH_EVIDENCE', 'root-pid-reused-so-old-group-is-empty']);
    assert.strictEqual(o.evidence.rootPidPresent, true);
  });
  killGroup(c.pid);
});

test('missing identity, unreadable /proc, a throwing observer, an unmeasured platform: UNKNOWN, fail-closed on both entry points, rows unchanged', async () => {
  await rig(async ({ db, project, task, unknownWork, mk }) => {
    const noPid = unknownWork({}, null);
    const noStart = unknownWork({}, { pid: 4242, startedAt: null });
    assert.strictEqual(observeRunner(repo.getWork(db, noPid.id)).reason, LINUX ? 'no-runner-identity' : 'platform-not-measured');
    assert.strictEqual(observeRunner(repo.getWork(db, noStart.id)).verdict, 'UNKNOWN');
    const good = { runner_pid: 4242, runner_started_at: iso() };
    assert.strictEqual(observeRunner(good, { procDir: '/nonexistent-proc' }).reason, LINUX ? 'process-query-failed' : 'platform-not-measured');
    assert.strictEqual(observeRunner(good, { platform: 'win32' }).reason, 'platform-not-measured');
    assert.strictEqual(observeRunner(good, { platform: 'darwin' }).verdict, 'UNKNOWN');
    for (const deps of [{}, { observeRunner: () => { throw new Error('boom'); } }, { observeRunner: () => ({ verdict: 'whatever' }) }, { observeRunner: () => null }]) {
      const h = mk(deps);
      const before = rows(db);
      const a = h['juqode:legacy-unknown-ack'](null, project.id, noPid.id, true);
      assert.deepStrictEqual([a.ok, a.reason, a.detail?.observation], [false, HELD, 'UNKNOWN']);
      assert.strictEqual(rows(db), before);
    }
  });
});

test('wrong ids, another project, a Work that is not ended_unknown, a missing confirmation: refused, rows unchanged; the observer is not even asked', async () => {
  let asked = 0;
  await rig(async ({ db, project, other, task, unknownWork, mk }) => {
    const h = mk({ observeRunner: () => { asked += 1; return { verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: 'stub' }; } });
    const legacy = unknownWork({}, null);
    const tasked = unknownWork({ taskId: task.id, idempotencyKey: 'k3' }, null);
    const running = repo.beginWork(db, project.id, 'live one', {}).work;
    const before = rows(db);
    const cases = [
      h['juqode:legacy-unknown-ack'](null, project.id, legacy.id, false),
      h['juqode:legacy-unknown-ack'](null, other.id, legacy.id, true),
      h['juqode:legacy-unknown-ack'](null, project.id, tasked.id, true),
      h['juqode:legacy-unknown-ack'](null, project.id, running.id, true),
      h['juqode:legacy-unknown-ack'](null, project.id, 'nope', true),
    ];
    assert.ok(cases.every((c) => c.ok === false), JSON.stringify(cases));
    assert.strictEqual(rows(db), before);
    assert.strictEqual(asked, 0, 'the observer ran for a request that never passed identity');
    const bad = await h['juqode:task-retry'](null, task.id, running.id, 'x', 'k-bad', true);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(rows(db), before);
  });
});

test('app restart: the stored identity is read back from the file store and judged afresh (a live runner stays refused)', { skip: !LINUX }, async () => {
  const c = spawnOwned('sleep', ['300']);
  const file = path.join(tempDir('juqode-rl-db-'), 'j.db');
  let ids;
  await rig(async ({ project, unknownWork }) => {
    ids = { p: project.id, w: unknownWork({}, { pid: c.pid, startedAt: iso() }).id };
  }, { file });
  const db2 = openDb(file);
  const h2 = makeHandlers({ db: () => db2, dbFault: () => null, evidenceStore: () => tempDir('juqode-rl-ev-'), push() {}, pushQc() {} });
  const r = h2['juqode:legacy-unknown-ack'](null, ids.p, ids.w, true);
  assert.deepStrictEqual([r.ok, r.reason, r.detail?.observation], [false, HELD, 'LIVE_CONFIRMED']);
  killGroup(c.pid);
  assert.ok(await until(() => observeRunner(repo.getWork(db2, ids.w)).verdict === 'NOT_OBSERVED_WITH_EVIDENCE'));
  assert.strictEqual(h2['juqode:legacy-unknown-ack'](null, ids.p, ids.w, true).ok, true, 'after the runner really ended, the same confirmation works');
});

/* a synthetic /proc: how the parser and the verdict treat shapes a real host rarely produces */
function fakeProc(entries) {
  const dir = tempDir('juqode-fakeproc-');
  const btime = 1_000_000;
  fs.writeFileSync(path.join(dir, 'stat'), `cpu 1\nbtime ${btime}\n`);
  const selfTicks = Math.round(((Date.now() - process.uptime() * 1000) - btime * 1000) / 10);
  const all = [{ pid: process.pid, comm: 'node', state: 'R', pgrp: process.pid, sid: process.pid, ticks: selfTicks }, ...entries];
  for (const e of all) {
    fs.mkdirSync(path.join(dir, String(e.pid)));
    const f = Array(22).fill('0'); f[0] = String(e.pid); f[1] = `(${e.comm ?? 'x'})`; f[2] = e.state ?? 'S'; f[4] = String(e.pgrp); f[5] = String(e.sid); f[21] = String(e.ticks ?? 1);
    fs.writeFileSync(path.join(dir, String(e.pid), 'stat'), f.join(' '));
  }
  return { dir, btime };
}
const W = (pid, started) => ({ runner_pid: pid, runner_started_at: iso(started) });

test('synthetic /proc: zombie-only is not alive; a comm with spaces/parens parses; a member with another pgrp/sid is not ours; sid membership counts', () => {
  const t0 = Date.now() - 60_000;
  const ticks = (ms, b) => Math.round((ms - b * 1000) / 10);
  const mk = (entries) => { const f = fakeProc(entries); return { f, o: (w) => observeRunner(w, { procDir: f.dir }) }; };
  let { f, o } = mk([{ pid: 777, state: 'Z', pgrp: 777, sid: 777, ticks: ticks(t0, 1_000_000) }]);
  assert.strictEqual(o(W(777, t0)).verdict, 'NOT_OBSERVED_WITH_EVIDENCE', 'a zombie root counted as alive');
  ({ f, o } = mk([{ pid: 778, comm: 'a b) (c', state: 'S', pgrp: 778, sid: 778, ticks: ticks(t0, 1_000_000) }]));
  assert.deepStrictEqual([o(W(778, t0)).verdict, o(W(778, t0)).reason], ['LIVE_CONFIRMED', 'root-identity-matches']);
  ({ f, o } = mk([{ pid: 900, state: 'S', pgrp: 901, sid: 902 }]));
  assert.strictEqual(o(W(779, t0)).verdict, 'NOT_OBSERVED_WITH_EVIDENCE');
  ({ f, o } = mk([{ pid: 900, state: 'S', pgrp: 900, sid: 779 }]));
  assert.strictEqual(o(W(779, t0)).reason, 'group-or-session-members-alive', 'a child that changed group but stayed in the session was missed');
  fs.writeFileSync(path.join(f.dir, '900', 'stat'), 'garbage');
  assert.strictEqual(o(W(779, t0)).reason, 'process-query-failed', 'an unparsable stat was read as "nothing there"');
  const noSelf = fakeProc([]); fs.rmSync(path.join(noSelf.dir, String(process.pid)), { recursive: true });
  assert.strictEqual(observeRunner(W(779, t0), { procDir: noSelf.dir }).reason, 'scan-does-not-see-this-process');
});

test('source pin: both entry points go through the observation gate; nothing in ipc writes the acknowledgement directly', () => {
  const ipc = src.code('app/main/ipc.js');
  assert.strictEqual((ipc.match(/acknowledgeAfterObservation\(/g) ?? []).length, 2);
  assert.ok(!/repo\.acknowledgeUnknownProcessStopped/.test(ipc), 'ipc.js writes the acknowledgement without observing');
  const all = ['app/main/ipc.js', 'app/main/work/supervisor.js', 'app/main/qc/run.js'].map((f) => src.code(f)).join('\n');
  assert.ok(!/repo\.acknowledgeUnknownProcessStopped|\backnowledgeUnknownProcessStopped\(/.test(all.replace(/acknowledgeAfterObservation/g, '')));
  assert.ok(/obs\?\.verdict !== 'NOT_OBSERVED_WITH_EVIDENCE'/.test(src.code('app/main/work/runner-liveness.js')));
});

test('the FIRST child\'s identity reaches the Work row (it used to exist only as a signal, so the columns stayed empty)', async () => {
  const fake = require(path.join(__dirname, 'fakecli.js'));
  const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-rl-sup-'), 'p');
  const dir = tempDir('juqode-rl-sup-bin-');
  const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'rl-session', cwd: project.path });
  const finish = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, permission_denials: [] });
  const bin = fake.scriptBin(dir, 'claude', `process.stdout.write(${JSON.stringify(init + '\n' + finish + '\n')});`);
  const t0 = Date.now();
  const r = await supervisor.start(db, project, 'identity', { evidenceStore: tempDir('juqode-rl-sup-ev-'), bin, detect: async () => ({ available: true }) });
  assert.strictEqual(r.ok, true);
  await r.done;
  const w = repo.getWork(db, r.workId);
  const sig = db.prepare("select payload from work_signal where work_id = ? and payload like '%juqodeProcess%'").get(w.id);
  assert.ok(Number.isInteger(w.runner_pid) && w.runner_pid > 1, 'runner_pid never reached the row');
  assert.strictEqual(w.runner_pid, JSON.parse(sig.payload).juqodeProcess.pid);
  assert.ok(Date.parse(w.runner_started_at) >= t0 - 1000 && Date.parse(w.runner_started_at) <= Date.now());
});

test('an older row with the identity only in its juqodeProcess signal is judged by that signal (live refused, ended accepted)', { skip: !LINUX }, async () => {
  const live = spawnOwned('sleep', ['300']);
  const gone = spawnOwned('sleep', ['300']);
  const goneAt = iso(); killGroup(gone.pid);
  await rig(async ({ db, project, h, unknownWork }) => {
    const mkSignalOnly = (pid, at) => {
      const w = unknownWork({}, null);
      repo.addSignal(db, w.id, { seq: 1, source: 'juqode', kind: 'raw', payload: JSON.stringify({ juqodeProcess: { pid, startedAt: at } }) });
      return w;
    };
    const a = mkSignalOnly(live.pid, iso(Date.now() + 5000));          // signals are written a little after the spawn
    const r1 = h['juqode:legacy-unknown-ack'](null, project.id, a.id, true);
    assert.deepStrictEqual([r1.ok, r1.detail?.observation], [false, 'LIVE_CONFIRMED']);
    const b = mkSignalOnly(gone.pid, goneAt);
    assert.ok(await until(() => h['juqode:legacy-unknown-ack'](null, project.id, b.id, true).ok));
    assert.strictEqual(JSON.parse(acks(db, b.id)[0].payload).juqodeProcess.observation.verdict, 'NOT_OBSERVED_WITH_EVIDENCE');
  });
  killGroup(live.pid);
});

/* ── F1 · a confirmation recorded before the observer existed is a STATEMENT, never an observation ── */
const STATEMENT = (db, project, w) => repo.acknowledgeUnknownProcessStopped(db, project.id, w.id);   // exactly what the old code wrote
const addRunner = (db, w, pid, at = iso()) => repo.addSignal(db, w.id, { seq: repo.nextSeq(db, w.id), source: 'juqode', kind: 'raw', payload: JSON.stringify({ juqodeProcess: { pid, startedAt: at, resume: true } }) });

test('F1: an OLD statement-only confirmation + a runner that is still alive: every start path stays held, nothing is rewritten', { skip: !LINUX }, async () => {
  const c = spawnOwned('sleep', ['300']);
  await rig(async ({ db, project, task, h, unknownWork }) => {
    const w = unknownWork({ taskId: task.id, idempotencyKey: 'f1' }, { pid: c.pid, startedAt: iso() });
    assert.deepStrictEqual(STATEMENT(db, project, w), { ok: true, existing: false });
    assert.strictEqual(repo.stopAcknowledgementKind(db, w.id), 'statement');
    const before = rows(db);
    const retry = await h['juqode:task-retry'](null, task.id, w.id, 'again', 'k-f1', true);
    assert.deepStrictEqual([retry.ok, retry.reason, retry.detail?.observation], [false, HELD, 'LIVE_CONFIRMED'], 'task-retry released on a statement');
    const start = await h['juqode:work-start'](null, project.id, 'new work');
    assert.strictEqual(start.reason, HELD, 'a new Work started beside a live runner');
    const q = await h['juqode:qc-run'](null, project.id, 'qc.build', 'b');
    assert.strictEqual(q.reason, 'prior-run-unknown');
    assert.strictEqual(rows(db), before, 'a refusal changed or added a row (the old statement must stay exactly as it was)');
    assert.strictEqual(repo.stopAcknowledgementKind(db, w.id), 'statement', 'the statement was promoted');
  });
  killGroup(c.pid);
});

test('F1: statement-only + identity missing (UNKNOWN) keeps the hold; statement-only + observed gone releases it WITHOUT rewriting, and a new confirmation appends an observed one', { skip: !LINUX }, async () => {
  const gone = spawnOwned('sleep', ['300']); const startedAt = iso(); killGroup(gone.pid);
  await rig(async ({ db, project, h, unknownWork }) => {
    const none = unknownWork({}, null);
    STATEMENT(db, project, none);
    assert.strictEqual((await h['juqode:work-start'](null, project.id, 'x')).reason, HELD, 'UNKNOWN identity released a hold');
    const b = unknownWork({}, { pid: gone.pid, startedAt });
    STATEMENT(db, project, b);
    // `none` still holds the project; look at `b` alone through the hold lookup
    const { unknownTaskRunWithLiveRunner } = require(path.join(R, 'app/main/work/runner-liveness.js'));
    assert.ok(await until(() => unknownTaskRunWithLiveRunner(db, project.id, none.id) === null), 'a statement beside an observed-gone runner never released');
    const stmtRows = acks(db, b.id).length;
    assert.strictEqual(stmtRows, 1);
    const ok = h['juqode:legacy-unknown-ack'](null, project.id, b.id, true);
    assert.deepStrictEqual([ok.ok, ok.existing], [true, false]);
    assert.strictEqual(acks(db, b.id).length, 2, 'the old statement row must stay and the observed one be appended');
    assert.strictEqual(repo.stopAcknowledgementKind(db, b.id), 'observed');
  });
});

/* ── F2 · every runner a Work ever left (first child + each resume child) is judged ── */
test('F2: two independent process groups: the EARLIER group\'s child is alive, the later group ended -> LIVE, refused; the reverse too; both ended -> accepted', { skip: !LINUX }, async () => {
  const mkGroup = async (withChild) => {
    const g = withChild ? spawnOwned('sh', ['-c', 'sleep 300 & wait']) : spawnOwned('sleep', ['300']);
    if (withChild) await until(() => cp.spawnSync('pgrep', ['-g', String(g.pid), '-x', 'sleep']).status === 0);
    return { pid: g.pid, at: iso() };
  };
  const first = await mkGroup(true);          // later: only its root dies, the child stays
  const second = await mkGroup(false);        // the resume runner
  process.kill(first.pid, 'SIGKILL'); killGroup(second.pid);
  await rig(async ({ db, project, task, h, unknownWork }) => {
    const w = unknownWork({ taskId: task.id, idempotencyKey: 'f2' }, { pid: first.pid, startedAt: first.at });
    addRunner(db, w, second.pid, second.at);
    repo.addSignal(db, w.id, { seq: repo.nextSeq(db, w.id), source: 'juqode', kind: 'permission_granted', payload: '{}' });   // one resume happened
    const o = require(path.join(R, 'app/main/work/runner-liveness.js')).observeWork(repo.getWork(db, w.id), db);
    assert.strictEqual(o.verdict, 'LIVE_CONFIRMED', 'the later group ending hid the earlier group\'s live child');
    assert.deepStrictEqual(o.evidence.runners.map((r) => r.verdict), ['LIVE_CONFIRMED', 'NOT_OBSERVED_WITH_EVIDENCE']);
    const before = rows(db);
    const r = await h['juqode:task-retry'](null, task.id, w.id, 'again', 'k-f2', true);
    assert.deepStrictEqual([r.ok, r.reason, r.detail?.observation], [false, HELD, 'LIVE_CONFIRMED']);
    assert.strictEqual(rows(db), before);
    killGroup(first.pid);                      // now the earlier group's child ends too
    assert.ok(await until(() => require(path.join(R, 'app/main/work/runner-liveness.js')).observeWork(repo.getWork(db, w.id), db).verdict === 'NOT_OBSERVED_WITH_EVIDENCE'));
    const ok = h['juqode:legacy-unknown-ack'](null, project.id, w.id, true);   // task-linked: legacy path refuses by contract
    assert.strictEqual(ok.reason, 'not-legacy-work');
    const r2 = await h['juqode:task-retry'](null, task.id, w.id, 'again', 'k-f2b', true);
    assert.strictEqual(r2.reason, 'claude-unavailable', 'with every recorded runner gone the ordinary gate follows');
  });
  killGroup(first.pid); killGroup(second.pid);
});

test('F2: the LATER group alive while the earlier one ended -> LIVE; a resume that left no identity -> UNKNOWN (nothing invented), a live one still wins', { skip: !LINUX }, async () => {
  const dead = spawnOwned('sleep', ['300']); const deadAt = iso(); killGroup(dead.pid);
  const live = spawnOwned('sleep', ['300']);
  await rig(async ({ db, unknownWork }) => {
    const { observeWork } = require(path.join(R, 'app/main/work/runner-liveness.js'));
    const a = unknownWork({}, { pid: dead.pid, startedAt: deadAt });
    addRunner(db, a, live.pid);
    assert.strictEqual(observeWork(repo.getWork(db, a.id), db).verdict, 'LIVE_CONFIRMED');
    // a grant happened but only the first runner was ever recorded (older data): incomplete
    const b = unknownWork({}, { pid: dead.pid, startedAt: deadAt });
    repo.addSignal(db, b.id, { seq: repo.nextSeq(db, b.id), source: 'juqode', kind: 'permission_granted', payload: '{}' });
    assert.ok(await until(() => observeWork(repo.getWork(db, b.id), db).reason === 'runner-identities-incomplete'), 'an unrecorded resume runner was assumed gone');
    assert.strictEqual(observeWork(repo.getWork(db, b.id), db).verdict, 'UNKNOWN');
    // an answer counts as a resume as well
    const c = unknownWork({}, { pid: dead.pid, startedAt: deadAt });
    repo.addSignal(db, c.id, { seq: repo.nextSeq(db, c.id), source: 'user', kind: 'answer', payload: 'yes' });
    assert.strictEqual(observeWork(repo.getWork(db, c.id), db).reason, 'runner-identities-incomplete');
  });
  killGroup(live.pid);
});

test('F2/source: supervisor records each resume child (permission grant retry and answer resume)', () => {
  const sup = src.code('app/main/work/supervisor.js');
  assert.strictEqual((sup.match(/recordChild\(db, workId, c\)/g) ?? []).length, 2);
});
