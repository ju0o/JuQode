'use strict';
/* Real processes: an "app" process starts a Quick Command dev server through the real handlers and is then FORCE-KILLED (its own
 * pid only, not its tree), so the server survives as an orphan -- exactly what a crash does. A second "app" (this test, same DB file
 * and evidence directory) must find the run unresolved and keep the Writer gate shut. Only processes this test started are ended,
 * each by its own pid (the tree through taskkill /T or the process group), never by name or pattern. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));

const WIN = process.platform === 'win32';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const dirs = [];
const killTreeOf = (pid) => {      // a pid THIS test's fixture started
  if (!pid) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
};
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } } });

const APP = `
const path = require('path');
const [R, dbFile, evidence, projDir, mode] = process.argv.slice(2);
process.env.JUQODE_CLAUDE_BIN = path.join(require('os').tmpdir(), 'juqode-no-such-claude');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const db = openDb(dbFile);
const proj = repo.openProject(db, projDir, 'p');
const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => evidence, push() {}, pushQc() {} });
(async () => {
  const r = await h['juqode:qc-run'](null, proj.id, 'qc.dev.start', 'x');
  console.log(JSON.stringify({ projectId: proj.id, runId: r.runId, pid: r.pid, ok: r.ok, reason: r.reason }));
  if (mode === 'stop-then-die') { h['juqode:qc-stop'](null, proj.id); process.kill(process.pid); }
  setInterval(() => {}, 1000);
})();`;

async function crashedApp(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-restart-')); dirs.push(dir);
  const proj = path.join(dir, 'proj'); fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ scripts: { dev: 'node -e "require(\'fs\').writeFileSync(\'.dev.pid\', String(process.pid)); setInterval(()=>{},1000)"', build: 'node -e 1' } }));
  const dbFile = path.join(dir, 'store.db'); const evidence = path.join(dir, 'evidence'); fs.mkdirSync(evidence);
  const script = path.join(dir, 'app.js'); fs.writeFileSync(script, APP);
  const app = spawn(process.execPath, [script, R, dbFile, evidence, proj, mode], { stdio: ['ignore', 'pipe', 'inherit'], detached: !WIN });
  let out = '';
  app.stdout.on('data', (d) => { out += d; });
  assert.ok(await until(() => out.includes('\n')), 'the first app never reported its Quick Command');
  const info = JSON.parse(out.split('\n')[0]);
  assert.strictEqual(info.ok, true, JSON.stringify(info));
  return { dir, dbFile, evidence, proj, app, info };
}

test('real: force-killing the app leaves the dev server alive; the restarted app keeps the Writer gate shut (build and Work refused, read-only fine) until the user names the run', async (t) => {
  const c = await crashedApp('run');
  const was = process.env.JUQODE_CLAUDE_BIN; process.env.JUQODE_CLAUDE_BIN = path.join(os.tmpdir(), 'juqode-no-such-claude');
  t.after(() => { if (was === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = was; killTreeOf(c.info.pid); try { c.app.kill('SIGKILL'); } catch { /* gone */ } });
  const pidFile = path.join(c.proj, '.dev.pid');
  assert.ok(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== ''), 'the dev server never started');
  const server = Number(fs.readFileSync(pidFile, 'utf8'));
  t.after(() => killTreeOf(server));
  // the crash: only the app process, not its tree
  if (WIN) spawnSync('taskkill', ['/PID', String(c.app.pid), '/F'], { stdio: 'ignore' }); else process.kill(c.app.pid, 'SIGKILL');
  assert.ok(await until(() => !alive(c.app.pid)), 'the app did not die');
  /* what survives a crash is the host's business (a closed stdout pipe ends some launchers on POSIX); the hold must not depend on it */
  const survived = alive(server);

  const db = openDb(c.dbFile);
  repo.reconcileQcRuns(db);                                           // main.js at boot
  const row = repo.qcRun(db, c.info.runId);
  assert.deepStrictEqual([row.status, row.exit_code, row.runner_pid], ['unknown', null, c.info.pid], 'the identity was not persisted / the run was not reconciled');
  const mk = () => makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => c.evidence, push() {}, pushQc() {} });
  for (let restart = 1; restart <= 2; restart += 1) {
    const h = mk();
    assert.strictEqual((await h['juqode:qc-run'](null, c.info.projectId, 'qc.build', 'b')).reason, 'prior-run-unknown', `restart ${restart}`);
    assert.strictEqual((await h['juqode:work-start'](null, c.info.projectId, 'x')).reason, 'prior-process-may-still-live', `restart ${restart}`);
    assert.notStrictEqual(h['juqode:qc-route'](null, c.info.projectId, '깃 상태').reason, 'prior-run-unknown');
    assert.deepStrictEqual(h['juqode:qc-list'](null, c.info.projectId).held.map((x) => [x.runId, x.why]), [[c.info.runId, 'never-finished']]);
  }
  assert.strictEqual(alive(server), survived, 'the product ended (or revived) a process it no longer owns');
  if (WIN) assert.strictEqual(survived, true, 'on Windows a killed parent must leave the server running -- this is the premise of the test');

  // the survivor is still there; the user names it only after ending it
  killTreeOf(c.info.pid); killTreeOf(server);
  assert.ok(await until(() => !alive(server) && !alive(c.info.pid)), 'the test fixture could not be ended');
  const h = mk();
  assert.strictEqual((await h['juqode:qc-run'](null, c.info.projectId, 'qc.build', 'b')).reason, 'prior-run-unknown', 'observed absence cannot prove escaped descendants stopped');
  const r = await h['juqode:qc-ack-stopped'](null, c.info.projectId, [c.info.runId], true);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.acked, []);
  const after = mk();                                                   // restart after refused confirmation: hold, history and result preserved
  assert.strictEqual((await after['juqode:qc-run'](null, c.info.projectId, 'qc.build', 'b')).reason, 'prior-run-unknown');
  assert.deepStrictEqual([repo.qcRun(db, c.info.runId).status, repo.qcRun(db, c.info.runId).exit_code], ['unknown', null]);
  assert.ok(repo.qcRunsFor(db, c.info.projectId).some((x) => x.id === c.info.runId), 'the run left the history');
  await until(() => repo.qcRunsFor(db, c.info.projectId).every((x) => x.status !== 'running'), 10000);
});

test('real: the app dies right after asking to Stop -- whatever the Stop managed to do, the run is unresolved and still blocks', async (t) => {
  const c = await crashedApp('stop-then-die');
  const was = process.env.JUQODE_CLAUDE_BIN; process.env.JUQODE_CLAUDE_BIN = path.join(os.tmpdir(), 'juqode-no-such-claude');
  t.after(() => { if (was === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = was; killTreeOf(c.info.pid); try { c.app.kill('SIGKILL'); } catch { /* gone */ } });
  assert.ok(await until(() => !alive(c.app.pid), 20000), 'the app did not die by itself');
  await new Promise((r) => setTimeout(r, 1500));                       // the asynchronous taskkill may or may not have gone out
  const db = openDb(c.dbFile);
  repo.reconcileQcRuns(db);
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => c.evidence, push() {}, pushQc() {} });
  const row = repo.qcRun(db, c.info.runId);
  assert.strictEqual(row.status, 'unknown', `a run nobody saw finish was recorded as ${row.status}`);
  assert.strictEqual((await h['juqode:qc-run'](null, c.info.projectId, 'qc.build', 'b')).reason, 'prior-run-unknown');
  assert.strictEqual(h['juqode:qc-list'](null, c.info.projectId).held.length, 1);
});
