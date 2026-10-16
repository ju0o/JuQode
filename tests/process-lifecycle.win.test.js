'use strict';
/* V1-404 · cancel / exit / restart regressions on WINDOWS, FIXTURE level -- the counterpart of
 * process-lifecycle.test.js, whose 11 POSIX cases are (rightly) skipped on Windows.
 *
 * Real Windows processes: a fake CLI behind an npm-shim-shaped `.cmd` (so the owned root is cmd.exe,
 * exactly as it is for an npm-installed `claude.cmd`), a node.exe under it, descendants of that, and
 * unrelated bystander processes. It does NOT stand in for Ubuntu 24.04, WSLg, or a Windows machine other
 * than the one it ran on, and it is not V1-404's acceptance: a native `claude.exe` as the owned root,
 * job objects and real Claude descendants are still unmeasured.
 *
 * What it asserts is the product's own rule: the owned handle is the only thing JuQode may end; an exit
 * of the root proves nothing about its descendants; so a cancel ends as `ended_unknown`, the project
 * slot stays held until a person acknowledges, user data and evidence are preserved, and nothing
 * outside the fixture is touched.
 *
 * Teardown follows the same rule: a process is ended only through an owned handle or after its
 * identity (pid + creation time) is read again and is unchanged. No pattern kills, no process groups. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const session = require(path.join(R, 'app/main/claude/session.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));

const WIN = process.platform === 'win32';
const winTest = (name, fn) => test(name, { skip: !WIN && 'Windows-only: real Windows process trees (taskkill, CIM identity, cmd.exe shim); the POSIX counterpart is process-lifecycle.test.js' }, fn);

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });
const dirs = [];
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

/* OWNERSHIP. Everything this file starts is registered with its identity at the moment it is first seen;
 * teardown ends a pid only if that identity is still the same. */
const owned = [];                                              // { pid, id: { start, cmd } }
const ownedHandles = [];
const ownPid = (pid) => { const id = fake.processIdentity(pid); if (id) owned.push({ pid, id }); return pid; };
const ownHandle = (h) => { ownedHandles.push(h); ownPid(h.pid); return h; };
test.after(() => {
  for (const h of ownedHandles) { try { if (h.exitCode === null && h.signalCode === null) h.kill('SIGKILL'); } catch { /* gone */ } }
  for (const { pid, id } of owned) {
    const now = fake.processIdentity(pid);
    if (now && now.start === id.start) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  fake.reapProcessesUnder(dirs, { handles: [...supervisor.live.values()].map((e) => e.child).filter(Boolean) });
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy or gone */ } }
});

/* fast stop timings, as the POSIX suite does */
const realStop = session.stop;
session.stop = (child, o = {}) => realStop(child, { ...o, graceMs: 500, confirmMs: 150 });

function bench() {
  const dir = tmp('juqode-wlife-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, path.basename(dir));
  return { dir, db, project, store: tmp('juqode-wlife-store-') };
}

/* The fake CLI: changes a file, starts `children` descendants (every second one has a child of its own),
 * reports every pid it created, answers its init, then idles. Windows cannot ignore a terminate, so
 * nothing here pretends to. */
function wslCli(b, { children = 1 } = {}) {
  const home = `${b.dir}-cli`; dirs.push(home);
  const marker = path.join(home, 'PIDS.json');
  const bin = fake.scriptBin(home, 'win-fixture', `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
fs.writeFileSync(${JSON.stringify(path.join(b.dir, 'a.txt'))}, 'changed-by-the-run\\n');
const kids = [], grand = [];
for (let n = 0; n < ${Number(children)}; n++) {
  const own = n % 2
    ? "const g = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', " + JSON.stringify(${JSON.stringify(b.dir)}) + "], { stdio: 'ignore' }); require('node:fs').appendFileSync(" + JSON.stringify(${JSON.stringify(marker)} + '.gc') + ", g.pid + '\\\\n'); setInterval(() => {}, 1000)"
    : "setInterval(() => {}, 1000)";
  kids.push(spawn(process.execPath, ['-e', own, ${JSON.stringify(b.dir)}], { stdio: 'ignore' }).pid);
}
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ node: process.pid, kids }));
init();
setInterval(() => {}, 1000);
`);
  return { bin, marker };
}

async function startFixture(b, opts = {}) {
  const cli = wslCli(b, opts);
  const task = repo.createTask(b.db, b.project.id, { goal: 'windows lifecycle regression' });
  const r = await supervisor.start(b.db, b.project, 'a.txt 바꿔줘', { evidenceStore: b.store, bin: cli.bin, detect: AVAILABLE, taskId: task.id, idempotencyKey: `k-${task.id}` });
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(await until(() => fs.existsSync(cli.marker) && fs.readFileSync(cli.marker, 'utf8').trim().endsWith('}')), 'the fixture never reported its pids');
  const { node, kids } = JSON.parse(fs.readFileSync(cli.marker, 'utf8'));
  const gcFile = `${cli.marker}.gc`;
  const wantGc = Math.floor((opts.children ?? 1) / 2);
  assert.ok(await until(() => wantGc === 0 || (fs.existsSync(gcFile) && fs.readFileSync(gcFile, 'utf8').split(/\r?\n/).filter(Boolean).length >= wantGc)), 'grandchildren never reported');
  const grand = wantGc ? fs.readFileSync(gcFile, 'utf8').split(/\r?\n/).filter(Boolean).map(Number) : [];
  const entry = supervisor.live.get(r.workId);
  const root = ownHandle(entry.child);                               // the OWNED root: cmd.exe, the shim
  [node, ...kids, ...grand].forEach(ownPid);
  await new Promise((res) => setTimeout(res, 200));
  return { r, task, root, node, kids, grand, entry, all: [node, ...kids, ...grand] };
}

const bystander = (marker) => ownHandle(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', marker], { stdio: 'ignore' }));
const ok = (dir) => { const f = path.join(tmp('juqode-wlife-ok-'), 'ok.cmd'); fs.writeFileSync(f, '@echo off\r\nexit /b 0\r\n'); return f; };

winTest('the owned root is the cmd.exe shim; cancel is a REQUEST and ends only that root, so the node.exe and its descendants are reported as possibly alive: ended_unknown', async () => {
  const b = bench();
  const by = bystander(path.join(b.dir, 'user-process'));
  const fx = await startFixture(b, { children: 2 });
  assert.ok(fx.all.every(alive), 'precondition: the whole fixture tree is running');
  assert.notStrictEqual(fx.root.pid, fx.node, 'precondition: the owned root is the shim wrapper, not the node.exe under it');
  const before = 'one\n';
  assert.notStrictEqual(fs.readFileSync(path.join(b.dir, 'a.txt'), 'utf8'), before, 'precondition: the run changed a file');

  assert.deepStrictEqual(supervisor.cancel(b.db, fx.r.workId), { ok: true });
  assert.strictEqual(repo.getWork(b.db, fx.r.workId).status, 'cancel_requested', 'a request was reported as an outcome');
  assert.ok(await until(() => repo.getWork(b.db, fx.r.workId).status === 'ended', 10000), 'the Work never left cancel_requested');
  const w = repo.getWork(b.db, fx.r.workId);
  assert.strictEqual(w.outcome, 'ended_unknown', `reported ${w.outcome}`);
  assert.ok(!repo.signalsFor(b.db, fx.r.workId).some((s) => s.kind === 'cancel_confirmed'), 'a cancel was confirmed with no proof of the tree');

  assert.ok(await until(() => !alive(fx.root.pid)), 'the owned root should be gone');
  assert.ok(fx.all.every(alive), `JuQode ended something beyond its owned handle: ${fx.all.filter((p) => !alive(p))}`);
  assert.strictEqual(session.processTreeMayBeAlive(fx.root.pid), true, 'live descendants of a dead root were reported gone');
  assert.ok(alive(by.pid), 'an unrelated user process was ended');
  assert.strictEqual(fs.readFileSync(path.join(b.dir, 'a.txt'), 'utf8'), 'changed-by-the-run\n');
  assert.deepStrictEqual(supervisor.changes(b.db, fx.r.workId, b.project, b.store).files, ['a.txt'], 'the measured change was lost');
  assert.ok(repo.getWork(b.db, fx.r.workId).failure_reason, 'no typed reason for the unknown end');
});

winTest('while the end is unknown the project slot stays held even though the root is gone; a person\'s acknowledgement releases it', async () => {
  const b = bench();
  const fx = await startFixture(b);
  supervisor.cancel(b.db, fx.r.workId);
  assert.ok(await until(() => repo.getWork(b.db, fx.r.workId).status === 'ended', 10000));
  assert.ok(await until(() => !alive(fx.root.pid)));
  assert.ok(fx.all.every(alive));

  const refused = await supervisor.start(b.db, b.project, 'second writer', { evidenceStore: b.store, bin: ok(b.dir), detect: AVAILABLE });
  assert.deepStrictEqual([refused.ok, refused.reason], [false, 'prior-process-may-still-live'], 'a second writer was admitted');
  assert.deepStrictEqual(repo.acknowledgeUnknownProcessStopped(b.db, b.project.id, fx.r.workId), { ok: true, existing: false });
  const next = await supervisor.start(b.db, b.project, 'after acknowledgement', { evidenceStore: b.store, bin: ok(b.dir), detect: AVAILABLE });
  assert.notStrictEqual(next.reason, 'prior-process-may-still-live');
  if (next.ok) { ownHandle(supervisor.live.get(next.workId)?.child ?? { pid: 0, exitCode: 0, signalCode: null, kill() {} }); await next.done; }
});

winTest('duplicate cancels end the owned root once, change nothing afterwards, and an ended Work cannot be cancelled again', async () => {
  const b = bench();
  const fx = await startFixture(b);
  const sent = [];
  const realKill = fx.root.kill.bind(fx.root);
  fx.root.kill = (sig) => { sent.push(sig); return realKill(sig); };
  const results = [supervisor.cancel(b.db, fx.r.workId), supervisor.cancel(b.db, fx.r.workId), supervisor.cancel(b.db, fx.r.workId)];
  assert.ok(results.every((x) => x.ok), 'a duplicate cancel was refused as an error');
  assert.ok(await until(() => repo.getWork(b.db, fx.r.workId).status === 'ended', 10000));
  assert.strictEqual(sent.length, 1, `the owned root was signalled ${sent.length} times: ${sent}`);
  assert.strictEqual(repo.getWork(b.db, fx.r.workId).outcome, 'ended_unknown');
  const again = supervisor.cancel(b.db, fx.r.workId);
  assert.deepStrictEqual([again.ok, again.reason], [false, 'ended']);
});

winTest('restart: the live handle is lost while the processes survive -> ended_unknown, a late exit of the old root cannot rewrite it, data unchanged, no new writer', async () => {
  const b = bench();
  const fx = await startFixture(b, { children: 2 });
  const hash = sha(path.join(b.dir, 'a.txt'));
  supervisor.cancel(b.db, fx.r.workId);                               // the stop is on its way, nothing observed yet
  supervisor.live.delete(fx.r.workId);                                // "the app died"
  assert.deepStrictEqual(repo.reconcileLostWorks(b.db, () => true), [fx.r.workId], 'a Task Run without its stream stayed running');
  const w0 = repo.getWork(b.db, fx.r.workId);
  assert.deepStrictEqual([w0.status, w0.outcome], ['ended', 'ended_unknown']);

  await until(() => !alive(fx.root.pid), 10000);                      // the old root finally goes
  await new Promise((res) => setTimeout(res, 600));                   // …and any late handlers run
  const after = repo.getWork(b.db, fx.r.workId);
  assert.deepStrictEqual([after.status, after.outcome], ['ended', 'ended_unknown'], 'a late exit rewrote the end of a recovered Work');
  assert.ok(!repo.signalsFor(b.db, fx.r.workId).some((x) => x.kind === 'cancel_confirmed'));
  assert.strictEqual(sha(path.join(b.dir, 'a.txt')), hash, 'user data changed during recovery');
  assert.ok(fx.all.every(alive), 'recovery ended a descendant it does not own');
  const blocked = await supervisor.start(b.db, b.project, 'new writer', { evidenceStore: b.store, bin: ok(b.dir), detect: AVAILABLE });
  assert.strictEqual(blocked.reason, 'prior-process-may-still-live');
});

winTest('PID reuse: a Work whose recorded runner pid now belongs to an unrelated process is never signalled by cancel or recovery', async () => {
  const b = bench();
  const by = bystander(path.join(b.dir, 'holds-a-recorded-pid'));
  const other = repo.openProject(b.db, tmp('juqode-wlife-p2-'), 'p2');
  const legacy = repo.beginWork(b.db, other.id, 'recovered work').work;
  repo.setRunnerIdentity(b.db, legacy.id, 'old-session', by.pid, new Date().toISOString());
  const cancelled = supervisor.cancel(b.db, legacy.id);
  assert.strictEqual(cancelled.ok, true);
  assert.strictEqual(repo.getWork(b.db, legacy.id).outcome, 'ended_unknown', 'a missing handle is never proof of a cancel');
  repo.reconcileLostWorks(b.db);
  await new Promise((res) => setTimeout(res, 300));
  assert.ok(alive(by.pid), 'a process was ended only because it held a recorded pid');
  assert.strictEqual(by.exitCode, null);
});

winTest('several descendant trees: none is ended by JuQode, all stay possibly-alive, and the identity check sees the same processes after the cancel', async () => {
  const b = bench();
  const fx = await startFixture(b, { children: 4 });
  const idsBefore = fx.all.map((p) => fake.processIdentity(p));
  assert.ok(idsBefore.every(Boolean), 'precondition: every member has a readable identity');
  assert.ok(fx.grand.length >= 2, 'precondition: the tree is two levels deep');
  supervisor.cancel(b.db, fx.r.workId);
  assert.ok(await until(() => repo.getWork(b.db, fx.r.workId).status === 'ended', 10000));
  assert.ok(await until(() => !alive(fx.root.pid)));
  fx.all.forEach((pid, i) => {
    assert.ok(alive(pid), `descendant ${pid} was ended by JuQode`);
    assert.strictEqual(fake.processIdentity(pid)?.start, idsBefore[i].start, `${pid} is a different process now`);
  });
  assert.strictEqual(repo.getWork(b.db, fx.r.workId).outcome, 'ended_unknown');
  assert.deepStrictEqual(supervisor.changes(b.db, fx.r.workId, b.project, b.store).files, ['a.txt']);
  assert.strictEqual((await supervisor.start(b.db, b.project, 'x', { evidenceStore: b.store, bin: ok(b.dir), detect: AVAILABLE })).reason, 'prior-process-may-still-live');
});

winTest('the identity reader tells a live process from a recycled/exited one (the basis of every ownership check here)', async () => {
  const dir = tmp('juqode-wlife-id-');
  const p = ownHandle(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', path.join(dir, 'x')], { stdio: 'ignore' }));
  const id = fake.processIdentity(p.pid);
  assert.ok(id && id.start && id.cmd.includes(path.join(dir, 'x')), JSON.stringify(id));
  p.kill();
  await new Promise((res) => p.once('exit', res));
  assert.strictEqual(fake.processIdentity(p.pid), null, 'an exited pid still answers');
  // a recorded identity whose start differs is not "ours": the reaper must skip it
  const sent = [];
  const by = bystander(path.join(dir, 'bystander'));
  const r = fake.reapProcessesUnder([dir], { discover: () => [{ pid: by.pid, start: 'someone-elses-start', cmd: path.join(dir, 'looks-ours') }], kill: (pid) => sent.push(pid) });
  assert.deepStrictEqual([r.pids, sent], [[], []]);
  assert.ok(alive(by.pid));
});
