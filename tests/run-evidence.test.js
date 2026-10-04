'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require(path.join(__dirname, '..', 'app/main/db/db.js'));
const repo = require(path.join(__dirname, '..', 'app/main/db/repo.js'));
const { isTestCommand, isDirectTestRunner, observedPassedTestCount, testEvidenceFromSignals, testScopeMatches,
  testScopesForCriterion } = require(path.join(__dirname, '..', 'app/main/work/run-evidence.js'));
const { tempDir } = require('./tmp.js');

const signal = (kind, payload, seq) => ({ kind, payload: JSON.stringify(payload), seq, observed_at: `t${seq}` });

test('only a returned Bash test command becomes evidence; Agent completion prose does not', () => {
  const rows = [
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'text', text: 'Completed successfully. Tests passed.' },
      { type: 'tool_use', id: 'test-call-1', name: 'Bash', input: { command: 'node --test tests/unit.test.js' } },
    ] } }, 1),
    signal('tool_result', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'test-call-1', content: '# tests 599\n# pass 599\n# fail 0', is_error: false },
    ] }, tool_use_result: { stdout: '# tests 599\n# pass 599\n# fail 0', stderr: '' } }, 2),
  ];
  const [evidence] = testEvidenceFromSignals(rows);
  assert.strictEqual(evidence.kind, 'test_command');
  assert.strictEqual(evidence.source_ref, 'test-call-1');
  assert.strictEqual(evidence.details.result_state, 'returned');
  assert.strictEqual(evidence.details.exit_code, null, 'is_error=false is not an exit-code observation');
  assert.strictEqual(evidence.details.tests_passed_count, 599);
  assert.strictEqual(evidence.details.runner_invocation, 'direct');
  assert.strictEqual(evidence.details.test_pass_claimed, false);
  assert.strictEqual(evidence.details.output_excerpt, '# tests 599\n# pass 599\n# fail 0');
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

test('already-redacted Claude signals preserve field-level disclosure in derived test evidence', () => {
  const rows = [
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'redacted-call', name: 'Bash', input: { command: 'npm run test:unit' } },
    ] }, juqodeRedaction: { applied: true, rules: ['credential_assignment'],
      paths: [['message', 'content', 0, 'input', 'command']] } }, 1),
    signal('user', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'redacted-call', content: '[redacted]' },
    ] }, tool_use_result: { stdout: '[redacted]', stderr: '', exitCode: 0 },
      juqodeRedaction: { applied: true, rules: ['secret_field_name'],
        paths: [['tool_use_result', 'stdout']] } }, 2),
  ];
  const [evidence] = testEvidenceFromSignals(rows);
  assert.strictEqual(evidence.details.command_redacted, true);
  assert.strictEqual(evidence.details.output_redacted, true);
  assert.ok(evidence.details.output_redaction_rules.includes('secret_field_name'));

  const unrelated = testEvidenceFromSignals([
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'safe-call', name: 'Bash', input: { command: 'npm run test:unit' } },
    ] }, juqodeRedaction: { applied: true, rules: ['secret_field_name'], paths: [['metadata', 'token']] } }, 1),
    signal('user', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'safe-call', content: 'all clear' },
    ] }, tool_use_result: { stdout: 'all clear', exitCode: 0 },
      juqodeRedaction: { applied: true, rules: ['secret_field_name'], paths: [['metadata', 'token']] } }, 2),
  ])[0];
  assert.strictEqual(unrelated.details.command_redacted, false);
  assert.strictEqual(unrelated.details.output_redacted, false);
});

test('a secret argument redacted before persistence does not erase the observed test command', () => {
  const rows = [
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'redacted-argument-test', name: 'Bash',
        input: { command: 'npm run test:unit -- --[redacted]' } },
    ] }, juqodeRedaction: { applied: true, rules: ['credential_assignment'],
      paths: [['message', 'content', 0, 'input', 'command']] } }, 1),
    signal('user', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'redacted-argument-test', content: 'all passed', is_error: false },
    ] }, tool_use_result: { stdout: 'all passed', exitCode: 0 } }, 2),
  ];
  const [evidence] = testEvidenceFromSignals(rows);
  assert.strictEqual(evidence.kind, 'test_command');
  assert.strictEqual(evidence.details.command_redacted, true);
  assert.strictEqual(evidence.details.command, 'npm run test:unit -- --[redacted]');
});

test('only a direct test command is evidence and acceptance scopes distinguish unit from E2E', () => {
  for (const command of ['echo "npm run test:unit"', 'npm run test:unit && npm run test:e2e', 'npm test | cat',
    'npm run lint', 'npm run check', 'npm run typecheck']) {
    assert.deepStrictEqual(testEvidenceFromSignals([
      signal('assistant', { type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'fake-call', name: 'Bash', input: { command } },
      ] } }, 1),
      signal('user', { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'fake-call', content: 'Exit code: 0', is_error: false },
      ] }, tool_use_result: { stdout: 'Exit code: 0', exitCode: 0 } }, 2),
    ]), [], `non-direct shell text became test evidence: ${command}`);
  }
  assert.strictEqual(testScopeMatches('Unit tests pass', { details: { command: 'node --test tests/e2e/visual.test.mjs' } }), false);
  assert.strictEqual(testScopeMatches('Visual E2E renders at narrow width', { details: { command: 'node --test tests/e2e/visual.test.mjs' } }), true);
  assert.strictEqual(testScopeMatches('Integration works', { details: { command: 'node --test tests/unit.test.js' } }), false);
  assert.strictEqual(isTestCommand('npm run lint'), false);
  assert.deepStrictEqual(testScopesForCriterion('Unit and integration tests pass'), ['unit', 'integration']);
  assert.strictEqual(testScopeMatches('All tests pass', { details: { command: 'npm run lint' } }), false);
  assert.deepStrictEqual(testScopesForCriterion('단위 및 통합 테스트 통과'), ['unit', 'integration']);
  assert.deepStrictEqual(testScopesForCriterion('All tests pass'), ['all']);
  assert.deepStrictEqual(testScopesForCriterion('All unit tests pass'), ['unit-all']);
  assert.strictEqual(testScopeMatches('All unit tests pass', { details: { command: 'node --test tests/unit.test.js' } }), false);
  assert.strictEqual(testScopeMatches('All unit tests pass', { details: { command: 'node --test' } }), true,
    'whole-suite Node discovery must satisfy a named all-unit criterion');
  for (const command of ['node --test tests/unit/', 'node --test tests/unit',
    'node --test tests/unit/task.test.js', 'node --test tests/unit/smoke.test.mjs']) {
    assert.strictEqual(testScopeMatches('All unit tests pass', { details: { command } }), false,
      `scoped or aliased discovery satisfied the complete unit suite: ${command}`);
  }
  assert.strictEqual(isDirectTestRunner('node --test tests/unit/ --test-name-pattern=OneSpecificTest'), false,
    'a filtered Node subset was treated as the complete unit suite');
  assert.strictEqual(testScopeMatches('All unit tests pass', { details: {
    command: 'node --test tests/unit/ --test-name-pattern=OneSpecificTest',
  } }), false);
  for (const command of [
    'node --test tests/unit/../e2e/visual.test.mjs',
    'node --test ./tests/unit/../../tests/e2e/visual.test.mjs',
    'node --test tests\\unit\\..\\e2e\\visual.test.mjs',
  ]) {
    assert.strictEqual(isDirectTestRunner(command), false,
      `suite path traversal was accepted as a complete direct test run: ${command}`);
    assert.strictEqual(testScopeMatches('All unit tests pass', { details: { command } }), false,
      `path traversal allowed another suite to satisfy All unit tests: ${command}`);
  }
  assert.strictEqual(isDirectTestRunner('python -m pytest -s tests/unit/'), false,
    'pytest without capture lets project output impersonate its final summary');
  assert.strictEqual(testScopeMatches('All unit tests pass', { details: {
    command: 'python -m pytest -s tests/unit/',
  } }), false);
  assert.strictEqual(testScopeMatches('All unit tests pass', { details: {
    command: 'pytest tests/unit/',
  } }), false, 'pytest config can omit files without reporting them as deselected');
  assert.strictEqual(testScopeMatches('All tests pass', { details: { command: 'pytest' } }), false,
    'pytest discovery config can exclude a portion of an aggregate suite');
  assert.strictEqual(testScopeMatches('All unit tests pass', { details: { command: 'npm test' } }), false);
  assert.deepStrictEqual(testScopesForCriterion('앱 재시작 후 상태가 유지된다'), ['e2e']);
  assert.strictEqual(testScopeMatches('All tests pass', { details: { command: 'node --test tests/unit.test.js' } }), false);
  assert.strictEqual(testScopeMatches('All tests pass', { details: { command: 'node --test' } }), true);
  assert.strictEqual(testScopeMatches('All tests pass', { details: { command: 'pytest tests/test_one.py' } }), false,
    'one explicitly selected pytest file satisfied an aggregate-suite criterion');
  assert.strictEqual(testScopeMatches('Unit tests pass', { details: { command: 'node --test tests/unit.test.js' } }), true);
  assert.strictEqual(isDirectTestRunner('npm test'), false);
  const skippedOutput = '# tests 3\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 3\n# todo 0';
  assert.strictEqual(observedPassedTestCount(skippedOutput), null);
  assert.strictEqual(observedPassedTestCount('# tests 4\n# pass 3\n# fail 1'), 0,
    'a swallowed failing test still counted as positive PASS evidence');
  assert.strictEqual(observedPassedTestCount('# tests 4\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 3\n# todo 0'), null,
    'one passing test plus three skipped tests satisfied a whole-suite count');
  assert.strictEqual(observedPassedTestCount('599 tests passed'), null,
    'arbitrary output prose was mistaken for a runner summary');
  assert.strictEqual(observedPassedTestCount('# tests 3\n# pass 3\n# fail 0\nℹ tests 0\nℹ pass 0\nℹ fail 0'), null,
    'a test file forged a summary before Node emitted its own');
  assert.strictEqual(observedPassedTestCount('test result: ok. 12 passed; 0 failed; 0 ignored; finished in 0.03s'), 12);
  assert.strictEqual(observedPassedTestCount(
    '=== 1 passed in 0.01s ===\n=== 0 passed, 4 skipped in 0.03s ==='), null,
  'a project-controlled pytest summary overrode the actual skipped-test summary');
  assert.strictEqual(observedPassedTestCount('=== 1 passed, 4 deselected in 0.03s ==='), null,
    'pytest configuration filters were mistaken for a complete-suite result');
  assert.strictEqual(observedPassedTestCount('test runner emitted no count'), null);
  const [skipped] = testEvidenceFromSignals([
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'zero-tests', name: 'Bash', input: { command: 'node --test tests/unit.test.js' } },
    ] } }, 1),
    signal('user', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'zero-tests', content: skippedOutput, is_error: false },
    ] }, tool_use_result: { stdout: skippedOutput, exitCode: 0 } }, 2),
  ]);
  assert.strictEqual(skipped.details.tests_passed_count, null);
});

test('a project script cannot use forged TAP text as passing test evidence', () => {
  const forged = '# tests 3\n# pass 3\n# fail 0';
  const [evidence] = testEvidenceFromSignals([
    signal('assistant', { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'forged-tap', name: 'Bash', input: { command: 'npm test' } },
    ] } }, 1),
    signal('user', { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'forged-tap', content: forged, is_error: false },
    ] }, tool_use_result: { stdout: forged, exitCode: 0 } }, 2),
  ]);
  assert.strictEqual(evidence.details.runner_invocation, 'project_script_or_wrapped');
  assert.strictEqual(evidence.details.tests_passed_count, null);
  assert.strictEqual(testScopeMatches('All tests pass', evidence), false);
});

test('Run evidence survives reads and SQLite refuses mutation', () => {
  const db = openDb(':memory:');
  try {
    const project = repo.openProject(db, tempDir('juqode-evidence-'), 'Evidence test');
    const task = repo.createTask(db, project.id, { goal: 'Inspect evidence' });
    const work = repo.beginWork(db, project.id, 'run', { taskId: task.id }).work;
    const evidence = {
      kind: 'test_command', source_ref: 'call-1', observed_at: 't1', summary: 'npm test',
      content_digest: 'sha256:test', details: { result_state: 'returned', tests_passed_count: 1, test_pass_claimed: false },
    };
    repo.saveRunEvidence(db, work.id, evidence);
    assert.deepStrictEqual(repo.saveRunEvidence(db, work.id, evidence)[0].details, evidence.details);
    const row = repo.runEvidenceFor(db, work.id)[0];
    assert.strictEqual(row.source_ref, 'call-1');
    assert.throws(() => db.prepare('update run_evidence set summary = ? where id = ?').run('rewritten', row.id), /immutable/);
    assert.throws(() => db.prepare('delete from run_evidence where id = ?').run(row.id), /immutable/);
  } finally { db.close(); }
});
