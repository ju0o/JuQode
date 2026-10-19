'use strict';
/* V1-409 · what the structured IPC answers (`work-signals`, `work-reader`, `work-get`) carry back to the renderer.
 * `publicOut` scrubs only `detail`; these answers' `signals[].payload` is whatever the Supervisor STORED. So the trust
 * boundary is the persistence masking, and it is tested here on the real path: fixture CLI -> Supervisor -> DB -> handler.
 * This file also PINS the one asymmetry found (see FINDING) so a change to it has to touch a test. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });

const CORE = "A1b2C3d4E5f6G7h8I9j0";

const { reduce, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
const SECRETS = [`ghp_${CORE.repeat(2)}`, `Bearer ${CORE.toLowerCase()}zzzz`, 'API_TOKEN=abcd1234efgh5678'];
const CORES = [CORE, `${CORE.toLowerCase()}zzzz`, 'abcd1234efgh5678'];
const hasSecret = (v) => CORES.some((c) => JSON.stringify(v).includes(c));
const bodyOf = (o) => JSON.stringify(o);

async function runWork({ task }) {
  const dir = tempDir('juqode-ob-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '-A', '.'); g('commit', '-qm', 'b');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const store = tempDir('juqode-ob-store-');
  const home = tempDir('juqode-ob-cli-');
  const [S1, S2, S3] = SECRETS;
  const bin = fake.scriptBin(home, 'say-secret', `init();
emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(`token is ${S1} ok`)} }] } });
emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x1', is_error: true, content: ${JSON.stringify(`denied: ${S2} ${S3}`)} }] } });
result({ is_error: true, subtype: 'error_during_execution', result: ${JSON.stringify(`failed ${S1}`)}, permission_denials: [{ tool_name: 'Bash', tool_use_id: 'x1', tool_input: { command: ${JSON.stringify(`curl -H "Authorization: ${S2}"`)} } }] });
process.exit(1);`);
  const t = task ? repo.createTask(db, project.id, { goal: 'g' }) : null;
  const run = await supervisor.start(db, project, `please use ${S1} and ${S3}`, { evidenceStore: store, bin, detect: AVAILABLE, taskId: t?.id ?? null, idempotencyKey: task ? 'k1' : null });
  assert.strictEqual(run.ok, true);
  await run.done;
  let retry = null;
  if (task) {                                           // retry exists only for Task Runs
    const again = await supervisor.start(db, project, `retry with ${S3}`, { evidenceStore: store, bin, detect: AVAILABLE, taskId: t.id, idempotencyKey: 'k2', retryOfWorkId: run.workId, retryReason: `because ${S1}` });
    if (again.ok) { await again.done; retry = again.workId; }
  }
  /* answer: drive the waiting state exactly as loop.test does, then answer with a secret */
  const entry = supervisor.live.get(run.workId);
  let answered = null;
  if (entry) {
    entry.state = reduce(entry.state, { kind: KIND.INPUT_REQUEST, payload: { text: 'which?' } }, new Date().toISOString());
    repo.setWorkState(db, run.workId, { status: 'input_waiting' });
    answered = await supervisor.answer(db, run.workId, `use ${S1} then ${S2}`);
  }
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => store, push() {}, pushQc() {} });
  return { h, db, workId: run.workId, retry, answered, project };
}

for (const task of [true, false]) {
  test(`${task ? 'Task Run' : 'Work without a Task'}: no synthetic secret in what is STORED or returned (intent, events, answer, failure, work-signals/get/history/reader)`, async () => {
    const { h, db, workId, retry, answered, project } = await runWork({ task });
    const s = h['juqode:work-signals'](null, workId);
    assert.strictEqual(s.ok, true);
    assert.ok(s.signals.length > 0);
    assert.ok(answered && s.signals.some((x) => x.kind === 'answer'), 'the answer was not driven or not recorded');
    for (const [name, v] of Object.entries({
      'work-signals': s, 'work-get': h['juqode:work-get'](null, workId), 'work-reader': h['juqode:work-reader'](null, workId),
      history: h['juqode:history'](null, project.id), 'work row': repo.getWork(db, workId), 'result': repo.resultFor(db, workId),
      'raw signals table': db.prepare('select payload from work_signal').all(),
    })) assert.ok(!hasSecret(v), `${name} carried a synthetic secret: ${Object.entries(v?.work ?? v ?? {}).filter(([, x]) => hasSecret(x)).map(([k]) => k)}`);
    if (retry) assert.ok(!hasSecret(repo.getWork(db, retry)) && !hasSecret(repo.signalsFor(db, retry)), 'retry Work / events carried a secret');
    assert.ok(!hasSecret(db.prepare('select * from work').all()), 'a work row (intent, retry_reason) carried a secret');
  });
}

test('masking in the stream keeps the JSONL valid, event kinds, ids and the juqodeRedaction reason', async () => {
  for (const task of [true, false]) {
    const { h, workId } = await runWork({ task });
    const sigs = h['juqode:work-signals'](null, workId).signals;
    const parsed = sigs.filter((x) => x.source === 'claude').map((x) => JSON.parse(x.payload));
    assert.ok(parsed.length >= 3 && parsed.every((o) => typeof o === 'object'), 'a stored claude line is not valid JSON');
    assert.ok(parsed.some((o) => o.type === 'user' && o.message.content[0].tool_use_id === 'x1'), 'the event identifier was lost');
    assert.ok(parsed.some((o) => o.juqodeRedaction?.applied === true && o.juqodeRedaction.rules.length), `${task}: no juqodeRedaction ground on a masked line`);
  }
});

test('the provider is still sent the user\'s text unmasked (stored form and sent form are different things)', async () => {
  const dir = tempDir('juqode-ob2-');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const store = tempDir('juqode-ob2-store-');
  const home = tempDir('juqode-ob2-cli-');
  const seen = path.join(home, 'argv.json');
  const bin = fake.scriptBin(home, 'echo-argv', `require('fs').writeFileSync(${JSON.stringify(seen)}, require('fs').readFileSync(0, 'utf8')); init(); result(); process.exit(0);`);
  const run = await supervisor.start(db, project, `use ${SECRETS[0]}`, { evidenceStore: store, bin, detect: AVAILABLE });
  await run.done;
  assert.ok(fs.readFileSync(seen, 'utf8').includes(CORE), 'the prompt the provider received was altered');
  assert.ok(!hasSecret(repo.getWork(db, run.workId).intent), 'the stored intent kept the secret');
});

test('writeSignal failure records a safe code, never the exception text', () => {
  const src = require(path.join(__dirname, 'src.js')).code('app/main/work/supervisor.js');
  assert.ok(!/signal-write-failed: \$\{e\?\.code \?\? e\?\.message/.test(src));
  assert.ok(/signal-write-failed: \$\{typeof e\?\.code === 'string' && \/\^\[A-Za-z0-9_\.-\]\{1,48\}\$\/\.test\(e\.code\)/.test(src));
});

/* a REAL exception thrown by the store while a signal is written - the fallback row must hold a code and nothing else */
const FAILURES = [
  ['SQL error', Object.assign(new Error(`SQLITE_CONSTRAINT: UNIQUE constraint failed: work_signal.seq (insert into work_signal values ('${SECRETS[0]}'))`), { code: 'ERR_SQLITE_ERROR' })],
  ['local path', Object.assign(new Error('EACCES: permission denied, open \'/home/someone/.config/juqode/app.db\''), { code: 'EACCES' })],
  ['API token', new Error(`request failed with ${SECRETS[2]}`)],
  ['multi-line', new Error(`first line\n  at secret (${SECRETS[1]})\n/home/someone/x.js:1:1`)],
  ['unsafe code', Object.assign(new Error('boom'), { code: `bad code with spaces ${SECRETS[0]}` })],
];
for (const [name, err] of FAILURES) {
  test(`a signal write that throws (${name}) leaves a code-only fallback, keeps the earlier history, and does not stop the Work`, async () => {
    const dir = tempDir('juqode-wf-');
    const db = openDb(':memory:');
    const project = repo.openProject(db, dir, 'p');
    const home = tempDir('juqode-wf-cli-');
    const bin = fake.scriptBin(home, 'say', `init(); emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'THROWME' }] } }); result(); process.exit(0);`);
    const orig = repo.addSignal;
    let thrown = 0;
    repo.addSignal = (d, id, sig) => { if (!thrown && String(sig.payload).includes('THROWME')) { thrown++; throw err; } return orig(d, id, sig); };
    let run;
    try {
      run = await supervisor.start(db, project, 'hello', { evidenceStore: tempDir('juqode-wf-store-'), bin, detect: AVAILABLE });
      await run.done;
    } finally { repo.addSignal = orig; }
    assert.strictEqual(thrown, 1, 'the injected failure never fired');
    const rows = repo.signalsFor(db, run.workId);
    const fallback = rows.filter((s) => String(s.payload).startsWith('signal-write-failed'));
    assert.strictEqual(fallback.length, 1);
    assert.match(fallback[0].payload, /^signal-write-failed: (unknown|ERR_SQLITE_ERROR|EACCES)$/);
    assert.ok(!/someone|SQLITE_CONSTRAINT|request failed|first line|bad code|THROWME|secret/.test(JSON.stringify(rows)), 'the fallback carried exception text');
    assert.ok(!hasSecret(rows) && !hasSecret(db.prepare('select * from work_signal').all()));
    assert.ok(rows.length >= 3 && rows.some((s) => s.kind === 'session_start'), 'earlier history was lost');
    assert.strictEqual(repo.getWork(db, run.workId).status, 'ended', 'the Work did not reach its end');
  });
}

test('interpret: the narrative pass\'s child stderr (narrative.detail) leaves scrubbed, like every other detail', async () => {
  const dir = tempDir('juqode-nd-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}\n');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const home = tempDir('juqode-nd-cli-');
  const bin = fake.scriptBin(home, 'stderr-only', `process.stderr.write(${JSON.stringify(`boom ${SECRETS[0]} ${SECRETS[2]} at /home/someone/x`)}); process.exit(1);`);
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => tempDir('juqode-nd-store-'), push() {}, pushQc() {}, claudeBin: () => bin });
  const r = await h['juqode:interpret'](null, project.id);
  assert.strictEqual(r.ok, true);
  assert.ok(r.narrative.detail, 'the fixture did not produce a stderr detail');
  assert.ok(!hasSecret(r), `interpret carried a synthetic secret: ${bodyOf(r.narrative)}`);
});
