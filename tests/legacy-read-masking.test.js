'use strict';
/* V1-409 · rows an OLDER build stored (a non-Task Work whose intent / stream / result kept what the user typed or the provider
 * printed) are masked on the way OUT to the renderer. The stored row is never rewritten. Synthetic rows in a scratch DB only;
 * no real user data is read. Also: the permission card says when part of the command is hidden, and v1-protected refuses then. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });
const CORE = 'A1b2C3d4E5f6G7h8I9j0';
const TOK = `ghp_${CORE.repeat(2)}`;
const API = 'API_TOKEN=abcd1234efgh5678';
const CORES = [CORE, 'abcd1234efgh5678'];
const leaks = (v) => CORES.some((c) => JSON.stringify(v).includes(c));
const rows = (db) => JSON.stringify(['work', 'work_signal', 'work_result', 'result_claim', 'step', 'change_group', 'raw_diff']
  .map((t) => db.prepare(`select * from ${t} order by rowid`).all()));

/* what a build before V1-409 wrote for a Work without a Task: raw intent, raw stream, raw result, raw step */
function legacy(withTask = false) {
  const dir = tempDir('juqode-legacy-');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const taskId = withTask ? repo.createTask(db, project.id, { goal: 'g' }).id : null;
  const w = repo.beginWork(db, project.id, `use ${TOK} for ${API}`, { taskId, idempotencyKey: withTask ? 'k1' : null });
  assert.strictEqual(w.ok, true, JSON.stringify(w));
  const id = w.work.id;
  const line = (o) => JSON.stringify(o);
  repo.addSignal(db, id, { seq: 0, source: 'claude', kind: 'tool_result', payload: line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_keep', content: `denied ${TOK}` }] } }) });
  repo.addSignal(db, id, { seq: 1, source: 'claude', kind: 'raw', payload: `not json ${API}` });
  repo.addSignal(db, id, { seq: 2, source: 'claude', kind: 'status', payload: line({ type: 'system', subtype: 'status', note: 'clean line' }) });
  repo.setWorkState(db, id, { status: 'ended', outcome: 'failed' });
  db.prepare("insert into work_result (work_id, summary, what_failed, created_at) values (?, ?, ?, ?)").run(id, `summary ${TOK}`, JSON.stringify({ why: `broke ${API}` }), new Date().toISOString());
  db.prepare("insert into result_claim (id, work_id, ord, text, confidence) values (?, ?, 0, ?, 'confirmed')").run('c1', id, JSON.stringify({ claim: `said ${TOK}` }));
  repo.upsertStep(db, id, { ord: 0, title: `step ${API}`, state: 'done' });
  db.prepare("insert into raw_diff (id, work_id, file, displayable, unified_head) values ('d1', ?, 'a.txt', 1, ?)").run(id, `+secret ${TOK}\n`);
  db.prepare("insert into change_group (id, work_id, ord, title, what, why, affects, confidence, explainable) values ('g1', ?, 0, ?, ?, ?, ?, 'expected', 1)").run(id, `t ${TOK}`, `w ${API}`, 'y', 'a');
  db.prepare("insert into change_group_file (change_group_id, raw_diff_id) values ('g1', 'd1')").run();
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => tempDir('juqode-legacy-store-'), push() {}, pushQc() {} });
  return { db, h, id, project };
}

for (const withTask of [false, true]) {
  test(`${withTask ? 'Task Run' : 'Work without a Task'} stored by an older build: every renderer exit shows a masked copy and the row is untouched`, () => {
    const { db, h, id, project } = legacy(withTask);
    const before = rows(db);
    assert.ok(leaks(before), 'the synthetic legacy rows must really hold the secret');

    const sig = h['juqode:work-signals'](null, id);
    const out = {
      signals: sig, get: h['juqode:work-get'](null, id), history: h['juqode:history'](null, project.id),
      reader: h['juqode:work-reader'](null, id),
    };
    for (const [name, v] of Object.entries(out)) {
      const copy = name === 'reader' ? { ...v, groups: v.groups.map((g) => ({ ...g, files: g.files.map(({ patch, blocks, ...f }) => f) })) } : v;
      assert.ok(!leaks(copy), `${name} carried the secret`);
    }
    /* kept: order, kind, source, ids, valid JSON, and the reason */
    assert.deepStrictEqual(sig.signals.map((s) => [s.seq, s.source, s.kind]), [[0, 'claude', 'tool_result'], [1, 'claude', 'raw'], [2, 'claude', 'status']]);
    const first = JSON.parse(sig.signals[0].payload);
    assert.strictEqual(first.message.content[0].tool_use_id, 'tu_keep');
    assert.strictEqual(first.juqodeRedaction.applied, true);
    assert.strictEqual(first.juqodeRedaction.at, 'read');
    assert.ok(first.juqodeRedaction.rules.length && first.juqodeRedaction.paths.length);
    assert.strictEqual(sig.signals[2].payload, repo.signalsFor(db, id)[2].payload, 'a clean line is returned byte for byte');
    assert.ok(!sig.signals[1].payload.includes('abcd1234efgh5678'));
    /* SC-04's explicit raw contract survives: the diff text is the user's own file content */
    const raw = out.reader.groups[0].files[0].patch;
    assert.ok(raw.includes(TOK), 'SC-04 raw diff must stay raw');
    assert.strictEqual(out.get.work.work.id, id);
    assert.strictEqual(out.get.work.status, 'ended');
    assert.strictEqual(out.get.work.outcome, 'failed');
    assert.strictEqual(rows(db), before, 'a read must not rewrite the stored rows');
  });
}

test('a payload a NEW build stored (already masked) is returned unchanged', () => {
  assert.strictEqual(supervisor.maskPayload('{"a":"b"}', { readOnly: true }), '{"a":"b"}');
  const stored = supervisor.maskPayload(JSON.stringify({ t: `x ${TOK}` }));
  assert.strictEqual(supervisor.maskPayload(stored, { readOnly: true }), stored);
});

test('the old Task-linked rows get the same policy through task-detail', () => {
  const l = legacy(true);
  const t = l.db.prepare('select task_id from work where id = ?').get(l.id);
  const d = l.h['juqode:task-detail'](null, t.task_id);
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.runs.length, 1);
  assert.ok(!leaks(d.runs));
});

/* ── the permission card: what is shown, what is granted ── */
function permBench(command, mode) {
  const dir = tempDir('juqode-perm-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const store = tempDir('juqode-perm-store-');
  const home = tempDir('juqode-perm-cli-');
  const ev = [{ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'tu_p', message: 'no' },
    { type: 'result', subtype: 'success', is_error: false, result: 'x', permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tu_p', tool_input: { command } }] }];
  const bin = fake.scriptBin(home, 'deny', `init(); ${ev.map((e) => (e.type === 'result' ? `result(${JSON.stringify(e)});` : `emit(${JSON.stringify(e)});`)).join(' ')} process.exit(0);`);
  return { db, project, store, home, bin, mode };
}

test('permission card: a command with a secret says args are hidden; v1-protected refuses before any grant; the clean one shows exactly what is granted', async () => {
  const hidden = permBench(`echo ${API} done`);
  const r = await supervisor.start(hidden.db, hidden.project, 'x', { evidenceStore: hidden.store, bin: hidden.bin, detect: AVAILABLE, });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  await r.done;
  const snap = supervisor.snapshot(hidden.db, r.workId);
  assert.strictEqual(snap.permission?.tool, 'Bash');
  assert.strictEqual(snap.permission.argsHidden, true);
  assert.ok(!leaks(snap.permission), 'the card must not show the secret');
  assert.strictEqual(snap.permission.scopable, false, 'no allow button when the card cannot show what is granted');
  assert.strictEqual(snap.permission.scopeRefusal, 'args-hidden');
  const before = rows(hidden.db);
  const out = await supervisor.allow(hidden.db, r.workId, 'tu_p', { executionMode: 'v1-protected' });
  assert.deepStrictEqual([out.ok, out.reason], [false, 'permission-args-hidden']);
  assert.strictEqual(rows(hidden.db), before, 'a refusal records nothing and moves nothing');
  assert.strictEqual(repo.getWork(hidden.db, r.workId).status, 'permission_waiting');

  const clean = permBench('echo hello');
  const c = await supervisor.start(clean.db, clean.project, 'x', { evidenceStore: clean.store, bin: clean.bin, detect: AVAILABLE, });
  await c.done;
  const cs = supervisor.snapshot(clean.db, c.workId);
  assert.strictEqual(cs.permission.argsHidden, false);
  const live = supervisor.live.get(c.workId);
  assert.strictEqual(cs.permission.spec, require(path.join(R, 'app/main/claude/session.js')).allowSpec({ tool: 'Bash', input: { command: 'echo hello' } }, live.cwd), 'the card shows the grant string itself');
});

test('dev-compat refuses a card with hidden args too (V1-004 §7.8): no grant record, no process, the Work keeps waiting', async () => {
  const b = permBench(`echo ${API} done`);
  const r = await supervisor.start(b.db, b.project, 'x', { evidenceStore: b.store, bin: b.bin, detect: AVAILABLE });
  await r.done;
  const retried = path.join(b.home, 'RETRIED');
  const e = supervisor.live.get(r.workId);
  e.bin = fake.scriptBin(b.home, 'retry-ok', `require('fs').writeFileSync(${JSON.stringify(retried)}, 'ran'); init(); result(); process.exit(0);`);
  e.binding = require(path.join(R, 'app/main/claude/session.js')).bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId: e.sessionId, bin: e.bin });
  e.launchIdentity = null;
  const before = rows(b.db);
  for (const mode of ['dev-compat', undefined]) {
    const out = await supervisor.allow(b.db, r.workId, 'tu_p', mode ? { executionMode: mode } : {});
    assert.deepStrictEqual([out.ok, out.reason], [false, 'permission-args-hidden'], String(mode));
  }
  assert.strictEqual(rows(b.db), before, 'a refusal records nothing and moves nothing');
  assert.ok(!fs.existsSync(retried), 'a retry process was started');
  assert.strictEqual(repo.getWork(b.db, r.workId).status, 'permission_waiting');
});

test('the renderer card shows the hidden-args sentence and the protected-mode refusal sentence (source pin; no GUI run claimed here)', () => {
  const src = require(path.join(__dirname, 'src.js')).code('app/renderer/screens/sc03.js');
  assert.ok(/scopeRefusal === 'args-hidden'/.test(src) && /workArgsHiddenRefused/.test(src));
  const C = require(path.join(__dirname, 'src.js')).text('app/renderer/copy.js');
  assert.ok(C.includes('workArgsHiddenRefused:'));
});
