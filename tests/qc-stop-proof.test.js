'use strict';
/* Stop evidence is only trusted when it is COMPLETE and agrees with the run row; a confirmation is only trusted when it matches the row's own
 * facts; read-only runs never hold the Writer gate; holds never cross projects. Negative cases first. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { validate } = require(path.join(R, 'app/main/qc/stop-proof.js'));
const ack = require(path.join(R, 'app/main/qc/ack.js'));
const { isReadOnlyRun } = require(path.join(R, 'app/main/qc/rules.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));

const ROW = { id: 'run-1', project_id: 'p1', started_at: '2026-10-16T10:00:00.000Z', runner_pid: 4242, exit_code: 1, status: 'unknown', command: 'npm run dev' };
const good = () => ({ runId: 'run-1', recordedAt: '2026-10-16T10:00:05.000Z', stop: {
  requested: true, requestedAt: '2026-10-16T10:00:02.000Z', attempts: 1, root: 'not-terminated', taskkill: { status: 255, error: null }, fallback: { used: true, sent: false },
  snapshot: { root: { pid: 4242, created: 'T' }, descendants: 0 }, descendants: 'none', platform: 'win32', members: [], uncertain: false,
  verdict: 'stop-unconfirmed', observedExit: { code: 1, signal: null }, timings: { snapshotMs: 5, taskkillMs: 5, survivorsMs: 5 } } });
const clone = (o) => JSON.parse(JSON.stringify(o));
const mut = (fn) => { const r = clone(good()); fn(r); return r; };

test('a complete record that agrees with the row is the only thing that clears', () => {
  assert.deepStrictEqual(validate(good(), ROW), { kind: 'clear' });
  for (const [verdict, root] of [['kill-unconfirmed', 'kill-requested'], ['contradiction-exit-0', 'terminated-by-taskkill']]) {
    assert.strictEqual(validate(mut((r) => { r.stop.verdict = verdict; r.stop.root = root; }), ROW).kind, 'clear', verdict);
  }
});

test('incomplete, contradictory or foreign records never clear (the bare {"stop":{"uncertain":false}} included)', () => {
  const bad = {
    'bare': { stop: { uncertain: false } },
    'no runId': mut((r) => { delete r.runId; }), 'other run': mut((r) => { r.runId = 'run-2'; }),
    'no recordedAt': mut((r) => { delete r.recordedAt; }), 'recorded before the run': mut((r) => { r.recordedAt = '2026-10-16T09:00:00.000Z'; }),
    'not requested': mut((r) => { r.stop.requested = false; }), 'posix': mut((r) => { r.stop.platform = 'linux'; }),
    'no requestedAt': mut((r) => { delete r.stop.requestedAt; }), 'zero attempts': mut((r) => { r.stop.attempts = 0; }),
    'no uncertain': mut((r) => { delete r.stop.uncertain; }), 'string uncertain': mut((r) => { r.stop.uncertain = 'false'; }),
    'verdict that cannot be clear': mut((r) => { r.stop.verdict = 'stopped-tree-observed'; }), 'unknown verdict': mut((r) => { r.stop.verdict = 'trust-me'; }),
    'root contradicts verdict': mut((r) => { r.stop.root = 'terminated-by-taskkill'; }),
    'descendants survivors': mut((r) => { r.stop.descendants = 'survivors'; }), 'descendants unverified': mut((r) => { r.stop.descendants = 'unverified'; }),
    'descendants missing': mut((r) => { delete r.stop.descendants; }),
    'members not empty': mut((r) => { r.stop.members = [{ pid: 9, created: 'x' }]; }), 'members missing': mut((r) => { delete r.stop.members; }),
    'survivor pids listed': mut((r) => { r.stop.survivorPids = [9]; }),
    'no survivor re-check recorded': mut((r) => { delete r.stop.timings; }), 'negative timing': mut((r) => { r.stop.timings.survivorsMs = -1; }),
    'another process was the root': mut((r) => { r.stop.snapshot.root.pid = 1; }),
    'exit code differs from the row': mut((r) => { r.stop.observedExit.code = 0; }), 'no observed exit': mut((r) => { delete r.stop.observedExit; }),
    'array': [], 'null': null, 'string': 'x',
  };
  for (const [label, rec] of Object.entries(bad)) assert.strictEqual(validate(rec, ROW).kind, 'untrusted', `${label}: released the hold`);
  // a record from before the survivor re-check existed
  const legacy = { runId: 'run-1', recordedAt: '2026-10-16T10:00:05.000Z', stop: { requested: true, attempts: 1, root: 'not-terminated', verdict: 'stop-unconfirmed', descendants: 'none', platform: 'win32' } };
  assert.strictEqual(validate(legacy, ROW).kind, 'untrusted', 'a pre-recheck record cleared a hold');
});

test('records saying something is (or may be) alive need well-formed members, otherwise the user decides', () => {
  const alive = (members) => mut((r) => { r.stop.uncertain = true; r.stop.verdict = 'root-stopped-descendants-alive'; r.stop.members = members; r.stop.descendants = 'survivors'; });
  assert.deepStrictEqual(validate(alive([{ pid: 7, created: 'T1' }, { pid: 8, created: null }]), ROW), { kind: 'members', members: [{ pid: 7, created: 'T1' }, { pid: 8, created: null }] });
  for (const members of [[], null, [{ pid: 'x', created: 'T' }], [{ pid: -1, created: 'T' }], [{ created: 'T' }], 'nope']) {
    assert.strictEqual(validate(alive(members), ROW).kind, 'untrusted', JSON.stringify(members));
  }
});

/* ───────────── the handlers: read-only vs writer, isolation, tampered evidence ───────────── */
const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } } });
const mk = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
function bench() {
  const was = process.env.JUQODE_CLAUDE_BIN; process.env.JUQODE_CLAUDE_BIN = path.join(os.tmpdir(), 'juqode-no-such-claude');
  const db = openDb(':memory:'); const evidence = mk('juqode-sp-ev-');
  const a = repo.openProject(db, mk('juqode-sp-a-'), 'a'); const b = repo.openProject(db, mk('juqode-sp-b-'), 'b');
  const boot = () => makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => evidence, push() {}, pushQc() {} });
  return { db, evidence, a, b, boot, restore: () => { if (was === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = was; } };
}
const unknownRun = (x, projectId, { ruleId, command, pid = 5000 + Math.floor(Math.random() * 999), startedAt = new Date().toISOString() }) => {
  const id = repo.beginQcRun(x.db, projectId, { phrase: 'x', ruleId, command, status: 'running', startedAt });
  repo.setQcRunner(x.db, id, { sessionId: 's', pid, startedAt });
  x.db.prepare("update quick_command_run set status = 'unknown', ended_at = ? where id = ?").run(new Date().toISOString(), id);
  return id;
};
const build = (h, pid) => h['juqode:qc-run'](null, pid, 'qc.build', 'b').then((r) => r.reason ?? 'allowed');

test('a read-only unknown run never blocks; a write-capable one does; one that only LOOKS read-only does; projects do not leak', async (t) => {
  const x = bench(); t.after(x.restore);
  fs.writeFileSync(path.join(x.a.path, 'package.json'), JSON.stringify({ scripts: { build: 'node -e 1' } }));
  fs.writeFileSync(path.join(x.b.path, 'package.json'), JSON.stringify({ scripts: { build: 'node -e 1' } }));
  const old = '2020-01-01T00:00:00.000Z';
  const ro = unknownRun(x, x.a.id, { ruleId: 'qc.git.status', command: 'git status --porcelain=v1 --branch', startedAt: old });
  assert.strictEqual(isReadOnlyRun({ rule_id: 'qc.git.status', command: 'git status --porcelain=v1 --branch', started_at: old }), true);
  assert.strictEqual(isReadOnlyRun({ rule_id: 'qc.future.rule', command: 'git status --porcelain=v1 --branch', started_at: old }), false, 'an unknown rule id was called read-only (the DB forbids one today; the code must not rely on that)');
  const h0 = x.boot();
  assert.strictEqual(await build(h0, x.a.id), 'allowed', 'an old read-only unknown run blocked the Writer for ever');
  for (let i = 0; i < 100 && repo.qcRunsFor(x.db, x.a.id).some((r) => r.status === 'running'); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.deepStrictEqual(x.boot()['juqode:qc-list'](null, x.a.id).held, []);

  for (const [label, row] of Object.entries({
    'another command under the read-only rule': { ruleId: 'qc.git.status', command: 'git status && rm -rf x' },
    'git status with a changed flag': { ruleId: 'qc.git.status', command: 'git status --porcelain=v2' },
    'build': { ruleId: 'qc.build', command: 'npm run build' }, 'test': { ruleId: 'qc.test', command: 'npm run test' },
    'commit': { ruleId: 'qc.git.commit', command: 'git commit -m x' }, 'deploy': { ruleId: 'qc.deploy', command: 'npm run deploy' }, 'dev': { ruleId: 'qc.dev.start', command: 'npm run dev' },
  })) {
    const y = bench(); t.after(y.restore);
    fs.writeFileSync(path.join(y.a.path, 'package.json'), JSON.stringify({ scripts: { build: 'node -e 1' } }));
    const id = unknownRun(y, y.a.id, { ...row, startedAt: old });
    assert.strictEqual(await build(y.boot(), y.a.id), 'prior-run-unknown', `${label}: the Writer was let through`);
    assert.deepStrictEqual(y.boot()['juqode:qc-list'](null, y.a.id).held.map((h) => h.runId), [id], label);
  }
  // a read-only-looking run with no recorded start is not trusted to be read-only
  const z = bench(); t.after(z.restore);
  fs.writeFileSync(path.join(z.a.path, 'package.json'), JSON.stringify({ scripts: { build: 'node -e 1' } }));
  const noStart = unknownRun(z, z.a.id, { ruleId: 'qc.git.status', command: 'git status --porcelain=v1 --branch' });
  z.db.prepare('update quick_command_run set started_at = null where id = ?').run(noStart);
  assert.strictEqual(await build(z.boot(), z.a.id), 'prior-run-unknown', 'a run with no start time was called read-only');

  // isolation: a write-capable hold in project A does not touch project B
  const w = bench(); t.after(w.restore);
  for (const p of [w.a, w.b]) fs.writeFileSync(path.join(p.path, 'package.json'), JSON.stringify({ scripts: { build: 'node -e 1' } }));
  unknownRun(w, w.a.id, { ruleId: 'qc.build', command: 'npm run build' });
  const h = w.boot();
  assert.strictEqual(await build(h, w.a.id), 'prior-run-unknown');
  assert.strictEqual(await build(h, w.b.id), 'allowed', 'a hold in one project blocked another');
  assert.deepStrictEqual(h['juqode:qc-list'](null, w.b.id).held, []);
});

test('tampered or contradictory Stop evidence keeps the hold; a complete, agreeing record releases it (restart-proof)', async (t) => {
  const x = bench(); t.after(x.restore);
  fs.writeFileSync(path.join(x.a.path, 'package.json'), JSON.stringify({ scripts: { build: 'node -e 1' } }));
  const id = unknownRun(x, x.a.id, { ruleId: 'qc.build', command: 'npm run build', pid: 4242 });
  x.db.prepare('update quick_command_run set exit_code = 1 where id = ?').run(id);
  const row = () => repo.qcRun(x.db, id);
  const put = (rec) => { fs.mkdirSync(path.join(x.evidence, 'qc-stop'), { recursive: true }); fs.writeFileSync(path.join(x.evidence, 'qc-stop', `${id}.json`), JSON.stringify(rec)); x.db.prepare('update quick_command_run set output_ref = ? where id = ?').run(`evidence:qc-stop/${id}.json`, id); };
  const base = { runId: id, recordedAt: new Date(Date.now() + 1000).toISOString(), stop: { ...good().stop } };
  const held = async () => (await build(x.boot(), x.a.id)) === 'prior-run-unknown';
  put({ stop: { uncertain: false } });                                    assert.ok(await held(), 'bare evidence released');
  put({ ...base, runId: 'someone-else' });                               assert.ok(await held(), 'another run\'s evidence released');
  put({ ...base, stop: { ...base.stop, descendants: 'survivors' } });    assert.ok(await held(), 'self-contradicting evidence released');
  put({ ...base, stop: { ...base.stop, snapshot: { root: { pid: 1 } } } }); assert.ok(await held(), 'evidence about another root pid released');
  assert.strictEqual(x.boot()['juqode:qc-list'](null, x.a.id).held[0].why, 'evidence-incomplete');
  put(base);                                                              assert.ok(!(await held()), 'a complete record that agrees with the row did not release');
  assert.deepStrictEqual([row().status, row().exit_code], ['unknown', 1], 'the past result was changed');
});

/* ───────────── a confirmation must match the run row, not just be well-formed ───────────── */
test('a confirmation whose facts differ from the run row is not a confirmation (command, pid, start, exit code, evidence ref, evidence content, status)', () => {
  const x = bench();
  const root = x.evidence;
  const id = unknownRun(x, x.a.id, { ruleId: 'qc.dev.start', command: 'npm run dev', pid: 4242, startedAt: '2026-10-16T10:00:00.000Z' });
  const run = () => repo.qcRun(x.db, id);
  const w = ack.writeAck(root, run());
  assert.strictEqual(w.ok, true);
  assert.strictEqual(ack.hasAck(root, run()), true);
  const file = path.join(root, 'qc-ack', `${id}.json`);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(rec.source, 'ipc:qc-ack-stopped');
  // the same file against a row that is not the one it was made for
  const forged = (over) => { const r = { ...run(), ...over }; return ack.hasAck(root, r); };
  assert.strictEqual(forged({ command: 'npm run build' }), false, 'command');
  assert.strictEqual(forged({ runner_pid: 9999 }), false, 'pid');
  assert.strictEqual(forged({ runner_started_at: '2001-01-01T00:00:00.000Z' }), false, 'start time');
  assert.strictEqual(forged({ exit_code: 0 }), false, 'exit code');
  assert.strictEqual(forged({ output_ref: 'evidence:qc-stop/other.json' }), false, 'evidence ref');
  assert.strictEqual(forged({ status: 'success' }), false, 'status');
  // a record re-signed (digest recomputed) with a different pid is well-formed but does not match the row
  const resigned = { ...rec, before: { ...rec.before, runnerPid: 1 } }; delete resigned.digest; resigned.digest = ack.digestOf(resigned);
  fs.writeFileSync(file, JSON.stringify(resigned));
  assert.strictEqual(ack.hasAck(root, run()), false, 'a well-formed record with another pid counted');
  fs.writeFileSync(file, JSON.stringify(rec));
  assert.strictEqual(ack.hasAck(root, run()), true);
});

test('a confirmation pins the Stop evidence it was made against: changing that file afterwards voids it', () => {
  const x = bench();
  const root = x.evidence;
  const id = unknownRun(x, x.a.id, { ruleId: 'qc.build', command: 'npm run build', pid: 4242 });
  const rel = `qc-stop/${id}.json`;
  fs.mkdirSync(path.join(root, 'qc-stop'), { recursive: true });
  fs.writeFileSync(path.join(root, rel), JSON.stringify({ runId: id, stop: { requested: true } }));
  x.db.prepare('update quick_command_run set output_ref = ? where id = ?').run(`evidence:${rel}`, id);
  assert.strictEqual(ack.writeAck(root, repo.qcRun(x.db, id)).ok, true);
  assert.strictEqual(ack.hasAck(root, repo.qcRun(x.db, id)), true);
  fs.writeFileSync(path.join(root, rel), JSON.stringify({ runId: id, stop: { requested: true, uncertain: false } }));    // evidence edited later
  assert.strictEqual(ack.hasAck(root, repo.qcRun(x.db, id)), false, 'a record made against different evidence still counted');
});

test('a confirmation file written by the previous build (same schema, no evidence digest, no source) is still honoured if every fact matches', () => {
  const x = bench();
  const root = x.evidence;
  const id = unknownRun(x, x.a.id, { ruleId: 'qc.dev.start', command: 'npm run dev', pid: 4242 });
  const run = repo.qcRun(x.db, id);
  const rec = { schema: 1, runId: id, projectId: x.a.id, confirmedAt: new Date().toISOString(), confirmedBy: 'user', statement: 's',
    before: { status: 'unknown', exitCode: null, stopEvidenceRef: null, runnerPid: 4242, runnerStartedAt: run.runner_started_at, command: 'npm run dev' }, heldBecause: 'never-finished' };
  rec.digest = ack.digestOf(rec);
  fs.mkdirSync(path.join(root, 'qc-ack'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qc-ack', `${id}.json`), JSON.stringify(rec));
  assert.strictEqual(ack.hasAck(root, run), true, 'an existing valid confirmation stopped working (compatibility)');
});
