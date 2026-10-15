/* V1-404 · cancel / exit / restart regressions for the Claude process, FIXTURE level.
 *
 * Real OS processes (a script standing in for the CLI, plus real descendants and real decoys),
 * but ONE host: Ubuntu 26.04 native. This does NOT stand in for Windows process trees, Ubuntu
 * 24.04 native or WSLg — those are V1-404's own acceptance and stay unmeasured here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const session = require(path.join(R, 'app/main/claude/session.js'));

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });
const dirs = [];
const posix = process.platform !== 'win32';
/* These cases need /bin/sh, POSIX process groups and /proc. They are NOT run on Windows; the
 * Windows process-tree variants of V1-404 are a separate, unwritten host-specific suite. */
const posixTest = (name, fn) => test(name, { skip: !posix && 'POSIX-only (needs /bin/sh, process groups, /proc); Windows tree tests are a separate H1 suite' }, fn);

const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

/* TEARDOWN OWNERSHIP. A bare pid is not an identity (07 §8.5): after a process exits its number
 * can be handed to an unrelated one. So the test records each process it CREATED together with
 * its kernel start time (/proc/<pid>/stat field 22) and, at teardown, signals that exact pid only
 * while the start time still matches. Never a negative pid / process group, never a process whose
 * identity cannot be read (non-Linux: nothing is signalled), never a pid nobody here created. */
function startTimeOf(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;     // field 22 = starttime
  } catch { return null; }
}
function makeReaper(kill = process.kill) {
  const owned = new Map();
  let done = false;
  return {
    own(pid, start = startTimeOf(pid)) { if (Number.isInteger(pid) && pid > 1) owned.set(pid, start); return pid; },
    reap() {
      if (done) return [];
      done = true;
      const signalled = [];
      for (const [pid, start] of owned) {
        if (start === null || startTimeOf(pid) !== start) continue;           // gone, recycled, or unverifiable
        try { kill(pid, 'SIGKILL'); signalled.push(pid); } catch { /* gone */ }
      }
      return signalled;
    },
  };
}
const reaper = makeReaper();
const own = (pid) => reaper.own(pid);
/* ONE teardown, registered once. Descendants hold the event loop open, so it must run. */
test.after(() => reaper.reap());

/* fast stop timings, as the existing cancel tests do */
const realStop = session.stop;
session.stop = (child, o = {}) => realStop(child, { ...o, graceMs: 500, confirmMs: 150 });

function bench() {
  const dir = tmp('juqode-life-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, path.basename(dir));
  return { dir, db, project, store: tmp('juqode-life-store-') };
}

/* A CLI that writes a file at once, spawns a descendant that ignores SIGTERM, ignores SIGTERM
 * itself (unless `rootExits`), reports its descendant's pid, and then idles. */
function stubbornCli(dir, { rootExits = false, children = 1 } = {}) {
  const home = `${dir}-cli`; fs.mkdirSync(home, { recursive: true }); dirs.push(home);
  const marker = path.join(home, 'HELPER-PID');
  const bin = path.join(home, 'stubborn');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const { spawn } = require('node:child_process');
fs.writeFileSync(${JSON.stringify(path.join(dir, 'a.txt'))}, 'changed-by-the-run\\n');
const helpers = [];
for (let n = 0; n < ${Number(children)}; n++) {
  /* every other helper has its own child, so the tree is two levels deep */
  const code = n % 2 ? "const g = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); require('node:fs').appendFileSync(" + JSON.stringify(${JSON.stringify(marker)} + '.gc') + ", g.pid + '\\\\n'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
                     : "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
  helpers.push(spawn(process.execPath, ['-e', code], { stdio: 'ignore' }).pid);
}
fs.writeFileSync(${JSON.stringify(marker)}, helpers.join('\\n'));
const a = process.argv, i = Math.max(a.indexOf('--session-id'), a.indexOf('--resume'));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: a[i + 1], cwd: process.cwd() }) + '\\n');
${rootExits ? "process.on('SIGTERM', () => process.exit(0));" : "process.on('SIGTERM', () => {});"}
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  return { bin, marker };
}

async function startStubborn(b, opts = {}) {
  const cliBin = stubbornCli(b.dir, opts);
  const extra = opts.task ? (() => { const t = repo.createTask(b.db, b.project.id, { goal: 'restart regression' }); return { taskId: t.id, idempotencyKey: `k-${t.id}` }; })() : {};
  const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, bin: cliBin.bin, detect: AVAILABLE, ...extra });
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(await until(() => fs.existsSync(cliBin.marker)), 'the fixture never reported its descendant');
  const helpers = fs.readFileSync(cliBin.marker, 'utf8').split('\n').map(Number);
  const helper = helpers[0];
  helpers.forEach((pid) => own(pid));
  /* grandchildren report themselves too, so every process the fixture creates is owned */
  const gcLines = () => (fs.existsSync(`${cliBin.marker}.gc`) ? fs.readFileSync(`${cliBin.marker}.gc`, 'utf8').split('\n').filter(Boolean) : []);
  const wantGc = Math.floor((opts.children ?? 1) / 2);               // every second helper has a child
  assert.ok(await until(() => gcLines().length >= wantGc, 8000), 'a grandchild never reported itself, so it could not be owned');
  gcLines().forEach((pid) => own(Number(pid)));
  const entry = supervisor.live.get(r.workId);
  own(entry.child.pid);
  await new Promise((res) => setTimeout(res, 150));     // let the descendant install its handler
  return { r, helper, helpers, root: entry.child.pid, entry };
}

posixTest('cancel is a REQUEST: the Work is not cancelled until an exit is observed, and a surviving descendant makes it ended_unknown', async () => {
  const b = bench();
  const before = 'one\n';
  const { r, helper, root } = await startStubborn(b);
  assert.notStrictEqual(fs.readFileSync(path.join(b.dir, 'a.txt'), 'utf8'), before, 'fixture precondition: the run changed a file');

  assert.deepStrictEqual(supervisor.cancel(b.db, r.workId), { ok: true });
  assert.strictEqual(repo.getWork(b.db, r.workId).status, 'cancel_requested', 'a request was reported as an outcome');
  assert.ok(alive(root), 'the root was assumed gone at request time');

  assert.ok(await until(() => repo.getWork(b.db, r.workId).status === 'ended', 6000), 'the Work never left cancel_requested');
  const w = repo.getWork(b.db, r.workId);
  assert.strictEqual(w.outcome, 'ended_unknown', `the stubborn root + descendant were reported as ${w.outcome}`);
  assert.ok(alive(helper), 'precondition: the descendant really survived the stop');
  assert.ok(!repo.signalsFor(b.db, r.workId).some((s) => s.kind === 'cancel_confirmed'), 'a cancel was confirmed with no proof');

  /* evidence of the early file change is preserved, not discarded with the cancel */
  assert.strictEqual(fs.readFileSync(path.join(b.dir, 'a.txt'), 'utf8'), 'changed-by-the-run\n');
  const changed = supervisor.changes(b.db, r.workId, b.project, b.store);
  assert.deepStrictEqual(changed.files, ['a.txt'], 'the measured change was lost');
  assert.ok(repo.getWork(b.db, r.workId).failure_reason, 'no typed reason for the unknown end');
});

posixTest('while the end is unknown the project slot stays held, even after the root pid is gone, until a person acknowledges', async () => {
  const b = bench();
  const { r, helper, root } = await startStubborn(b, { rootExits: true });
  supervisor.cancel(b.db, r.workId);
  assert.ok(await until(() => repo.getWork(b.db, r.workId).status === 'ended', 6000));
  assert.strictEqual(repo.getWork(b.db, r.workId).outcome, 'ended_unknown');
  assert.ok(await until(() => !alive(root)), 'precondition: the ROOT exited');
  assert.ok(alive(helper), 'precondition: its descendant did not');

  const fine = tmp('juqode-life-ok-');
  const okBin = path.join(fine, 'ok'); fs.writeFileSync(okBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const refused = await supervisor.start(b.db, b.project, 'second writer', { evidenceStore: b.store, bin: okBin, detect: AVAILABLE });
  assert.deepStrictEqual([refused.ok, refused.reason], [false, 'prior-process-may-still-live'], 'a second writer was admitted');
  assert.strictEqual(refused.detail.workId, r.workId);

  assert.deepStrictEqual(repo.acknowledgeUnknownProcessStopped(b.db, b.project.id, r.workId), { ok: true, existing: false });
  const next = await supervisor.start(b.db, b.project, 'after acknowledgement', { evidenceStore: b.store, bin: okBin, detect: AVAILABLE });
  assert.notStrictEqual(next.reason, 'prior-process-may-still-live', 'acknowledgement did not release the slot');
});

posixTest('duplicate cancels do not signal twice, double-record, or change the outcome', async () => {
  const b = bench();
  const { r } = await startStubborn(b);
  const sent = [];
  const kill = supervisor.live.get(r.workId).child.kill.bind(supervisor.live.get(r.workId).child);
  supervisor.live.get(r.workId).child.kill = (sig) => { sent.push(sig); return kill(sig); };
  const results = [supervisor.cancel(b.db, r.workId), supervisor.cancel(b.db, r.workId), supervisor.cancel(b.db, r.workId)];
  assert.ok(results.every((x) => x.ok), 'a duplicate cancel was refused as an error');
  assert.ok(await until(() => repo.getWork(b.db, r.workId).status === 'ended', 6000));
  assert.deepStrictEqual(sent, ['SIGTERM', 'SIGKILL'], `signals sent: ${sent}`);
  assert.strictEqual(repo.getWork(b.db, r.workId).outcome, 'ended_unknown');
  const again = supervisor.cancel(b.db, r.workId);
  assert.deepStrictEqual([again.ok, again.reason], [false, 'ended'], 'an ended Work was cancelled again');
});

posixTest('cancel and recovery never touch an unrelated process, including one that holds a recorded pid', async () => {
  const b = bench();
  /* an unrelated, long-lived "CLI daemon": its own session, same cwd, a claude-like name */
  const decoyBin = path.join(tmp('juqode-decoy-'), 'claude-daemon');
  fs.writeFileSync(decoyBin, `#!${process.execPath}\nsetInterval(() => {}, 1000)\n`, { mode: 0o755 });
  const decoy = spawn(decoyBin, ['serve'], { cwd: b.dir, detached: true, stdio: 'ignore' });
  decoy.unref(); own(decoy.pid);

  const { r } = await startStubborn(b);
  supervisor.cancel(b.db, r.workId);
  assert.ok(await until(() => repo.getWork(b.db, r.workId).status === 'ended', 6000));
  assert.ok(alive(decoy.pid), 'cancelling a Work killed an unrelated daemon');

  /* PID reuse: a Work whose recorded runner pid now belongs to the decoy. Neither cancel without
   * a handle nor startup reconciliation may signal it — a pid alone is not identity (07 §8.5). */
  const legacy = repo.beginWork(b.db, tmp('x') && repo.openProject(b.db, tmp('juqode-life2-'), 'p2').id, 'recovered').work;
  repo.setRunnerIdentity(b.db, legacy.id, 'old', decoy.pid, new Date().toISOString());
  assert.strictEqual(supervisor.cancel(b.db, legacy.id).ok, true);
  assert.strictEqual(repo.getWork(b.db, legacy.id).outcome, 'ended_unknown');
  repo.reconcileLostWorks(b.db);
  assert.ok(alive(decoy.pid), 'recovery signalled a process only because it held a recorded pid');
});

posixTest('restart: a Work whose process survived the app is ended_unknown, keeps its evidence, and blocks a new writer', async () => {
  const b = bench();
  const { r, helper } = await startStubborn(b, { task: true });
  const hash = sha(path.join(b.dir, 'a.txt'));
  /* "the app died": the in-memory handle is gone, the child and its descendant are not */
  supervisor.live.delete(r.workId);
  assert.deepStrictEqual(repo.reconcileLostWorks(b.db, () => true), [r.workId], 'a Task Run without its stream stayed running');
  const w = repo.getWork(b.db, r.workId);
  assert.deepStrictEqual([w.status, w.outcome], ['ended', 'ended_unknown']);
  assert.ok(alive(helper), 'precondition: the survivor is still running');
  assert.strictEqual(sha(path.join(b.dir, 'a.txt')), hash, 'recovery rewrote user data');
  assert.ok(repo.signalsFor(b.db, r.workId).length >= 1, 'the recorded stream was lost');
  const ok = path.join(tmp('juqode-life-ok-'), 'ok'); fs.writeFileSync(ok, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const blocked = await supervisor.start(b.db, b.project, 'new writer', { evidenceStore: b.store, bin: ok, detect: AVAILABLE });
  assert.strictEqual(blocked.reason, 'prior-process-may-still-live');
});

posixTest('group/pid reuse: stopping signals only the owned handle, never a numeric pid or group', async () => {
  assert.deepStrictEqual(session.killPlan('linux', 4242, false), { kind: 'child', signal: 'SIGTERM' });
  assert.deepStrictEqual(session.killPlan('win32', 4242, true), { kind: 'child', signal: 'SIGKILL' });

  const realKill = process.kill;
  const numeric = [];
  process.kill = (pid, sig) => { if (sig !== 0 && sig !== undefined) numeric.push([pid, sig]); return realKill(pid, sig); };
  try {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: true, stdio: 'ignore' });
    own(child.pid);
    await new Promise((res) => setTimeout(res, 150));
    await new Promise((res) => realStop(child, { graceMs: 200, confirmMs: 100, onUnconfirmed: res }));
    assert.deepStrictEqual(numeric, [], `stop() signalled by numeric pid/group: ${JSON.stringify(numeric)}`);
  } finally { process.kill = realKill; }
});

posixTest('a live group after the root is gone is reported as MAY BE ALIVE, a dead one is not', async () => {
  const home = tmp('juqode-grp-');
  const pidFile = path.join(home, 'GRANDCHILD-PID');
  const root = spawn('/bin/sh', ['-c', `${process.execPath} -e "setInterval(()=>{},1000)" & echo $! > ${pidFile}; wait`], { detached: true, stdio: 'ignore' });
  own(root.pid);
  assert.ok(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim()), 'the grandchild never reported');
  const grandchild = own(Number(fs.readFileSync(pidFile, 'utf8')));      // also in the global teardown
  root.kill('SIGKILL');
  await new Promise((res) => root.once('exit', res));
  assert.strictEqual(session.processTreeMayBeAlive(root.pid), true, 'the root exited, its group did not');
  /* end the survivor by ITS OWN pid, with the same ownership check teardown uses */
  const local = makeReaper();                       // NOT the global teardown, which must still run at the end
  local.own(grandchild);
  assert.deepStrictEqual(local.reap(), [grandchild], 'the owned grandchild was not reaped');
  assert.ok(await until(() => !session.processTreeMayBeAlive(root.pid)), 'a dead group is still reported alive');
  assert.strictEqual(session.processTreeMayBeAlive(NaN), true, 'an unusable pid must be treated as unknown');
});

/* ───────────── the teardown itself is held to the same rule ───────────── */

posixTest('teardown signals only processes it created and can still identify', async () => {
  const mk = () => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const mine = mk(), bystander = mk(), recycled = mk();
  const sent = [];
  const r = makeReaper((pid, sig) => { sent.push([pid, sig]); return process.kill(pid, sig); });
  try {
    await new Promise((res) => setTimeout(res, 150));
    r.own(mine.pid);
    /* an entry whose recorded start time no longer matches = the pid was recycled to someone else */
    r.own(recycled.pid, 'a-start-time-from-a-previous-owner');
    /* a process that is simply not registered, and one whose identity cannot be read at all */
    r.own(process.pid + 1_000_000, null);
    const out = r.reap();
    assert.deepStrictEqual(out, [mine.pid], `teardown signalled ${JSON.stringify(out)}`);
    assert.ok(sent.every(([pid, sig]) => pid > 1 && sig === 'SIGKILL'), 'a negative pid / group signal was sent');
    assert.ok(await until(() => !alive(mine.pid)), 'its own process survived teardown');
    assert.ok(alive(bystander.pid), 'an unregistered process was killed');
    assert.ok(alive(recycled.pid), 'a recycled pid was killed on the strength of its number');
    assert.deepStrictEqual(r.reap(), [], 'teardown is not idempotent');
    assert.strictEqual(sent.length, 1);
  } finally { bystander.kill('SIGKILL'); recycled.kill('SIGKILL'); mine.kill('SIGKILL'); }
});

posixTest('a pid that exits and is not recycled is simply skipped; start time is read from the kernel', async () => {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await new Promise((res) => setTimeout(res, 100));
  const t = startTimeOf(c.pid);
  assert.match(t, /^\d+$/);
  const r = makeReaper();
  r.own(c.pid);
  c.kill('SIGKILL');
  await new Promise((res) => c.once('exit', res));
  assert.strictEqual(startTimeOf(c.pid), null, 'a reaped pid still answers');
  assert.deepStrictEqual(r.reap(), [], 'a dead process was signalled');
});

posixTest('the app dies right after the stop signal: the late exit of the old child cannot rewrite the recorded end', async () => {
  const b = bench();
  const { r, root, helper } = await startStubborn(b, { task: true, rootExits: true });
  const child = supervisor.live.get(r.workId).child;
  supervisor.cancel(b.db, r.workId);                       // SIGTERM is on its way; nothing observed yet
  /* "crash": the in-memory state vanishes before the exit is seen, then startup reconciliation */
  supervisor.live.delete(r.workId);
  assert.deepStrictEqual(repo.reconcileLostWorks(b.db, () => true), [r.workId]);
  const frozen = JSON.stringify(repo.getWork(b.db, r.workId));
  const hash = sha(path.join(b.dir, 'a.txt'));
  assert.deepStrictEqual([repo.getWork(b.db, r.workId).status, repo.getWork(b.db, r.workId).outcome], ['ended', 'ended_unknown']);

  await new Promise((res) => (child.exitCode !== null || child.signalCode ? res() : child.once('exit', res)));   // the old child finally exits
  await new Promise((res) => setTimeout(res, 600));                                                              // …and any late handlers run
  const after = repo.getWork(b.db, r.workId);
  assert.deepStrictEqual([after.status, after.outcome], ['ended', 'ended_unknown'], 'a late exit rewrote the end of a recovered Work');
  assert.strictEqual(sha(path.join(b.dir, 'a.txt')), hash, 'user data changed during recovery');
  assert.ok(!repo.signalsFor(b.db, r.workId).some((x) => x.kind === 'cancel_confirmed'), 'the late exit was read as a confirmed cancel');
  assert.ok(alive(helper), 'precondition: the descendant outlived the app');
  assert.ok(!alive(root), 'precondition: the root did exit');
  /* and the project still has no safe writer until a person says so */
  const ok = path.join(tmp('juqode-life-ok-'), 'ok'); fs.writeFileSync(ok, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.strictEqual((await supervisor.start(b.db, b.project, 'x', { evidenceStore: b.store, bin: ok, detect: AVAILABLE })).reason, 'prior-process-may-still-live');
  assert.ok(frozen.includes('ended_unknown'));
});

posixTest('several descendant trees: none is signalled by JuQode, all are reported as possibly alive, the slot stays held', async () => {
  const b = bench();
  const { r, helpers, root } = await startStubborn(b, { children: 4, rootExits: true });
  assert.strictEqual(helpers.length, 4);
  const starts = helpers.map((pid) => startTimeOf(pid));
  supervisor.cancel(b.db, r.workId);
  assert.ok(await until(() => repo.getWork(b.db, r.workId).status === 'ended', 6000));
  assert.ok(await until(() => !alive(root)), 'precondition: the root exited');
  assert.strictEqual(repo.getWork(b.db, r.workId).outcome, 'ended_unknown');
  for (const [i, pid] of helpers.entries()) {
    assert.ok(alive(pid), `descendant ${i} (${pid}) was killed by JuQode — it can only signal the root handle`);
    assert.strictEqual(startTimeOf(pid), starts[i], 'precondition: identity unchanged');
  }
  assert.strictEqual(session.processTreeMayBeAlive(root), true, 'a group with live members was reported gone');
  assert.deepStrictEqual(supervisor.changes(b.db, r.workId, b.project, b.store).files, ['a.txt']);
  const ok = path.join(tmp('juqode-life-ok-'), 'ok'); fs.writeFileSync(ok, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.strictEqual((await supervisor.start(b.db, b.project, 'x', { evidenceStore: b.store, bin: ok, detect: AVAILABLE })).reason, 'prior-process-may-still-live');
});
