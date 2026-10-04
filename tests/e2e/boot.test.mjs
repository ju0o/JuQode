/* WBS-01 desktop boot smoke test.
 *
 * Runs the REAL packaged-equivalent app under Xvfb and asserts on the structured trace.
 * Not a DOM mock: this spawns Electron and reads what the main process actually reported.
 *
 * Host note: this machine cannot run the Chromium OS sandbox (chrome-sandbox needs root,
 * AppArmor blocks unprivileged userns), so --no-sandbox is required HERE. It is a host
 * limitation, not an app setting; webPreferences.sandbox stays true.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { sweepDisplays } from './xvfb.mjs';
import { launchArgs, killTree, WIN } from './launch.mjs';

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
const require = createRequire(import.meta.url);
const { openDb } = require('../../app/main/db/db.js');
const repo = require('../../app/main/db/repo.js');

/* Seed one interrupted Task Run owned by a prior JuQode launch. Its pid is the still-live test
 * process: startup must still mark the old Run unknown because the prior Claude stream cannot be
 * reattached, and it must not create a replacement execution. */
const seededDb = openDb(DB);
const seededProject = repo.openProject(seededDb, path.join(os.tmpdir(), 'juqode-restart-project'), 'Restart fixture');
const oldAppSession = repo.startAppSession(seededDb, { appVersion: 'fixture', platform: process.platform });
const restartTask = repo.createTask(seededDb, seededProject.id, {
  goal: 'Recover interrupted execution', acceptanceCriteria: ['History remains truthful'],
});
const interruptedRun = repo.beginWork(seededDb, seededProject.id, 'Interrupted before result', {
  taskId: restartTask.id, status: 'starting', appSessionId: oldAppSession.id,
}).work;
repo.setRunnerIdentity(seededDb, interruptedRun.id, 'fixture-claude-session', process.pid);
seededDb.close(); // no endAppSession: this is the crash boundary

sweepDisplays();

function boot(extraArgs = [], env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    /* Detached so the whole Electron tree lands in one process group and can actually be
     * stopped; killing xvfb-run alone leaves Electron holding the stdio pipes. */
    const [file, argv] = launchArgs(['.', '--no-sandbox', ...extraArgs]);
    const p = spawn(file, argv, {
      cwd: ROOT, detached: !WIN,
      env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: DB, JUQODE_USER_DATA: USER_DATA, ...env },
    });
    p.on('error', (e) => { throw new Error(`could not start the app (is xvfb-run installed?): ${e.message}`); });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => killTree(p.pid), 30000);
    p.on('exit', (code, signal) => {
      clearTimeout(kill);
      const events = out.split('\n').filter(Boolean).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      });
      resolve({ code, signal, events, out, err, wall: Date.now() - t0 });
    });
  });
}

const ev = (events, name) => events.find((e) => e.ev === name);

const runs = [];
for (let i = 0; i < 3; i++) runs.push(await boot([], { JUQODE_EXIT_AFTER_LOAD: '1' }));


// Every run must have produced the same shape.
for (const [i, r] of runs.entries()) {
  assert.ok(ev(r.events, 'app.ready'), `run ${i}: app never became ready\n${r.err.slice(0, 600)}`);
  const load = ev(r.events, 'did-finish-load');
  assert.ok(load, `run ${i}: renderer never finished loading`);
  assert.strictEqual(load.windows, 1, `run ${i}: expected exactly one window, got ${load.windows}`);
  assert.strictEqual(load.externalRequests, 0, `run ${i}: app made ${load.externalRequests} external requests — it must make none`);
  assert.ok(ev(r.events, 'window.shown'), `run ${i}: window never shown (ready-to-show fallback failed?)`);
  assert.ok(ev(r.events, 'window-all-closed'), `run ${i}: never reached window-all-closed`);
  assert.strictEqual(r.code, 0, `run ${i}: unclean exit — code ${r.code} signal ${r.signal}`);
}

const recoveredDb = openDb(DB);
const recoveredRun = repo.getWork(recoveredDb, interruptedRun.id);
assert.strictEqual(recoveredRun.status, 'ended');
assert.strictEqual(recoveredRun.outcome, 'ended_unknown');
assert.strictEqual(recoveredRun.failure_reason, 'app-restarted-before-run-completion');
assert.strictEqual(recoveredRun.app_session_id, oldAppSession.id);
assert.strictEqual(recoveredDb.prepare('select count(*) n from work where task_id = ?').get(restartTask.id).n, 1,
  'restarting JuQode must not auto-create or auto-run a replacement attempt');
assert.strictEqual(recoveredDb.prepare('select ended_at from app_session where id = ?').get(oldAppSession.id).ended_at, null,
  'crash ownership must remain distinguishable from a clean app shutdown');
const cleanSessions = recoveredDb.prepare('select count(*) n from app_session where ended_at is not null').get().n;
recoveredDb.close();

const t = runs.map((r) => ev(r.events, 'did-finish-load').ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  runs: runs.length,
  windows: 1,
  externalRequests: 0,
  restartReconciliation: { outcome: recoveredRun.outcome, runCount: 1, endedAppSessions: cleanSessions },
  shownVia: runs.map((r) => ev(r.events, 'window.shown').via),
  didFinishLoadMs: { min: t[0], median: t[1], max: t[t.length - 1] },
  note: 'Linux measurement only. The target OS is Windows 10/11 (D-125) and is NOT TESTED.',
}, null, 2));
console.log('boot smoke: PASS');
