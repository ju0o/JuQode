'use strict';
/* Follow-up to independent QA on 3058: root signals and historic stopped rows are not tree proof. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyEnd } = require('../app/main/qc/stopper');
const { createUncertain, restore } = require('../app/main/qc/uncertain');
const { openDb } = require('../app/main/db/db');
const repo = require('../app/main/db/repo');
const { tempDir } = require('./tmp');

for (const [name, params] of [
  ['POSIX root SIGTERM', { windows: false, code: null, signal: 'SIGTERM', stop: { requested: true } }],
  ['POSIX root exit 0 after request', { windows: false, code: 0, signal: null, stop: { requested: true } }],
  ['external signal without Stop request', { windows: false, code: null, signal: 'SIGKILL', stop: { requested: false } }],
  ['Windows root killed and observed tree empty', { windows: true, code: 1, signal: null, stop: { requested: true, root: 'terminated-by-taskkill', descendants: 'none' } }],
  ['Windows not-found race and exit 0', { windows: true, code: 0, signal: null, stop: { requested: true, root: 'not-found' } }],
  ['Windows exited during asynchronous snapshot', { windows: true, code: 0, signal: null, stop: { requested: true, root: 'exited-before-request' } }],
]) {
  test(`${name}: no ownership proof means unknown`, () => {
    const result = classifyEnd(params);
    assert.equal(result.state, 'unknown', JSON.stringify(result));
  });
}

test('natural no-stop success and failure retain their ordinary results on both platforms', () => {
  for (const windows of [false, true]) for (const [code, state] of [[0, 'ok'], [2, 'failed']]) {
    assert.equal(classifyEnd({ windows, code, signal: null, stop: { requested: false } }).state, state);
  }
});

test('historic stopped writers rebuild holds without rewriting their rows or evidence; fixed read-only stopped runs do not', () => {
  const db = openDb(':memory:');
  try {
    const project = repo.openProject(db, tempDir('juqode-s0-old-stop-'), 'synthetic');
    const root = tempDir('juqode-s0-old-stop-evidence-');
    fs.mkdirSync(path.join(root, 'qc-stop'));
    const make = (ruleId, command) => {
      const id = repo.beginQcRun(db, project.id, { phrase: 'synthetic history', ruleId, command, status: 'running' });
      const ref = `qc-stop/${id}.json`;
      fs.writeFileSync(path.join(root, ref), JSON.stringify({ runId: id, stop: { requested: true, verdict: 'stopped-by-signal' } }));
      repo.endQcRun(db, id, { status: 'stopped', exitCode: null, outputRef: `evidence:${ref}`, stoppedAt: new Date().toISOString() });
      return id;
    };
    const writer = make('qc.build', 'npm run build');
    const reader = make('qc.git.status', 'git status --porcelain=v1 --branch');
    const before = JSON.stringify(db.prepare('select * from quick_command_run order by id').all());
    const evidence = fs.readFileSync(path.join(root, 'qc-stop', `${writer}.json`));
    const candidates = repo.qcUnresolvedRuns(db, project.id);
    assert.ok(candidates.some((row) => row.id === writer), 'historic stopped writer was omitted from the safety query');
    const registry = createUncertain({ schedule: () => null });
    restore({ rows: candidates, root, registry });
    assert.deepEqual(registry.heldFor(project.id).map((row) => row.runId), [writer]);
    assert.equal(registry.has(reader), false);
    assert.equal(JSON.stringify(db.prepare('select * from quick_command_run order by id').all()), before);
    assert.ok(fs.readFileSync(path.join(root, 'qc-stop', `${writer}.json`)).equals(evidence));
  } finally { db.close(); }
});
