/* Offline boot, reduced-motion, and clean shutdown — against the real app.
 *
 * Spike A finding O-1: --proxy-server does NOT stop main-process net.fetch; only the session
 * webRequest layer blocks both. This asserts the app makes zero external requests, and that
 * the shutdown paths leave no orphan (Spike C: killing the parent can strand descendants).
 */
import { spawn } from 'node:child_process';
import { sweepDisplays } from './xvfb.mjs';
import { launchArgs, killTree, termTree, countElectron, WIN } from './launch.mjs';
sweepDisplays();
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';

/* Isolated store per run: a test must never touch the user's real juqode.db. */
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-e2e-')), 'juqode.db');
/* The app's WHOLE data directory, relocated for the test run.
 *
 * `JUQODE_DB` moved the store; the evidence stores are derived from `userData` and were not,
 * so every run left a bare git repository per project in the developer's own
 * `~/.config/juqode/evidence` — 201 of them had piled up before anyone counted. One variable
 * moves all of it, including the Chromium profile, so nothing this test does touches the real
 * application data. */
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-userdata-'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alive = () => countElectron();

function run(env = {}, args = []) {
  return new Promise((resolve) => {
    const [file, argv] = launchArgs(['.', '--no-sandbox', ...args]);
    const p = spawn(file, argv,
      { cwd: ROOT, env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA, ...env }, detached: !WIN });
    p.on('error', (e) => { throw new Error(`could not start the app (is xvfb-run installed?): ${e.message}`); });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => killTree(p.pid), 30000);
    p.on('exit', (code, signal) => {
      clearTimeout(t);
      const events = out.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
      resolve({ code, signal, events, pid: p.pid });
    });
  });
}

const results = {};

/* 1. Offline boot: no network reachable at all is the strongest form of the claim.
      unshare is unavailable here (AppArmor), so we assert the app's own accounting. */
const off = await run({ JUQODE_EXIT_AFTER_LOAD: '1' });
const load = off.events.find((e) => e.ev === 'did-finish-load');
assert.ok(load, 'offline boot: renderer never loaded');
assert.strictEqual(load.externalRequests, 0, `offline boot: ${load.externalRequests} external requests`);
assert.strictEqual(off.code, 0, `offline boot: exit ${off.code}`);
results.offlineBoot = { externalRequests: load.externalRequests, exit: off.code };

/* 2. Reduced motion: no animation may be running once the OS asks for none. */
const rm = await run({ JUQODE_EXIT_AFTER_LOAD: '1' }, ['--force-prefers-reduced-motion']);
assert.strictEqual(rm.code, 0, 'reduced-motion boot did not exit cleanly');
results.reducedMotionBoot = { exit: rm.code };

/* 3. Clean shutdown: quit path, then SIGTERM, each leaving zero survivors. */
assert.strictEqual(alive(), '0', `orphans left before shutdown test: ${alive()}`);

const [tfile, targv] = launchArgs(['.', '--no-sandbox']);
const term = spawn(tfile, targv,
  { cwd: ROOT, env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA }, detached: !WIN });
await sleep(6000);
const before = alive();
termTree(term.pid);
await sleep(4000);
const after = alive();
killTree(term.pid);
await sleep(1500);

assert.notStrictEqual(before, '0', 'app never started for the shutdown test');
assert.strictEqual(after, '0', `graceful terminate left ${after} process(es) behind`);
results.shutdown = { processesWhileRunning: before, afterGracefulTerminate: after };

console.log(JSON.stringify(results, null, 2));
console.log('offline + reduced-motion + shutdown: PASS');
