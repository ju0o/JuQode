'use strict';
/* The fixture reaper (`tests/fakecli.js::reapProcessesUnder`) is held to the rule the product holds
 * itself to: it must never signal a process that is not ours any more. A command line that mentions
 * a temp directory FINDS a candidate; it is not permission to kill it. These cases use real
 * processes. POSIX identity is the /proc start time, Windows identity is the CIM CreationDate;
 * the same cases run on both. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fake = require('./fakecli.js');

const dirs = [];
const own = new Set();
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
/* spawn a long-lived node whose command line carries `marker` */
const idle = (marker) => {
  const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', marker], { stdio: 'ignore' });
  own.add(c);
  return c;
};
test.after(() => { for (const c of own) { try { if (c.exitCode === null) c.kill('SIGKILL'); } catch { /* gone */ } } for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const ready = () => new Promise((r) => setTimeout(r, 150));

test('a process whose command line names our directory AND whose identity is unchanged is stopped', async () => {
  const d = tmp('juqode-reap-own-');
  const c = idle(path.join(d, 'fixture'));
  await ready();
  const r = fake.reapProcessesUnder([d]);
  assert.deepStrictEqual(r.pids, [c.pid]);
  assert.ok(await until(() => !alive(c.pid)), 'the owned process survived');
});

test('a held ChildProcess handle is stopped through the handle -- no pid is signalled for it', async () => {
  const c = idle('handle-case');
  await ready();
  const sent = [];
  const r = fake.reapProcessesUnder([], { handles: [c], kill: (pid, sig) => sent.push([pid, sig]) });
  assert.strictEqual(r.handles, 1);
  assert.deepStrictEqual(sent, [], 'a handle-owned process was also signalled by number');
  assert.ok(await until(() => c.exitCode !== null || c.signalCode !== null), 'the handle was not killed');
  // an already-finished handle is left alone
  assert.strictEqual(fake.reapProcessesUnder([], { handles: [c] }).handles, 0);
});

test('a recycled pid (same number, different start time) is NOT signalled', async () => {
  const d = tmp('juqode-reap-recycled-');
  const bystander = idle(path.join(d, 'looks-ours'));                 // even its command line names our directory
  await ready();
  const sent = [];
  const stale = { pid: bystander.pid, start: 'a-start-time-from-a-previous-owner', cmd: path.join(d, 'fixture') };
  const r = fake.reapProcessesUnder([d], { discover: () => [stale], kill: (pid) => sent.push(pid) });
  assert.deepStrictEqual(r.pids, []);
  assert.deepStrictEqual(sent, []);
  assert.ok(alive(bystander.pid), 'a recycled pid was killed');
});

test('a process that no longer names our directory is NOT signalled, even with a matching start time', async () => {
  const d = tmp('juqode-reap-other-');
  const other = idle('somebody-elses-daemon');
  await ready();
  const id = fake.processIdentity(other.pid);
  const sent = [];
  const r = fake.reapProcessesUnder([d], { discover: () => [{ pid: other.pid, start: id.start, cmd: path.join(d, 'x') }], kill: (pid) => sent.push(pid) });
  assert.deepStrictEqual([r.pids, sent], [[], []]);
  assert.ok(alive(other.pid), 'an unrelated process was killed on a stale discovery');
});

test('an exited process is not signalled (no ESRCH-or-worse by number)', async () => {
  const d = tmp('juqode-reap-gone-');
  const c = spawn(process.execPath, ['-e', '0', path.join(d, 'short')], { stdio: 'ignore' });
  await new Promise((r) => c.once('exit', r));
  const sent = [];
  const r = fake.reapProcessesUnder([d], { discover: () => [{ pid: c.pid, start: '1', cmd: path.join(d, 'short') }], kill: (pid) => sent.push(pid) });
  assert.deepStrictEqual([r.pids, sent], [[], []]);
});

test('unreadable identity means no signal; this process, its parent, tiny pids and groups are never targets', () => {
  const d = tmp('juqode-reap-never-');
  const sent = [];
  const rows = [process.pid, process.ppid, 1, 4, -123, 0].map((pid) => ({ pid, start: 's', cmd: path.join(d, 'x') }));
  const r = fake.reapProcessesUnder([d], { discover: () => rows, identityOf: () => ({ start: 's', cmd: path.join(d, 'x') }), kill: (pid, sig) => sent.push([pid, sig]) });
  assert.deepStrictEqual(r.pids, []);
  assert.deepStrictEqual(sent, [], `signalled ${JSON.stringify(sent)}`);
  // identity unreadable (e.g. no /proc): nothing is signalled
  const victim = { pid: 999999, start: 's', cmd: path.join(d, 'x') };
  assert.deepStrictEqual(fake.reapProcessesUnder([d], { discover: () => [victim], identityOf: () => null, kill: (p) => sent.push(p) }).pids, []);
  assert.deepStrictEqual(sent, []);
});

test('every signal the reaper sends is SIGKILL to one positive pid; the source has no pattern or group kill', () => {
  const d = tmp('juqode-reap-shape-');
  const sent = [];
  const id = { start: 's', cmd: path.join(d, 'x') };
  fake.reapProcessesUnder([d], { discover: () => [{ pid: 424242, ...id }], identityOf: () => id, kill: (pid, sig) => sent.push([pid, sig]) });
  assert.deepStrictEqual(sent, [[424242, 'SIGKILL']]);
  const src = fs.readFileSync(path.join(__dirname, 'fakecli.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!/pkill|killall|taskkill|kill\(\s*-/.test(src), 'a pattern or group kill crept into the reaper');
});
