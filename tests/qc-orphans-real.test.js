'use strict';
/* MEASURED on H1: libuv puts a Node-spawned child in a job that dies with its spawner, so only DETACHED (breakaway) children outlive a killed root -- the cases below use those.
 * REAL Windows processes (isolated scratch node processes this test starts and ends itself): descendants outside the Stop's snapshot. Skipped elsewhere. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { windowsTools } = require(path.join(R, 'app/main/qc/stopper.js'));
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spawned = [];
const idle = 'setInterval(()=>{},1000)';
// a parent that starts a child (kept alive) and reports its pid on stdout; `late` = start another child when told to
const parentSrc = `const {spawn}=require('child_process');const k=spawn(process.execPath,['-e','${idle}'],{stdio:'ignore',detached:true});console.log('kid '+k.pid);` +
  `process.stdin.on('data',()=>{const l=spawn(process.execPath,['-e','${idle}'],{stdio:'ignore',detached:true});console.log('late '+l.pid)});${idle}`;
const grandSrc = `const {spawn}=require('child_process');const m=spawn(process.execPath,['-e',"const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','${idle}'],{stdio:'ignore',detached:true});console.log('grand '+g.pid);setTimeout(()=>process.exit(0),200)"],{stdio:['ignore','inherit','ignore']});m.on('exit',()=>{});${idle}`;
async function start(src) {
  const p = spawn(process.execPath, ['-e', src], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  spawned.push(p);
  const got = {}; let buf = '';
  p.stdout.on('data', (d) => { buf += d; for (const l of buf.split(/\r?\n/)) { const m = /^(\w+) (\d+)$/.exec(l); if (m) got[m[1]] = Number(m[2]); } });
  for (let i = 0; i < 100 && !Object.keys(got).length; i += 1) await sleep(100);
  return { p, got };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
test.after(() => { for (const p of spawned) { try { p.kill(); } catch { /* gone */ } } for (const pid of globalThis.__kids ?? []) { try { process.kill(pid); } catch { /* gone */ } } });
const track = (...pids) => { (globalThis.__kids ??= []).push(...pids.filter(Boolean)); };

test('root killed, recorded child alive -> survivors sees it; after it ends -> nothing', { skip: !win }, async () => {
  const { p, got } = await start(parentSrc);
  track(got.kid);
  const t = await windowsTools.tree(p.pid);
  assert.ok(t && t.descendants.some((d) => d.pid === got.kid), 'the child was not in the snapshot');
  p.kill(); await sleep(500);
  const s1 = await windowsTools.survivors(t.descendants, [t.root]);
  assert.ok(s1 && s1.some((m) => m.pid === got.kid), 'a live child of a dead root was not found');
  process.kill(got.kid); await sleep(500);
  assert.deepStrictEqual(await windowsTools.survivors(t.descendants, [t.root]), []);
});

test('a child started AFTER the snapshot (the root still alive, then killed) is found', { skip: !win }, async () => {
  const { p, got } = await start(parentSrc);
  track(got.kid);
  const t = await windowsTools.tree(p.pid);
  p.stdin.write('go\n');
  for (let i = 0; i < 50 && !got.late; i += 1) await sleep(100);
  track(got.late);
  assert.ok(got.late, 'the late child was not started');
  p.kill(); await sleep(500);
  const s = await windowsTools.survivors(t.descendants, [t.root]);
  assert.ok(s && s.some((m) => m.pid === got.late), 'a child started after the snapshot was missed');
  process.kill(got.kid); process.kill(got.late);
});

test('LIMITED (measured): a grandchild whose parent exited before the snapshot is invisible to the check', { skip: !win }, async () => {
  const { p, got } = await start(grandSrc);
  track(got.grand);
  await sleep(1200);                                       // the intermediate parent has exited by now
  const t = await windowsTools.tree(p.pid);
  assert.ok(alive(got.grand), 'the grandchild is not running');
  assert.ok(!t.descendants.some((d) => d.pid === got.grand), 'the snapshot saw an orphan: the documented limit changed');
  p.kill(); await sleep(500);
  assert.deepStrictEqual(await windowsTools.survivors(t.descendants, [t.root]), [], 'the orphan became visible: update the README contract');
  process.kill(got.grand);
});
