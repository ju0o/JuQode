'use strict';
/* The Writer hold after a restart must FAIL CLOSED, see every unresolved run, accept only a verifiable confirmation, and
 * release only what the user named. Real modules, temp DB + evidence dirs, the CLI pointed at a missing path (no agent). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const ack = require(path.join(R, 'app/main/qc/ack.js'));
const { createUncertain } = require(path.join(R, 'app/main/qc/uncertain.js'));

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } } });
const NO_CLAUDE = path.join(os.tmpdir(), 'juqode-no-such-claude');

function bench(extra = {}) {
  const was = process.env.JUQODE_CLAUDE_BIN;
  process.env.JUQODE_CLAUDE_BIN = NO_CLAUDE;
  const dir = tmp('juqode-rs-'); dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setTimeout(()=>{},300)"', build: 'node -e 1' } }));
  const db = openDb(':memory:');
  const evidence = tmp('juqode-rs-ev-'); dirs.push(evidence);
  const project = repo.openProject(db, dir, 'p');
  const boot = (more = {}) => makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => evidence, push() {}, pushQc() {}, ...extra, ...more });
  return { db, dir, evidence, project, boot, h: boot(), restoreEnv: () => { if (was === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = was; } };
}
const stranded = (b, { pid = 4242, status = 'unknown', projectId = b.project.id, command = 'npm run dev' } = {}) => {
  const id = repo.beginQcRun(b.db, projectId, { phrase: 'x', ruleId: 'qc.dev.start', command, status: 'long_running' });
  repo.setQcRunner(b.db, id, { sessionId: 's', pid, startedAt: new Date().toISOString() });
  if (status !== 'long_running') b.db.prepare('update quick_command_run set status = ?, ended_at = ? where id = ?').run(status, new Date().toISOString(), id);
  return id;
};
const gate = async (h, projectId) => ({
  build: (await h['juqode:qc-run'](null, projectId, 'qc.build', 'b')).reason ?? 'allowed',
  work: (await h['juqode:work-start'](null, projectId, 'x')).reason ?? 'allowed',
  readOnly: h['juqode:qc-route'](null, projectId, '깃 상태').reason ?? 'ok',
});

/* ───────────── A · a restore that fails keeps the gate shut, says why, and is retried ───────────── */
test('A: evidence store failure -> Writer gate shut with the restore-failure reason (read-only QC allowed); retried on the next question; normal after recovery', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const id = stranded(b);
  let broken = true;
  const h = b.boot({ evidenceStore: () => { if (broken) throw Object.assign(new Error('disk offline'), { code: 'EIO' }); return b.evidence; } });
  let g = await gate(h, b.project.id);
  assert.deepStrictEqual([g.build, g.work], ['qc-restore-failed', 'prior-process-may-still-live'], 'a failed restore let a Writer through');
  assert.notStrictEqual(g.readOnly, 'qc-restore-failed', 'a read-only command was blocked by the failure');
  const listed = h['juqode:qc-list'](null, b.project.id);
  assert.strictEqual(listed.restoreFailure.reason, 'EIO', 'the exact reason was not exposed');
  assert.strictEqual((await h['juqode:work-start'](null, b.project.id, 'x')).detail.restoreFailed, true);
  const ack = await h['juqode:qc-ack-stopped'](null, b.project.id, [id], true);
  assert.deepStrictEqual([ack.ok, ack.reason], [false, 'qc-restore-failed'], 'a confirmation was accepted while the holds were unknown');
  // still failing: still shut (no "restored" mark was left behind by the failed attempt)
  assert.strictEqual((await gate(h, b.project.id)).build, 'qc-restore-failed');
  // recovery: the next question rebuilds the holds -> now the real hold (this run) is what blocks
  broken = false;
  g = await gate(h, b.project.id);
  assert.strictEqual(g.build, 'prior-run-unknown');
  assert.strictEqual(h['juqode:qc-list'](null, b.project.id).restoreFailure, null);
  assert.deepStrictEqual(h['juqode:qc-list'](null, b.project.id).held.map((x) => x.runId), [id]);
});

test('A: a database error while reading the unresolved runs is a restore failure too, not "nothing to restore"', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  let n = 0;
  const h = b.boot({ qcUnresolvedRuns: (...a) => { n += 1; if (n === 1) throw new Error('database is locked'); return repo.qcUnresolvedRuns(...a); } });
  assert.strictEqual((await gate(h, b.project.id)).build, 'qc-restore-failed');
  assert.strictEqual(h['juqode:qc-list'](null, b.project.id).restoreFailure, null, 'the retry on opening the list did not clear a failure that is over');
  assert.strictEqual((await gate(h, b.project.id)).build, 'allowed', 'with nothing held and a working store the gate must open');
});

test('A: a Stop-evidence file that cannot be trusted (directory, symlink, outside the store, broken) holds the run for the user -- never releases it', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const mk = (ref) => { const id = stranded(b); b.db.prepare('update quick_command_run set output_ref = ? where id = ?').run(ref, id); return id; };
  fs.mkdirSync(path.join(b.evidence, 'qc-stop', 'dir.json'), { recursive: true });
  fs.writeFileSync(path.join(b.evidence, 'qc-stop', 'broken.json'), '{"stop": ');
  fs.writeFileSync(path.join(b.evidence, 'qc-stop', 'clear.json'), JSON.stringify({ stop: { requested: true, uncertain: false } }));
  const outside = path.join(tmp('juqode-outside-'), 'x.json'); dirs.push(path.dirname(outside));
  fs.writeFileSync(outside, JSON.stringify({ stop: { requested: true, uncertain: false } }));
  const ids = { dir: mk('evidence:qc-stop/dir.json'), broken: mk('evidence:qc-stop/broken.json'), missing: mk('evidence:qc-stop/none.json'),
                escape: mk(`evidence:../${path.basename(path.dirname(outside))}/x.json`), clear: mk('evidence:qc-stop/clear.json') };
  let link = null;
  try { fs.symlinkSync(outside, path.join(b.evidence, 'qc-stop', 'link.json')); link = mk('evidence:qc-stop/link.json'); } catch { /* no symlink right on this host */ }
  const held = b.boot()['juqode:qc-list'](null, b.project.id).held;
  const heldIds = held.map((x) => x.runId);
  for (const k of ['dir', 'broken', 'missing', 'escape']) assert.ok(heldIds.includes(ids[k]), `${k}: evidence that cannot be trusted released the run`);
  if (link) assert.ok(heldIds.includes(link), 'a symlinked evidence file was trusted');
  assert.ok(!heldIds.includes(ids.clear), 'a plain, complete record saying "nothing alive" still counts');
  assert.ok(held.filter((x) => x.runId !== ids.clear).every((x) => x.needsAck), 'untrusted evidence must need the user, not a snapshot');
});

/* ───────────── B · no LIMIT in the safety query ───────────── */
test('B: the oldest unresolved run among 1,500 newer finished ones still holds the gate; History paging is untouched', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const oldest = stranded(b, { pid: 777 });
  b.db.prepare("update quick_command_run set created_at = '2020-01-01T00:00:00.000Z' where id = ?").run(oldest);
  const ins = b.db.prepare("insert into quick_command_run (id, project_id, phrase, rule_id, command, status, exit_code, created_at, started_at, ended_at) values (?, ?, 'x', 'qc.test', 'npm run test', 'success', 0, ?, ?, ?)");
  b.db.exec('begin');
  for (let i = 0; i < 1500; i += 1) { const at = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(); ins.run(`bulk-${i}`, b.project.id, at, at, at); }
  b.db.exec('commit');
  assert.ok(!repo.qcRunsFor(b.db, b.project.id, 1000).some((r) => r.id === oldest), 'the premise: a 1,000-row read would have missed it');
  assert.strictEqual(repo.qcRunsFor(b.db, b.project.id).length, 20, 'History paging changed');
  const g = await gate(b.h, b.project.id);
  assert.deepStrictEqual([g.build, g.work], ['prior-run-unknown', 'prior-process-may-still-live']);
  assert.deepStrictEqual(b.h['juqode:qc-list'](null, b.project.id).held.map((x) => x.runId), [oldest]);
});

/* ───────────── C · a confirmation counts only if it verifies ───────────── */
test('C: empty, broken, foreign, tampered, half-written, symlinked and directory "acknowledgements" release nothing; a valid one is written next to them, never over them', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const other = repo.openProject(b.db, tmp('juqode-other-'), 'other'); dirs.push(other.path);
  const id = stranded(b);
  const row = repo.qcRun(b.db, id);
  const dir = path.join(b.evidence, 'qc-ack'); fs.mkdirSync(dir, { recursive: true });
  const good = (over = {}) => { const rec = { schema: 1, runId: id, projectId: b.project.id, confirmedAt: new Date().toISOString(), confirmedBy: 'user', statement: 's', before: { status: 'unknown' }, ...over }; rec.digest = ack.digestOf(rec); return rec; };
  const put = (name, body) => fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  const cases = {
    'empty': '', 'broken': '{"schema":1,"runId":', 'array': '[]', 'not json': 'confirmed',
    'other project': good({ projectId: other.id }), 'other run': good({ runId: 'someone-else' }), 'wrong schema': good({ schema: 2 }),
    'not user': good({ confirmedBy: 'agent' }), 'no time': good({ confirmedAt: 'tomorrow' }), 'before ok': good({ before: { status: 'success' } }),
    'tampered': { ...good(), confirmedAt: '2001-01-01T00:00:00.000Z' }, 'no digest': (() => { const r = good(); delete r.digest; return r; })(),
  };
  let n = 0;
  for (const [label, body] of Object.entries(cases)) {
    const name = n === 0 ? `${id}.json` : `${id}.${n + 1}.json`; n += 1;
    fs.rmSync(path.join(dir, `${id}.json`), { force: true }); fs.rmSync(path.join(dir, `${id}.${n}.json`), { force: true });
    put(`${id}.json`, body);
    assert.strictEqual(ack.hasAck(b.evidence, row), false, `${label}: counted as a confirmation`);
    assert.strictEqual((await gate(b.boot(), b.project.id)).build, 'prior-run-unknown', `${label}: released the hold after a restart`);
    fs.rmSync(path.join(dir, `${id}.json`), { force: true });
  }
  // EEXIST alone is not a confirmation: an unusable file of the canonical name stays, the real record goes beside it
  put(`${id}.json`, '');
  const h = b.boot();
  const r = await h['juqode:qc-ack-stopped'](null, b.project.id, [id], true);
  assert.deepStrictEqual([r.ok, r.acked[0].existing, r.acked[0].ref], [true, false, `evidence:qc-ack/${id}.2.json`]);
  assert.strictEqual(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'), '', 'the unusable file was overwritten');
  assert.strictEqual(ack.hasAck(b.evidence, row), true);
  assert.strictEqual(b.boot()['juqode:qc-list'](null, b.project.id).held.length, 0, 'the valid record did not survive a restart');
  // the run and its evidence were never touched
  const after = repo.qcRun(b.db, id);
  assert.deepStrictEqual([after.status, after.exit_code, after.output_ref], [row.status, row.exit_code, row.output_ref]);
});

test('C: a symlinked file or a symlinked / escaping qc-ack directory is never trusted and never written through', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const id = stranded(b); const row = repo.qcRun(b.db, id);
  const elsewhere = tmp('juqode-elsewhere-'); dirs.push(elsewhere);
  // 1 · file symlink to a perfectly valid record elsewhere
  const dir = path.join(b.evidence, 'qc-ack'); fs.mkdirSync(dir, { recursive: true });
  const rec = { schema: 1, runId: id, projectId: b.project.id, confirmedAt: new Date().toISOString(), confirmedBy: 'user', statement: 's', before: { status: 'unknown' } }; rec.digest = ack.digestOf(rec);
  fs.writeFileSync(path.join(elsewhere, 'v.json'), JSON.stringify(rec));
  let canLink = true;
  try { fs.symlinkSync(path.join(elsewhere, 'v.json'), path.join(dir, `${id}.json`)); } catch { canLink = false; }
  if (canLink) assert.strictEqual(ack.hasAck(b.evidence, row), false, 'a symlinked record was accepted');
  fs.rmSync(path.join(dir, `${id}.json`), { force: true });
  // 2 · the qc-ack directory itself is a link to somewhere else
  fs.rmSync(dir, { recursive: true, force: true });
  try { fs.symlinkSync(elsewhere, dir, 'junction'); } catch { canLink = false; }
  if (canLink) {
    fs.copyFileSync(path.join(elsewhere, 'v.json'), path.join(elsewhere, `${id}.json`));
    assert.strictEqual(ack.hasAck(b.evidence, row), false, 'a record behind a linked directory was accepted');
    const w = ack.writeAck(b.evidence, row);
    assert.strictEqual(w.ok, false, 'a record was written through a linked directory');
    assert.ok(!fs.readdirSync(elsewhere).some((n) => n.includes('.tmp')), 'a temp file leaked outside the store');
  }
  t.diagnostic(canLink ? 'symlink + junction cases ran' : 'this host could not create symlinks: the symlink cases did NOT run here');
});

/* ───────────── D · the confirmation names runs ───────────── */
test('D: only the named runs are released; a run held AFTER the panel was drawn, another project\'s run and an unheld id stay as they are', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const other = repo.openProject(b.db, tmp('juqode-other-'), 'other'); dirs.push(other.path);
  const a1 = stranded(b, { pid: 1001, command: 'npm run dev' });
  const a2 = stranded(b, { pid: 1002, command: 'npm run build' });
  const foreign = stranded(b, { pid: 1003, projectId: other.id });
  const h = b.boot();
  const shown = h['juqode:qc-list'](null, b.project.id).held.map((x) => x.runId);     // what the panel displayed
  assert.deepStrictEqual(shown.sort(), [a1, a2].sort());
  const late = stranded(b, { pid: 1004, command: 'npm run later' });                  // appears after the panel was drawn
  b.db.prepare("update quick_command_run set status = 'unknown' where id = ?").run(late);
  // a new restart-like question picks the late run up (new handlers = new process)
  const h2 = b.boot();
  assert.strictEqual(h2['juqode:qc-list'](null, b.project.id).held.length, 3);
  const r = await h2['juqode:qc-ack-stopped'](null, b.project.id, [a1, foreign, 'no-such-run'], true);
  assert.deepStrictEqual(r.acked.map((x) => x.runId), [a1], 'only the named, held run of this project is acknowledged');
  assert.deepStrictEqual(r.skipped.map((x) => x.runId).sort(), [foreign, 'no-such-run'].sort());
  assert.deepStrictEqual(r.stillHeld.sort(), [a2, late].sort(), 'the rest of the Writer hold was dropped');
  assert.strictEqual((await gate(h2, b.project.id)).build, 'prior-run-unknown', 'partial confirmation opened the gate');
  assert.deepStrictEqual(b.boot()['juqode:qc-list'](null, other.id).held.map((x) => x.runId), [foreign], 'the other project lost its hold');
  // the whole list, once the user has seen and named every run, opens it
  const r2 = await h2['juqode:qc-ack-stopped'](null, b.project.id, [a2, late], true);
  assert.deepStrictEqual(r2.stillHeld, []);
  assert.strictEqual((await gate(h2, b.project.id)).build, 'allowed');
  for (const id of [a1, a2, late]) assert.strictEqual(repo.qcRun(b.db, id).status, 'unknown', 'a past run was rewritten');
});

/* ───────────── E · the two Writers cannot both start ───────────── */
test('E: a Work that is starting and a file-changing Quick Command racing in the same turn: exactly one writer goes first', async (t) => {
  const b = bench(); t.after(b.restoreEnv);
  const results = await Promise.all([
    b.h['juqode:work-start'](null, b.project.id, '고쳐줘'),
    b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드'),
  ]);
  const [work, build] = results;
  // the CLI is absent, so the Work ends in claude-unavailable -- what matters is that the QC saw it as "starting" and was refused
  assert.strictEqual(build.ok, false, `the build started while a Work was starting: ${JSON.stringify(build)}`);
  assert.strictEqual(build.reason, 'active-run', `refused for the wrong reason: ${build.reason}/${build.detail}`);
  assert.strictEqual(work.ok, false);
  // once the Work attempt is over the build is allowed again
  const later = await b.h['juqode:qc-run'](null, b.project.id, 'qc.build', '빌드');
  assert.strictEqual(later.ok, true, `${later.reason}/${later.detail}`);
});
