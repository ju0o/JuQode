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

/* Isolated store per run: a test must never touch the user's real juqode.db. */
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-e2e-')), 'juqode.db');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', '.bin', 'electron');

function boot(extraArgs = [], env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    /* Detached so the whole Electron tree lands in one process group and can actually be
     * stopped; killing xvfb-run alone leaves Electron holding the stdio pipes. */
    const p = spawn('xvfb-run', ['-a', ELECTRON, '.', '--no-sandbox', ...extraArgs], {
      cwd: ROOT, detached: true,
      env: { ...process.env, JUQODE_TRACE: '1', JUQODE_DB: DB, ...env },
    });
    p.on('error', (e) => { throw new Error(`could not start the app (is xvfb-run installed?): ${e.message}`); });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } }, 30000);
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

const t = runs.map((r) => ev(r.events, 'did-finish-load').ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  runs: runs.length,
  windows: 1,
  externalRequests: 0,
  shownVia: runs.map((r) => ev(r.events, 'window.shown').via),
  didFinishLoadMs: { min: t[0], median: t[1], max: t[t.length - 1] },
  note: 'Linux measurement only. The target OS is Windows 10/11 (D-125) and is NOT TESTED.',
}, null, 2));
console.log('boot smoke: PASS');
