'use strict';
/* S0 QC counterpart: old user statements, absence and release() cannot unlock uncertain writers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../app/main/db/db');
const repo = require('../app/main/db/repo');
const supervisor = require('../app/main/work/supervisor');
const { makeHandlers } = require('../app/main/ipc');
const { createUncertain } = require('../app/main/qc/uncertain');
const ack = require('../app/main/qc/ack');
const { initial, reduce, KIND } = require('../app/main/work/reducer');
const { tempDir } = require('./tmp');
const snapshot = (db) => JSON.stringify(['work', 'work_signal', 'quick_command_run'].map((table) => db.prepare(`select * from ${table} order by rowid`).all()));
const ackFiles = (root) => fs.existsSync(path.join(root, 'qc-ack')) ? fs.readdirSync(path.join(root, 'qc-ack')).sort() : [];
function fixture() {
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-s0-qc-project-'), 'synthetic');
  fs.writeFileSync(path.join(project.path, 'package.json'), JSON.stringify({ scripts: { build: 'true' } }));
  const evidence = tempDir('juqode-s0-qc-evidence-');
  const id = repo.beginQcRun(db, project.id, { phrase: 'synthetic', ruleId: 'qc.build', command: 'npm run build', status: 'running' });
  repo.setQcRunner(db, id, { sessionId: 'synthetic', pid: 4242, startedAt: new Date().toISOString() });
  repo.endQcRun(db, id, { status: 'unknown', exitCode: null, endedAt: new Date().toISOString() });
  const boot = () => makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => evidence, push() {}, pushQc() {} });
  return { db, project, evidence, id, boot };
}

test('historic valid QC ACK remains byte-for-byte intact after restart and cannot release its writer hold', () => {
  const f = fixture();
  try {
    assert.equal(ack.writeAck(f.evidence, repo.qcRun(f.db, f.id)).ok, true);
    const file = path.join(f.evidence, 'qc-ack', `${f.id}.json`), before = fs.readFileSync(file);
    const h = f.boot();
    assert.deepEqual(h['juqode:qc-list'](null, f.project.id).held.map((row) => row.runId), [f.id]);
    assert.ok(fs.readFileSync(file).equals(before), 'the historic ACK was changed');
    assert.equal(ack.hasAck(f.evidence, repo.qcRun(f.db, f.id)), true, 'history compatibility changed');
  } finally { f.db.close(); }
});

test('the registry release method cannot authorize an uncertain writer, even after all observed members disappear', async () => {
  const registry = createUncertain({ probe: async () => [], schedule: () => null });
  registry.add('synthetic-run', 'project', [{ pid: 4242, created: 'synthetic' }]);
  await registry.recheck('synthetic-run');
  assert.equal(registry.heldFor('project')[0].observed, 'observed-gone');
  registry.release('synthetic-run');
  assert.equal(registry.blocks('project'), 'synthetic-run');
});

test('QC confirmation appends no ACK and keeps Work, QC, permission and answer writers closed', async () => {
  const f = fixture();
  const oldBin = process.env.JUQODE_CLAUDE_BIN;
  process.env.JUQODE_CLAUDE_BIN = path.join(tempDir('juqode-s0-no-provider-'), 'missing');
  try {
    const current = repo.beginWork(f.db, f.project.id, 'waiting synthetic work').work;
    repo.setWorkState(f.db, current.id, { status: 'permission_waiting' });
    supervisor.live.set(current.id, { projectId: f.project.id, cwd: f.project.path,
      state: reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: 'denied', input: { file_path: 'a.txt' } } }) });
    const h = f.boot();
    h['juqode:qc-list'](null, f.project.id);
    const before = snapshot(f.db), files = ackFiles(f.evidence);
    const denied = h['juqode:qc-ack-stopped'](null, f.project.id, [f.id], true);
    assert.equal(denied.ok, false);
    assert.deepEqual(denied.acked, []);
    assert.deepEqual(denied.stillHeld, [f.id]);
    assert.deepEqual(ackFiles(f.evidence), files);
    assert.equal((await h['juqode:work-start'](null, f.project.id, 'do not start')).reason, 'prior-process-may-still-live');
    assert.equal((await h['juqode:work-allow'](null, current.id, 'denied')).reason, 'prior-process-may-still-live');
    assert.equal((await h['juqode:work-answer'](null, current.id, 'do not resume')).reason, 'prior-process-may-still-live');
    assert.equal((await h['juqode:qc-run'](null, f.project.id, 'qc.build', 'do not build')).ok, false);
    assert.equal(snapshot(f.db), before, 'a refused writer appended a row or signal');
  } finally {
    if (oldBin === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = oldBin;
    for (const row of f.db.prepare('select id from work').all()) supervisor.live.delete(row.id);
    f.db.close();
  }
});
