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

test('Windows: taskkill succeeded and the whole observed tree is gone -> stopped, with the proof recorded', () => {
  const child = handle(); const t = tools(); const s = stopperFor(child, t);
  assert.strictEqual(s.request(() => {}), true);
  const end = s.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.root, end.stop.descendants], ['stopped', 'stopped-tree-observed', 'terminated-by-taskkill', 'none']);
  assert.deepStrictEqual(t.calls.taskkill, [4242], 'taskkill must address only the owned pid');
  assert.deepStrictEqual(t.calls.survivors, [[5001, 5002]]);
});

test('Windows: the run ended by itself BEFORE the request got in (handle already exited) -> its own result, never a stop', () => {
  for (const [code, want] of [[0, 'ok'], [1, 'failed']]) {
    const child = handle({ exitCode: code }); const t = tools(); const s = stopperFor(child, t);
    assert.strictEqual(s.request(() => {}), false);
    const end = s.finalize({ code, signal: null });
    assert.strictEqual(end.state, want, `exit ${code} after a late Stop was reported as ${end.state}`);
    assert.strictEqual(end.stop.verdict, 'ended-before-stop-took-effect');
    assert.deepStrictEqual(t.calls.taskkill, [], 'a pid that already exited was addressed');
  }
});

test('Windows: taskkill says "not found" (128): it ended by itself in the race -> failed/ok by its own code, NOT stopped', () => {
  for (const [code, want] of [[1, 'failed'], [0, 'ok'], [7, 'failed']]) {
    const s = stopperFor(handle(), tools({ taskkill: { status: 128, error: null } }));
    s.request(() => {});
    const end = s.finalize({ code, signal: null });
    assert.deepStrictEqual([end.state, end.stop.verdict], [want, 'ended-before-stop-took-effect'], `code ${code}`);
  }
});

test('Windows: taskkill FAILS -> the owned handle is asked to end it; a signal from that is a stop, no signal is not', () => {
  const child = handle(); const s = stopperFor(child, tools({ taskkill: { status: 5, error: null } }));
  s.request(() => {});
  assert.strictEqual(child.killed, 1, 'no handle fallback');
  assert.strictEqual(s.finalize({ code: null, signal: 'SIGTERM' }).state, 'stopped');

  const dead = handle({ killReturns: false }); const s2 = stopperFor(dead, tools({ taskkill: { status: null, error: 'ENOENT' } }));
  s2.request(() => {});
  const end = s2.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.root], ['failed', 'stop-unconfirmed', 'not-terminated'],
    'a failed stop that then exits non-zero must not be reported as stopped');
});

test('Windows: the root stopped but a descendant is still alive -> unknown (not stopped), the survivor named', () => {
  const s = stopperFor(handle(), tools({ survivors: [{ pid: 5002, created: 'x' }] }));
  s.request(() => {});
  const end = s.finalize({ code: 1, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict, end.stop.descendants, end.stop.survivorPids], ['unknown', 'root-stopped-descendants-alive', 'survivors', [5002]]);
});

test('Windows: descendants that cannot be checked are unverified -> unknown, never stopped', () => {
  for (const o of [{ tree: null }, { survivors: null }, { survivorsThrows: true }]) {
    const s = stopperFor(handle(), tools(o));
    s.request(() => {});
    const end = s.finalize({ code: 1, signal: null });
    assert.deepStrictEqual([end.state, end.stop.verdict], ['unknown', 'root-stopped-descendants-unverified'], JSON.stringify(Object.keys(o)));
  }
});

test('Windows: taskkill says terminated but the process says it finished cleanly (exit 0) -> unknown, not stopped and not ok', () => {
  const s = stopperFor(handle(), tools());
  s.request(() => {});
  const end = s.finalize({ code: 0, signal: null });
  assert.deepStrictEqual([end.state, end.stop.verdict], ['unknown', 'contradiction-exit-0']);
});

test('duplicate Stop does nothing new; a FAILED stop may be retried', () => {
  const t = tools();
  const s = stopperFor(handle(), t);
  assert.strictEqual(s.request(() => {}), true);
  assert.strictEqual(s.request(() => {}), false);
  assert.strictEqual(s.request(() => {}), false);
  assert.deepStrictEqual(t.calls.taskkill, [4242], 'the second/third Stop ran taskkill again');

  const t2 = tools({ taskkill: { status: 5, error: null } });
  const s2 = stopperFor(handle({ killReturns: false }), t2);
  s2.request(() => {}); s2.request(() => {});
  assert.deepStrictEqual(t2.calls.taskkill, [4242, 4242], 'a failed stop could not be retried');
  assert.strictEqual(s2.evidence().attempts, 2);
});

test('POSIX: a signal proves the stop; a clean exit 0 after a request is still `ok` (a cancelled child can exit 0)', () => {
  const sent = [];
  const s = stopperFor(handle(), tools(), false);
  s.request((c) => sent.push(c.pid)); s.request((c) => sent.push(c.pid));
  assert.deepStrictEqual(sent, [4242], 'duplicate POSIX Stop signalled twice');
  const end = s.finalize({ code: null, signal: 'SIGTERM' });
  assert.deepStrictEqual([end.state, end.stop.verdict], ['stopped', 'stopped-by-signal']);

  const s2 = stopperFor(handle(), tools(), false); s2.request(() => {});
  const e2 = s2.finalize({ code: 0, signal: null });
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
