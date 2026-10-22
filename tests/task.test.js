'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fake = require(path.join(__dirname, 'fakecli.js'));
const { DatabaseSync } = require('node:sqlite');

const R = path.resolve(__dirname, '..');
const { MIGRATIONS, SCHEMA_FILE, LATEST, openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const { CLAIM_LIMIT, limitClaim } = require(path.join(R, 'app/main/work/provenance.js'));
const { code: sourceCode } = require(path.join(__dirname, 'src.js'));
const { buildContextBundle } = require(path.join(R, 'app/main/work/context.js'));
const { windowsRunnerTreeMayBeAlive } = require(path.join(R, 'app/main/claude/session.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

function setup() {
  const db = openDb(':memory:');
  const project = repo.openProject(db, tempDir('juqode-task-'), 'Task test');
  return { db, project };
}

function reviewRun(db, project, task, {
  outcome = 'complete', evidence = true, testExitCode = 0, testCommand = 'node --test', testsPassedCount = 1,
} = {}) {
  const work = repo.beginWork(db, project.id, 'Run for evidence review', { taskId: task.id }).work;
  const built = buildContextBundle({ project, task, userPrompt: 'Implement and verify' });
  repo.saveRunContextBundle(db, work.id, built);
  repo.setWorkState(db, work.id, { status: 'ended', outcome });
  const refs = [];
  if (evidence) {
    for (const [kind, sourceRef, summary, details] of [
      ['changed_files', 'evidence:before→after', '1 changed file measured', { known: true, files: ['src/app.js'] }],
      ['test_command', 'test-call-1', testCommand, { command: testCommand, result_state: 'returned', exit_code: testExitCode,
        tests_passed_count: testsPassedCount, test_pass_claimed: false }],
    ]) {
      const rows = repo.saveRunEvidence(db, work.id, {
        kind, source_ref: sourceRef, observed_at: 't1', summary,
        content_digest: `digest:${sourceRef}`, details,
      });
      refs.push(rows.find((row) => row.source_ref === sourceRef).id);
    }
  }
  return { work: repo.getWork(db, work.id), refs };
}

test('Task persistence creates durable, separate Project children with truthful initial verdict', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, {
      goal: '  Add a focused persistence check  ',
      acceptanceCriteria: ['The Task is stored', { id: 'criterion-2', text: 'A result is inspectable' }],
    });
    assert.strictEqual(task.project_id, project.id);
    assert.strictEqual(task.goal, 'Add a focused persistence check');
    assert.deepStrictEqual(task.dependencies, []);
    assert.deepStrictEqual(task.acceptance_criteria, [
      { id: task.acceptance_criteria[0].id, text: 'The Task is stored' },
      { id: 'criterion-2', text: 'A result is inspectable' },
    ]);
    assert.strictEqual(task.status, 'open');
    assert.strictEqual(task.verdict, 'unverified');
    assert.strictEqual(task.created_at, task.updated_at);
    assert.deepStrictEqual(repo.tasksForProject(db, project.id).map((row) => row.id), [task.id]);
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 0,
      'creating a Task does not create or masquerade as a Work/Run');
  } finally { db.close(); }
});

test('V1-307 Inspector preview limits Agent claims by grapheme and preserves the full technical record', () => {
  const { db, project } = setup();
  try {
    const claimSnapshot = (text) => {
      const task = repo.createTask(db, project.id, { goal: 'Inspect an Agent report' });
      const work = repo.beginWork(db, project.id, 'Inspect report preview', { taskId: task.id }).work;
      repo.setWorkState(db, work.id, { status: 'ended', outcome: 'complete' });
      repo.saveResult(db, work.id, {
        outcome: 'complete', summary: text, whatFailed: null,
        claims: [{ kind: 'agent-report', data: { text }, confidence: 'expected', sourceRef: 'claude:result' }],
        items: [],
      });
      const stored = repo.resultFor(db, work.id).claims.find((claim) => claim.kind === 'agent-report');
      assert.strictEqual(stored.data.text, text, 'the stored report remains byte-for-byte the original');
      assert.strictEqual(stored.data.shown, undefined, 'the display preview is not written to storage');
      const snapshot = supervisor.snapshot(db, work.id);
      return snapshot.result.claims.find((claim) => claim.kind === 'agent-report');
    };

    const short = '짧은 보고';
    const shortClaim = claimSnapshot(short);
    assert.strictEqual(shortClaim.data.shown, short);
    assert.strictEqual(shortClaim.data.truncated, false);
    assert.strictEqual(shortClaim.data.text, short);

    const combining = `${'x'.repeat(CLAIM_LIMIT - 1)}e\u0301👩‍💻이어지는 설명`;
    const combiningClaim = claimSnapshot(combining);
    assert.strictEqual(combiningClaim.data.shown, limitClaim(combining).shown);
    assert.strictEqual(combiningClaim.data.truncated, true);
    assert.ok(combiningClaim.data.shown.endsWith('…'), 'the preview ends with a truncation marker');
    assert.strictEqual([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(combiningClaim.data.shown)].length,
      CLAIM_LIMIT + 1, 'the preview is 280 graphemes plus the marker');
    assert.ok(combiningClaim.data.shown.includes('e\u0301'), 'a combining sequence at the boundary remains whole');
    assert.ok(!combiningClaim.data.shown.includes('👩‍💻'), 'the following ZWJ grapheme is omitted as a whole');
    assert.strictEqual(combiningClaim.data.text, combining);

    const zwjAtLimit = `${'y'.repeat(CLAIM_LIMIT - 1)}👩‍💻 다음 문장`;
    const zwjClaim = claimSnapshot(zwjAtLimit);
    assert.strictEqual(zwjClaim.data.shown, limitClaim(zwjAtLimit).shown);
    assert.ok(zwjClaim.data.shown.includes('👩‍💻'), 'a ZWJ sequence at the limit remains whole');
    assert.ok(zwjClaim.data.shown.endsWith('…'));
    assert.strictEqual(zwjClaim.data.text, zwjAtLimit, 'the full Agent claim remains retrievable');

    const source = sourceCode('app/renderer/screens/sc02.js');
    const humanStart = source.indexOf('function renderHumanRead(');
    const humanEnd = source.indexOf('\nfunction testStateLabel', humanStart);
    const humanRead = source.slice(humanStart, humanEnd);
    assert.match(humanRead, /report\?\.data\?\.shown/, 'the Inspector human reading uses the limited preview');
    assert.doesNotMatch(humanRead, /report\?\.data\?\.text/, 'the Inspector human reading does not fall back to the full report');
    const detailStart = source.indexOf('function inspectResult(');
    const detailEnd = source.indexOf('\nfunction changedFilesOf', detailStart);
    assert.match(source.slice(detailStart, detailEnd), /report\.data\.text/, 'the technical detail fold still exposes the original report');
  } finally { db.close(); }
});

test('a routed request keeps the Task selected at submit time', () => {
  const source = sourceCode('app/renderer/screens/sc02.js');
  const sendStart = source.indexOf('async function send()');
  const startWorkStart = source.indexOf('async function startWork(', sendStart);
  const workStreamStart = source.indexOf('const stream = card(', startWorkStart);
  assert.ok(sendStart >= 0 && startWorkStart > sendStart && workStreamStart > startWorkStart);
  const send = source.slice(sendStart, startWorkStart);
  const startWork = source.slice(startWorkStart, workStreamStart);
  assert.match(send, /const submittedTaskId = state\.inspectDismissed \? null : \(state\.selectedTaskId \?\? null\)/,
    'the Task is frozen at submit time, and a Task whose Inspector was closed is not attached');
  assert.match(send, /startWork\(text, submittedTaskId, idempotencyKey\)/,
    'deferred route actions must carry the Task selected when Send was pressed');
  assert.match(startWork, /api\.workStart\(p\.id, text, taskId, idempotencyKey\)/);
  assert.doesNotMatch(startWork, /state\.selectedTaskId/,
    'startWork re-read a mutable selection after the user had already submitted');
});

test('Task dependencies must reference distinct Tasks in the same Project', () => {
  const { db, project } = setup();
  try {
    const prerequisite = repo.createTask(db, project.id, { goal: 'Prerequisite' });
    const dependent = repo.createTask(db, project.id, {
      goal: 'Dependent', dependencies: [prerequisite.id],
    });
    assert.deepStrictEqual(dependent.dependencies, [prerequisite.id]);
    assert.throws(() => repo.createTask(db, project.id, {
      goal: 'Unknown dependency', dependencies: ['not-a-task'],
    }), /same Project/);
    assert.throws(() => repo.createTask(db, project.id, {
      goal: 'Duplicate dependency', dependencies: [prerequisite.id, prerequisite.id],
    }), /duplicates/);
    const otherProject = repo.openProject(db, '/tmp/task-other-project', 'Other');
    const foreignTask = repo.createTask(db, otherProject.id, { goal: 'Foreign' });
    assert.throws(() => repo.createTask(db, project.id, {
      goal: 'Cross-project dependency', dependencies: [foreignTask.id],
    }), /same Project/);
    assert.throws(() => repo.updateTask(db, prerequisite.id, { dependencies: [prerequisite.id] }), /itself/);
    assert.throws(() => repo.updateTask(db, prerequisite.id, { dependencies: [dependent.id] }), /cycle/);
  } finally { db.close(); }
});

test('Task records survive closing and reopening the local database', () => {
  const file = path.join(tempDir('juqode-task-reopen-'), 'tasks.db');
  let db = openDb(file);
  const project = repo.openProject(db, '/tmp/durable-task-project', 'Durable');
  const task = repo.createTask(db, project.id, {
    goal: 'Survive application restart', acceptanceCriteria: ['History remains readable'],
  });
  db.close();

  db = openDb(file);
  try {
    const restored = repo.getTask(db, task.id);
    assert.strictEqual(restored.project_id, project.id);
    assert.strictEqual(restored.goal, task.goal);
    assert.deepStrictEqual(restored.acceptance_criteria, task.acceptance_criteria);
    assert.strictEqual(restored.verdict, 'unverified');
  } finally { db.close(); }
});

test('Task updates preserve criterion identity and cannot bypass the evidence verdict gate', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Initial goal', acceptanceCriteria: ['Criterion'] });
    const criterionId = task.acceptance_criteria[0].id;
    const updated = repo.updateTask(db, task.id, {
      goal: 'Revised goal',
      acceptanceCriteria: [{ id: criterionId, text: 'Revised criterion' }],
      status: 'in_progress',
    });
    assert.strictEqual(updated.goal, 'Revised goal');
    assert.strictEqual(updated.acceptance_criteria[0].id, criterionId);
    assert.strictEqual(updated.status, 'in_progress');
    assert.strictEqual(updated.verdict, 'unverified');
    assert.throws(() => repo.updateTask(db, task.id, { status: 'complete' }), /invalid Task status/);
    assert.throws(() => repo.updateTask(db, task.id, { verdict: 'pass' }), /unsupported Task field/);
    assert.throws(() => repo.createTask(db, project.id, { goal: '   ' }), /goal/);
    assert.throws(() => repo.createTask(db, project.id, { goal: 'Missing criteria array', acceptanceCriteria: 'not-an-array' }), /array/);
  } finally { db.close(); }
});

test('Task PASS requires every criterion to be reviewed against evidence from one successful Run', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, {
      goal: 'Ship the requested behavior', acceptanceCriteria: ['The UI renders it', 'A test covers it', 'The result is inspectable'],
    });
    const { work, refs } = reviewRun(db, project, task, { testCommand: 'node --test tests/e2e/visual.test.mjs' });
    const first = repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id, 'pass', [refs[0], refs[1]]);
    assert.strictEqual(first.task.verdict, 'unverified');
    assert.strictEqual(first.task.status, 'in_progress');
    const second = repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[1].id, 'pass', [refs[1]]);
    assert.strictEqual(second.task.verdict, 'unverified', 'one of three acceptance criteria is still unreviewed');
    assert.strictEqual(second.task.status, 'in_progress');
    const third = repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[2].id, 'pass', [refs[0]]);
    assert.strictEqual(third.task.verdict, 'pass');
    assert.strictEqual(third.task.status, 'complete');
    assert.strictEqual(third.reviews.length, 3);
    assert.throws(() => db.prepare('update task_criterion_review set verdict = ? where task_id = ?').run('fail', task.id), /immutable/);
    assert.throws(() => db.prepare('delete from task_criterion_review where task_id = ?').run(task.id), /immutable/);
  } finally { db.close(); }
});

test('"completed successfully" without evidence cannot pass a Task', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Verify a behavior', acceptanceCriteria: ['Behavior is correct'] });
    const { work } = reviewRun(db, project, task, { evidence: false });
    repo.saveResult(db, work.id, {
      outcome: 'complete', summary: 'completed successfully', whatFailed: null,
      claims: [{ kind: 'agent-report', data: { text: 'completed successfully' }, confidence: 'expected', sourceRef: 'claude:result' }],
      items: [],
    });
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id, 'pass', []), /requires distinct Run evidence/);
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
    assert.strictEqual(repo.getTask(db, task.id).status, 'in_progress');
    assert.throws(() => repo.updateTask(db, task.id, { verdict: 'pass' }), /unsupported Task field/);
  } finally { db.close(); }
});

test('unknown or failed test command evidence cannot verify a PASS criterion', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Require measured test evidence', acceptanceCriteria: ['The test succeeds'] });
    const { work, refs } = reviewRun(db, project, task, { testExitCode: null });
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id,
      task.acceptance_criteria[0].id, 'pass', [refs[1]]), /returned command with exit code 0/);
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id,
      task.acceptance_criteria[0].id, 'pass', [refs[0]]), /latest scoped test command/,
    'a test criterion passed using changed-file evidence while its test result was unknown');
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
  } finally { db.close(); }
});

test('criterion PASS must cite the latest successful test in its named scope', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Verify the unit contract', acceptanceCriteria: ['Unit tests pass'] });
    const { work, refs } = reviewRun(db, project, task);
    const addTest = (sourceRef, observedAt, command, exitCode) => repo.saveRunEvidence(db, work.id, {
      kind: 'test_command', source_ref: sourceRef, observed_at: observedAt, summary: command,
      content_digest: `digest:${sourceRef}`,
      details: { command, result_state: 'returned', exit_code: exitCode,
        tests_passed_count: exitCode === 0 ? 1 : 0, test_pass_claimed: false },
    }).at(-1);
    const failedLatest = addTest('unit-failed', 't2', 'node --test tests/unit.test.js', 1);
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id,
      'pass', [refs[0], failedLatest.id]), /exit code 0/);
    const e2e = addTest('e2e-pass', 't3', 'node --test tests/e2e/visual.test.mjs', 0);
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id,
      'pass', [refs[0], e2e.id]), /latest scoped test command/,
    'an E2E run was allowed to verify a unit-test criterion');
    const unitPass = addTest('unit-pass', 't4', 'node --test tests/unit.test.js', 0);
    const failedAgain = addTest('unit-failed-again', 't5', 'node --test tests/unit.test.js', 1);
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id,
      'pass', [refs[0], unitPass.id]), /latest scoped test command/,
    'an earlier passing unit run stayed sufficient after a newer unit run failed');
    assert.ok(failedAgain);
    const unitPassLatest = addTest('unit-pass-latest', 't6', 'node --test tests/unit.test.js', 0);
    const passed = repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id,
      'pass', [refs[0], unitPassLatest.id]);
    assert.strictEqual(passed.task.verdict, 'pass');
  } finally { db.close(); }
});

test('filtered unit subsets cannot satisfy an all-unit-tests criterion', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, {
      goal: 'Verify the entire unit suite', acceptanceCriteria: ['All unit tests pass'],
    });
    const partial = reviewRun(db, project, task, {
      testCommand: 'node --test tests/unit/ --test-name-pattern=OneSpecificTest',
    });
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, partial.work.id,
      task.acceptance_criteria[0].id, 'pass', partial.refs), /latest scoped test command/);
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
  } finally { db.close(); }
});

test('test acceptance cannot pass from lint evidence or a partial set of named test scopes', () => {
  const { db, project } = setup();
  try {
    const lintTask = repo.createTask(db, project.id, {
      goal: 'Require actual tests', acceptanceCriteria: ['All tests pass'],
    });
    const lintRun = reviewRun(db, project, lintTask, { testCommand: 'npm run lint' });
    assert.throws(() => repo.reviewTaskCriterion(db, lintTask.id, lintRun.work.id,
      lintTask.acceptance_criteria[0].id, 'pass', lintRun.refs), /latest scoped test command/,
    'a successful lint command was allowed to satisfy an all-tests criterion');
    assert.strictEqual(repo.getTask(db, lintTask.id).verdict, 'unverified');

    const allTask = repo.createTask(db, project.id, {
      goal: 'Require the complete configured test command', acceptanceCriteria: ['All tests pass'],
    });
    const partialRun = reviewRun(db, project, allTask, { testCommand: 'node --test tests/unit.test.js' });
    assert.throws(() => repo.reviewTaskCriterion(db, allTask.id, partialRun.work.id,
      allTask.acceptance_criteria[0].id, 'pass', partialRun.refs), /latest scoped test command/,
    'one successful suite was allowed to satisfy the all-tests criterion');
    const aggregate = repo.saveRunEvidence(db, partialRun.work.id, {
      kind: 'test_command', source_ref: 'all-tests', observed_at: 't-all', summary: 'node --test',
      content_digest: 'digest:all-tests',
      details: { command: 'node --test', result_state: 'returned', exit_code: 0,
        tests_passed_count: 3, test_pass_claimed: false },
    })[0];
    assert.strictEqual(repo.reviewTaskCriterion(db, allTask.id, partialRun.work.id,
      allTask.acceptance_criteria[0].id, 'pass', [partialRun.refs[0], aggregate.id]).task.verdict, 'pass');

    const zeroTask = repo.createTask(db, project.id, {
      goal: 'Require observed passing tests', acceptanceCriteria: ['Unit tests pass'],
    });
    const zeroRun = reviewRun(db, project, zeroTask, {
      testCommand: 'node --test tests/unit.test.js', testsPassedCount: 0,
    });
    assert.throws(() => repo.reviewTaskCriterion(db, zeroTask.id, zeroRun.work.id,
      zeroTask.acceptance_criteria[0].id, 'pass', zeroRun.refs), /test evidence for PASS|latest scoped test command/,
    'an exit-zero test command with zero observed passing tests was allowed to verify the criterion');

    const fakeTextTask = repo.createTask(db, project.id, {
      goal: 'Reject a project script that prints a test count', acceptanceCriteria: ['All tests pass'],
    });
    const fakeTextRun = reviewRun(db, project, fakeTextTask, { testCommand: 'npm test', testsPassedCount: 3 });
    assert.throws(() => repo.reviewTaskCriterion(db, fakeTextTask.id, fakeTextRun.work.id,
      fakeTextTask.acceptance_criteria[0].id, 'pass', fakeTextRun.refs), /test evidence for PASS|latest scoped test command/,
    'an exit-zero npm test script that prints forged TAP was allowed to pass');

    const staticTask = repo.createTask(db, project.id, {
      goal: 'Do not claim uncaptured static verification', acceptanceCriteria: ['Lint passes'],
    });
    const staticRun = reviewRun(db, project, staticTask);
    assert.throws(() => repo.reviewTaskCriterion(db, staticTask.id, staticRun.work.id,
      staticTask.acceptance_criteria[0].id, 'pass', staticRun.refs),
    (error) => error.code === 'unsupported-verification');
    assert.strictEqual(repo.getTask(db, staticTask.id).verdict, 'unverified');

    const scopedTask = repo.createTask(db, project.id, {
      goal: 'Require both test suites', acceptanceCriteria: ['Unit and integration tests pass'],
    });
    const scopedRun = reviewRun(db, project, scopedTask);
    const addTest = (sourceRef, command) => repo.saveRunEvidence(db, scopedRun.work.id, {
      kind: 'test_command', source_ref: sourceRef, observed_at: sourceRef, summary: command,
      content_digest: `digest:${sourceRef}`,
      details: { command, result_state: 'returned', exit_code: 0, tests_passed_count: 1, test_pass_claimed: false },
    })[0];
    const unit = addTest('scope-unit', 'node --test tests/unit.test.js');
    assert.throws(() => repo.reviewTaskCriterion(db, scopedTask.id, scopedRun.work.id,
      scopedTask.acceptance_criteria[0].id, 'pass', [scopedRun.refs[0], unit.id]), /latest scoped test command/,
    'unit evidence alone satisfied a criterion that explicitly names integration tests too');
    const integration = addTest('scope-integration', 'node --test tests/integration.test.js');
    const passed = repo.reviewTaskCriterion(db, scopedTask.id, scopedRun.work.id,
      scopedTask.acceptance_criteria[0].id, 'pass', [scopedRun.refs[0], unit.id, integration.id]);
    assert.strictEqual(passed.task.verdict, 'pass');
  } finally { db.close(); }
});

test('visible UI criteria cannot pass on changed-file evidence alone', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Render selected Task', acceptanceCriteria: ['The UI renders the selected task at narrow width'] });
    const { work } = reviewRun(db, project, task, { evidence: false });
    const changed = repo.saveRunEvidence(db, work.id, {
      kind: 'changed_files', source_ref: 'measured-change', observed_at: 't2', summary: '1 file measured',
      content_digest: 'digest:change', details: { known: true, files: ['app/renderer/view.js'] },
    })[0];
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, work.id, task.acceptance_criteria[0].id,
      'pass', [changed.id]), /latest scoped test command/);
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
  } finally { db.close(); }
});

test('criterion review rejects foreign evidence, stale Task context, and PASS from a failed Run', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Keep criterion current', acceptanceCriteria: ['The old behavior is gone'] });
    const old = reviewRun(db, project, task);
    const otherTask = repo.createTask(db, project.id, { goal: 'Other goal', acceptanceCriteria: ['Other criterion'] });
    const other = reviewRun(db, project, otherTask);
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, old.work.id,
      task.acceptance_criteria[0].id, 'pass', other.refs), /belong to the selected Run/);
    repo.updateTask(db, task.id, { acceptanceCriteria: ['A changed criterion'] });
    assert.throws(() => repo.reviewTaskCriterion(db, task.id, old.work.id,
      repo.getTask(db, task.id).acceptance_criteria[0].id, 'pass', old.refs), /current acceptance criterion/);

    const failureTask = repo.createTask(db, project.id, { goal: 'A failed attempt', acceptanceCriteria: ['The attempt passes'] });
    const failed = reviewRun(db, project, failureTask, { outcome: 'failed' });
    assert.throws(() => repo.reviewTaskCriterion(db, failureTask.id, failed.work.id,
      failureTask.acceptance_criteria[0].id, 'pass', failed.refs), /successful Run outcome/);
    const markedFail = repo.reviewTaskCriterion(db, failureTask.id, failed.work.id,
      failureTask.acceptance_criteria[0].id, 'fail', failed.refs);
    assert.strictEqual(markedFail.task.verdict, 'fail');
    assert.strictEqual(markedFail.task.status, 'in_progress');
  } finally { db.close(); }
});

test('Task IPC exposes Project-scoped creation, selection, and a truthful unverified detail', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { db, project } = setup();
  try {
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-task-ipc-evidence-'), push: () => {} });
    assert.deepStrictEqual(await handlers['juqode:task-list'](null, 'missing-project'),
      { ok: false, reason: 'no-project' });
    const created = await handlers['juqode:task-create'](null, project.id, {
      goal: 'Create one selectable Task', acceptanceCriteria: ['The Task remains unverified before evidence'],
    });
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.task.verdict, 'unverified');
    assert.deepStrictEqual((await handlers['juqode:task-list'](null, project.id)).tasks.map((task) => task.id), [created.task.id]);
    const detail = await handlers['juqode:task-detail'](null, created.task.id);
    assert.strictEqual(detail.task.id, created.task.id);
    assert.deepStrictEqual(detail.runs, []);
    assert.deepStrictEqual(detail.reviews, []);
    const invalid = await handlers['juqode:task-review-criterion'](null, created.task.id, 'missing-work',
      created.task.acceptance_criteria[0].id, 'pass', ['no-evidence']);
    assert.strictEqual(invalid.ok, false);
    assert.strictEqual((await handlers['juqode:task-detail'](null, created.task.id)).task.verdict, 'unverified');
  } finally { db.close(); }
});

test('Task retry IPC deduplicates a replay by source Run before invoking the Agent adapter', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
  const { db, project } = setup();
  const actualStart = supervisor.start;
  try {
    const task = repo.createTask(db, project.id, { goal: 'Retry through the Product boundary' });
    const prior = repo.beginWork(db, project.id, 'Run #1', { taskId: task.id }).work;
    repo.setWorkState(db, prior.id, { status: 'ended', outcome: 'failed' });
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-task-retry-ipc-'), push: () => {} });
    const calls = [];
    supervisor.start = async (store, projectRow, intent, options) => {
      calls.push({ projectId: projectRow.id, intent, options });
      const begun = repo.beginWork(store, projectRow.id, intent, options);
      return begun.ok ? { ok: true, workId: begun.work.id } : begun;
    };
    const reason = 'Add the missing verification evidence';
    const first = await handlers['juqode:task-retry'](null, task.id, prior.id, reason, 'retry-ipc-1');
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.work.work.task_id, task.id);
    assert.strictEqual(first.work.work.attempt, 2);
    assert.strictEqual(first.work.work.retry_reason, reason);
    assert.strictEqual(first.work.work.retry_of_work_id, prior.id);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.taskId, task.id);
    assert.strictEqual(calls[0].options.retryOfWorkId, prior.id);
    assert.strictEqual(calls[0].options.attempt, 2);

    const replay = await handlers['juqode:task-retry'](null, task.id, prior.id,
      'a different body after a lost reply', 'retry-ipc-2');
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.existing, true);
    assert.strictEqual(replay.work.work.id, first.work.work.id);
    assert.strictEqual(calls.length, 1, 'a replay spawned or reserved another retry');
    assert.strictEqual(db.prepare('select count(*) n from work where task_id = ?').get(task.id).n, 2);
    repo.setWorkState(db, first.work.work.id, { status: 'ended', outcome: 'failed' });

    const unknownTask = repo.createTask(db, project.id, { goal: 'Do not overlap an unknown process' });
    const unknown = repo.beginWork(db, project.id, 'Unknown after restart', { taskId: unknownTask.id }).work;
    repo.setRunnerIdentity(db, unknown.id, 'unknown-session-id', process.pid);
    repo.setWorkState(db, unknown.id, { status: 'ended', outcome: 'ended_unknown' });
    const unsafeRetry = await handlers['juqode:task-retry'](null, unknownTask.id, unknown.id,
      'Retry while its process may still exist', 'retry-unknown-live');
    assert.strictEqual(unsafeRetry.reason, 'prior-process-may-still-live');
    assert.strictEqual(calls.length, 1, 'an unknown Run with a live pid was retried into the same project');

    const noPidTask = repo.createTask(db, project.id, { goal: 'Missing runner identity is uncertain' });
    const noPid = repo.beginWork(db, project.id, 'Unknown without durable PID', { taskId: noPidTask.id }).work;
    repo.setWorkState(db, noPid.id, { status: 'ended', outcome: 'ended_unknown' });
    const unsafeNoPidRetry = await handlers['juqode:task-retry'](null, noPidTask.id, noPid.id,
      'Do not infer no process from a missing PID', 'retry-unknown-no-pid');
    assert.strictEqual(unsafeNoPidRetry.reason, 'prior-process-may-still-live');
    assert.strictEqual(calls.length, 1, 'an unknown Run without a recorded PID was retried');
  } finally {
    supervisor.start = actualStart;
    db.close();
  }
});

test('ordinary Run start refuses while a restarted unknown Run may still own the Project', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Do not overlap a detached process' });
    const unknown = repo.beginWork(db, project.id, 'Unknown Run', { taskId: task.id }).work;
    repo.setRunnerIdentity(db, unknown.id, 'unknown-session', process.pid);
    repo.setWorkState(db, unknown.id, { status: 'ended', outcome: 'ended_unknown' });
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-unknown-run-start-'), push: () => {} });
    const before = db.prepare('select count(*) n from work').get().n;
    const result = await handlers['juqode:work-start'](null, project.id, 'start another Run', task.id, 'after-unknown');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'prior-process-may-still-live');
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, before,
      'a second Run row or Agent spawn was allowed while prior ownership was uncertain');
  } finally { db.close(); }
});

test('ordinary Run start fails closed when an unknown Run has no durable process identity', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Do not assume a missing PID is gone' });
    const unknown = repo.beginWork(db, project.id, 'Unknown with no PID', { taskId: task.id }).work;
    repo.setWorkState(db, unknown.id, { status: 'ended', outcome: 'ended_unknown' });
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-unknown-no-pid-'), push: () => {} });
    const result = await handlers['juqode:work-start'](null, project.id, 'start another Run', task.id, 'after-unknown-no-pid');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'prior-process-may-still-live');
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
  } finally { db.close(); }
});

test('an unknown Task Run stays gated even when its original PID is absent', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Do not infer detached descendants are gone' });
    const unknown = repo.beginWork(db, project.id, 'Unknown after root exit', { taskId: task.id }).work;
    repo.setRunnerIdentity(db, unknown.id, 'exited-root', 2_000_000_000);
    repo.setWorkState(db, unknown.id, { status: 'ended', outcome: 'ended_unknown' });
    const { runnerMayBeAlive, unknownTaskRunWithLiveRunner } = require(path.join(R, 'app/main/work/runner-liveness.js'));
    assert.strictEqual(runnerMayBeAlive(repo.getWork(db, unknown.id)), false,
      'the fixture PID should be absent on this Linux test host');
    assert.strictEqual(unknownTaskRunWithLiveRunner(db, project.id)?.id, unknown.id,
      'an unknown Run bypassed the gate just because its original PID is absent');
    assert.strictEqual(unknownTaskRunWithLiveRunner(db, project.id, unknown.id)?.id, unknown.id,
      'a supplied source id bypassed the unresolved Run');
  } finally { db.close(); }
});

test('an unattached legacy unknown Work keeps Task Runs held after an unproven confirmation', async () => {
  const { db, project } = setup();
  const dir = tempDir('juqode-legacy-unknown-no-pid-');
  try {
    const legacy = repo.beginWork(db, project.id, 'Historical unattached Work').work;
    repo.setWorkState(db, legacy.id, { status: 'ended', outcome: 'ended_unknown' });
    const task = repo.createTask(db, project.id, { goal: 'Do not overlap the unknown legacy process' });
    const invoked = path.join(dir, 'invoked');
    const bin = fake.scriptBin(dir, 'claude', `require('node:fs').appendFileSync(${JSON.stringify(invoked)}, 'invoked');`);
    const result = await require(path.join(R, 'app/main/work/supervisor.js')).start(db, project, 'start Task Run', {
      evidenceStore: tempDir('juqode-legacy-unknown-store-'), bin, detect: async () => ({ available: true }),
      taskId: task.id, idempotencyKey: 'after-legacy-unknown',
    });
    assert.deepStrictEqual(result, {
      ok: false, reason: 'prior-process-may-still-live', detail: { workId: legacy.id },
    });
    assert.strictEqual(fs.existsSync(invoked), false, 'the uncertain legacy process did not block Agent spawn');
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
    const handlers = require(path.join(R, 'app/main/ipc.js')).makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-legacy-unknown-ack-'), push: () => {},
      observeRunner: () => ({ verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: 'stub (real observer: runner-liveness.test.js)' }) });
    assert.deepStrictEqual(handlers['juqode:legacy-unknown-ack'](null, project.id, legacy.id, false),
      { ok: false, reason: 'confirmation-required' }, 'the app recorded a stop confirmation without explicit user action');
    const acknowledged = handlers['juqode:legacy-unknown-ack'](null, project.id, legacy.id, true);
    assert.strictEqual(acknowledged.ok, false);
    assert.strictEqual(acknowledged.reason, 'prior-process-may-still-live');
    assert.strictEqual(repo.hasStoppedProcessAcknowledgement(db, legacy.id), false);
    const stillHeld = await require(path.join(R, 'app/main/work/supervisor.js')).start(db, project, 'do not overlap after confirmation', {
      evidenceStore: tempDir('juqode-legacy-unknown-store-2-'), bin, detect: async () => ({ available: true }),
      taskId: task.id, idempotencyKey: 'after-legacy-unknown-ack',
    });
    assert.strictEqual(stillHeld.reason, 'prior-process-may-still-live');
    assert.strictEqual(fs.existsSync(invoked), false, 'the refused Task Run reached its Agent adapter');
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
  } finally { db.close(); }
});

test('retrying an unknown Run remains refused even with a stopped-process confirmation', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { db, project } = setup();
  const originalStart = require(path.join(R, 'app/main/work/supervisor.js')).start;
  try {
    const task = repo.createTask(db, project.id, { goal: 'Explicitly retry an unknown Run' });
    const prior = repo.beginWork(db, project.id, 'first attempt', { taskId: task.id }).work;
    repo.setWorkState(db, prior.id, { status: 'ended', outcome: 'ended_unknown' });
    const calls = [];
    const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
    supervisor.start = async (_db, projectRow, intent, options) => {
      calls.push(options);
      const begun = repo.beginWork(db, projectRow.id, intent, options);
      return begun.ok ? { ok: true, workId: begun.work.id } : begun;
    };
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-confirm-unknown-'), push: () => {},
      observeRunner: () => ({ verdict: 'NOT_OBSERVED_WITH_EVIDENCE', reason: 'stub (real observer: runner-liveness.test.js)' }) });
    const refused = await handlers['juqode:task-retry'](null, task.id, prior.id,
      'Try again after checking', 'unknown-retry-idem');
    assert.strictEqual(refused.reason, 'prior-process-may-still-live');
    assert.strictEqual(calls.length, 0);

    const confirmed = await handlers['juqode:task-retry'](null, task.id, prior.id,
      'Try again after checking', 'unknown-retry-idem', true);
    assert.strictEqual(confirmed.ok, false);
    assert.strictEqual(confirmed.reason, 'prior-process-may-still-live');
    assert.strictEqual(calls.length, 0, 'a refused retry reached supervisor.start');
    assert.strictEqual(repo.hasStoppedProcessAcknowledgement(db, prior.id), false);
    assert.strictEqual(repo.getWork(db, prior.id).outcome, 'ended_unknown');
    assert.strictEqual(repo.worksForTask(db, task.id).length, 1);
  } finally {
    require(path.join(R, 'app/main/work/supervisor.js')).start = originalStart;
    db.close();
  }
});

test('an unknown legacy Work with a recorded live PID still blocks Task Runs', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { db, project } = setup();
  try {
    const legacy = repo.beginWork(db, project.id, 'legacy Work', {}).work;
    repo.setRunnerIdentity(db, legacy.id, 'legacy-session', process.pid);
    repo.setWorkState(db, legacy.id, { status: 'ended', outcome: 'ended_unknown' });
    const task = repo.createTask(db, project.id, { goal: 'Wait for legacy execution ownership' });
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-legacy-runner-'), push: () => {} });
    const result = await handlers['juqode:work-start'](null, project.id, 'start Task Run', task.id, 'legacy-block');
    assert.strictEqual(result.reason, 'prior-process-may-still-live');
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
  } finally { db.close(); }
});

test('IPC idempotency replay cannot alias the same key to a different Task', async () => {
  const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
  const { db, project } = setup();
  try {
    const firstTask = repo.createTask(db, project.id, { goal: 'Original idempotency owner' });
    const secondTask = repo.createTask(db, project.id, { goal: 'Different idempotency owner' });
    const first = repo.beginWork(db, project.id, 'first', {
      taskId: firstTask.id, idempotencyKey: 'project-scoped-key',
    }).work;
    repo.setWorkState(db, first.id, { status: 'ended', outcome: 'failed' });
    const handlers = makeHandlers({ db: () => db, dbFault: () => null,
      evidenceStore: () => tempDir('juqode-idempotency-owner-'), push: () => {} });
    const result = await handlers['juqode:work-start'](null, project.id, 'cross Task replay', secondTask.id, 'project-scoped-key');
    assert.deepStrictEqual(result, { ok: false, reason: 'idempotency-key-conflict' });
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
  } finally { db.close(); }
});

test('Windows process-tree probe is read-only and treats query errors as uncertain', () => {
  const calls = [];
  const query = (file, args, options) => {
    calls.push({ file, args, options });
    return { status: 0, stdout: 'gone\r\n' };
  };
  assert.strictEqual(windowsRunnerTreeMayBeAlive(4321, query), false);
  assert.strictEqual(calls[0].file, 'powershell.exe');
  assert.deepStrictEqual(calls[0].args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.match(calls[0].args[3], /^\$ErrorActionPreference = 'Stop'; \$root = 4321;/);
  assert.match(calls[0].args[3], /Get-CimInstance -ClassName Win32_Process -ErrorAction Stop/);
  assert.match(calls[0].args[3], /process-query-failed/);
  assert.doesNotMatch(calls[0].args[3], /Stop-Process|taskkill|Remove-Process/);
  assert.strictEqual(calls[0].options.timeout, 5000);
  assert.strictEqual(windowsRunnerTreeMayBeAlive(4321, () => ({ status: 0, stdout: 'alive' })), true);
  assert.strictEqual(windowsRunnerTreeMayBeAlive(4321, () => ({ status: 1, stdout: 'gone' })), true);
  assert.strictEqual(windowsRunnerTreeMayBeAlive(4321, () => ({ error: new Error('unavailable') })), true);
});

test('migration 4 preserves pre-existing Works and does not invent Tasks', () => {
  const file = path.join(tempDir('juqode-task-migration-'), 'legacy.db');
  const legacy = new DatabaseSync(file);
  legacy.exec('pragma foreign_keys = on');
  legacy.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  for (const migration of MIGRATIONS.filter((m) => m.to <= 3)) {
    legacy.exec(migration.sql);
    legacy.prepare('insert into schema_version values (?, ?)').run(migration.to, '2026-01-01T00:00:00Z');
  }
  const projectId = 'legacy-project';
  const workId = 'legacy-work';
  legacy.prepare(`insert into project (id, path, name, first_opened_at, last_opened_at)
    values (?, ?, ?, ?, ?)`).run(projectId, '/tmp/legacy-project', 'legacy', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  legacy.prepare(`insert into work (id, project_id, intent, status, requested_at, started_at)
    values (?, ?, ?, 'running', ?, ?)`).run(workId, projectId, 'legacy intent', '2026-01-02T00:00:00Z', '2026-01-02T00:00:01Z');
  legacy.close();

  const upgraded = openDb(file);
  try {
    assert.strictEqual(upgraded.prepare('select max(version) v from schema_version').get().v, LATEST);
    assert.deepStrictEqual({ ...upgraded.prepare('select id, project_id, intent, status, requested_at, started_at from work').get() }, {
      id: workId,
      project_id: projectId,
      intent: 'legacy intent',
      status: 'running',
      requested_at: '2026-01-02T00:00:00Z',
      started_at: '2026-01-02T00:00:01Z',
    });
    assert.strictEqual(upgraded.prepare('select count(*) n from task').get().n, 0,
      'historical Work rows stay taskless when no Task can be reconstructed');
    assert.strictEqual(upgraded.prepare('select task_id from work where id = ?').get(workId).task_id, null,
      'DG-06 adds the link without fabricating a historical Task');
    assert.strictEqual(upgraded.prepare("select count(*) n from sqlite_master where type='table' and name='app_session'").get().n, 1);
  } finally { upgraded.close(); }
});

test('migration 5 adds Task linkage and process fields without changing existing Work or QC rows', () => {
  const file = path.join(tempDir('juqode-task-work-migration-'), 'v4.db');
  const v4 = new DatabaseSync(file);
  v4.exec('pragma foreign_keys = on');
  v4.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  for (const migration of MIGRATIONS.filter((m) => m.to <= 4)) {
    v4.exec(migration.sql);
    v4.prepare('insert into schema_version values (?, ?)').run(migration.to, '2026-01-01T00:00:00Z');
  }
  v4.prepare(`insert into project (id, path, name, first_opened_at, last_opened_at)
    values (?, ?, ?, ?, ?)`).run('project-v4', '/tmp/v4', 'v4', 't0', 't0');
  v4.prepare(`insert into work (id, project_id, intent, status, requested_at, started_at)
    values (?, ?, ?, 'running', ?, ?)`).run('work-v4', 'project-v4', 'old Work', 't1', 't2');
  v4.prepare(`insert into quick_command_run
    (id, project_id, phrase, rule_id, command, status, started_at, created_at)
    values (?, ?, ?, ?, ?, 'running', ?, ?)`).run('qc-v4', 'project-v4', 'start', 'qc.dev.start', 'npm run dev', 't3', 't3');
  v4.close();

  const db = openDb(file);
  try {
    assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, LATEST);
    assert.strictEqual(db.prepare('select task_id from work where id = ?').get('work-v4').task_id, null);
    assert.strictEqual(db.prepare('select intent from work where id = ?').get('work-v4').intent, 'old Work');
    assert.strictEqual(db.prepare('select phrase from quick_command_run where id = ?').get('qc-v4').phrase, 'start');
    for (const [table, columns] of [['work', ['task_id', 'runner_session_id', 'runner_pid', 'runner_started_at', 'app_session_id']],
                                    ['quick_command_run', ['runner_session_id', 'runner_pid', 'runner_started_at']]]) {
      const names = new Set(db.prepare(`select name from pragma_table_info('${table}')`).all().map((r) => r.name));
      for (const column of columns) assert.ok(names.has(column), `${table}.${column} missing after v5`);
    }
  } finally { db.close(); }
});

test('migration 14 preserves old bases and persists only non-content manifest metadata', () => {
  const file = path.join(tempDir('juqode-manifest-migration-'), 'v13.db');
  const v13 = new DatabaseSync(file);
  v13.exec('pragma foreign_keys = on');
  v13.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  for (const migration of MIGRATIONS.filter((m) => m.to <= 13)) {
    v13.exec(migration.sql);
    v13.prepare('insert into schema_version values (?, ?)').run(migration.to, '2026-01-01T00:00:00Z');
  }
  v13.prepare(`insert into project (id, path, name, first_opened_at, last_opened_at)
    values ('project-v13', '/tmp/v13', 'v13', 't0', 't0')`).run();
  v13.prepare(`insert into work (id, project_id, intent, status, requested_at, started_at)
    values ('work-v13', 'project-v13', 'old Work', 'running', 't1', 't2')`).run();
  v13.prepare(`insert into evidence_basis (id, work_id, phase, kind, ref, created_at)
    values ('basis-v13', 'work-v13', 'before', 'hash_manifest', 'old-digest', 't3')`).run();
  v13.close();

  let manifestWorkId;
  const db = openDb(file);
  try {
    assert.strictEqual(db.prepare('select max(version) v from schema_version').get().v, LATEST);
    assert.deepStrictEqual({ ...db.prepare('select id, ref, manifest_json from evidence_basis').get() },
      { id: 'basis-v13', ref: 'old-digest', manifest_json: null });
    const project = repo.openProject(db, tempDir('juqode-manifest-roundtrip-'), 'Manifest');
    const task = repo.createTask(db, project.id, { goal: 'Persist path and hashes' });
    const work = repo.beginWork(db, project.id, 'manifest attempt', { taskId: task.id }).work;
    manifestWorkId = work.id;
    const files = [{ path: 'src/app.js', size: 17, sha256: 'a'.repeat(64) }];
    repo.saveBasis(db, work.id, 'before', { kind: 'hash_manifest', ref: 'manifest-digest', files, excluded: [] });
    assert.deepStrictEqual(JSON.parse(repo.basisFor(db, work.id, 'before').files), files);
  } finally { db.close(); }
  const reopened = openDb(file);
  try {
    const row = repo.basisFor(reopened, manifestWorkId, 'before');
    assert.deepStrictEqual(JSON.parse(row.files), [{ path: 'src/app.js', size: 17, sha256: 'a'.repeat(64) }]);
    const manifestRow = reopened.prepare("select manifest_json from evidence_basis where id != 'basis-v13'").get();
    assert.deepStrictEqual(JSON.parse(manifestRow.manifest_json), [{ path: 'src/app.js', size: 17, sha256: 'a'.repeat(64) }]);
    assert.ok(!manifestRow.manifest_json.includes('source text'));
  } finally { reopened.close(); }
});

test('Task Run idempotency returns one durable Work and the active-Project guard remains authoritative', () => {
  const { db, project } = setup();
  try {
    const first = repo.createTask(db, project.id, { goal: 'First Task' });
    const second = repo.createTask(db, project.id, { goal: 'Second Task' });
    const begun = repo.beginWork(db, project.id, 'attempt one', {
      taskId: first.id, status: 'starting', idempotencyKey: 'one-request-one-run',
    });
    assert.strictEqual(begun.ok, true);
    assert.strictEqual(begun.work.task_id, first.id);
    assert.strictEqual(begun.work.status, 'starting');
    assert.strictEqual(begun.work.agent_code, 'claude_code');
    assert.strictEqual(repo.getTask(db, first.id).status, 'in_progress');
    const duplicate = repo.beginWork(db, project.id, 'attempt one', {
      taskId: first.id, status: 'starting', idempotencyKey: 'one-request-one-run',
    });
    assert.strictEqual(duplicate.existing, true);
    assert.strictEqual(duplicate.work.id, begun.work.id);
    assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'same key under another Task', {
      taskId: second.id, status: 'starting', idempotencyKey: 'one-request-one-run',
    }), { ok: false, reason: 'idempotency-key-conflict' },
    'a replay key aliased another Task to the existing Run');
    assert.deepStrictEqual(repo.worksForTask(db, first.id).map((work) => work.id), [begun.work.id]);
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'attempt two', { taskId: second.id }), {
      ok: false, reason: 'active-work', active: repo.getWork(db, begun.work.id),
    });
    assert.deepStrictEqual(repo.beginWork(db, tempDir('other-project-'), 'wrong project', { taskId: first.id }), {
      ok: false, reason: 'task-project-mismatch',
    });
  } finally { db.close(); }
});

test('a completed Task Run can only be followed by an explicit linked retry', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'Keep Task Run numbers truthful' });
    const first = repo.beginWork(db, project.id, 'Run #1', {
      taskId: task.id, status: 'starting', idempotencyKey: 'numbered-run-1',
    }).work;
    repo.setWorkState(db, first.id, { status: 'ended', outcome: 'failed' });
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'unlinked repeat', {
      taskId: task.id, status: 'starting', idempotencyKey: 'unlinked-run-2',
    }), { ok: false, reason: 'task-run-retry-required' });
    const retry = repo.beginWork(db, project.id, 'Run #2', {
      taskId: task.id, status: 'starting', idempotencyKey: 'linked-run-2', attempt: 2,
      retryOfWorkId: first.id, retryReason: 'The first Run failed',
    });
    assert.strictEqual(retry.ok, true);
    assert.strictEqual(retry.work.attempt, 2);
    assert.strictEqual(retry.work.retry_of_work_id, first.id);
    assert.strictEqual(repo.getWork(db, first.id).outcome, 'failed');
    assert.deepStrictEqual(repo.worksForTask(db, task.id).map((work) => work.attempt), [2, 1]);
  } finally { db.close(); }
});

test('a retry is a new immutable Run under the same Task, and replay returns its one successor', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, {
      goal: 'Keep separate attempts', acceptanceCriteria: ['Each attempt remains reviewable'],
    });
    const first = reviewRun(db, project, task, { outcome: 'failed' });
    const failedReview = repo.reviewTaskCriterion(db, task.id, first.work.id,
      task.acceptance_criteria[0].id, 'fail', [first.refs[0]]);
    assert.strictEqual(failedReview.task.verdict, 'fail');
    repo.saveResult(db, first.work.id, {
      outcome: 'failed', summary: 'The first attempt failed', whatFailed: 'A required test was missing',
      claims: [{ kind: 'agent-report', data: { text: 'done' }, confidence: 'expected', sourceRef: 'claude:first' }],
      items: [],
    });
    const original = {
      work: { ...repo.getWork(db, first.work.id) },
      context: JSON.stringify(repo.contextBundleFor(db, first.work.id)),
      result: JSON.stringify(repo.resultFor(db, first.work.id)),
      evidence: JSON.stringify(repo.runEvidenceFor(db, first.work.id)),
    };
    const reason = 'Add the missing test and capture its result';
    const second = repo.beginWork(db, project.id, reason, {
      taskId: task.id, status: 'starting', idempotencyKey: 'task-retry-2',
      attempt: 2, retryOfWorkId: first.work.id, retryReason: reason,
    });
    assert.strictEqual(second.ok, true);
    assert.notStrictEqual(second.work.id, first.work.id);
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified',
      'starting a retry left a stale FAIL verdict current');
    assert.strictEqual(second.work.task_id, task.id);
    assert.strictEqual(second.work.attempt, 2);
    assert.strictEqual(second.work.retry_of_work_id, first.work.id);
    assert.strictEqual(second.work.retry_reason, reason);

    const replay = repo.beginWork(db, project.id, 'different replay body', {
      taskId: task.id, status: 'starting', idempotencyKey: 'task-retry-replayed',
      attempt: 2, retryOfWorkId: first.work.id, retryReason: 'different replay reason',
    });
    assert.strictEqual(replay.existing, true);
    assert.strictEqual(replay.retryReplay, true);
    assert.strictEqual(replay.work.id, second.work.id);
    assert.strictEqual(db.prepare('select count(*) n from work where task_id = ?').get(task.id).n, 2);

    const refreshedTask = repo.getTask(db, task.id);
    const secondContext = buildContextBundle({ project, task: refreshedTask, userPrompt: reason });
    repo.saveRunContextBundle(db, second.work.id, secondContext);
    const priorAfter = {
      work: { ...repo.getWork(db, first.work.id) },
      context: JSON.stringify(repo.contextBundleFor(db, first.work.id)),
      result: JSON.stringify(repo.resultFor(db, first.work.id)),
      evidence: JSON.stringify(repo.runEvidenceFor(db, first.work.id)),
    };
    assert.deepStrictEqual(priorAfter, original, 'retry changed the historical first Run');
    assert.notStrictEqual(repo.contextBundleFor(db, second.work.id).bundle.bundle_id,
      repo.contextBundleFor(db, first.work.id).bundle.bundle_id);
    assert.throws(() => db.prepare('update run_context_bundle set bundle_json = ? where work_id = ?')
      .run('{}', first.work.id), /immutable/);

    repo.setWorkState(db, second.work.id, { status: 'ended', outcome: 'ended_unknown' });
    assert.throws(() => db.prepare(`insert into work
      (id, project_id, task_id, intent, status, requested_at, started_at, idempotency_key,
       attempt, retry_of_work_id, retry_reason, agent_code, app_session_id)
      select 'duplicate-successor', project_id, task_id, 'duplicate', 'starting', requested_at,
        started_at, 'duplicate-successor-key', 2, retry_of_work_id, 'duplicate', agent_code, app_session_id
      from work where id = ?`).run(second.work.id), /UNIQUE constraint failed: work\.retry_of_work_id/,
    'the durable unique index must reject a duplicate retry even if repository checks are bypassed');
    const third = repo.beginWork(db, project.id, 'Resolve unknown attempt explicitly', {
      taskId: task.id, status: 'starting', idempotencyKey: 'task-retry-3',
      attempt: 3, retryOfWorkId: second.work.id, retryReason: 'Resolve unknown attempt explicitly',
    });
    assert.strictEqual(third.ok, true);
    assert.strictEqual(third.work.retry_of_work_id, second.work.id);
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
  } finally { db.close(); }
});

test('retry rejects an active source, wrong attempt number, missing reason, and cross-Task source', () => {
  const { db, project } = setup();
  try {
    const task = repo.createTask(db, project.id, { goal: 'First Task' });
    const other = repo.createTask(db, project.id, { goal: 'Second Task' });
    const active = repo.beginWork(db, project.id, 'Run #1', { taskId: task.id, status: 'starting' }).work;
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'bad retry', {
      taskId: task.id, attempt: 2, retryOfWorkId: active.id, retryReason: 'retry',
    }), { ok: false, reason: 'bad-retry-source' });
    repo.setWorkState(db, active.id, { status: 'ended', outcome: 'failed' });
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'wrong attempt', {
      taskId: task.id, attempt: 4, retryOfWorkId: active.id, retryReason: 'retry',
    }), { ok: false, reason: 'bad-attempt-sequence' });
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'no reason', {
      taskId: task.id, attempt: 2, retryOfWorkId: active.id,
    }), { ok: false, reason: 'retry-reason-required' });
    assert.deepStrictEqual(repo.beginWork(db, project.id, 'cross Task', {
      taskId: other.id, attempt: 2, retryOfWorkId: active.id, retryReason: 'retry',
    }), { ok: false, reason: 'bad-retry-source' });
  } finally { db.close(); }
});

test('app session ownership survives restart and interrupted Task Runs reconcile to unknown without replay', () => {
  const file = path.join(tempDir('juqode-run-restart-'), 'restart.db');
  let db = openDb(file);
  const project = repo.openProject(db, '/tmp/restart-task-project', 'Restart');
  const oldSession = repo.startAppSession(db, { appVersion: '0.1-test', platform: 'linux' });
  const task = repo.createTask(db, project.id, { goal: 'Survive interruption' });
  const run = repo.beginWork(db, project.id, 'Run interrupted by app close', {
    taskId: task.id, status: 'starting', appSessionId: oldSession.id,
  }).work;
  repo.setRunnerIdentity(db, run.id, 'claude-session-for-run-1', 2147483000, '2026-10-05T00:00:00.000Z');
  assert.strictEqual(repo.processFor(db, run.id).pid, 2147483000,
    'process identity must be queryable from durable columns even without a signal marker');
  db.close(); // simulate a crash: no endAppSession and no child result

  db = openDb(file);
  try {
    const currentSession = repo.startAppSession(db, { appVersion: '0.1-test', platform: 'linux' });
    assert.notStrictEqual(currentSession.id, oldSession.id);
    assert.strictEqual(db.prepare('select ended_at from app_session where id = ?').get(oldSession.id).ended_at, null,
      'crash simulation should leave the prior launch open');
    assert.deepStrictEqual(repo.reconcileLostWorks(db, () => true), [run.id],
      'a Task Run from a prior launch must not stay falsely live or be reattached');
    const recovered = repo.getWork(db, run.id);
    assert.strictEqual(recovered.status, 'ended');
    assert.strictEqual(recovered.outcome, 'ended_unknown');
    assert.strictEqual(recovered.failure_reason, 'app-restarted-before-run-completion');
    assert.strictEqual(recovered.app_session_id, oldSession.id);
    assert.strictEqual(repo.workForRetrySource(db, run.id), null);
    assert.strictEqual(db.prepare('select count(*) n from work where task_id = ?').get(task.id).n, 1,
      'restart reconciliation must not create a replacement Run');
    assert.strictEqual(repo.endAppSession(db, currentSession.id), true);
    assert.ok(db.prepare('select ended_at from app_session where id = ?').get(currentSession.id).ended_at);
  } finally { db.close(); }
});

test('a database claiming current version while missing the migrated Task table is refused', () => {
  const file = path.join(tempDir('juqode-task-integrity-'), 'damaged.db');
  let db = openDb(file);
  db.close();
  db = new DatabaseSync(file);
  db.exec('drop table task');
  db.close();
  assert.throws(() => openDb(file), (e) => e.code === 'db-corrupt' && /after migrations/.test(e.message));
});
