'use strict';
/* S0: process absence and historic ACKs cannot prove escaped descendants stopped. Synthetic DB/proc only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../app/main/db/db');
const repo = require('../app/main/db/repo');
const supervisor = require('../app/main/work/supervisor');
const { makeHandlers } = require('../app/main/ipc');
const session = require('../app/main/claude/session');
const { observeRunner, holdReleased, unknownTaskRunWithLiveRunner } = require('../app/main/work/runner-liveness');
const { tempDir } = require('./tmp');
const rows = (db) => JSON.stringify(['work', 'work_signal', 'quick_command_run'].map((t) => db.prepare(`select * from ${t} order by rowid`).all()));

function world() {
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-s0-project-'), 'synthetic');
  const task = repo.createTask(db, project.id, { goal: 'Keep writers apart' });
  const prior = repo.beginWork(db, project.id, 'unknown predecessor', { taskId: task.id }).work;
  repo.setRunnerIdentity(db, prior.id, 'synthetic-session', 4242, new Date().toISOString());
  repo.setWorkState(db, prior.id, { status: 'ended', outcome: 'ended_unknown' });
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => tempDir('juqode-s0-evidence-'), push() {}, pushQc() {},
    observeRunner: () => ({ verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: 'root-and-group-absent', limits: ['descendants-that-left-the-session-are-not-observable'] }) });
  return { db, project, task, prior: repo.getWork(db, prior.id), h };
}

function escapedProc() {
  const dir = tempDir('juqode-s0-proc-');
  const btime = 1_000_000;
  fs.writeFileSync(path.join(dir, 'stat'), `btime ${btime}\n`);
  const selfTicks = Math.round(((Date.now() - process.uptime() * 1000) - btime * 1000) / 10);
  for (const row of [{ pid: process.pid, group: process.pid, ticks: selfTicks }, { pid: 4243, group: 4243, ticks: 1 }]) {
    fs.mkdirSync(path.join(dir, String(row.pid)));
    const fields = Array(22).fill('0');
    fields[0] = String(row.pid); fields[1] = '(synthetic)'; fields[2] = 'S';
    fields[4] = fields[5] = String(row.group); fields[21] = String(row.ticks);
    fs.writeFileSync(path.join(dir, String(row.pid), 'stat'), fields.join(' '));
  }
  return dir;
}

test('historic all-runners ACK never frees an ended_unknown writer, including an explicit source-id bypass', async () => {
  const { db, project, task, prior, h } = world();
  try {
    repo.acknowledgeUnknownProcessStopped(db, project.id, prior.id,
      { verdict: 'NOT_OBSERVED_WITH_EVIDENCE', scope: 'all-runners', limits: [] });
    const before = rows(db);
    assert.equal(holdReleased(db, prior), false, 'historic observation was promoted into termination proof');
    assert.equal(unknownTaskRunWithLiveRunner(db, project.id, prior.id)?.id, prior.id, 'source-id argument bypassed the hold');
    let detected = 0;
    const result = await supervisor.preflight(db, project, { taskId: task.id, allowUnknownWorkId: prior.id,
      detect: async () => { detected += 1; return { available: true }; } });
    assert.equal(result.reason, 'prior-process-may-still-live');
    assert.equal(detected, 0, 'a held request reached the provider probe');
    const direct = await supervisor.start(db, project, 'legacy option must not bypass the hold', {
      taskId: task.id, allowUnknownWorkId: prior.id, detect: async () => { detected += 1; return { available: true }; },
    });
    assert.equal(direct.reason, 'prior-process-may-still-live');
    assert.equal(detected, 0, 'direct start bypassed the gate via its legacy option');
    const retry = await h['juqode:task-retry'](null, task.id, prior.id, 'try again', 's0-historic-retry', true);
    assert.equal(retry.reason, 'prior-process-may-still-live');
    assert.equal(rows(db), before);
  } finally { db.close(); }
});

test('an escaped descendant remains invisible to the proc observer, so confirming absence appends no ACK', () => {
  const { db, project, prior } = world();
  try {
    const procDir = escapedProc();
    const observation = observeRunner(prior, { procDir, platform: 'linux' });
    assert.equal(observation.verdict, 'NOT_OBSERVED_WITH_EVIDENCE');
    assert.ok(fs.existsSync(path.join(procDir, '4243/stat')), 'synthetic escaped descendant is absent');
    const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => '', push() {}, observeRunner: () => observation });
    const legacy = repo.beginWork(db, project.id, 'legacy unknown').work;
    repo.setWorkState(db, legacy.id, { status: 'ended', outcome: 'ended_unknown' });
    const before = rows(db);
    const result = h['juqode:legacy-unknown-ack'](null, project.id, legacy.id, true);
    assert.equal(result.ok, false, 'absence was accepted despite the escaped-descendant limit');
    assert.equal(result.reason, 'prior-process-may-still-live');
    assert.equal(rows(db), before, 'refused confirmation appended an ACK');
  } finally { db.close(); }
});

test('unknown predecessor blocks both permission and input resumes before grants, answers or children', async () => {
  const { db, project, prior } = world();
  const { initial, reduce, KIND } = require('../app/main/work/reducer');
  const originalRun = session.run, originalVerify = session.verifyResume;
  let children = 0, bindings = 0;
  session.run = async () => { children += 1; throw new Error('held request reached spawn'); };
  session.verifyResume = () => { bindings += 1; return { ok: false, reason: 'synthetic' }; };
  try {
    const current = repo.beginWork(db, project.id, 'waiting current').work;
    repo.setWorkState(db, current.id, { status: 'permission_waiting' });
    supervisor.live.set(current.id, { projectId: project.id, cwd: project.path,
      state: reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: 'denied', input: { file_path: 'a.txt' } } }) });
    const before = rows(db);
    const allow = await supervisor.allow(db, current.id, 'denied');
    const answer = await supervisor.answer(db, current.id, 'synthetic answer');
    assert.equal(allow.reason, 'prior-process-may-still-live');
    assert.equal(answer.reason, 'prior-process-may-still-live');
    assert.equal(rows(db), before, 'a refused resume wrote a grant or answer');
    assert.equal(children, 0);
    assert.equal(bindings, 0, 'the hold was checked after resume verification');
    assert.equal(repo.getWork(db, prior.id).outcome, 'ended_unknown');
  } finally {
    session.run = originalRun; session.verifyResume = originalVerify;
    for (const row of db.prepare('select id from work where project_id = ?').all(project.id)) supervisor.live.delete(row.id);
    db.close();
  }
});


test('historic ACK survives restart unchanged while writers stay held and another safe project passes preflight', async () => {
  const file = path.join(tempDir('juqode-s0-db-'), 'synthetic.db');
  const db = openDb(file);
  const project = repo.openProject(db, tempDir('juqode-s0-restart-'), 'held');
  fs.writeFileSync(path.join(project.path, 'package.json'), JSON.stringify({ scripts: { build: 'true' } }));
  const prior = repo.beginWork(db, project.id, 'unknown before restart').work;
  repo.setWorkState(db, prior.id, { status: 'ended', outcome: 'ended_unknown' });
  repo.acknowledgeUnknownProcessStopped(db, project.id, prior.id,
    { verdict: 'NOT_OBSERVED_WITH_EVIDENCE', scope: 'all-runners', limits: [] });
  const before = rows(db);
  db.close();
  const reopened = openDb(file);
  try {
    const h = makeHandlers({ db: () => reopened, dbFault: () => null, evidenceStore: () => '', push() {}, pushQc() {} });
    const work = await h['juqode:work-start'](null, project.id, 'do not start');
    assert.equal(work.reason, 'prior-process-may-still-live');
    const qc = await h['juqode:qc-run'](null, project.id, 'qc.build', 'synthetic build');
    assert.equal(qc.reason, 'prior-run-unknown');
    assert.equal(rows(reopened), before);
    assert.equal(h['juqode:history'](null, project.id).ok, true, 'history became unavailable');
    const other = repo.openProject(reopened, tempDir('juqode-s0-safe-'), 'safe');
    const clear = repo.beginWork(reopened, other.id, 'a normally ended run').work;
    repo.setWorkState(reopened, clear.id, { status: 'ended', outcome: 'complete' });
    assert.equal((await supervisor.preflight(reopened, other, { detect: async () => ({ available: true }) })).ok, true);
  } finally { reopened.close(); }
});
