'use strict';
/* V1-004 §6.6 · an `ended_unknown` Work (a process JuQode could not prove stopped) holds the project's Writer slot on EVERY way
 * to start something that could write: same-Task retry, another Task, a new Work with no Task, a file-changing Quick Command.
 * Synthetic DB only. PATH is emptied, so a start that slipped past the hold would show up as `claude-unavailable`, never as a
 * model call. The hold lifts only through the user's explicit acknowledgement (existing contract). */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

async function rig(fn) {
  const dir = tempDir('juqode-wh-');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'same');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'true', test: 'true', dev: 'true', deploy: 'true' } }));
  const git = (...a) => require('node:child_process').execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('add', '-A'); git('commit', '-qm', 'base');
  fs.writeFileSync(path.join(dir, 'pending.txt'), 'uncommitted');          // so qc.git.commit has something it could save
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => tempDir('juqode-wh-ev-'), push() {}, pushQc() {} });
  const t1 = repo.createTask(db, project.id, { goal: 'one', acceptanceCriteria: ['a'] });
  const t2 = repo.createTask(db, project.id, { goal: 'two', acceptanceCriteria: ['b'] });
  const prior = repo.beginWork(db, project.id, 'first try', { taskId: t1.id, idempotencyKey: 'k-first' }).work;
  repo.setWorkState(db, prior.id, { status: 'ended', outcome: 'ended_unknown' });
  const oldPath = process.env.PATH; const bin = tempDir('juqode-wh-nopath-');          // PATH holds `git` and nothing else: no `claude`, so no start can reach a model
  fs.symlinkSync(require('node:child_process').execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'));
  process.env.PATH = bin;
  try { return await fn({ db, project, h, t1, t2, prior, dir }); } finally { process.env.PATH = oldPath; }
}
const snapRows = (db) => JSON.stringify(['work', 'quick_command_run'].map((t) => db.prepare(`select * from ${t} order by rowid`).all()));
const HELD = 'prior-process-may-still-live';

test('unacknowledged ended_unknown: retry, another Task, a Task-less Work and file-changing Quick Commands are all refused; nothing is written or created', async () => {
  await rig(async ({ db, project, h, t1, t2, prior, dir }) => {
    const rows = snapRows(db);
    const r1 = await h['juqode:task-retry'](null, t1.id, prior.id, 'again', 'k-retry', false);
    assert.deepStrictEqual([r1.ok, r1.reason], [false, HELD], 'same-Task retry');
    const r2 = await h['juqode:work-start'](null, project.id, 'other task', t2.id, 'k-other');
    assert.deepStrictEqual([r2.ok, r2.reason], [false, HELD], 'another Task');
    const r3 = await h['juqode:work-start'](null, project.id, 'new request with no task');
    assert.deepStrictEqual([r3.ok, r3.reason], [false, HELD], 'Task-less Work');
    for (const id of ['qc.build', 'qc.test', 'qc.dev.start', 'qc.deploy', 'qc.git.commit']) {
      const q = await h['juqode:qc-run'](null, project.id, id, id);
      assert.deepStrictEqual([q.ok, q.reason], [false, "prior-run-unknown"], `Quick Command ${id}`);
    }
    const routed = h['juqode:qc-route'](null, project.id, '빌드 해줘');
    assert.strictEqual(routed.available, false);
    assert.strictEqual(routed.reason, 'prior-run-unknown');
    assert.strictEqual(snapRows(db), rows, 'a refused start created a row');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'same');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['.git', 'keep.txt', 'package.json', 'pending.txt']);
  });
});

test('a read-only Quick Command is not held, and a wrong or missing acknowledgement does not lift the hold', async () => {
  await rig(async ({ db, project, h, t1, prior }) => {
    const ok = await h['juqode:qc-run'](null, project.id, 'qc.git.status', 'status');
    assert.notStrictEqual(ok.reason, 'prior-run-unknown');
    const denied = h['juqode:legacy-unknown-ack'](null, project.id, prior.id, false);
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(repo.hasStoppedProcessAcknowledgement(db, prior.id), false);
    const r = await h['juqode:task-retry'](null, t1.id, prior.id, 'again', 'k-retry2', false);
    assert.strictEqual(r.reason, HELD);
  });
});

test('only the user\'s explicit confirmation lifts the hold, and then it lifts for THAT Work only (the next gate is the ordinary one)', async () => {
  await rig(async ({ db, project, h, t1, prior }) => {
    const r = await h['juqode:task-retry'](null, t1.id, prior.id, 'again', 'k-retry3', true);
    assert.strictEqual(repo.hasStoppedProcessAcknowledgement(db, prior.id), true, 'the confirmation was not recorded');
    assert.strictEqual(r.reason, 'claude-unavailable', 'with PATH emptied the ordinary next gate answers, not a model call');
    const ack = db.prepare("select source, kind from work_signal where work_id = ? and payload like '%stoppedConfirmedByUser%'").get(prior.id);
    assert.deepStrictEqual({ ...ack }, { source: 'user', kind: 'raw' });
  });
});

test('the hold is a single shared gate: preflight and the Quick Command gate both read the same acknowledgement lookup (source pin)', () => {
  const src = require(path.join(__dirname, 'src.js'));
  assert.ok(/unknownTaskRunWithLiveRunner\(db, project\.id, allowUnknownWorkId\)/.test(src.code('app/main/work/supervisor.js')));
  assert.ok(/if \(unknownTaskRunWithLiveRunner\(db\(\), projectId\)\) return 'prior-run-unknown'/.test(src.code('app/main/ipc.js')));
});
