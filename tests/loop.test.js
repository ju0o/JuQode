/* WBS-12 Steps · WBS-13 input · WBS-14 permission · WBS-15 liveness · WBS-16 cancel ·
 * WBS-17 after-snapshot — the Work loop, driven end to end through the supervisor.
 *
 * The CLI is a script that emits a chosen stream, so every branch is reachable and none of it
 * depends on what a real model happens to do. The git repository, the evidence store and the
 * database are all real.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { code: read } = require(path.join(__dirname, 'src.js'));
const { code: srcOf } = require(path.join(__dirname, 'src.js'));

/* Every fixture directory this file makes, removed when the file finishes. The suite leaked one
 * per case and filled a 7.5 GB tmpfs mid-run — after which every later failure looked like a
 * product bug rather than a full disk. */
const juqodeTempDirs = [];
const tempDir = (prefix) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  juqodeTempDirs.push(d);
  return d;
};
/* descendants of cancelled fixtures are alive by design; they must not hold the runner open */
test.after(() => fake.reapProcessesUnder(juqodeTempDirs, { handles: [...supervisor.live.values()].map((e) => e.child).filter(Boolean) }));
process.on('exit', () => {
  for (const d of juqodeTempDirs) {
    for (const target of [d, `${d}-cli`]) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* already gone */ }
    }
  }
});
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const session = require(path.join(R, 'app/main/claude/session.js'));
const { KIND } = require(path.join(R, 'app/main/work/reducer.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });

/** A project, a store, a database — all real, all disposable. */
function bench({ git = true, files = { 'a.txt': 'one\n' } } = {}) {
  const dir = tempDir('juqode-loop-');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  if (git) {
    const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    g('add', '-A', '.'); g('commit', '-qm', 'baseline');
  }
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, path.basename(dir));
  return { dir, db, project, store: tempDir('juqode-store-') };
}

/** A CLI that emits exactly the given events, one per line, then exits. */
/* The fake CLI and its argv log live OUTSIDE the project — anything written inside it is a
 * change the evidence layer would (correctly) report as the Work's own. */
function cliHome(dir) {
  const home = `${dir}-cli`;
  fs.mkdirSync(home, { recursive: true });
  return home;
}

function cli(dir, events, { edits = [], exit = 0, silent = false, capturePrompt = false, name = 'fake-claude', initCwd = null, initSessionId = undefined } = {}) {
  const home = cliHome(dir);
  const script = path.join(home, `${name}.js`);
  /* argv is appended to a log, so a test can assert what actually REACHED the process rather
   * than what the caller believed it sent — "same session, same Work" was claimed by two test
   * titles and asserted by neither, so `resume: false` and an empty grant both passed. */
  fs.writeFileSync(script, `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(path.join(cliHome(dir), 'ARGV.log'))}, process.argv.slice(2).join(' ') + '\\n');
${capturePrompt ? `fs.writeFileSync(${JSON.stringify(path.join(home, 'PROMPT.log'))}, fs.readFileSync(0, 'utf8'));` : ''}
${edits.map((e) => `fs.writeFileSync(${JSON.stringify(e.path)}, ${JSON.stringify(e.body)});`).join('\n')}
${silent ? '' : `for (const e of ${JSON.stringify(events)}) {
  /* a real CLI's init event reports the cwd it actually runs in (measured on --resume, 2.1.283) */
  if (e.type === 'system' && e.subtype === 'init' && !e._literal) {
    e.cwd = ${initCwd === null ? 'process.cwd()' : JSON.stringify(initCwd)};
    /* a real CLI reports the session id it was given (--session-id) or resumed (--resume); the
     * fixture used to print a constant, which made the id check unfalsifiable */
    const a = process.argv, i = Math.max(a.indexOf('--session-id'), a.indexOf('--resume'));
    ${initSessionId === undefined ? 'e.session_id = a[i + 1];' : initSessionId === null ? 'delete e.session_id;' : `e.session_id = ${JSON.stringify(initSessionId)};`}
  }
  process.stdout.write(JSON.stringify(e) + '\\n');
}`}
process.exit(${exit});
`);
  return fake.launcher(home, name, script);
}

const argvLog = (dir) => {
  const f = path.join(`${dir}-cli`, 'ARGV.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};

const INIT = { type: 'system', subtype: 'init', session_id: 's', cwd: '/p' };
const OK = { type: 'result', subtype: 'success', is_error: false, permission_denials: [], result: '했어요' };

/* ───────────────────────── the happy path, and the evidence around it ───────────────────────── */

test('a Work runs, ends, and its changes are a measured number', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK], { edits: [{ path: path.join(dir, 'a.txt'), body: 'two\n' }] });

  const r = await supervisor.start(db, project, 'a.txt 를 바꿔줘', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true, `start refused: ${r.reason}`);
  await r.done;              // `start` resolves at the first event; the turn ends later

  const snap = supervisor.snapshot(db, r.workId);
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.outcome, 'complete');
  assert.strictEqual(snap.work.intent, 'a.txt 를 바꿔줘', 'the Work is named by the user\'s own words');

  /* Both bases exist, so `변경 n개` is measured rather than claimed. */
  assert.ok(snap.evidence.before && snap.evidence.after, 'a basis is missing');
  /* The store is passed in rather than looked up in memory — History must be able to answer
   * this for a Work that has already ended, and a finished Work holds nothing live. */
  const changed = supervisor.changes(db, r.workId, project, store);
  assert.strictEqual(changed.known, true);
  assert.deepStrictEqual(changed.files, ['a.txt']);

  /* Every line the CLI emitted is on the record, before anything interpreted it. */
  const signals = repo.signalsFor(db, r.workId);
  assert.ok(signals.length >= 2, `only ${signals.length} signals persisted`);
  assert.ok(signals.every((s) => s.payload !== null || s.kind === 'reconciled'),
    '기술 출력 보기 would have nothing to show for some signal');
  const changedEvidence = supervisor.snapshot(db, r.workId).runEvidence.find((item) => item.kind === 'changed_files');
  assert.deepStrictEqual(changedEvidence.details.files, ['a.txt']);
});

test('a Task Run stores a completed test-like command separately from the Agent report', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, { goal: 'Observe a test command', acceptanceCriteria: ['The command result is inspectable'] });
  const toolUse = { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'test-tool-1', name: 'Bash', input: { command: 'npm run test:unit' } },
  ] } };
  const toolResult = { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'test-tool-1', content: '599 tests passed', is_error: false },
  ] }, tool_use_result: { stdout: '599 tests passed', stderr: '' } };
  const bin = cli(dir, [INIT, toolUse, toolResult, { ...OK, result: 'completed successfully' }]);
  const run = await supervisor.start(db, project, 'Run a test', {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: 'evidence-run-1',
  });
  assert.strictEqual(run.ok, true);
  await run.done;
  const snap = supervisor.snapshot(db, run.workId);
  const tests = snap.runEvidence.filter((item) => item.kind === 'test_command');
  assert.strictEqual(tests.length, 1);
  assert.strictEqual(tests[0].details.command, 'npm run test:unit');
  assert.strictEqual(tests[0].details.result_state, 'returned');
  assert.strictEqual(tests[0].details.exit_code, null);
  assert.strictEqual(tests[0].details.tests_passed_count, null,
    'an arbitrary output string was treated as structured passing-test evidence');
  assert.strictEqual(tests[0].details.test_pass_claimed, false);
  assert.strictEqual(snap.result.claims.find((claim) => claim.kind === 'agent-report').data.text,
    'completed successfully');
  assert.notStrictEqual(tests[0].id, snap.result.claims.find((claim) => claim.kind === 'agent-report').sourceRef);
});

test('Task Run persistence redacts secret-like Task, prompt, stream, evidence, and report text', async () => {
  const { dir, db, project, store } = bench({ git: false });
  const secret = 'SYNTHETIC_SECRET_VALUE_93841';
  const opaqueStructuredSecret = 'opaque-value-without-a-recognizable-prefix';
  const tokenObjectKey = 'ghp_syntheticFixtureTokenValue93841021';
  const task = repo.createTask(db, project.id, {
    goal: `Store safely API_KEY=${secret}`,
    acceptanceCriteria: [`The result hides password=${secret}`],
  });
  const events = [
    INIT,
    { type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'secret-test', name: 'Bash', input: { command: `npm run test:unit -- --api-key=${secret}` } },
    ] } },
    { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'secret-test', content: `test output api_key=${secret}`, is_error: false },
    ] }, tool_use_result: { stdout: `test output api_key=${secret}`, stderr: '', exitCode: 0 } },
    { ...OK, result: `completed successfully; client_secret=${secret}`,
      metadata: { api_key: opaqueStructuredSecret, [tokenObjectKey]: 'synthetic marker' } },
  ];
  const bin = cli(dir, events);
  const idempotencyKey = `API_KEY=${secret}`;
  const run = await supervisor.start(db, project, `Run once API_KEY=${secret}`, {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey,
  });
  assert.strictEqual(run.ok, true);
  await run.done;

  const persisted = [
    JSON.stringify(repo.getTask(db, task.id)),
    JSON.stringify(repo.getWork(db, run.workId)),
    JSON.stringify(repo.signalsFor(db, run.workId)),
    JSON.stringify(repo.resultFor(db, run.workId)),
    JSON.stringify(repo.runEvidenceFor(db, run.workId)),
    JSON.stringify(repo.contextBundleFor(db, run.workId)),
  ].join('\n');
  assert.ok(!persisted.includes(secret), 'a synthetic secret value crossed into durable Task Run records');
  assert.ok(!persisted.includes(opaqueStructuredSecret), 'a secret value escaped because its structured field name was not inspected');
  assert.ok(!persisted.includes(tokenObjectKey), 'a token-shaped structured key crossed into durable signal metadata');
  assert.match(persisted, /juqodeRedaction/, 'persisted signal omitted redaction metadata');
  assert.ok(!repo.getWork(db, run.workId).idempotency_key.includes(secret), 'idempotency key was stored in plaintext');
  assert.strictEqual(repo.workForIdempotency(db, project.id, idempotencyKey).id, run.workId);
  assert.match(persisted, /\[redacted\]/, 'redaction left no visible indication in persisted snapshots');
  assert.strictEqual(repo.getWork(db, run.workId).intent, `Run once [redacted]`);
  const result = repo.resultFor(db, run.workId);
  assert.strictEqual(result.summary, `completed successfully; [redacted]`);
  assert.strictEqual(result.claims.find((claim) => claim.kind === 'agent-report').data.redacted, true);
  assert.strictEqual(repo.contextBundleFor(db, run.workId).bundle.prompt_snapshot_redacted, true);
});

test('Task Run records changed paths without persisting source text, and manifest evidence survives restart', async () => {
  const dir = tempDir('juqode-task-manifest-');
  const source = path.join(dir, 'src', 'app.js');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'export const value = 1;\n');
  const database = path.join(tempDir('juqode-task-manifest-db-'), 'juqode.db');
  const store = tempDir('juqode-task-manifest-store-');
  let db = openDb(database);
  const project = repo.openProject(db, dir, 'Manifest-backed Task Run');
  const task = repo.createTask(db, project.id, { goal: 'Change a file without storing its contents' });
  const secret = 'SYNTHETIC_SOURCE_SECRET_91827';
  const bin = cli(dir, [INIT, OK], { edits: [{ path: source, body: `export const value = '${secret}';\n` }] });
  const run = await supervisor.start(db, project, 'Change the measured source file', {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: 'manifest-source-test',
  });
  assert.strictEqual(run.ok, true);
  await run.done;
  const changed = supervisor.snapshot(db, run.workId).runEvidence.find((item) => item.kind === 'changed_files');
  assert.deepStrictEqual(changed.details.files, ['src/app.js']);
  assert.strictEqual(db.prepare('select count(*) n from raw_diff where work_id = ?').get(run.workId).n, 0,
    'Task Run source diff content was persisted');
  const manifests = db.prepare('select manifest_json from evidence_basis where work_id = ?').all(run.workId);
  assert.strictEqual(manifests.length, 2);
  assert.ok(manifests.every((row) => typeof row.manifest_json === 'string'));
  assert.ok(!manifests.some((row) => row.manifest_json.includes(secret)));
  db.close();

  db = openDb(database);
  try {
    const reopenedProject = db.prepare('select * from project where id = ?').get(project.id);
    assert.deepStrictEqual(supervisor.changes(db, run.workId, reopenedProject, store), {
      known: true, files: ['src/app.js'],
    }, 'changed-file evidence became unknown after reopening the database');
    assert.ok(!JSON.stringify(repo.contextBundleFor(db, run.workId)).includes(secret));
    assert.ok(!JSON.stringify(repo.signalsFor(db, run.workId)).includes(secret));
    assert.ok(!JSON.stringify(repo.resultFor(db, run.workId)).includes(secret));
    const files = [];
    const walk = (root) => {
      if (!fs.existsSync(root)) return;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) walk(target); else files.push(fs.readFileSync(target, 'utf8'));
      }
    };
    walk(store);
    assert.ok(!files.join('\n').includes(secret), 'the Task Run wrote source contents into its evidence store');
  } finally { db.close(); }
});

test('the existing Claude Work path carries the selected Task and frozen Context into the attempt', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, {
    goal: 'Change a.txt safely', acceptanceCriteria: ['The Work remains linked to this Task'],
  });
  const bin = cli(dir, [INIT, OK], {
    edits: [{ path: path.join(dir, 'a.txt'), body: 'two\n' }], capturePrompt: true,
  });
  const run = await supervisor.start(db, project, 'Change a.txt safely', {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id,
  });
  assert.strictEqual(run.ok, true, `Task-linked Work refused: ${run.reason}`);
  await run.done;
  const work = repo.getWork(db, run.workId);
  assert.strictEqual(work.task_id, task.id);
  assert.deepStrictEqual(repo.worksForTask(db, task.id).map((item) => item.id), [run.workId]);
  assert.strictEqual(work.intent, 'Change a.txt safely');
  const context = repo.contextBundleFor(db, run.workId);
  assert.ok(context, 'the started Task Run has no ContextBundle');
  assert.strictEqual(context.bundle.task_ref, task.id);
  assert.strictEqual(context.bundle.project_ref, project.id);
  assert.strictEqual(context.bundle.workspace_capability.selected_file_isolation, false);
  assert.deepStrictEqual(context.bundle.selected_resources, []);
  assert.strictEqual(fs.readFileSync(path.join(`${dir}-cli`, 'PROMPT.log'), 'utf8'),
    context.bundle.prompt_snapshot, 'the stored safe snapshot is exactly what the CLI received');
});

test('a Task Run and its Context exist before the Claude session can spawn', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, { goal: 'Run before spawn', acceptanceCriteria: ['Stored first'] });
  const requestKey = 'submit-once-001';
  const actualRun = session.run;
  let observedBeforeSpawn = null;
  session.run = (options) => {
    observedBeforeSpawn = repo.activeWork(db, project.id);
    assert.strictEqual(observedBeforeSpawn.status, 'starting');
    assert.strictEqual(observedBeforeSpawn.task_id, task.id);
    assert.match(observedBeforeSpawn.idempotency_key, /^sha256:[a-f0-9]{64}$/);
    assert.ok(repo.contextBundleFor(db, observedBeforeSpawn.id), 'ContextBundle must be frozen before spawn');
    options.onChild({ pid: process.pid, exitCode: null, signalCode: null });
    options.onSignal({ kind: KIND.FINISH, payload: {
      subtype: 'success', terminalReason: 'end_turn', isError: false, denials: [],
    } }, { type: 'result' }, JSON.stringify({ type: 'result', subtype: 'success' }));
    return Promise.resolve({ code: 0, signal: null, sawEvent: true, stderr: '', startFailed: false, unparsed: 0 });
  };
  try {
    const r = await supervisor.start(db, project, 'Do it', {
      evidenceStore: store, bin: cli(dir, [INIT, OK]) /* a real file: its identity is pinned, but session.run is stubbed */, detect: AVAILABLE, taskId: task.id,
      idempotencyKey: requestKey,
    });
    assert.strictEqual(r.ok, true);
    await r.done;
    assert.ok(observedBeforeSpawn, 'the session started without a reserved Run');
    const work = repo.getWork(db, r.workId);
    assert.strictEqual(work.status, 'ended');
    assert.strictEqual(work.outcome, 'complete');
    assert.strictEqual(work.runner_session_id != null, true);
    assert.strictEqual(work.runner_pid, process.pid);
  } finally { session.run = actualRun; }
});

test('a Task process that emits no event remains a failed Run with a durable reason', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, { goal: 'Record an Agent start failure', acceptanceCriteria: ['The attempt remains inspectable'] });
  const bin = cli(dir, [], { silent: true, exit: 1 });
  const r = await supervisor.start(db, project, 'Try the task', {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: 'start-failure-1',
  });
  assert.strictEqual(r.ok, true, 'the accepted Run should be returned even if the child emits no event');
  await r.done;
  const work = repo.getWork(db, r.workId);
  assert.strictEqual(work.task_id, task.id);
  assert.strictEqual(work.status, 'ended');
  assert.strictEqual(work.outcome, 'failed');
  assert.strictEqual(work.failure_reason, 'agent-start-failed-before-first-event');
  assert.ok(work.runner_session_id && work.runner_pid && work.runner_started_at);
  assert.ok(repo.contextBundleFor(db, work.id));
  assert.ok(repo.resultFor(db, work.id));
});

test('failed Task Run retries as a new Claude session and never rewrites Run #1', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, {
    goal: 'Retry without losing history', acceptanceCriteria: ['The retry is independently inspectable'],
  });
  const firstBin = cli(dir, [INIT, {
    type: 'result', subtype: 'error_max_turns', terminal_reason: 'error_max_turns',
    is_error: false, permission_denials: [], result: 'I could not finish within the turn limit',
  }]);
  const first = await supervisor.start(db, project, 'Make the requested change', {
    evidenceStore: store, bin: firstBin, detect: AVAILABLE, taskId: task.id,
    idempotencyKey: 'task-loop-attempt-1',
  });
  assert.strictEqual(first.ok, true);
  await first.done;
  const firstBefore = {
    work: { ...repo.getWork(db, first.workId) },
    context: JSON.stringify(repo.contextBundleFor(db, first.workId)),
    result: JSON.stringify(repo.resultFor(db, first.workId)),
    evidence: JSON.stringify(repo.runEvidenceFor(db, first.workId)),
    signals: JSON.stringify(repo.signalsFor(db, first.workId)),
    basis: JSON.stringify({ before: repo.basisFor(db, first.workId, 'before'), after: repo.basisFor(db, first.workId, 'after') }),
    steps: JSON.stringify(repo.stepsFor(db, first.workId)),
  };
  assert.strictEqual(firstBefore.work.outcome, 'failed');

  const retryReason = 'Continue the change and run the focused test';
  const secondBin = cli(dir, [INIT, OK], {
    edits: [{ path: path.join(dir, 'a.txt'), body: 'retry result with evidence\n' }], capturePrompt: true,
  });
  const second = await supervisor.start(db, project, retryReason, {
    evidenceStore: store, bin: secondBin, detect: AVAILABLE, taskId: task.id,
    idempotencyKey: 'task-loop-attempt-2', attempt: 2,
    retryOfWorkId: first.workId, retryReason,
  });
  assert.strictEqual(second.ok, true);
  assert.notStrictEqual(second.workId, first.workId);
  await second.done;

  const firstAfter = {
    work: { ...repo.getWork(db, first.workId) },
    context: JSON.stringify(repo.contextBundleFor(db, first.workId)),
    result: JSON.stringify(repo.resultFor(db, first.workId)),
    evidence: JSON.stringify(repo.runEvidenceFor(db, first.workId)),
    signals: JSON.stringify(repo.signalsFor(db, first.workId)),
    basis: JSON.stringify({ before: repo.basisFor(db, first.workId, 'before'), after: repo.basisFor(db, first.workId, 'after') }),
    steps: JSON.stringify(repo.stepsFor(db, first.workId)),
  };
  assert.deepStrictEqual(firstAfter, firstBefore, 'Run #2 rewrote Run #1 history');
  const secondSnap = supervisor.snapshot(db, second.workId);
  assert.strictEqual(secondSnap.work.task_id, task.id);
  assert.strictEqual(secondSnap.work.attempt, 2);
  assert.strictEqual(secondSnap.work.retry_of_work_id, first.workId);
  assert.strictEqual(secondSnap.work.retry_reason, retryReason);
  assert.strictEqual(secondSnap.work.outcome, 'complete');
  assert.notStrictEqual(secondSnap.work.runner_session_id, firstBefore.work.runner_session_id);
  assert.notStrictEqual(secondSnap.contextBundle.bundle.bundle_id,
    JSON.parse(firstBefore.context).bundle.bundle_id);
  assert.strictEqual(fs.readFileSync(path.join(`${dir}-cli`, 'PROMPT.log'), 'utf8'),
    secondSnap.contextBundle.bundle.prompt_snapshot, 'retry Context does not match the actual prompt');
  assert.deepStrictEqual(repo.worksForTask(db, task.id).map((run) => run.id), [second.workId, first.workId]);
  assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified',
    'a successful agent run without criterion reviews must not mark the Task PASS');
});

test('a finished Work has a result, and every 확인됨 claim names its evidence', async () => {
  const { dir, db, project, store } = bench();
  /* A size-CHANGING edit: this test is about the result pipeline, and a same-size edit would
   * make it depend on git's stat heuristics as well. The same-size shape has its own test. */
  const bin = cli(dir, [INIT, OK], { edits: [{ path: path.join(dir, 'a.txt'), body: 'two and more\n' }] });
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  const res = repo.resultFor(db, r.workId);
  assert.ok(res, 'a finished Work wrote no result at all');
  for (const c of res.claims) {
    if (c.confidence === 'confirmed') assert.ok(c.sourceRef, `a 확인됨 claim with no source: ${c.kind}`);
  }
  const changed = res.claims.find((c) => c.kind === 'changed-files');
  assert.deepStrictEqual(changed.data.files, ['a.txt']);
  assert.strictEqual(changed.confidence, 'confirmed');

  /* Claude Code's own words survive into the result. They were lost once: the live entry was
   * released the moment the status changed, so the result was built from a state rebuilt out
   * of the row — which has no `finish`. */
  const report = res.claims.find((c) => c.kind === 'agent-report');
  assert.ok(report, "the model's own report did not reach the result");
  assert.strictEqual(report.confidence, 'expected', "the model's own report is never 확인됨");
  assert.strictEqual(report.data.text, '했어요');

  /* And it survives the store, so History can show it without the session. */
  assert.strictEqual(supervisor.snapshot(db, r.workId).result.claims.length, res.claims.length);
});

test('the patch is stored per file, so the change reader works from History', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK], { edits: [{ path: path.join(dir, 'a.txt'), body: 'two\n' }] });
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  const diffs = repo.diffsFor(db, r.workId);
  assert.deepStrictEqual(diffs.map((d) => d.file), ['a.txt']);
  assert.match(diffs[0].patch, /^@@ /m, 'the stored patch has no hunk at all');
  assert.strictEqual(diffs[0].displayable, true);

  /* …and the units are derivable from it without the session or the live map. */
  const seg = supervisor.blocksFor(db, r.workId, project, store);
  assert.strictEqual(seg.length, 1);
  assert.ok(seg[0].blocks.length > 0, 'the stored patch produced no block at all');
});

test('a Work that changed nothing says so — it does not guess', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, '아무것도 안 바꿔줘', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const changed = supervisor.changes(db, r.workId, project, store);
  assert.strictEqual(changed.known, true, 'both bases exist, so the answer is knowable');
  assert.deepStrictEqual(changed.files, []);
});

/* ───────────────────────── the four refusals, in Canon's order ───────────────────────── */

test('Claude Code being unavailable stops the Work before anything else happens', async () => {
  const { db, project, store } = bench();
  const r = await supervisor.start(db, project, 'x', {
    evidenceStore: store, detect: async () => ({ available: false, reason: 'logged-out' }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'claude-unavailable');
  assert.strictEqual(r.detail.reason, 'logged-out');
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, 0, 'a refused start wrote a Work row');
});

test('a second Work is refused as a guard, and the first is named', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  await (await supervisor.start(db, project, '첫 번째', { evidenceStore: store, bin, detect: AVAILABLE })).done;
  /* the first ended, so re-open the slot deliberately to test the guard */
  const first = repo.worksFor(db, project.id)[0];
  repo.setWorkState(db, first.id, { status: 'running' });

  /* A second CLI that leaves a mark if it runs at all. Counting `work` rows cannot tell the
   * preflight guard from the DB index — with the guard removed the row count is still 1 while
   * a second Claude Code session runs a full turn in the same repository. */
  const bin2 = cli(dir, [INIT, OK], { name: 'second-claude', edits: [{ path: path.join(dir, 'SECOND-RAN'), body: 'x' }] });
  const r = await supervisor.start(db, project, '두 번째', { evidenceStore: store, bin: bin2, detect: AVAILABLE });
  assert.strictEqual(r.reason, 'active-work');
  assert.strictEqual(r.detail.intent, '첫 번째', 'the guard must name the Work that is actually running');
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1, 'the refused request was queued');
  assert.strictEqual(fs.existsSync(path.join(dir, 'SECOND-RAN')), false,
    'the guard refused, but a second Claude Code session ran in the project anyway');
});

test('availability is checked BEFORE the guard — the order Canon fixes', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  await (await supervisor.start(db, project, '첫', { evidenceStore: store, bin, detect: AVAILABLE })).done;
  repo.setWorkState(db, repo.worksFor(db, project.id)[0].id, { status: 'running' });

  /* With a Work already running AND Claude unavailable, `12` reports the availability — it is
   * the first question, and answering the second one instead tells the user to wait for
   * something that could not have started either way. */
  const r = await supervisor.start(db, project, '둘', {
    evidenceStore: store, bin, detect: async () => ({ available: false, reason: 'logged-out' }),
  });
  assert.strictEqual(r.reason, 'claude-unavailable', `reported ${r.reason} instead`);
});

test('a project with no honest basis does not start a change Work', async () => {
  const { dir, db, project, store } = bench({ git: true });
  fs.writeFileSync(path.join(dir, '.git/MERGE_HEAD'), 'deadbeef\n');
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.reason, 'evidence-blocked');
  assert.strictEqual(r.detail.reason, 'mid-merge');
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, 0);
});

test('a session that never speaks writes no Work row at all', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [], { silent: true, exit: 3 });
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.reason, 'start-failed');
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, 0,
    '`20`: History is Works that started — a start failure is not one');
  assert.strictEqual(db.prepare('select count(*) n from evidence_basis').get().n, 0);
});

/* ───────────────────────── WBS-14 · the permission cycle ───────────────────────── */

const DENIED = {
  type: 'system', subtype: 'permission_denied', tool_name: 'Edit',
  tool_use_id: 'tu_1', message: 'Claude requested permissions to write to /p/a.txt',
};
const RESULT_DENIED = {
  type: 'result', subtype: 'success', is_error: false, result: '못 했어요',
  permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_1', tool_input: { file_path: 'a.txt' } }],
};

test('a refused action leaves the Work open with a card, not ended', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'a.txt 바꿔줘', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true);
  await r.done;

  const snap = supervisor.snapshot(db, r.workId);
  assert.strictEqual(snap.status, 'permission_waiting');
  assert.strictEqual(snap.outcome, null, 'a Work with an unanswered refusal has not ended');
  assert.strictEqual(snap.permission.tool, 'Edit');
  assert.strictEqual(repo.getWork(db, r.workId).status, 'permission_waiting', 'the store disagrees with the screen');
});

test('allowing retries that ONE action, and records that a person allowed it', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'a.txt 바꿔줘', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  /* the retry turn succeeds and edits the file */
  const retryBin = cli(dir, [INIT, OK], { edits: [{ path: path.join(dir, 'a.txt'), body: 'allowed\n' }], capturePrompt: true });
  useBin(r.workId, retryBin);

  const allowed = await supervisor.allow(db, r.workId, 'tu_1');
  assert.strictEqual(allowed.ok, true);
  assert.strictEqual(allowed.scope, 'Edit(a.txt)', 'the grant must name one tool and one target');

  /* What actually REACHED the process, not what `allow` returned about itself. */
  const retryArgs = argvLog(dir).at(-1);
  assert.match(retryArgs, /--resume/, 'the retry started a NEW session instead of resuming');
  assert.match(retryArgs, new RegExp(`--resume ${supervisor.live.get(r.workId)?.sessionId ?? '.*'}`),
    'the retry resumed a different session');
  assert.match(retryArgs, /--allowedTools Edit\(a\.txt\)/, 'the retry ran unbounded');
  assert.ok(!/--session-id/.test(retryArgs), '--session-id and --resume must not both be sent');

  const snap = supervisor.snapshot(db, r.workId);
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.outcome, 'complete', 'a refusal the user allowed is resolved');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'allowed\n');

  /* D-116 must stay queryable without parsing a payload: a person approved, and the record
   * says so with `source = 'juqode'` on a `permission_granted` signal. */
  const grants = repo.signalsFor(db, r.workId).filter((s) => s.kind === 'permission_granted');
  assert.strictEqual(grants.length, 1);
  assert.strictEqual(grants[0].source, 'juqode');
  assert.match(grants[0].payload, /Edit\(a\.txt\)/, 'the record does not say what was allowed');
  assert.strictEqual(fs.readFileSync(path.join(`${dir}-cli`, 'PROMPT.log'), 'utf8'),
    'Continue the original request from this session. Retry the one action that was just allowed, then finish without repeating completed work.',
    'permission continuation must not replay the full original request');
});

test('two concurrent allows do not start two sessions on one session id', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const retryBin = fake.scriptBin(cliHome(dir), 'slow-retry', `init(); setTimeout(() => { result(); process.exit(0); }, 1000);`);
  useBin(r.workId, retryBin);

  const [x, y] = await Promise.all([
    supervisor.allow(db, r.workId, 'tu_1'),
    supervisor.allow(db, r.workId, 'tu_1'),
  ]);
  assert.strictEqual([x, y].filter((o) => o.ok).length, 1, 'both allows ran a retry');
  assert.ok([x, y].some((o) => o.reason === 'retry-in-flight' || o.reason === 'no-open-permission'));
});

test('an action that cannot be scoped narrowly gets no grant at all', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT,
    { type: 'system', subtype: 'permission_denied', tool_name: 'WebFetch', tool_use_id: 'tu_9', message: 'no' },
    { type: 'result', subtype: 'success', is_error: false,
      permission_denials: [{ tool_name: 'WebFetch', tool_use_id: 'tu_9', tool_input: { url: 'https://x' } }] }]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const out = await supervisor.allow(db, r.workId, 'tu_9');
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'cannot-scope',
    'with nothing to scope to, the answer is no grant — never a grant of the whole tool');
  assert.strictEqual(supervisor.snapshot(db, r.workId).status, 'permission_waiting', 'the Work was ended anyway');
});

/* ───────────────────────── WBS-16 · cancel ───────────────────────── */

test('cancelling an unresolved Work with no live root remains unknown until acknowledged', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  supervisor.cancel(db, r.workId);
  const snap = supervisor.snapshot(db, r.workId);
  /* The original root has exited. That does not prove detached descendants are gone, and the
   * incomplete Work has no observed Agent completion to preserve. */
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.outcome, 'ended_unknown');

  const kinds = repo.signalsFor(db, r.workId).map((s) => `${s.source}/${s.kind}`);
  assert.ok(kinds.includes('user/cancel_request'), 'the record must say the PERSON asked');
  assert.ok(!kinds.includes('juqode/cancel_confirmed'), 'root exit alone cannot confirm the full process tree stopped');
  const { unresolvedLegacyUnknownWorks } = require(path.join(R, 'app/main/work/runner-liveness.js'));
  assert.ok(unresolvedLegacyUnknownWorks(db, project.id).some((item) => item.id === r.workId),
    'an absent original PID bypassed the explicit unknown-process gate');

  assert.strictEqual(repo.activeWork(db, project.id), null, 'the D-117 slot is still held');
});

test('cancelling a Task Run with unproven descendants stays unknown and leaves its verdict unverified', async () => {
  const { dir, db, project, store } = bench({ git: false });
  const task = repo.createTask(db, project.id, { goal: 'Cancel without inventing rollback' });
  const bin = fake.scriptBin(cliHome(dir), 'slow-task-claude', `init(); setInterval(() => {}, 1000);`);
  const run = await supervisor.start(db, project, 'Cancel this attempt', {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: 'cancel-task-run-1',
  });
  assert.strictEqual(run.ok, true);
  const before = repo.getWork(db, run.workId);
  supervisor.cancel(db, run.workId);
  await run.done;
  const after = repo.getWork(db, run.workId);
  assert.strictEqual(after.id, before.id);
  assert.strictEqual(after.status, 'ended');
  assert.strictEqual(after.outcome, 'ended_unknown', 'an exited root cannot prove detached descendants stopped');
  assert.strictEqual(after.failure_reason, 'cancel-process-tree-not-confirmed-stopped');
  assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
  assert.strictEqual(repo.activeWork(db, project.id), null);
  assert.ok(repo.resultFor(db, run.workId), 'cancelled attempt should remain inspectable');
  assert.ok(!repo.signalsFor(db, run.workId).some((item) => item.kind === 'cancel_confirmed'));
});

test('a success signal racing after cancel cannot turn the Run into success', { skip: fake.WIN && 'needs a SIGTERM handler that reports success before exiting; Windows terminates abruptly, so the race cannot be staged — not a Windows PASS' }, async () => {
  const { dir, db, project, store } = bench({ git: false });
  const task = repo.createTask(db, project.id, { goal: 'Cancel wins over a later Agent success report' });
  const success = JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    permission_denials: [], result: 'completed successfully' });
  const bin = fake.scriptBin(cliHome(dir), 'late-success-claude', `init();
process.on('SIGTERM', () => {
  process.stdout.write(${JSON.stringify(`${success}\n`)});
  setTimeout(() => process.exit(0), 100);
});
setInterval(() => {}, 1000);
`);
  const run = await supervisor.start(db, project, 'Cancel before its late success signal', {
    evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: 'cancel-race-run',
  });
  assert.strictEqual(run.ok, true);
  supervisor.cancel(db, run.workId);
  await run.done;
  const work = repo.getWork(db, run.workId);
  assert.strictEqual(work.status, 'ended');
  assert.strictEqual(work.outcome, 'ended_unknown');
  assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
  assert.ok(repo.signalsFor(db, run.workId).some((item) => item.kind === 'cancel_request'));
  assert.ok(!repo.signalsFor(db, run.workId).some((item) => item.kind === 'cancel_confirmed'));
  assert.ok(repo.resultFor(db, run.workId));
});

test('a stopped root remains unknown without process-tree proof', async () => {
  const { dir, db, project, store } = bench();
  /* This fixture has no descendants, but the portable adapter cannot prove that fact after
   * root exit, so it must retain the unknown outcome. */
  const bin = fake.scriptBin(cliHome(dir), 'slow-claude', `init(); setInterval(() => {}, 1000);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true);

  const child = supervisor.live.get(r.workId).child;
  supervisor.cancel(db, r.workId);
  const snap = supervisor.snapshot(db, r.workId);
  assert.ok(['cancel_requested', 'ended'].includes(snap.status));
  await r.done;
  const after = supervisor.snapshot(db, r.workId);
  assert.strictEqual(after.status, 'ended');
  assert.strictEqual(after.outcome, 'ended_unknown');
  assert.notStrictEqual(child.exitCode === null && child.signalCode === null, true, 'the root process was not stopped');
  assert.ok(!repo.signalsFor(db, r.workId).some((item) => item.kind === 'cancel_confirmed'));
});

test('a legacy Work without a live process handle becomes unknown, never cancelled', async () => {
  const { db, project, store } = bench();
  const work = repo.beginWork(db, project.id, 'legacy Work recovered without a ChildProcess handle').work;
  repo.setRunnerIdentity(db, work.id, 'old-session', process.pid, new Date().toISOString());
  const result = supervisor.cancel(db, work.id);
  assert.strictEqual(result.ok, true);
  const current = repo.getWork(db, work.id);
  assert.strictEqual(current.status, 'ended');
  assert.strictEqual(current.outcome, 'ended_unknown');
  assert.strictEqual(current.failure_reason, 'cancel-requested-without-process-handle');
  assert.ok(!repo.signalsFor(db, work.id).some((item) => item.kind === 'cancel_confirmed'));
  const { unresolvedLegacyUnknownWorks } = require(path.join(R, 'app/main/work/runner-liveness.js'));
  assert.deepStrictEqual(unresolvedLegacyUnknownWorks(db, project.id).map((item) => item.id), [work.id]);
  const task = repo.createTask(db, project.id, { goal: 'Do not overlap an unknown legacy process' });
  const preflight = await supervisor.preflight(db, project, {
    evidenceStore: store, detect: AVAILABLE, taskId: task.id,
  });
  assert.strictEqual(preflight.reason, 'prior-process-may-still-live');
});

test('a recovered Work with a dead recorded PID stays unknown when cancelled', () => {
  const { db, project } = bench();
  const work = repo.beginWork(db, project.id, 'Recovered work with no outcome observer').work;
  repo.setRunnerIdentity(db, work.id, 'old-session', 2_000_000_000, new Date().toISOString());
  const result = supervisor.cancel(db, work.id);
  assert.strictEqual(result.ok, true);
  const current = repo.getWork(db, work.id);
  assert.strictEqual(current.status, 'ended');
  assert.strictEqual(current.outcome, 'ended_unknown',
    'a missing process proves only that it is gone now, not that cancellation ended it');
  assert.strictEqual(current.failure_reason, 'cancel-requested-without-process-handle');
  assert.ok(!repo.signalsFor(db, work.id).some((item) => item.kind === 'cancel_confirmed'));
  assert.strictEqual(repo.activeWork(db, project.id), null);
  db.close();
});

test('two submits cannot start two sessions in one project', async () => {
  /* `preflight`'s guard read is advisory — the engine's real one is `beginWork`'s insert, which
   * happens only once a session SPEAKS. Both starts used to pass preflight and both spawned;
   * the loser got the guard card while its process kept running, untracked and unstoppable,
   * and its writes were folded into the winner's after-basis. */
  const { dir, db, project, store } = bench();

  /* The CLI is SILENT for a moment before its first event. That is the window the DB index
   * cannot cover: `beginWork` only fires once a session speaks, so without an in-flight guard
   * both preflights pass and both spawn. A fake that answers instantly hides the whole race. */
  const bin = fake.scriptBin(cliHome(dir), 'slow-claude', `setTimeout(() => { init(); result(); process.exit(0); }, 1000);`);

  const [a, b] = await Promise.all([
    supervisor.start(db, project, '첫', { evidenceStore: store, bin, detect: AVAILABLE }),
    supervisor.start(db, project, '둘', { evidenceStore: store, bin, detect: AVAILABLE }),
  ]);
  const started = [a, b].filter((r) => r.ok);
  assert.strictEqual(started.length, 1, 'both submits started a session');
  assert.strictEqual([a, b].find((r) => !r.ok).reason, 'active-work');
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, 1);
  await started[0].done;
});

test('two Task submissions for one Project reserve only one live Run', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, { goal: 'Do not duplicate a live Task Run' });
  const bin = cli(dir, [INIT, OK]);
  const slowDetect = async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return AVAILABLE();
  };
  const [a, b] = await Promise.all([
    supervisor.start(db, project, 'first request', { evidenceStore: store, bin, detect: slowDetect,
      taskId: task.id, idempotencyKey: 'task-duplicate-a' }),
    supervisor.start(db, project, 'duplicate request', { evidenceStore: store, bin, detect: slowDetect,
      taskId: task.id, idempotencyKey: 'task-duplicate-b' }),
  ]);
  const started = [a, b].filter((result) => result.ok);
  assert.strictEqual(started.length, 1);
  assert.strictEqual([a, b].find((result) => !result.ok).reason, 'active-work');
  assert.strictEqual(db.prepare('select count(*) n from work where task_id = ?').get(task.id).n, 1);
  await started[0].done;
  assert.strictEqual(argvLog(dir).length, 1, 'the rejected duplicate still spawned a second Claude process');
});

test('a signal that cannot be written does not take the app down', async () => {
  /* The session's own per-run counter collided with `unique (work_id, seq)` as soon as a retry
   * advanced the sequence, and it threw inside a stdout handler — in the main process that is
   * an uncaught exception and a dead window. A stream is where an error must not be fatal. */
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  const seqs = repo.signalsFor(db, r.workId).map((s) => s.seq);
  assert.deepStrictEqual(seqs, [...new Set(seqs)].sort((x, y) => x - y), 'the sequence has a duplicate');

  /* And a write that genuinely fails is recorded rather than thrown. */
  const retryBin = cli(dir, [INIT, OK]);
  useBin(r.workId, retryBin);
  await supervisor.allow(db, r.workId, 'tu_1');
  const after = repo.signalsFor(db, r.workId).map((s) => s.seq);
  assert.deepStrictEqual(after, [...new Set(after)].sort((x, y) => x - y),
    'the retry reused a sequence the first turn had already written');
});

/* ───────────────────────── D-124 · a Work whose process is gone ───────────────────────── */

test('reconciliation ASKS whether the process is alive before closing a Work', () => {
  /* A JuQode child is spawned detached and can outlive its parent — measured. Closing a Work
   * whose session is still writing would free the D-117 slot and let a second session start in
   * the same repository, which is the thing the guard exists to prevent. */
  const { db, project } = bench({ git: false });
  const w = repo.beginWork(db, project.id, 'x').work;
  repo.addSignal(db, w.id, { seq: 0, source: 'juqode', kind: 'raw',
    payload: JSON.stringify({ juqodeProcess: { pid: 4242, startedAt: new Date().toISOString() } }) });

  assert.deepStrictEqual(repo.processFor(db, w.id), {
    pid: 4242, startedAt: repo.processFor(db, w.id).startedAt, sessionId: null,
  });

  /* alive → left alone */
  assert.deepStrictEqual(repo.reconcileLostWorks(db, () => true), []);
  assert.strictEqual(repo.getWork(db, w.id).status, 'running');

  /* gone → closed as 확인 불가 */
  assert.deepStrictEqual(repo.reconcileLostWorks(db, () => false), [w.id]);
  assert.strictEqual(repo.getWork(db, w.id).outcome, 'ended_unknown');
});

test('the pid marker is written so reconciliation has something to ask about', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const proc = repo.processFor(db, r.workId);
  assert.ok(proc?.pid > 0, 'no process marker was recorded — reconciliation can only guess');
  assert.ok(proc.startedAt, '`07` §8.5: a pid is reusable, so the start time goes with it');
});

test('a Work left running by a lost process is closed as 확인 불가, not as success', () => {
  const { db, project } = bench({ git: false });
  const w = repo.beginWork(db, project.id, 'x').work;
  repo.upsertStep(db, w.id, { ord: 1, title: '읽기', state: 'running' });

  const closed = repo.reconcileLostWorks(db);
  assert.deepStrictEqual(closed, [w.id]);
  const after = repo.getWork(db, w.id);
  assert.strictEqual(after.status, 'ended');
  assert.strictEqual(after.outcome, 'ended_unknown', 'a lost process must never be reported as complete');
  assert.deepStrictEqual(repo.stepsFor(db, w.id).map((s) => s.state), ['not_executed'],
    'a step that was running when the process vanished did not necessarily finish');

  /* And the D-117 slot is free again — without this a lost process pins it forever. */
  assert.strictEqual(repo.activeWork(db, project.id), null);
  assert.strictEqual(repo.beginWork(db, project.id, 'next').ok, true);
});

test('a Work with nothing live still reports the truth from the store', async () => {
  /* Every other assertion runs in the process that started the Work, where the reducer and the
   * row agree. After a restart they do not exist together at all — reading status from the
   * reducer would show a reconciled Work as still running. */
  const { db, project } = bench({ git: false });
  const w = repo.beginWork(db, project.id, 'x').work;
  repo.reconcileLostWorks(db);
  supervisor.live.delete(w.id);

  const snap = supervisor.snapshot(db, w.id);
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.outcome, 'ended_unknown');
  assert.strictEqual(snap.liveness, 'live', 'an ended Work is not "quiet" — nothing is expected of it');
  assert.strictEqual(snap.cancelUnconfirmed, false);
  assert.deepStrictEqual(snap.evidence, { before: false, after: false },
    'a Work with no basis reported that it had one');
});

test('a missing after-basis reads as 확인 불가, never as "nothing changed"', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK], { edits: [{ path: path.join(dir, 'a.txt'), body: 'two\n' }] });
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  assert.strictEqual(supervisor.snapshot(db, r.workId).evidence.after, true);

  db.prepare('delete from evidence_basis where work_id = ? and phase = ?').run(r.workId, 'after');
  assert.strictEqual(supervisor.snapshot(db, r.workId).evidence.after, false,
    'the snapshot claimed a basis that is not there');
  assert.strictEqual(supervisor.changes(db, r.workId, project, store).known, false,
    'a missing basis was reported as a measured "no changes"');
});

test('a basis that cannot be taken is recorded as a gap, not as silence', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  db.prepare('delete from evidence_basis where work_id = ? and phase = ?').run(r.workId, 'after');
  /* the project is gone by the time the after-basis is asked for */
  supervisor.captureAfter(db, r.workId, { path: path.join(dir, 'no-such-dir') }, true, store);
  assert.ok(repo.signalsFor(db, r.workId).some((x) => x.kind === 'evidence_gap'),
    'a failed capture left no record — 남은 변경 확인 불가 would have nothing to say');
});

test('the record is kept in the order it arrived', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const signals = repo.signalsFor(db, r.workId);
  assert.deepStrictEqual(signals.map((x) => x.seq), signals.map((_x, i) => i),
    '기술 출력 보기 would show the stream out of order');
  assert.strictEqual(signals[0].kind, 'session_start',
    'the buffered first event was dropped — it arrives before the Work row exists');
});

test('each Work gets its OWN session, so a retry cannot resume another one', async () => {
  const { dir, db, project, store } = bench();
  const other = bench();
  const bin = cli(dir, [INIT, OK]);
  const binB = cli(other.dir, [INIT, OK], { name: 'other-claude' });
  const a = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  const b = await supervisor.start(other.db, other.project, 'y', { evidenceStore: other.store, bin: binB, detect: AVAILABLE });

  const idA = argvLog(dir).at(-1).match(/--session-id (\S+)/)?.[1];
  const idB = argvLog(other.dir).at(-1).match(/--session-id (\S+)/)?.[1];
  assert.ok(idA && idB, 'no session id was requested at all');
  assert.notStrictEqual(idA, idB,
    'two Works share one session id — a retry would resume into another Work\'s conversation');
  await a.done; await b.done;
});

test('stopping a Work signals its root but records unknown without full tree proof', async () => {
  const { dir, db, project, store } = bench();
  const home = `${dir}-cli`;
  fs.mkdirSync(home, { recursive: true });
  const bin = fake.scriptBin(home, 'grouped-claude', `init(); setInterval(() => {}, 1000);`);

  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true);
  const runChild = supervisor.live.get(r.workId).child;
  const originalStop = session.stop;
  session.stop = (child, options = {}) => originalStop(child,
    { ...options, graceMs: 300, confirmMs: 1000, pollMs: 25 });

  try {
    supervisor.cancel(db, r.workId);
    await r.done;
    const ended = repo.getWork(db, r.workId);
    assert.strictEqual(ended.status, 'ended');
    assert.strictEqual(ended.outcome, 'ended_unknown');
    assert.ok(!repo.signalsFor(db, r.workId).some((item) => item.kind === 'cancel_confirmed'));
  } finally {
    session.stop = originalStop;
    if (runChild.exitCode === null && runChild.signalCode === null) runChild.kill('SIGKILL');
  }
});

test('cancel becomes unknown when the root exits before its surviving child process', async () => {
  const { dir, db, project, store } = bench();
  const task = repo.createTask(db, project.id, { goal: 'Keep cancellation truthful' });
  const home = `${dir}-cli`;
  fs.mkdirSync(home, { recursive: true });
  const marker = path.join(home, 'IGNORE-TERM-PID');
  const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', cwd: dir });
  const source = `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const helper = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(marker)}, String(helper.pid));
process.stdout.write(${JSON.stringify(`${init}\n`)});
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`;
  const bin = fake.scriptBin(home, 'root-exits-first', source);
  const originalStop = session.stop;
  let helper = null;
  let child = null;
  session.stop = (child, options = {}) => originalStop(child, { ...options, graceMs: 700, confirmMs: 150, pollMs: 25 });
  try {
    const run = await supervisor.start(db, project, 'Cancel with a child that ignores TERM', {
      evidenceStore: store, bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: 'root-exits-first',
    });
    assert.strictEqual(run.ok, true);
    child = supervisor.live.get(run.workId).child;
    const markerDeadline = Date.now() + 1500;
    while (!fs.existsSync(marker) && Date.now() < markerDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    helper = Number(fs.readFileSync(marker, 'utf8'));
    assert.ok(helper > 0);
    /* The pid file is written just after spawn; give the helper time to install its SIGTERM
     * ignore handler before the test sends the direct-child signal. */
    await new Promise((resolve) => setTimeout(resolve, 150));
    supervisor.cancel(db, run.workId);
    await new Promise((resolve) => child.once('exit', resolve));
    await run.done;
    assert.strictEqual(repo.getWork(db, run.workId).outcome, 'ended_unknown',
      'the root wrapper exit was mistaken for process-tree exit');
    assert.strictEqual(repo.activeWork(db, project.id), null,
      'the ended unknown Run still holds the ordinary active-work slot');
    let helperAlive = true;
    try { process.kill(helper, 0); } catch { helperAlive = false; }
    assert.strictEqual(helperAlive, true, 'the fixture child did not survive the graceful signal');

    const ended = repo.getWork(db, run.workId);
    assert.strictEqual(ended.status, 'ended');
    assert.strictEqual(ended.outcome, 'ended_unknown');
    assert.strictEqual(ended.failure_reason, 'cancel-process-tree-not-confirmed-stopped');
    assert.ok(!repo.signalsFor(db, run.workId).some((item) => item.kind === 'cancel_confirmed'));
    assert.strictEqual(repo.getTask(db, task.id).verdict, 'unverified');
    const preflight = await supervisor.preflight(db, project, { evidenceStore: store, detect: AVAILABLE, taskId: task.id });
    assert.strictEqual(preflight.reason, 'prior-process-may-still-live',
      'a surviving child did not block another Task Run');
    let stillAlive = true;
    try { process.kill(helper, 0); } catch { stillAlive = false; }
    assert.strictEqual(stillAlive, true, 'fixture descendant exited before the unknown state was proven');
    try { process.kill(helper, 'SIGKILL'); } catch { /* already gone */ }
  } finally {
    session.stop = originalStop;
    if (helper) { try { process.kill(helper, 'SIGKILL'); } catch { /* already gone */ } }
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('a retry that lands in a SECOND refusal still refreshes the evidence', async () => {
  /* The first turn's after-basis describes a project that had not been edited yet. Leaving it
   * in place made `changes()` answer 바뀐 파일이 없어요 about a change the user approved. */
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const firstAfter = repo.basisFor(db, r.workId, 'after').ref;

  /* the retry edits the file and is refused again */
  const retryBin = cli(dir, [INIT, DENIED, RESULT_DENIED], {
    name: 'retry-claude', edits: [{ path: path.join(dir, 'a.txt'), body: 'EDITED BY THE RETRY\n' }],
  });
  useBin(r.workId, retryBin);
  await supervisor.allow(db, r.workId, 'tu_1');

  assert.notStrictEqual(repo.basisFor(db, r.workId, 'after').ref, firstAfter,
    'the after-basis was not retaken, so the retry\'s change is invisible');
  const changed = supervisor.changes(db, r.workId, project, store);
  assert.deepStrictEqual(changed.files, ['a.txt'],
    'a change the user personally approved was reported as no change at all');
});

test('a basis records what it did NOT cover', async () => {
  /* The excluded-path ledger is what lets the product say "these paths are outside the
   * evidence, and these of them changed" (D-126a). A basis that drops it can only be silent. */
  const { dir, db, project, store } = bench();
  fs.writeFileSync(path.join(dir, '.env'), 'JUQODE_SYNTHETIC_SECRET=x\n');
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const basis = repo.basisFor(db, r.workId, 'before');
  assert.ok(basis.excluded, 'the basis recorded nothing about what it excluded');
  const excluded = JSON.parse(basis.excluded);
  assert.ok(excluded.some((e) => e.path === '.env'), `excluded: ${basis.excluded}`);
  assert.ok(!basis.excluded.includes('JUQODE_SYNTHETIC_SECRET'),
    'the ledger carries file CONTENTS — it must carry metadata only');
});

test('the oldest unanswered refusal is the one on the card', () => {
  const { reduce, initial, openPermission, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
  let s = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Edit', toolUseId: 'tu_1' } });
  s = reduce(s, { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'tu_2' } });
  assert.strictEqual(openPermission(s).toolUseId, 'tu_1',
    'the newest refusal took the card, so the user could not answer the question shown first');
});

test('a non-Git project is comparable too — the ✓ 확인됨 on the header has to mean something', async () => {
  /* The Work header states `시작 전 상태를 기록해 두었어요 ✓ 확인됨`. If a manifest basis could
   * never produce a before/after answer, that chip would be claiming evidence the product
   * structurally cannot use — a confirmation of nothing. */
  const { dir, db, project, store } = bench({ git: false });
  const bin = cli(dir, [INIT, OK], { edits: [
    { path: path.join(dir, 'a.txt'), body: 'changed\n' },
    { path: path.join(dir, 'new.txt'), body: 'added\n' },
  ] });
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true, `a project without git must still be workable: ${r.reason}`);
  await r.done;

  const snap = supervisor.snapshot(db, r.workId);
  assert.ok(snap.evidence.before && snap.evidence.after);
  assert.strictEqual(repo.basisFor(db, r.workId, 'before').kind, 'hash_manifest');

  const changed = supervisor.changes(db, r.workId, project, store);
  assert.strictEqual(changed.known, true, 'a manifest basis produced no comparison at all');
  assert.deepStrictEqual(changed.files.sort(), ['a.txt', 'new.txt']);
});

test('WBS-13 · answering continues the SAME Work, in the same session', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  /* No headless CLI event maps to `input_request` today (`19` §C3-L lists the ones that do),
   * so the state is driven from the signal directly — which is what the reducer reads anyway. */
  const { reduce, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
  const entry = supervisor.live.get(r.workId);
  entry.state = reduce(entry.state, { kind: KIND.INPUT_REQUEST, payload: { text: '어느 파일인가요?' } }, new Date().toISOString());
  repo.setWorkState(db, r.workId, { status: 'input_waiting' });
  assert.strictEqual(supervisor.snapshot(db, r.workId).inputRequest.text, '어느 파일인가요?');

  const worksBefore = db.prepare('select count(*) n from work').get().n;
  const answered = await supervisor.answer(db, r.workId, 'a.txt 요');
  assert.strictEqual(answered.ok, true);
  assert.strictEqual(db.prepare('select count(*) n from work').get().n, worksBefore,
    'answering started a NEW Work — `15` says it continues the same one');
  const sig = repo.signalsFor(db, r.workId).filter((s) => s.kind === 'answer');
  assert.strictEqual(sig.length, 1);
  assert.strictEqual(sig[0].source, 'user');
  assert.strictEqual(sig[0].payload, 'a.txt 요');
  /* the same session, resumed — a new one keeps the row count identical and would pass above */
  assert.match(argvLog(dir).at(-1), /--resume/, 'answering started a NEW session');
});

test('an empty answer is refused, and an ended Work cannot be answered', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  assert.strictEqual((await supervisor.answer(db, r.workId, '   ')).reason, 'empty-answer');
  assert.strictEqual((await supervisor.answer(db, r.workId, '답')).reason, 'ended');
});

test('an ended Work cannot be edited by a stale allow button', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  /* the user pressed 그만두기: the process is already gone, so the cancel closes the Work */
  supervisor.cancel(db, r.workId);
  assert.strictEqual(repo.getWork(db, r.workId).status, 'ended');

  const out = await supervisor.allow(db, r.workId, 'tu_1');
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'ended',
    'a stale allow button edited files on a Work the screen had already declared finished');
});

test('liveness is measured from the last OBSERVED signal, and only that', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  assert.strictEqual(supervisor.snapshot(db, r.workId).liveness, 'live');

  /* Pushed past the threshold `15` names. Nothing here is a judgement about the Work — it is
   * a fact about how long since anything was seen. */
  /* A literal offset, not one built from the constant under test — that made the threshold
   * itself unassertable: `QUIET_MS = 1e15` kept this green. */
  assert.strictEqual(supervisor.QUIET_MS, 2 * 60 * 1000, '`15` names 2분 for 새 신호 없음');
  /* …and the env override that lets the e2e reach the state cannot become the DEFAULT. A
   * shorter threshold shipped by accident would call a working Work quiet. */
  assert.ok(!process.env.JUQODE_QUIET_MS, 'this suite is running with the threshold overridden');
  assert.match(read('app/main/work/supervisor.js'),
    /const QUIET_MS = Number\(process\.env\.JUQODE_QUIET_MS\) \|\| 2 \* 60 \* 1000;/,
    'the default is no longer `15`\'s 2분');
  const entry = supervisor.live.get(r.workId);
  entry.state = { ...entry.state, lastObserved: { kind: 'tool_use', at: new Date(Date.now() - 121_000).toISOString() } };
  assert.strictEqual(supervisor.snapshot(db, r.workId).liveness, 'quiet');

  entry.state = { ...entry.state, lastObserved: null };
  assert.strictEqual(supervisor.snapshot(db, r.workId).liveness, 'unknown');
});

test('watchQuiet pushes the states that ONLY silence can produce — and nothing else', async () => {
  /* FOUND BY MUTATION: every part of the tick's push condition could be flipped and the suite
   * passed — nothing ever called `watchQuiet`.
   *
   * It is the one place a timer is legitimate (`15` defines 새 신호 없음 and 취소 확인 불가 by
   * the ABSENCE of a signal, and the only event that would deliver that news is the event that
   * makes it untrue). So it is also the one place where a wrong condition is invisible: the
   * screen simply never shows those states, and nothing errors. */
  const { dir, db, project, store } = bench();
  /* ignores SIGTERM where the OS lets a process do that (POSIX); on Windows kill is unconditional */
  const bin = fake.scriptBin(cliHome(dir), 'stubborn-claude', `process.on('SIGTERM', () => {}); init(); setInterval(() => {}, 1000);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  const entry = supervisor.live.get(r.workId);

  const pushes = [];
  const stop = supervisor.watchQuiet(db, (snap) => pushes.push(snap), { everyMs: 15 });
  const tick = () => new Promise((res) => setTimeout(res, 60));
  try {
    /* LIVE: nothing to say. A push here would redraw SC-03 on a timer with no news in it. */
    await tick();
    assert.deepStrictEqual(pushes, [], 'a live Work was pushed on a timer with nothing to report');

    /* QUIET: the news is the silence itself. */
    entry.state = { ...entry.state, lastObserved: { kind: 'tool_use', at: new Date(Date.now() - 121_000).toISOString() } };
    await tick();
    assert.ok(pushes.length, '새 신호 없음 is never delivered — the screen cannot show it');
    assert.strictEqual(pushes.at(-1).liveness, 'quiet');

    /* UNKNOWN: also silence, and also delivered. */
    pushes.length = 0;
    entry.state = { ...entry.state, lastObserved: null };
    await tick();
    assert.ok(pushes.length, '확인 불가 is never delivered');
    assert.strictEqual(pushes.at(-1).liveness, 'unknown');

    /* CANCEL UNCONFIRMED while still live: the OTHER half of the condition, on its own. */
    pushes.length = 0;
    supervisor.cancel(db, r.workId);
    entry.state = { ...entry.state,
                    lastObserved: { kind: 'tool_use', at: new Date().toISOString() },
                    cancelRequestedAt: new Date(Date.now() - 91_000).toISOString() };
    await tick();
    assert.ok(pushes.length, '멈췄는지 확인할 수 없어요 is never delivered while the Work is still live');
    assert.strictEqual(pushes.at(-1).cancelUnconfirmed, true);
    assert.strictEqual(pushes.at(-1).liveness, 'live',
      'this case must be the cancel half of the condition, not the silence half');
  } finally {
    stop();
    supervisor.cancel(db, r.workId);
    await r.done.catch(() => {});
  }
});

test('a cancel that stays unobserved becomes 확인 불가, and never 취소됨', async () => {
  const { dir, db, project, store } = bench();
  /* ignores SIGTERM where the OS lets a process do that (POSIX); on Windows kill is unconditional */
  const bin = fake.scriptBin(cliHome(dir), 'stubborn-claude', `process.on('SIGTERM', () => {}); init(); setInterval(() => {}, 1000);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  supervisor.cancel(db, r.workId);
  assert.strictEqual(supervisor.snapshot(db, r.workId).cancelUnconfirmed, false, 'it has only just been asked');

  assert.strictEqual(supervisor.CANCEL_CONFIRM_MS, 90 * 1000, '`15` names 90초 for 취소 확인 불가');
  assert.ok(!process.env.JUQODE_CANCEL_CONFIRM_MS, 'this suite is running with the threshold overridden');
  assert.match(read('app/main/work/supervisor.js'),
    /const CANCEL_CONFIRM_MS = Number\(process\.env\.JUQODE_CANCEL_CONFIRM_MS\) \|\| 90 \* 1000;/,
    'the default is no longer `15`\'s 90초');
  const entry = supervisor.live.get(r.workId);
  entry.state = { ...entry.state, cancelRequestedAt: new Date(Date.now() - 91_000).toISOString() };
  const snap = supervisor.snapshot(db, r.workId);
  assert.strictEqual(snap.cancelUnconfirmed, true,
    'an unobserved stop must be reported as unconfirmed, never as a cancellation');
  assert.strictEqual(snap.status, 'cancel_requested');
  await r.done;
});

test('cancelling an ended Work is refused — it cannot be resurrected', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, OK]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const before = repo.getWork(db, r.workId);
  assert.strictEqual(before.status, 'ended');

  const out = supervisor.cancel(db, r.workId);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'ended');
  const after = repo.getWork(db, r.workId);
  assert.strictEqual(after.outcome, before.outcome, 'a finished Work lost its outcome');
  assert.strictEqual(after.ended_at, before.ended_at);
  assert.strictEqual(repo.activeWork(db, project.id), null, 'the project was soft-locked by a stale cancel');
});

test('a bogus toolUseId is refused, never silently applied to another refusal', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const out = await supervisor.allow(db, r.workId, 'tu_DOES_NOT_EXIST');
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'no-such-permission',
    'an id that names nothing produced a real grant for a refusal the caller never asked about');
  assert.strictEqual(repo.signalsFor(db, r.workId).filter((s) => s.kind === 'permission_granted').length, 0);
});

/* ── the permission card names the same thing the flag will ──────────────────────────────── */

test('a denial carries the GRANT STRING, not only the model\'s raw input', () => {
  /* `allowSpec` resolves the model's path against the PROJECT — a relative
   * `../../../etc/shadow` resolved into an unrelated tree before it did. So the raw
   * `input.file_path` and the grant can name one file while READING as two different places,
   * and the card was showing the one the flag does not use.
   *
   * D-133's whole contract is that the person approves what they were shown. */
  const session = require(path.join(R, 'app/main/claude/session.js'));
  const cwd = '/p/app';
  const denial = { tool: 'Edit', toolUseId: 't1', input: { file_path: '../../etc/hosts' } };
  const spec = session.allowSpec(denial, cwd);
  if (fake.WIN) {
    /* How Claude Code spells a path outside the project on Windows is UNKNOWN, so there is no grant. */
    assert.strictEqual(spec, null);
  } else {
    assert.strictEqual(spec, 'Edit(//etc/hosts)');
    /* The raw input and the grant do NOT read the same — which is exactly why the card must
     * carry the grant. */
    assert.notStrictEqual(denial.input.file_path, spec);
  }

  /* The snapshot puts it there. */
  const sup = srcOf('app/main/work/supervisor.js');
  assert.ok(/const spec = session\.allowSpec\(d, cwd \?\? '\/'\);/.test(sup),
    'withScope no longer builds the spec');
  assert.ok(/return \{ \.\.\.d, scopable: Boolean\(spec\), spec \};/.test(sup),
    'the grant string does not travel with the denial');

  /* …and the card prefers it. */
  const sc03 = srcOf('app/renderer/screens/sc03.js');
  assert.ok(/const target = specTarget\(d\.spec\)/.test(sc03),
    'the permission card still shows the raw input first');
});

test('specTarget reads a grant string, or refuses to read one at all', () => {
  const sc03 = srcOf('app/renderer/screens/sc03.js');
  /* Evaluated rather than pattern-matched: this one has branches, and a helper that returned
   * `null` for everything would satisfy any regex about its shape while blanking the card. */
  const body = /function specTarget\(spec\) \{[\s\S]*?\n\}/.exec(sc03);
  assert.ok(body, 'specTarget is gone');
  // eslint-disable-next-line no-new-func
  const specTarget = new Function(`${body[0]}; return specTarget;`)();

  assert.strictEqual(specTarget('Edit(src/a.ts)'), 'src/a.ts');
  assert.strictEqual(specTarget('Edit(//etc/hosts)'), '//etc/hosts');
  assert.strictEqual(specTarget('Bash(npm test:*)'), 'npm test');
  /* Anything that is not that shape is not shown — the caller falls back to the raw input
   * rather than displaying something half-read. */
  for (const bad of [null, undefined, '', 'Edit', 'Edit(', 'Edit)', 42]) {
    assert.strictEqual(specTarget(bad), null, `specTarget accepted ${JSON.stringify(bad)}`);
  }
});

/* ───────────── resume must run in the project folder (H3 2.1.283: --resume follows the caller's cwd) ───────────── */

/* test seam: point a live Work at another fake CLI AND re-bind it, as a legitimate binary change
 * would not be silently accepted by the pre-resume binding. */
function useBin(workId, bin) {
  const e = supervisor.live.get(workId);
  e.bin = bin;
  e.binding = session.bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId: e.sessionId, bin });
  /* the harness RE-PINS the entry to a different fixture CLI; the launch identity recorded for the original binary no longer describes it
   * (production never changes `entry.bin`: a changed binary is refused, see the 'recorded binary' tests in claude-launch.test.js) */
  e.launchIdentity = null;
}

const sha = (f) => require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function deniedWork(extraDenied = false) {
  const b = bench();
  const second = { type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_2', message: 'denied' };
  const events = extraDenied ? [INIT, DENIED, second, RESULT_DENIED] : [INIT, DENIED, RESULT_DENIED];
  const bin = cli(b.dir, events);
  const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, bin, detect: AVAILABLE });
  await r.done;
  return { ...b, r, bin };
}

test('init-cwd mismatch is DETECTION: an early write is measured, never reported as prevented', async () => {
  const { dir, db, r, project, store } = await deniedWork();
  const file = path.join(dir, 'a.txt');
  const before = sha(file);
  const other = tempDir('juqode-other-');
  /* the fake CLI writes BEFORE it prints init — exactly the window a post-init check cannot close */
  useBin(r.workId, cli(dir, [INIT, OK], { initCwd: other, edits: [{ path: file, body: 'early-write\n' }] }));

  const res = await supervisor.allow(db, r.workId, 'tu_1');
  assert.deepStrictEqual([res.ok, res.reason], [false, 'cwd-mismatch'], 'runRetry reported success for a mismatch');
  assert.notStrictEqual(sha(file), before, 'fixture precondition: the early write really happened');

  const snap = supervisor.snapshot(db, r.workId);
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.outcome, 'ended_unknown', 'side effects and descendants are unverified, so not `failed`');
  assert.strictEqual(repo.getWork(db, r.workId).failure_reason, 'cwd-mismatch');
  const sig = repo.signalsFor(db, r.workId).find((x) => /juqodeCwdMismatch/.test(String(x.payload)));
  assert.match(String(sig.payload), /"sideEffectsPrevented":false/);
  assert.deepStrictEqual(supervisor.changes(db, r.workId, project, store).files, ['a.txt'],
    'the write the check could not stop must show in the measured changes');
});

test('mismatch with SEVERAL unresolved denials still ends the Work (allow and answer)', async () => {
  for (const via of ['allow', 'answer']) {
    const { dir, db, r } = await deniedWork(true);
    const e = supervisor.live.get(r.workId);
    useBin(r.workId, cli(dir, [INIT, OK], { initCwd: tempDir('juqode-other-') }));
    const res = via === 'allow' ? await supervisor.allow(db, r.workId, 'tu_1') : await supervisor.answer(db, r.workId, 'x');
    assert.deepStrictEqual([res.ok, res.reason], [false, 'cwd-mismatch'], via);
    const snap = supervisor.snapshot(db, r.workId);
    assert.strictEqual(snap.status, 'ended', `${via}: a second pending denial kept the Work open`);
    assert.strictEqual(snap.outcome, 'ended_unknown', via);
    assert.ok(!supervisor.live.has(r.workId), `${via}: stale live entry left behind`);
  }
});

test('resume is refused BEFORE any process exists when the binding cannot be verified', async () => {
  for (const [name, tamper] of [
    ['project folder gone', (e, d) => { fs.rmSync(d, { recursive: true, force: true }); }],
    ['cwd swapped', (e) => { e.cwd = tempDir('juqode-swap-'); }],
    ['binary swapped', (e, d) => { e.bin = cli(d, [INIT, OK], { name: 'other-claude' }); }],
    ['binding missing', (e) => { e.binding = null; }],
  ]) {
    const { dir, db, r } = await deniedWork();
    const file = path.join(dir, 'a.txt');
    const e = supervisor.live.get(r.workId);
    const tripwire = cli(dir, [INIT, OK], { name: 'tripwire', edits: [{ path: file, body: 'ran\n' }] });
    useBin(r.workId, tripwire);
    tamper(e, dir);
    const calls = argvLog(dir).length;
    const before = fs.existsSync(file) ? sha(file) : null;
    for (const res of [await supervisor.allow(db, r.workId, 'tu_1'), await supervisor.answer(db, r.workId, 'x')]) {
      assert.strictEqual(res.ok, false, name);
      assert.strictEqual(res.reason, 'resume-binding-unverified', name);
    }
    assert.strictEqual(argvLog(dir).length, calls, `${name}: a CLI process was started anyway`);
    assert.strictEqual(fs.existsSync(file) ? sha(file) : null, before, `${name}: a file changed`);
  }
});

test('canonical comparison fails closed', () => {
  const dir = tempDir('juqode-same-');
  const link = `${dir}-link`;
  fs.symlinkSync(dir, link);
  juqodeTempDirs.push(link);
  assert.strictEqual(session.sameDir(link, dir), true, 'a symlinked name of the project is the project');
  assert.strictEqual(session.sameDir('/p', dir), false);
  assert.strictEqual(session.sameDir(undefined, dir), false);
  const gone = path.join(dir, 'missing');
  assert.strictEqual(session.sameDir(gone, gone), false, 'an unresolvable path must not validate itself');
  const loop = path.join(dir, 'loop');
  fs.symlinkSync(loop, loop);
  assert.strictEqual(session.sameDir(loop, loop), false, 'a symlink loop must not validate');
  const file = path.join(dir, 'f'); fs.writeFileSync(file, '');
  assert.strictEqual(session.canonicalDir(file), null, 'a file is not a project folder');
  assert.strictEqual(session.bindSession({ cwd: gone, sessionId: 's' }), null);
});

/* ───────────── session id: the CLI must CONFIRM the id JuQode asked for ───────────── */

test('a session id the CLI did not confirm gets no binding, and resume is refused before any spawn', async () => {
  const cases = [
    ['wrong id in init', (dir) => cli(dir, [INIT, DENIED, RESULT_DENIED], { initSessionId: 'not-the-requested-id' })],
    ['init without a session_id', (dir) => cli(dir, [INIT, DENIED, RESULT_DENIED], { initSessionId: null })],
    ['no init event at all', (dir) => cli(dir, [DENIED, RESULT_DENIED])],
  ];
  for (const [name, make] of cases) {
    const b = bench();
    const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, bin: make(b.dir), detect: AVAILABLE });
    await r.done;
    assert.strictEqual(supervisor.live.get(r.workId).binding, null, `${name}: a binding was made for an unconfirmed session`);
    const file = path.join(b.dir, 'a.txt');
    const before = sha(file), calls = argvLog(b.dir).length;
    for (const res of [await supervisor.allow(b.db, r.workId, 'tu_1'), await supervisor.answer(b.db, r.workId, 'x')]) {
      assert.deepStrictEqual([res.ok, res.reason], [false, 'resume-binding-unverified'], name);
    }
    assert.strictEqual(argvLog(b.dir).length, calls, `${name}: a CLI was started anyway`);
    assert.strictEqual(sha(file), before, name);
  }
});

test('a resumed init that reports another session id ends the Work as ended_unknown', async () => {
  const { dir, db, r } = await deniedWork();
  const file = path.join(dir, 'a.txt');
  const before = sha(file);
  useBin(r.workId, cli(dir, [INIT, OK], { initSessionId: 'tampered', edits: [{ path: file, body: 'early\n' }] }));
  const res = await supervisor.allow(db, r.workId, 'tu_1');
  assert.deepStrictEqual([res.ok, res.reason], [false, 'session-mismatch']);
  assert.notStrictEqual(sha(file), before, 'fixture precondition: the pre-init write happened and is reported, not hidden');
  const snap = supervisor.snapshot(db, r.workId);
  assert.deepStrictEqual([snap.status, snap.outcome], ['ended', 'ended_unknown']);
  assert.strictEqual(repo.getWork(db, r.workId).failure_reason, 'session-mismatch');
  assert.ok(repo.signalsFor(db, r.workId).some((x) => /juqodeSessionMismatch/.test(String(x.payload))));
});

/* ───────────── the binary: resolved once, spawned by absolute path, identity re-checked ───────────── */

test('the Claude binary is pinned at start; PATH shadowing, replacement and removal never reach a spawn', async () => {
  const savedPath = process.env.PATH, savedBin = process.env.JUQODE_CLAUDE_BIN;
  delete process.env.JUQODE_CLAUDE_BIN;
  try {
    const b = bench();
    const real = cli(b.dir, [INIT, DENIED, RESULT_DENIED], { name: 'claude' });      // `${dir}-cli/claude`
    process.env.PATH = `${path.dirname(real)}${path.delimiter}${savedPath}`;
    /* the ordinary product path: no `bin` given, so the name `claude` is resolved through PATH */
    const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, detect: AVAILABLE });
    await r.done;
    const e = supervisor.live.get(r.workId);
    /* the resolved ABSOLUTE launcher (Windows resolves the extension from PATHEXT, in its own case) */
    const want = fs.realpathSync(real);
    assert.strictEqual(fake.WIN ? e.bin.toLowerCase() : e.bin, fake.WIN ? want.toLowerCase() : want,
      'the entry kept a name instead of the resolved path');
    assert.ok(path.isAbsolute(e.bin));
    assert.ok(e.binding?.identity?.realPath, 'no binary identity was recorded');

    /* 1. PATH shadowing: a different `claude` first on PATH must not be run */
    const shadowDir = tempDir('juqode-shadow-');
    const marker = path.join(shadowDir, 'SHADOW-RAN');
    const shadow = cli(shadowDir, [INIT, OK], { name: 'claude', edits: [{ path: marker, body: 'x' }] });
    process.env.PATH = `${path.dirname(shadow)}${path.delimiter}${process.env.PATH}`;
    const calls = argvLog(b.dir).length;
    const ok = await supervisor.allow(b.db, r.workId, 'tu_1');
    assert.strictEqual(ok.ok, true, `the pinned binary was refused: ${ok.reason}`);
    assert.strictEqual(argvLog(b.dir).length, calls + 1, 'the pinned binary did not run');
    assert.ok(!fs.existsSync(marker), 'a shadowing `claude` ran');
  } finally {
    process.env.PATH = savedPath;
    if (savedBin !== undefined) process.env.JUQODE_CLAUDE_BIN = savedBin;
  }
});

test('a replaced, removed or non-executable pinned binary refuses resume without spawning', async () => {
  for (const [name, tamper] of [
    ['replaced (new inode)', (bin) => { fs.writeFileSync(`${bin}.new`, fs.readFileSync(bin), { mode: 0o755 }); fs.renameSync(`${bin}.new`, bin); }],
    ['content rewritten in place', (bin) => { fs.appendFileSync(bin, '\n# changed\n'); }],
    ['removed', (bin) => { fs.rmSync(bin); }],
    ...(fake.WIN ? [] : [['made non-executable', (bin) => { fs.chmodSync(bin, 0o644); }]]),   // NTFS has no execute bit — not a Windows case
  ]) {
    const { dir, db, r } = await deniedWork();
    const e = supervisor.live.get(r.workId);
    const tripwire = path.join(dir, 'TRIPWIRE');
    useBin(r.workId, cli(dir, [INIT, OK], { name: 'pinned', edits: [{ path: tripwire, body: 'ran' }] }));
    tamper(e.bin);
    const calls = argvLog(dir).length;
    const res = await supervisor.allow(db, r.workId, 'tu_1');
    assert.strictEqual(res.ok, false, name);
    assert.strictEqual(res.reason, 'resume-binding-unverified', name);
    assert.match(res.detail, /^binary-(changed|missing)$/, name);
    assert.strictEqual(argvLog(dir).length, calls, `${name}: the tampered binary was started`);
    assert.ok(!fs.existsSync(tripwire), name);
  }
});

test('binaryIdentity resolves names through PATH and refuses what is not an executable file', () => {
  const dir = tempDir('juqode-id-');
  const exe = path.join(dir, 'claude');
  fs.writeFileSync(exe, 'placeholder\n', { mode: 0o755 });
  const saved = process.env.PATH;
  try {
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.strictEqual(session.binaryIdentity('claude').launchPath, exe);
    process.env.PATH = '/nonexistent-dir';
    assert.strictEqual(session.binaryIdentity('claude'), null, 'an unresolvable name must not yield an identity');
  } finally { process.env.PATH = saved; }
  assert.strictEqual(session.binaryIdentity(dir), null, 'a directory is not a binary');
  assert.strictEqual(session.binaryIdentity(''), null);
});

/* ───────────── the FIRST init is judged once ───────────── */

const initLit = (fields) => ({ type: 'system', subtype: 'init', cwd: '/', _literal: true, ...fields });

test('the first init decides the session binding once; later inits can only revoke it', async () => {
  const cases = [
    ['wrong first id, then a correct init', (d) => [initLit({ session_id: 'bad-first' }), INIT]],
    ['correct init, then a different id', (d) => [INIT, initLit({ session_id: 'another' })]],
    ['missing id, then a correct init', (d) => [initLit({}), INIT]],
    ['duplicate init with the same id', (d) => [INIT, INIT]],
  ];
  for (const [name, mk] of cases) {
    const b = bench();
    const bin = cli(b.dir, [...mk(), DENIED, RESULT_DENIED]);
    const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, bin, detect: AVAILABLE });
    await r.done;
    assert.strictEqual(supervisor.live.get(r.workId).binding, null, `${name}: a binding exists`);
    const file = path.join(b.dir, 'a.txt'), before = sha(file), calls = argvLog(b.dir).length;
    const res = await supervisor.allow(b.db, r.workId, 'tu_1');
    assert.deepStrictEqual([res.ok, res.reason], [false, 'resume-binding-unverified'], name);
    assert.strictEqual(argvLog(b.dir).length, calls, `${name}: resume spawned a CLI`);
    assert.strictEqual(sha(file), before, name);
    /* the oddity is on the record: every init line is persisted verbatim */
    assert.ok(repo.signalsFor(b.db, r.workId).filter((x) => x.kind === 'session_start').length >= 2
      || name.startsWith('wrong first'), `${name}: the init lines were not persisted`);
  }
});

test('later inits leave an anomaly record, and a single good init still binds (control)', async () => {
  const b = bench();
  const dup = await supervisor.start(b.db, b.project, 'x', { evidenceStore: b.store, bin: cli(b.dir, [INIT, INIT, OK]), detect: AVAILABLE });
  await dup.done;
  assert.ok(repo.signalsFor(b.db, dup.workId).some((x) => /juqodeInitAnomaly/.test(String(x.payload))), 'no anomaly record');
  const c = bench();
  const ok = await supervisor.start(c.db, c.project, 'x', { evidenceStore: c.store, bin: cli(c.dir, [INIT, DENIED, RESULT_DENIED]), detect: AVAILABLE });
  await ok.done;
  assert.ok(supervisor.live.get(ok.workId).binding, 'a single correct init no longer binds');
});

/* ───────────── an unverifiable executable is never run ───────────── */

test('an executable whose identity cannot be established is refused before any spawn', async () => {
  const savedPath = process.env.PATH, savedBin = process.env.JUQODE_CLAUDE_BIN;
  try {
    const b = bench();
    /* a decoy `claude` on PATH that would run and write if anything fell back to PATH */
    const decoyDir = tempDir('juqode-pathdecoy-');
    const marker = path.join(decoyDir, 'DECOY-RAN');
    const decoy = cli(decoyDir, [INIT, OK], { name: 'claude', edits: [{ path: marker, body: 'x' }] });
    process.env.PATH = `${path.dirname(decoy)}${path.delimiter}${savedPath}`;
    for (const [name, opt, env] of [
      ['explicit missing path', { bin: path.join(b.dir, 'nope', 'claude') }, null],
      ['directory as binary', { bin: b.dir }, null],
      ['override env points nowhere', {}, path.join(b.dir, 'nope', 'claude')],
    ]) {
      if (env) process.env.JUQODE_CLAUDE_BIN = env; else delete process.env.JUQODE_CLAUDE_BIN;
      const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, detect: AVAILABLE, ...opt });
      assert.deepStrictEqual([r.ok, r.reason], [false, 'binary-unverified'], name);
      assert.ok(!fs.existsSync(marker), `${name}: PATH was consulted and a CLI ran`);
      assert.strictEqual(repo.activeWork(b.db, b.project.id), null, `${name}: a Work row was left behind`);
    }
    /* a Task Run reserves a row before spawn; the refusal must come before that reservation */
    delete process.env.JUQODE_CLAUDE_BIN;
    const task = repo.createTask(b.db, b.project.id, { goal: 'Refuse unverified binary' });
    const t = await supervisor.start(b.db, b.project, 'x', { evidenceStore: b.store, detect: AVAILABLE,
      bin: path.join(b.dir, 'nope'), taskId: task.id, idempotencyKey: 'unverified-1' });
    assert.strictEqual(t.reason, 'binary-unverified');
    assert.strictEqual(repo.activeWork(b.db, b.project.id), null, 'a Task Run row was reserved for a CLI that could not be identified');
  } finally {
    process.env.PATH = savedPath;
    if (savedBin !== undefined) process.env.JUQODE_CLAUDE_BIN = savedBin; else delete process.env.JUQODE_CLAUDE_BIN;
  }
});

test('a Windows-style shim pinned by its launcher alone is not a full binary attestation', () => {
  const dir = tempDir('juqode-shim-');
  const exe = path.join(dir, 'claude'); fs.writeFileSync(exe, 'placeholder\n', { mode: 0o755 });
  const id = session.binaryIdentity(exe);
  assert.strictEqual(id.targetResolved, true, 'a plain executable is its own target');
  const partial = Object.freeze({ sessionId: 's', canonicalCwd: session.canonicalDir(dir), identity: { ...id, targetResolved: false } });
  const v = session.verifyResume(partial, { cwd: dir, sessionId: 's', bin: exe, projectPath: dir });
  assert.deepStrictEqual([v.ok, v.reason], [false, 'target-unresolved']);
  const full = Object.freeze({ sessionId: 's', canonicalCwd: session.canonicalDir(dir), identity: id });
  assert.strictEqual(session.verifyResume(full, { cwd: dir, sessionId: 's', bin: exe, projectPath: dir }).ok, true);
});

/* ───────────── scoped retry: the tool surface that REACHED the process, the launch checks, and the audit ───────────── */
const retryOf = async (denialEvents = [INIT, DENIED, RESULT_DENIED], retryEvents = [INIT, OK], retryOpts = {}) => {
  const b = bench();
  const bin = cli(b.dir, denialEvents);
  const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, bin, detect: AVAILABLE });
  await r.done;
  const retryBin = cli(b.dir, retryEvents, { name: 'retry-claude', ...retryOpts });
  useBin(r.workId, retryBin);
  return { ...b, r, calls: () => argvLog(b.dir).length };
};
const grantsOf = (db, workId) => repo.signalsFor(db, workId).filter((s) => s.kind === 'permission_granted');
const auditOf = (db, workId) => repo.signalsFor(db, workId).map((s) => { try { return JSON.parse(s.payload).juqodeRetryAudit; } catch { return null; } }).filter(Boolean).at(-1);

test('scoped retry: the argv that REACHED the process confines the whole tool surface, not only the grant', async () => {
  const w = await retryOf();
  const out = await supervisor.allow(w.db, w.r.workId, 'tu_1');
  assert.strictEqual(out.ok, true);
  const argv = argvLog(w.dir).at(-1);
  assert.match(argv, /--resume \S+ -p --output-format stream-json --verbose --allowedTools Edit\(a\.txt\) --tools Read,Edit,Write --strict-mcp-config$/, argv);
  assert.ok(!/--bare|dangerously|--permission-mode|--sandbox|bypass/i.test(argv), argv);
  assert.deepStrictEqual([out.safety, out.containment.attested, out.containment.hooks, out.containment.permissions, out.containment.mcp],
    ['dev-compat-unattested', false, 'UNKNOWN', 'UNKNOWN', 'closed-by-flag']);
  const audit = auditOf(w.db, w.r.workId);
  assert.deepStrictEqual([audit.problems, audit.tools, audit.sideEffectsPrevented], [[], ['Read', 'Edit', 'Write'], false]);
});

test('scoped retry: a Bash grant gets Read,Bash only; a denied tool that cannot be confined (a connector tool) is not retried at all', async () => {
  const bash = [INIT, { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'tu_1', message: 'no' },
    { type: 'result', subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu_1', tool_input: { command: 'ls' } }] }];
  const w = await retryOf(bash);
  assert.strictEqual((await supervisor.allow(w.db, w.r.workId, 'tu_1')).ok, true);
  assert.match(argvLog(w.dir).at(-1), /--allowedTools Bash\(ls:\*\) --tools Read,Bash --strict-mcp-config$/);

  const mcp = [INIT, { type: 'system', subtype: 'permission_denied', tool_name: 'mcp__claude_ai_Google_Drive__share_file', tool_use_id: 'tu_1', message: 'no' },
    { type: 'result', subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'mcp__claude_ai_Google_Drive__share_file', tool_use_id: 'tu_1', tool_input: { file_path: 'a.txt' } }] }];
  const m = await retryOf(mcp);
  const before = m.calls();
  const out = await supervisor.allow(m.db, m.r.workId, 'tu_1');
  assert.deepStrictEqual([out.ok, out.reason], [false, 'cannot-scope-tool-surface']);
  assert.strictEqual(m.calls(), before, 'a process was started for a tool that cannot be confined');
  assert.strictEqual(grantsOf(m.db, m.r.workId).length, 0, 'a grant was recorded that was never used');
});

test('v1-protected (and any unknown mode): a privileged retry is refused BEFORE a grant is recorded or a process exists; dev-compat still works afterwards', async () => {
  const w = await retryOf();
  const before = w.calls();
  for (const mode of ['v1-protected', 'banana', '']) {
    const out = await supervisor.allow(w.db, w.r.workId, 'tu_1', { executionMode: mode });
    assert.deepStrictEqual([out.ok, out.reason, out.detail], [false, 'preflight-refused', 'safety-unattested'], mode);
  }
  assert.strictEqual(w.calls(), before, 'a refused launch created a process');
  assert.strictEqual(grantsOf(w.db, w.r.workId).length, 0);
  assert.strictEqual(repo.getWork(w.db, w.r.workId).status, 'permission_waiting', 'a refused launch moved the Work');
  assert.strictEqual((await supervisor.allow(w.db, w.r.workId, 'tu_1', { executionMode: 'dev-compat' })).ok, true);
});

test('recorded binary: other bytes or another path refuse before anything is recorded; the version the process reports must match the start', async () => {
  const w = await retryOf();
  const entry = supervisor.live.get(w.r.workId);
  const idPath = session.preflightRun({ sessionId: 'x', bin: entry.bin }).identity.path;        // the binary itself (the package target behind a Windows shim)
  entry.launchIdentity = { path: idPath, sha256: '0'.repeat(64), version: null };
  const before = w.calls();
  const out = await supervisor.allow(w.db, w.r.workId, 'tu_1');
  assert.deepStrictEqual([out.ok, out.reason, out.detail], [false, 'preflight-refused', 'binary-changed']);
  entry.launchIdentity = { path: path.join(w.dir, 'elsewhere'), sha256: '0'.repeat(64), version: null };
  assert.strictEqual((await supervisor.allow(w.db, w.r.workId, 'tu_1')).detail, 'not-the-recorded-binary');
  assert.strictEqual(w.calls(), before);
  assert.strictEqual(grantsOf(w.db, w.r.workId).length, 0);

  const v = await retryOf([INIT, DENIED, RESULT_DENIED], [{ ...INIT, claude_code_version: '2.0.0' }, OK]);
  supervisor.live.get(v.r.workId).launchIdentity = null;     // the harness re-pinned; give it back a start version
  const vid = session.preflightRun({ sessionId: 'x', bin: supervisor.live.get(v.r.workId).bin }).identity;
  supervisor.live.get(v.r.workId).launchIdentity = { path: vid.path, sha256: vid.sha256, version: '1.0.0' };
  const out2 = await supervisor.allow(v.db, v.r.workId, 'tu_1');
  assert.deepStrictEqual([out2.ok, out2.reason, out2.detail], [false, 'retry-surface-violation', 'binary-version-changed-since-start']);
  assert.strictEqual(repo.getWork(v.db, v.r.workId).status, 'ended');
});

test('audit: an exposed connector tool, a built-in beyond the retry surface, or a write outside the granted file ends the Work unknown, with the facts recorded', async () => {
  const run = async (events, retryOpts) => { const w = await retryOf([INIT, DENIED, RESULT_DENIED], events, retryOpts); const out = await supervisor.allow(w.db, w.r.workId, 'tu_1'); return { w, out, audit: auditOf(w.db, w.r.workId) }; };
  const mcp = await run([{ ...INIT, tools: ['Read', 'Edit', 'mcp__claude_ai_Google_Drive__share_file'] }, OK]);
  assert.deepStrictEqual([mcp.out.ok, mcp.out.detail], [false, 'mcp-exposed']);
  assert.ok(mcp.audit.problems.includes('mcp-exposed'));
  const beyond = await run([{ ...INIT, tools: ['Read', 'Edit', 'Bash'] }, OK]);
  assert.strictEqual(beyond.out.detail, 'builtin-tools-beyond-claim');
  const other = path.join(bench().dir, 'b.txt');
  const wrote = (file) => [INIT, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tw1', name: 'Write', input: { file_path: file } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tw1', content: 'updated' }] } }, OK];
  const outside = await run(wrote(other));
  assert.match(outside.out.detail, /^write-ran-without-grant:/);
  assert.strictEqual(repo.getWork(outside.w.db, outside.w.r.workId).outcome, 'ended_unknown');
  assert.strictEqual(supervisor.snapshot(outside.w.db, outside.w.r.workId).status, 'ended');
});

test('audit: Hooks before init are recorded as a fact (not a violation); a denial with exit 0 is still a denial; the stream, not the exit code, decides', async () => {
  const hook = { type: 'system', subtype: 'hook_started', hook_name: 'SessionStart:startup', hook_event: 'SessionStart' };
  const w = await retryOf([INIT, DENIED, RESULT_DENIED], [hook, hook, INIT, OK]);
  const out = await supervisor.allow(w.db, w.r.workId, 'tu_1');
  assert.strictEqual(out.ok, true);
  const audit = auditOf(w.db, w.r.workId);
  assert.deepStrictEqual([audit.hooksBeforeInit, audit.problems, audit.sideEffectsPrevented], [true, [], false]);
  const d = await retryOf([INIT, DENIED, RESULT_DENIED], [INIT, DENIED, RESULT_DENIED]);
  await supervisor.allow(d.db, d.r.workId, 'tu_1');
  assert.strictEqual(auditOf(d.db, d.r.workId).outcome, 'denied');
  assert.strictEqual(supervisor.snapshot(d.db, d.r.workId).status, 'permission_waiting');
});

test('session.run itself refuses (no process) on a changed recorded binary and in protected mode; the argv check also holds there', async () => {
  const dir = tempDir('juqode-run-');
  const { bin } = (() => { const b = cli(dir, [INIT, OK]); return { bin: b }; })();
  const rec = { path: session.preflightRun({ sessionId: 'x', bin }).identity.path, sha256: '1'.repeat(64), version: null };
  const ids = { sessionId: 'sid', prompt: 'x', onSignal: () => {}, bin };
  const r1 = await session.run({ ...ids, recorded: rec });
  assert.deepStrictEqual([r1.startFailed, r1.preflight, r1.sawEvent], [true, 'binary-changed', false]);
  const r2 = await session.run({ ...ids, resume: true, allowedTools: ['Edit(a.txt)'], mode: 'v1-protected' });
  assert.deepStrictEqual([r2.startFailed, r2.preflight], [true, 'safety-unattested']);
  const r3 = await session.run({ ...ids, allowedTools: ['Edit'] });
  assert.strictEqual(r3.preflight, 'unscoped-grant');
  assert.deepStrictEqual(argvLog(dir), [], 'a refused launch created a process');
  const ok = await session.run({ ...ids });
  assert.deepStrictEqual([ok.startFailed, ok.safety, ok.identityVerified], [false, 'dev-compat-unattested', true]);
  assert.strictEqual(argvLog(dir).length, 1);
});

/* ───────────── Edit grant vs Write tool (measured H3 live 44ca8a4: Edit(f) let Write run on f; Write(other) was denied) ───────────── */
const toolRun = (id, name, input, content = 'ok') => [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } }];
const retryWith = async (mk, denial = [INIT, DENIED, RESULT_DENIED]) => {
  const w = await retryOf(denial);
  const cwd = fs.realpathSync(w.project.path);
  useBin(w.r.workId, cli(w.dir, mk(cwd), { name: 'retry-w' }));
  const out = await supervisor.allow(w.db, w.r.workId, 'tu_1');
  return { w, out, cwd, audit: auditOf(w.db, w.r.workId) };
};

test('Edit(a.txt) denial: the surface is Read,Edit,Write, the grant is still ONE file; a Write to that same file passes the audit', async () => {
  const x = await retryWith((cwd) => [{ ...INIT, cwd, tools: ['Read', 'Edit', 'Write'] }, ...toolRun('tw1', 'Write', { file_path: path.join(cwd, 'a.txt') }), OK]);
  assert.strictEqual(x.out.ok, true, JSON.stringify(x.out));
  assert.match(argvLog(x.w.dir).at(-1), /--allowedTools Edit\(a\.txt\) --tools Read,Edit,Write --strict-mcp-config$/);
  assert.deepStrictEqual(x.audit.problems, []);
  assert.ok(!argvLog(x.w.dir).at(-1).includes('--allowedTools Write'), 'Write was granted as a tool, not as a file rule');
});

test('Write after an Edit(a.txt) grant: another file, a same-name file in a subdirectory, an escaping path and a bare relative miss are all violations; none is "covered"', async () => {
  const cases = { other: (c) => path.join(c, 'b.txt'), sameNameBelow: (c) => path.join(c, 'sub', 'a.txt'), escape: (c) => path.join(c, '..', 'a.txt'), prefixOnly: (c) => path.join(c, 'a.txt.bak') };
  for (const [name, file] of Object.entries(cases)) {
    const x = await retryWith((cwd) => [{ ...INIT, cwd, tools: ['Read', 'Edit', 'Write'] }, ...toolRun('tw1', 'Write', { file_path: file(cwd) }), OK]);
    assert.match(x.out.detail ?? '', /^write-ran-without-grant:/, name);
    assert.strictEqual(repo.getWork(x.w.db, x.w.r.workId).outcome, 'ended_unknown', name);
  }
});

test('a Write that was DENIED is a denial, not a change: exit 0 / success does not make it one, and the file bytes decide', async () => {
  const x = await retryWith((cwd) => [{ ...INIT, cwd, tools: ['Read', 'Edit', 'Write'] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tw1', name: 'Write', input: { file_path: path.join(cwd, 'b.txt') } }] } },
    { type: 'system', subtype: 'permission_denied', tool_name: 'Write', tool_use_id: 'tw1', message: 'no' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tw1', is_error: true, content: 'denied' }] } },
    { type: 'result', subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'Write', tool_use_id: 'tw1', tool_input: { file_path: path.join(cwd, 'b.txt') } }] }]);
  assert.strictEqual(x.audit.outcome, 'denied');
  assert.ok(x.audit.notes.includes('denied-despite-success-exit'));
  assert.ok(!fs.existsSync(path.join(x.cwd, 'b.txt')), 'the denied file exists');
  assert.strictEqual(supervisor.snapshot(x.w.db, x.w.r.workId).status, 'permission_waiting');
});

test('Bash: Read,Bash is a surface, not a command scope -- a command outside the granted prefix (or chained to it) is a violation and the effect stays UNBOUNDED', async () => {
  const bash = [INIT, { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'tu_1', message: 'no' },
    { type: 'result', subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu_1', tool_input: { command: 'ls' } }] }];
  const ran = (command) => (cwd) => [{ ...INIT, cwd, tools: ['Read', 'Bash'] }, ...toolRun('tb1', 'Bash', { command }), OK];
  const ok = await retryWith(ran('ls -la'), bash);
  assert.deepStrictEqual([ok.out.ok, ok.audit.problems, ok.audit.notes.includes('bash-effect-unbounded'), ok.audit.sideEffectsPrevented], [true, [], true, false]);
  for (const cmd of ['rm -rf x', 'ls; rm x', 'ls && curl x', 'lsof', 'ls $(id)', 'ls `id`', 'ls | sh']) {
    const bad = await retryWith(ran(cmd), bash);
    assert.match(bad.out.detail ?? '', /^bash-ran-outside-grant:/, cmd);
  }
  const w = await retryOf(bash);
  const before = w.calls();
  const refused = await supervisor.allow(w.db, w.r.workId, 'tu_1', { executionMode: 'v1-protected' });
  assert.deepStrictEqual([refused.reason, refused.detail, w.calls()], ['preflight-refused', 'safety-unattested', before], 'protected mode must refuse an unattested Bash');
});

test('audit: a process that reports NO version leaves the build UNKNOWN (a note), never "unchanged"; a different version stays a violation', async () => {
  const w = await retryOf();                       // INIT carries no claude_code_version
  const entry = supervisor.live.get(w.r.workId);
  const id = session.preflightRun({ sessionId: 'x', bin: entry.bin }).identity;
  entry.launchIdentity = { path: id.path, sha256: id.sha256, version: '1.0.0' };
  assert.strictEqual((await supervisor.allow(w.db, w.r.workId, 'tu_1')).ok, true);
  const audit = auditOf(w.db, w.r.workId);
  assert.ok(audit.notes.includes('binary-version-unverified') && !audit.problems.includes('binary-version-changed-since-start'), JSON.stringify(audit));
});

test('retry with a different init cwd than the caller is a recorded problem, not silently accepted', async () => {
  const w = await retryOf();
  useBin(w.r.workId, cli(w.dir, [INIT, OK], { name: 'retry-cwd', initCwd: path.join(fs.realpathSync(w.project.path), '..') }));
  await supervisor.allow(w.db, w.r.workId, 'tu_1');
  assert.ok(auditOf(w.db, w.r.workId)?.problems.includes('init-cwd-differs-from-call'), JSON.stringify(auditOf(w.db, w.r.workId)));
});
