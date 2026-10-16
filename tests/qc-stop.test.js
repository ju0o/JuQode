'use strict';
/* What a Quick Command Stop PROVES (app/main/qc/stopper.js).
 *
 * Pure/injected cases drive the Windows rules on any host with a fake owned handle and fake tools --
 * those are decision-logic tests, NOT a Windows run. The real-process cases at the bottom run the real
 * run.start on whatever host this is (H1: real taskkill and a real process tree). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const { createStopper, classifyEnd, treeOf } = require(path.join(R, 'app/main/qc/stopper.js'));
const run = require(path.join(R, 'app/main/qc/run.js'));
const WIN = process.platform === 'win32';

/** an owned handle that has not exited, with a recording kill() */
const handle = (extra = {}) => {
  const h = { pid: 4242, exitCode: null, signalCode: null, killed: 0, kill() { this.killed += 1; return extra.killReturns ?? true; }, ...extra };
  return h;
};
const tools = (o = {}) => {
  const calls = { tree: [], taskkill: [], survivors: [] };
  return { calls,
    tree: (pid) => { calls.tree.push(pid); return 'tree' in o ? o.tree : { root: { pid, created: '2026-01-01T00:00:00.0Z' }, descendants: [{ pid: 5001, created: '2026-01-01T00:00:01.0Z' }, { pid: 5002, created: '2026-01-01T00:00:02.0Z' }] }; },
    taskkill: (pid) => { calls.taskkill.push(pid); return o.taskkill ?? { status: 0, error: null }; },
    survivors: (m) => { calls.survivors.push(m.map((x) => x.pid)); if (o.survivorsThrows) throw new Error('boom'); return 'survivors' in o ? o.survivors : []; } };
};
const stopperFor = (child, t, windows = true) => createStopper({ child, windows, tools: t, now: () => 'T' });

test('Windows: taskkill succeeded and the whole observed tree is gone -> stopped, with the proof recorded', async () => {
  const child = handle(); const t = tools(); const s = stopperFor(child, t);
  assert.strictEqual(s.request(() => {}), true);
  const end = await s.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.root, end.stop.descendants], ['stopped', 'stopped-tree-observed', 'terminated-by-taskkill', 'none']);
  assert.deepStrictEqual(t.calls.taskkill, [4242], 'taskkill must address only the owned pid');
  assert.deepStrictEqual(t.calls.survivors, [[5001, 5002]]);
});

test('Windows: the run ended by itself BEFORE the request got in (handle already exited) -> its own result, never a stop', async () => {
  for (const [code, want] of [[0, 'ok'], [1, 'failed']]) {
    const child = handle({ exitCode: code }); const t = tools(); const s = stopperFor(child, t);
    assert.strictEqual(s.request(() => {}), false);
    const end = await s.finalize({ code, signal: null });
    assert.strictEqual(end.state, want, `exit ${code} after a late Stop was reported as ${end.state}`);
    assert.strictEqual(end.stop.verdict, 'ended-before-stop-took-effect');
    assert.deepStrictEqual(t.calls.taskkill, [], 'a pid that already exited was addressed');
  }
});

test('Windows: taskkill says "not found" (128): it ended by itself in the race -> failed/ok by its own code, NOT stopped', async () => {
  for (const [code, want] of [[1, 'failed'], [0, 'ok'], [7, 'failed']]) {
    const s = stopperFor(handle(), tools({ taskkill: { status: 128, error: null } }));
    s.request(() => {});
    const end = await s.finalize({ code, signal: null });
    assert.deepStrictEqual([end.state, end.stop.verdict], [want, 'ended-before-stop-took-effect'], `code ${code}`);
  }
});

test('Windows: taskkill FAILS -> the owned handle is asked to end it; a signal from that is a stop, no signal is not', async () => {
  const child = handle(); const s = stopperFor(child, tools({ taskkill: { status: 5, error: null } }));
  s.request(() => {});
  await s.whenIdle();
  assert.strictEqual(child.killed, 1, 'no handle fallback');
  assert.strictEqual((await s.finalize({ code: null, signal: 'SIGTERM' })).state, 'stopped');
});

test('Windows: taskkill=255 and the root gone is NOT a stop, NOT `failed` -> unknown, exit code and taskkill status kept (PM policy)', async () => {
  for (const status of [255, null]) {
    const dead = handle({ killReturns: false });
    const t = tools({ taskkill: { status, error: status === null ? 'ENOENT' : null }, survivors: [] });
    const s = stopperFor(dead, t);
    s.request(() => {});
    const end = await s.finalize({ code: 1, signal: null });
    assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.root], ['unknown', 'stop-unconfirmed', 'not-terminated'],
      'a failed stop that then exits non-zero must be neither stopped nor failed');
    assert.deepStrictEqual(end.stop.observedExit, { code: 1, signal: null }, 'the observed exit code is evidence');
    assert.strictEqual(end.stop.taskkill.status, status, 'the taskkill status is evidence');
    assert.strictEqual(end.stop.requested, true, 'the request is not erased');
    /* …and the root + tree were looked at again: nothing alive, so the Writer gate has nothing to hold on to */
    assert.deepStrictEqual([end.stop.descendants, end.stop.uncertain, end.stop.members], ['none', false, []]);
  }
});

test('Windows: taskkill=255 and something still alive (or unreadable) -> unknown AND uncertain, members named for the Writer gate', async () => {
  const alive = tools({ taskkill: { status: 255, error: null }, survivors: [{ pid: 5002, created: 'x' }] });
  const s = stopperFor(handle({ killReturns: false }), alive);
  s.request(() => {});
  const end = await s.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([end.state, end.stop.uncertain, end.stop.survivorPids], ['unknown', true, [5002]]);
  assert.deepStrictEqual(alive.calls.survivors, [[4242, 5001, 5002]], 'when nothing proved the kill, the ROOT is checked too');

  /* tree unreadable: only the root pid is known, and it is looked up by pid alone -- gone means gone */
  const noTree = tools({ taskkill: { status: 255, error: null }, tree: null });
  const s3 = stopperFor(handle({ killReturns: false }), noTree);
  s3.request(() => {});
  const e3 = await s3.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([e3.state, e3.stop.descendants, e3.stop.uncertain], ['unknown', 'none', false]);
  assert.deepStrictEqual(noTree.calls.survivors, [[4242]]);

  for (const o of [{ survivors: null }, { survivorsThrows: true }]) {
    const s2 = stopperFor(handle({ killReturns: false }), tools({ taskkill: { status: 255, error: null }, ...o }));
    s2.request(() => {});
    const e2 = await s2.finalize({ code: 1, signal: null });
    assert.deepStrictEqual([e2.state, e2.stop.descendants, e2.stop.uncertain], ['unknown', 'unverified', true], JSON.stringify(Object.keys(o)));
    assert.ok(Array.isArray(e2.stop.members) && e2.stop.members.length >= 1, 'the root pid is at least known');
  }
});

test('Windows: the root stopped but a descendant is still alive -> unknown (not stopped), the survivor named', async () => {
  const s = stopperFor(handle(), tools({ survivors: [{ pid: 5002, created: 'x' }] }));
  s.request(() => {});
  const end = await s.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.descendants, end.stop.survivorPids, end.stop.uncertain], ['unknown', 'root-stopped-descendants-alive', 'survivors', [5002], true]);
});

test('Windows: descendants that cannot be checked are unverified -> unknown, never stopped', async () => {
  for (const o of [{ tree: null }, { survivors: null }, { survivorsThrows: true }]) {
    const s = stopperFor(handle(), tools(o));
    s.request(() => {});
    const end = await s.finalize({ code: 1, signal: null });
    assert.deepStrictEqual([end.state, end.stop.verdict], ['unknown', 'root-stopped-descendants-unverified'], JSON.stringify(Object.keys(o)));
  }
});

test('Windows: taskkill says terminated but the process says it finished cleanly (exit 0) -> unknown, not stopped and not ok', async () => {
  const s = stopperFor(handle(), tools());
  s.request(() => {});
  const end = await s.finalize({ code: 0, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict], ['unknown', 'contradiction-exit-0']);
});

test('duplicate Stop does nothing new (also while the first is still in flight); a FAILED stop may be retried', async () => {
  const t = tools();
  const s = stopperFor(handle(), t);
  assert.strictEqual(s.request(() => {}), true);
  assert.strictEqual(s.request(() => {}), false, 'a second Stop while the first reads its snapshot started another attempt');
  await s.whenIdle();
  assert.strictEqual(s.request(() => {}), false);
  assert.deepStrictEqual(t.calls.taskkill, [4242], 'the second/third Stop ran taskkill again');

  const t2 = tools({ taskkill: { status: 5, error: null } });
  const s2 = stopperFor(handle({ killReturns: false }), t2);
  s2.request(() => {}); await s2.whenIdle(); s2.request(() => {}); await s2.whenIdle();
  assert.deepStrictEqual(t2.calls.taskkill, [4242, 4242], 'a failed stop could not be retried');
  assert.strictEqual(s2.evidence().attempts, 2);
});

test('POSIX: a signal proves the stop; a clean exit 0 after a request is still `ok` (a cancelled child can exit 0)', async () => {
  const sent = [];
  const s = stopperFor(handle(), tools(), false);
  s.request((c) => sent.push(c.pid)); s.request((c) => sent.push(c.pid));
  assert.deepStrictEqual(sent, [4242], 'duplicate POSIX Stop signalled twice');
  const end = await s.finalize({ code: null, signal: 'SIGTERM' });
  assert.deepStrictEqual([end.state, end.stop.verdict], ['stopped', 'stopped-by-signal']);

  const s2 = stopperFor(handle(), tools(), false); s2.request(() => {});
  const e2 = await s2.finalize({ code: 0, signal: null });
  assert.deepStrictEqual([e2.state, e2.stop.verdict], ['ok', 'requested-not-observed']);
});

test('no Stop requested: ok / failed by code, whatever the host', () => {
  for (const windows of [true, false]) {
    assert.strictEqual(classifyEnd({ windows, code: 0, signal: null, stop: { requested: false } }).state, 'ok');
    assert.strictEqual(classifyEnd({ windows, code: 2, signal: null, stop: { requested: false } }).state, 'failed');
  }
});

test('the process tree is read by pid AND creation time: a reused parent id cannot adopt an older process, unrelated processes are excluded', () => {
  const all = [
    { pid: 100, ppid: 1, created: '2026-01-01T00:00:10.0Z' },     // the root
    { pid: 200, ppid: 100, created: '2026-01-01T00:00:11.0Z' },   // child
    { pid: 300, ppid: 200, created: '2026-01-01T00:00:12.0Z' },   // grandchild
    { pid: 400, ppid: 100, created: '2026-01-01T00:00:05.0Z' },   // claims the root as parent but is OLDER: the id was reused
    { pid: 500, ppid: 1, created: '2026-01-01T00:00:13.0Z' },     // unrelated
  ];
  const t = treeOf(100, all);
  assert.deepStrictEqual(t.descendants.map((d) => d.pid).sort(), [200, 300]);
  assert.strictEqual(treeOf(999, all), null, 'a root that is not there has no tree');
  assert.strictEqual(treeOf(100, null), null);
});

/* ───────────── real processes through run.start (H1: real taskkill and a real tree) ───────────── */

const NODE = (js) => [process.execPath, '-e', js];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const dirs = [];
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } } });

test('real: Stop twice on a running command ends it as `stopped` with the proof, and a bystander is untouched', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-qcstop-'))); dirs.push(dir);
  const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', path.join(dir, 'bystander')], { stdio: 'ignore' });
  try {
    const pidFile = path.join(dir, 'tree.pids');
    /* root -> child -> grandchild, each idle; the grandchild records its pid */
    const grand = "require('fs').appendFileSync(" + JSON.stringify(pidFile) + ", process.pid + '\\n'); setInterval(()=>{},1000)";
    const child = "const {spawn}=require('child_process'); const g=spawn(process.execPath,['-e'," + JSON.stringify(grand) + "],{stdio:'ignore'}); require('fs').appendFileSync(" + JSON.stringify(pidFile) + ", process.pid + '\\n'); setInterval(()=>{},1000)";
    const root = "const {spawn}=require('child_process'); spawn(process.execPath,['-e'," + JSON.stringify(child) + "],{stdio:'ignore'}); setInterval(()=>{},1000)";
    const r = run.start({ argv: NODE(root), cwd: dir, kind: 'long_running' });
    assert.ok(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim().split(/\r?\n/).length >= 2), 'the fixture tree never came up');
    const members = fs.readFileSync(pidFile, 'utf8').trim().split(/\r?\n/).map(Number);
    r.stop(); r.stop();
    const out = await r.done;
    assert.strictEqual(out.stop.requested, true);
    assert.strictEqual(out.stop.attempts, 1, 'the second Stop ran again');
    if (WIN) {
      assert.deepStrictEqual([out.state, out.stop.verdict, out.stop.descendants], ['stopped', 'stopped-tree-observed', 'none'], JSON.stringify(out.stop));
      assert.strictEqual(out.stop.taskkill.status, 0);
      assert.ok(await until(() => members.every((p) => !alive(p))), 'a member of the tree survived taskkill /T');
    } else {
      assert.deepStrictEqual([out.state, out.stop.verdict], ['stopped', 'stopped-by-signal']);
    }
    assert.ok(alive(bystander.pid), 'an unrelated process was terminated');
    // the same Stop after the run is over changes nothing
    r.stop();
    assert.strictEqual(out.state, 'stopped');
  } finally {
    try { bystander.kill('SIGKILL'); } catch { /* gone */ }
  }
});

test('real: a command that finishes by itself and is then "stopped" is NOT reported as stopped', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-qcstop-'))); dirs.push(dir);
  const r = run.start({ argv: NODE('process.exit(0)'), cwd: dir });
  const out = await r.done;
  r.stop();
  assert.strictEqual(out.state, 'ok');
  assert.notStrictEqual(out.stop?.requested, true);
});

test('the Windows stop snapshot never blocks the event loop; a child that ends DURING it is not addressed by taskkill (pid reuse) and keeps its own result (the loaded-H1 qc.test.js mechanism)', async () => {
  /* The snapshot used to be a spawnSync of PowerShell: 0.5 s idle, ~2 s under 2x CPU load on H1 -- the Electron main
   * process could not even observe the child's exit meanwhile. Now it is awaited. Fake slow tool, real child. */
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 250)'], { stdio: 'ignore' });
  const ended = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const slow = tools({ taskkill: { status: 128, error: null } });
  const fastTree = slow.tree;
  slow.tree = async (pid) => { await new Promise((r) => setTimeout(r, 900)); return fastTree(pid); };
  const s = stopperFor(child, slow);
  let ticks = 0; const beat = setInterval(() => { ticks += 1; }, 50);
  s.request(() => {});
  const { code, signal } = await ended;                   // the exit IS observed while the snapshot is still being read
  assert.ok(ticks >= 3, `the event loop was blocked during the snapshot (${ticks} ticks)`);
  const end = await s.finalize({ code, signal });         // waits for the in-flight attempt
  clearInterval(beat);
  assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.root], ['ok', 'ended-before-stop-took-effect', 'exited-before-request']);
  assert.deepStrictEqual(slow.calls.taskkill, [], 'taskkill addressed a pid whose handle had already closed');
});

test('real (any host): run.start with a snapshot that is slow keeps the loop alive and still ends the command with `stopped`', { skip: !WIN && 'the Windows path needs taskkill' }, async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-qcstop-'))); dirs.push(dir);
  const r = run.start({ argv: NODE('setInterval(()=>{},1000)'), cwd: dir, kind: 'long_running' });
  await new Promise((x) => setTimeout(x, 400));
  let ticks = 0; const beat = setInterval(() => { ticks += 1; }, 20);
  r.stop();
  const out = await r.done;
  clearInterval(beat);
  assert.strictEqual(out.state, 'stopped', JSON.stringify(out.stop));
  assert.ok(ticks >= 5, `the main loop was starved while Stop read the process tree (${ticks} ticks)`);
});

test('real: stopNow (app quit) ends the command without waiting for any asynchronous snapshot', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-qcstop-'))); dirs.push(dir);
  const r = run.start({ argv: NODE('setInterval(()=>{},1000)'), cwd: dir, kind: 'long_running' });
  await new Promise((x) => setTimeout(x, 300));
  const pid = r.pid;
  r.stopNow();
  /* on Windows taskkill ran synchronously inside stopNow: the process is already gone when it returns */
  if (WIN) assert.ok(!alive(pid), 'quit left the command running');
  const out = await Promise.race([r.done, new Promise((x) => setTimeout(() => x(null), 8000))]);
  assert.ok(out, 'the command was still running after stopNow');
  assert.ok(await until(() => !alive(pid)), 'the process outlived stopNow');
});
