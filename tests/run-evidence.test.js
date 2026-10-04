'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require(path.join(__dirname, '..', 'app/main/db/db.js'));
const repo = require(path.join(__dirname, '..', 'app/main/db/repo.js'));
const { testEvidenceFromSignals } = require(path.join(__dirname, '..', 'app/main/work/run-evidence.js'));
const { tempDir } = require('./tmp.js');

const signal = (kind, payload, seq) => ({ kind, payload: JSON.stringify(payload), seq, observed_at: `t${seq}` });

test('only a returned Bash test command becomes evidence; Agent completion prose does not', () => {
  const rows = [
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'text', text: 'Completed successfully. Tests passed.' },
      { type: 'tool_use', id: 'test-call-1', name: 'Bash', input: { command: 'npm run test:unit' } },
    ] } }, 1),
    signal('tool_result', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'test-call-1', content: '599 tests passed', is_error: false },
    ] }, tool_use_result: { stdout: '599 tests passed', stderr: '' } }, 2),
  ];
  const [evidence] = testEvidenceFromSignals(rows);
  assert.strictEqual(evidence.kind, 'test_command');
  assert.strictEqual(evidence.source_ref, 'test-call-1');
  assert.strictEqual(evidence.details.result_state, 'returned');
  assert.strictEqual(evidence.details.exit_code, null, 'is_error=false is not an exit-code observation');
  assert.strictEqual(evidence.details.test_pass_claimed, false);
  assert.strictEqual(evidence.details.output_excerpt, '599 tests passed');
  assert.deepStrictEqual(testEvidenceFromSignals([
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'text', text: 'completed successfully; tests passed' },
    ] } }, 1),
  ]), [], 'the report sentence is not test evidence');
});

test('test evidence is linked to its exact tool call, redacts output, and ignores unrelated results', () => {
  const rows = [
    signal('tool_use', { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'test-call-2', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_use', id: 'read-call', name: 'Read', input: { file_path: 'x' } },
    ] } }, 1),
    signal('tool_result', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'read-call', content: 'irrelevant', is_error: false },
    ] } }, 2),
    signal('tool_result', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'test-call-2', content: 'API key: abcdefghijklmnop123456', is_error: true },
    ] } }, 3),
  ];
  const [evidence] = testEvidenceFromSignals(rows);
  assert.strictEqual(evidence.source_ref, 'test-call-2');
  assert.strictEqual(evidence.details.result_state, 'error');
  assert.ok(evidence.details.output_redacted);
  assert.ok(!evidence.details.output_excerpt.includes('abcdefghijklmnop123456'));
  assert.deepStrictEqual(testEvidenceFromSignals([
    signal('tool_use', { message: { content: [
      { type: 'tool_use', id: 'read-only', name: 'Read', input: { file_path: 'x' } },
    ] } }, 1),
  ]), []);
});

test('Run evidence survives reads and SQLite refuses mutation', () => {
  const db = openDb(':memory:');
  try {
    const project = repo.openProject(db, tempDir('juqode-evidence-'), 'Evidence test');
    const task = repo.createTask(db, project.id, { goal: 'Inspect evidence' });
    const work = repo.beginWork(db, project.id, 'run', { taskId: task.id }).work;
    const evidence = {
      kind: 'test_command', source_ref: 'call-1', observed_at: 't1', summary: 'npm test',
      content_digest: 'sha256:test', details: { result_state: 'returned', test_pass_claimed: false },
    };
    repo.saveRunEvidence(db, work.id, evidence);
    assert.deepStrictEqual(repo.saveRunEvidence(db, work.id, evidence)[0].details, evidence.details);
    const row = repo.runEvidenceFor(db, work.id)[0];
    assert.strictEqual(row.source_ref, 'call-1');
    assert.throws(() => db.prepare('update run_evidence set summary = ? where id = ?').run('rewritten', row.id), /immutable/);
    assert.throws(() => db.prepare('delete from run_evidence where id = ?').run(row.id), /immutable/);
  } finally { db.close(); }
});
