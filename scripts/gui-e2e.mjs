#!/usr/bin/env node
/* Founder-approved VISIBLE Fixture E2E driver (H1 Windows desktop / H3 WSLg desktop).
 *
 *   node scripts/gui-e2e.mjs --host H3 --out <dir> [--only boot,visual,offline]
 *
 * Runs tests/e2e/boot.test.mjs, visual.mjs and offline-shutdown.mjs one at a time against the FIXTURE
 * Claude, with real application windows on this machine's desktop. It exists so that the approval's
 * invariants are enforced by code and recorded, not remembered:
 *
 *   - JUQODE_E2E_VISIBLE=yes is put in the environment of the three test processes ONLY. Nothing global.
 *   - No golden update: refuses --update-golden / JUQODE_UPDATE_GOLDEN; screenshots go to this host's own
 *     untracked tmp-visual-<host>; the tracked goldens' Git status is recorded before and after.
 *   - No real agent can run: `claude`, `codex` and `opencode` on PATH are TRIPWIRES placed first. They answer
 *     the read-only `--version` / `auth status` a detector may ask, and refuse (exit 97, marker written) on
 *     anything else. Afterwards the markers must be absent -- evidence that no model call was even attempted.
 *     The tests still point the app at their own fixture CLI; this covers any launch that does not.
 *   - Temp DB / user data are the tests' own mkdtemp directories; the real application data directory is never
 *     passed. The temp-entry inventory before/after is recorded.
 *   - Only the test processes started here are ended (by their own handle, tree via the platform mechanism).
 *     A before/after process inventory records anything new that is still alive. No pattern kills.
 * It does not install anything, does not log in, does not touch global settings. */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killTree, countElectron, WIN } from '../tests/e2e/launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const die = (m) => { console.error(`gui-e2e: ${m}`); process.exit(2); };

if (process.argv.includes('--update-golden') || process.env.JUQODE_UPDATE_GOLDEN) die('refusing: the tracked goldens are never updated by this driver');
const host = (arg('host') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
if (!host) die('--host H1|H3 is required');
const out = path.resolve(arg('out') ?? '');
if (!arg('out')) die('--out <dir> is required');
fs.mkdirSync(out, { recursive: true });
const only = (arg('only') ?? 'boot,visual,journey,offline').split(',');

const TESTS = {
  boot: { file: 'tests/e2e/boot.test.mjs', timeoutMs: 180_000 },
  visual: { file: 'tests/e2e/visual.mjs', timeoutMs: 1_200_000 },
  journey: { file: 'tests/e2e/journey.mjs', timeoutMs: 300_000 },
  offline: { file: 'tests/e2e/offline-shutdown.mjs', timeoutMs: 360_000 },
};

/* ───────────── tripwire agents ───────────── */
const trip = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-tripwire-'));
for (const name of ['claude', 'codex', 'opencode']) {
  const marker = path.join(trip, `TRIPWIRE-${name}.txt`);
  if (WIN) {
    fs.writeFileSync(path.join(trip, `${name}.cmd`), [
      '@echo off',
      'if "%~1"=="--version" (echo fixture-tripwire 0 & exit /b 0)',
      'if "%~1"=="auth" (echo {"loggedIn":true} & exit /b 0)',
      `echo %* >> "${marker}"`,
      'exit /b 97', ''].join('\r\n'));
  } else {
    fs.writeFileSync(path.join(trip, name), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "fixture-tripwire 0"; exit 0; fi',
      'if [ "$1" = "auth" ]; then echo \'{"loggedIn":true}\'; exit 0; fi',
      `echo "$@" >> "${marker}"`,
      'exit 97', ''].join('\n'), { mode: 0o755 });
  }
}
const childEnv = {
  ...process.env,
  JUQODE_E2E_VISIBLE: 'yes',                  // this child only
  JUQODE_E2E_HOST: host,
  PATH: `${trip}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
};
delete childEnv.JUQODE_UPDATE_GOLDEN;
delete childEnv.JUQODE_CLAUDE_BIN;            // each test sets its own fixture; none may inherit a real one

/* ───────────── inventories ───────────── */
function processes() {
  if (!WIN) {
    const r = spawnSync('ps', ['-eo', 'pid=,lstart=,comm='], { encoding: 'utf8' });
    return String(r.stdout || '').split('\n').filter(Boolean).map((l) => {
      const m = /^\s*(\d+)\s+(.{24})\s+(.*)$/.exec(l); return m ? { pid: Number(m[1]), start: m[2].trim(), name: m[3].trim() } : null;
    }).filter(Boolean);
  }
  const ps = "Get-CimInstance Win32_Process | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.CreationDate.ToString('o'), $_.Name }";
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  return String(r.stdout || '').split(/\r?\n/).map((l) => /^(\d+)\|([^|]*)\|(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), start: m[2], name: m[3] }));
}
const key = (p) => `${p.pid}|${p.start}`;
const tmpEntries = () => fs.readdirSync(os.tmpdir()).filter((n) => /^juqode-/.test(n)).sort();
const goldenStatus = () => spawnSync('git', ['status', '--porcelain', '--', 'docs/dev-evidence/screens'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const repoStatus = () => spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);

const report = { host, root: ROOT, node: process.version, platform: process.platform, release: os.release(), startedAt: new Date().toISOString(),
  sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), tripwireDir: trip, tests: {} };

/* preflight must say ready with consent given to THIS process tree */
const pre = spawnSync(process.execPath, [path.join(ROOT, 'tests/e2e/preflight.mjs')], { cwd: ROOT, encoding: 'utf8', env: childEnv });
fs.writeFileSync(path.join(out, 'preflight.json'), pre.stdout);
let preflight; try { preflight = JSON.parse(pre.stdout); } catch { die('preflight did not produce JSON'); }
report.preflight = { exit: pre.status, mode: preflight.display?.mode, ready: preflight.ready, blockers: preflight.blockers };
if (!preflight.ready) { report.result = 'BLOCKED'; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.preflight, null, 2)); fs.rmSync(trip, { recursive: true, force: true }); process.exit(3); }

report.before = { processes: processes(), tmp: tmpEntries(), electronOfThisCheckout: countElectron(), goldenStatus: goldenStatus(), repoDirty: repoStatus() };
const beforeKeys = new Set(report.before.processes.map(key));

async function runOne(name) {
  const t = TESTS[name];
  const log = path.join(out, `${name}.log`);
  const fd = fs.openSync(log, 'w');
  const t0 = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, t.file)], { cwd: ROOT, env: childEnv, detached: !WIN, stdio: ['ignore', fd, fd] });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killTree(child); }, t.timeoutMs);
  const res = await new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  fs.closeSync(fd);
  // the test's own app tree is already stopped by the test; make sure nothing of THIS child's tree is left
  killTree(child);
  const text = fs.readFileSync(log, 'utf8');
  report.tests[name] = { file: t.file, exitCode: res.code, signal: res.signal, timedOut, ms: Date.now() - t0,
    lastLine: text.trim().split('\n').pop()?.slice(0, 200), windowShownEvents: (text.match(/"ev":"window\.shown"/g) ?? []).length };
  console.log(`${name}: exit=${res.code} signal=${res.signal} timedOut=${timedOut} ${report.tests[name].ms} ms`);
  return res.code === 0;
}

for (const n of only) { if (!TESTS[n]) die(`unknown test ${n}`); await runOne(n); }

/* ───────────── after ───────────── */
await new Promise((r) => setTimeout(r, 1500));
const after = processes();
const leftovers = after.filter((p) => !beforeKeys.has(key(p)) && /electron|juqode|xvfb|node|cmd|claude|codex|opencode/i.test(p.name));
report.after = { tmp: tmpEntries(), electronOfThisCheckout: countElectron(), goldenStatus: goldenStatus(), repoDirty: repoStatus(),
  newProcessesStillAlive: leftovers.filter((p) => p.pid !== process.pid).map((p) => ({ pid: p.pid, name: p.name })) };
report.tmpAdded = report.after.tmp.filter((n) => !report.before.tmp.includes(n) && !n.startsWith('juqode-tripwire-'));
report.tripwireMarkers = fs.readdirSync(trip).filter((n) => n.startsWith('TRIPWIRE-'));
const shots = path.join(ROOT, String(preflight.screenshots).split(' ')[0]);          // exactly where preflight said they would go
report.screenshots = fs.existsSync(shots) ? fs.readdirSync(shots).filter((f) => f.endsWith('.png')).sort().map((f) => {
  const b = fs.readFileSync(path.join(shots, f)); return { file: f, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16) }; }) : [];
report.screenshotsDir = shots;
report.goldensUnchanged = report.before.goldenStatus === report.after.goldenStatus && report.after.goldenStatus === '';
report.finishedAt = new Date().toISOString();
const allOk = Object.values(report.tests).every((t) => t.exitCode === 0 && !t.timedOut);
report.result = allOk && report.tripwireMarkers.length === 0 && report.goldensUnchanged ? 'ALL_EXIT_0' : 'SEE_DETAILS';
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
fs.rmSync(trip, { recursive: true, force: true });
console.log(JSON.stringify({ result: report.result, tests: Object.fromEntries(Object.entries(report.tests).map(([k, v]) => [k, v.exitCode])), tripwireMarkers: report.tripwireMarkers,
  goldensUnchanged: report.goldensUnchanged, newProcessesStillAlive: report.after.newProcessesStillAlive.length, tmpAdded: report.tmpAdded, screenshots: report.screenshots.length }, null, 2));
process.exit(allOk ? 0 : 1);
