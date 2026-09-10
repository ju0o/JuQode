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

function cli(dir, events, { edits = [], exit = 0, silent = false, name = 'fake-claude' } = {}) {
  const home = cliHome(dir);
  const bin = path.join(home, name);
  const script = path.join(home, `${name}.js`);
  /* argv is appended to a log, so a test can assert what actually REACHED the process rather
   * than what the caller believed it sent — "same session, same Work" was claimed by two test
   * titles and asserted by neither, so `resume: false` and an empty grant both passed. */
  fs.writeFileSync(script, `
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(path.join(cliHome(dir), 'ARGV.log'))}, process.argv.slice(2).join(' ') + '\\n');
${edits.map((e) => `fs.writeFileSync(${JSON.stringify(e.path)}, ${JSON.stringify(e.body)});`).join('\n')}
${silent ? '' : `for (const e of ${JSON.stringify(events)}) process.stdout.write(JSON.stringify(e) + '\\n');`}
process.exit(${exit});
`);
  fs.writeFileSync(bin, `#!/bin/sh\nexec ${process.execPath} ${script} "$@"\n`, { mode: 0o755 });
  return bin;
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
  const retryBin = cli(dir, [INIT, OK], { edits: [{ path: path.join(dir, 'a.txt'), body: 'allowed\n' }] });
  supervisor.live.get(r.workId).bin = retryBin;

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
});

test('two concurrent allows do not start two sessions on one session id', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;
  const retryBin = path.join(dir, 'slow-retry');
  fs.writeFileSync(retryBin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
sleep 1
echo '{"type":"result","subtype":"success","is_error":false,"permission_denials":[]}'
`, { mode: 0o755 });
  supervisor.live.get(r.workId).bin = retryBin;

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

test('cancelling a Work whose process is already gone closes it, and frees the slot', async () => {
  const { dir, db, project, store } = bench();
  const bin = cli(dir, [INIT, DENIED, RESULT_DENIED]);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  await r.done;

  supervisor.cancel(db, r.workId);
  const snap = supervisor.snapshot(db, r.workId);
  /* Nothing is left to stop, so the stop IS observed. Without this the Work sat in 취소 요청됨
   * forever and D-117's single slot stayed held until the app restarted. */
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.outcome, 'cancelled_nochange', 'no tool ran, so nothing was changed');

  const kinds = repo.signalsFor(db, r.workId).map((s) => `${s.source}/${s.kind}`);
  assert.ok(kinds.includes('user/cancel_request'), 'the record must say the PERSON asked');
  assert.ok(kinds.includes('juqode/cancel_confirmed'), 'the observed stop is not on the record');

  assert.strictEqual(repo.activeWork(db, project.id), null, 'the D-117 slot is still held');
});

test('a cancel whose stop is NOT observed leaves the Work open and says so', async () => {
  const { dir, db, project, store } = bench();
  /* A CLI that keeps running: the request is sent, and nothing has been seen to stop. */
  const bin = path.join(dir, 'slow-claude');
  fs.writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
sleep 20
`, { mode: 0o755 });
  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true);

  const child = supervisor.live.get(r.workId).child;
  supervisor.cancel(db, r.workId);
  const snap = supervisor.snapshot(db, r.workId);
  assert.strictEqual(snap.status, 'cancel_requested',
    'a cancel REQUEST is not a cancellation — `15` keeps them separate states');
  assert.strictEqual(snap.outcome, null, '`07` §8.1: a cancelled child exits 0, so a stop is only what was SEEN');

  /* …and the child must actually be stopped. Recording the request while the process runs on
   * is the shape `07` §8.2's group rule exists to make impossible. */
  await new Promise((res) => { child.once('exit', res); setTimeout(res, 8000); });
  assert.notStrictEqual(child.exitCode === null && child.signalCode === null, true,
    'the cancel was recorded but nothing stopped the process');

  /* …and it closes once the child is actually observed to exit. */
  await r.done;
  await new Promise((res) => setTimeout(res, 250));
  const after = supervisor.snapshot(db, r.workId);
  assert.strictEqual(after.status, 'ended', 'the observed exit did not close the cancelled Work');
  assert.ok(after.outcome.startsWith('cancelled'), `outcome ${after.outcome}`);
});

test('two submits cannot start two sessions in one project', async () => {
  /* `preflight`'s guard read is advisory — the engine's real one is `beginWork`'s insert, which
   * happens only once a session SPEAKS. Both starts used to pass preflight and both spawned;
   * the loser got the guard card while its process kept running, untracked and unstoppable,
   * and its writes were folded into the winner's after-basis. */
  const { dir, db, project, store } = bench();
  const bin = path.join(dir, 'slow-claude');
  fs.writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
sleep 2
echo '{"type":"result","subtype":"success","is_error":false,"permission_denials":[]}'
`, { mode: 0o755 });

  /* The CLI is SILENT for a moment before its first event. That is the window the DB index
   * cannot cover: `beginWork` only fires once a session speaks, so without an in-flight guard
   * both preflights pass and both spawn. A fake that answers instantly hides the whole race. */
  fs.writeFileSync(bin, `#!/bin/sh
sleep 1
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
echo '{"type":"result","subtype":"success","is_error":false,"permission_denials":[]}'
`, { mode: 0o755 });

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
  supervisor.live.get(r.workId).bin = retryBin;
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

  assert.deepStrictEqual(repo.processFor(db, w.id), { pid: 4242, startedAt: repo.processFor(db, w.id).startedAt });

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

test('stopping a Work kills the whole process GROUP, not just the shell', async () => {
  /* `07` §8.2 is about the group. A CLI that spawns a helper leaves that helper running if the
   * signal goes to the shell alone — and the helper is what holds the file handles and keeps
   * editing. Killing only the shell also makes the shell exit, so a test that watches the
   * shell cannot tell the two apart. */
  const { dir, db, project, store } = bench();
  const home = `${dir}-cli`;
  fs.mkdirSync(home, { recursive: true });
  const marker = path.join(home, 'HELPER-PID');
  const bin = path.join(home, 'grouped-claude');
  fs.writeFileSync(bin, `#!/bin/sh
sh -c 'echo $$ > "${marker}"; sleep 20' &
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
sleep 20
`, { mode: 0o755 });

  const r = await supervisor.start(db, project, 'x', { evidenceStore: store, bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true);
  await new Promise((res) => setTimeout(res, 400));
  const helper = Number(fs.readFileSync(marker, 'utf8').trim());
  assert.ok(helper > 0, 'the fixture did not record its helper');

  supervisor.cancel(db, r.workId);
  await new Promise((res) => setTimeout(res, 1500));
  let helperAlive = true;
  try { process.kill(helper, 0); } catch { helperAlive = false; }
  assert.strictEqual(helperAlive, false,
    'the helper survived the cancel — the signal went to the shell, not to the process group');
  await r.done;
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
  supervisor.live.get(r.workId).bin = retryBin;
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
  const bin = cli(dir, [INIT, { type: 'system', subtype: 'init', session_id: 's', cwd: '/p' }]);
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
  const bin = path.join(dir, 'stubborn-claude');
  fs.writeFileSync(bin, `#!/bin/sh
trap "" TERM
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
sleep 20
`, { mode: 0o755 });
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
  const bin = path.join(dir, 'stubborn-claude');
  fs.writeFileSync(bin, `#!/bin/sh
trap "" TERM
echo '{"type":"system","subtype":"init","session_id":"s","cwd":"/p"}'
sleep 20
`, { mode: 0o755 });
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
  assert.strictEqual(spec, 'Edit(//etc/hosts)');
  /* The raw input and the grant do NOT read the same — which is exactly why the card must
   * carry the grant. */
  assert.notStrictEqual(denial.input.file_path, spec);

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
