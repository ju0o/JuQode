/* WBS-00 Spike C (POSIX) — process lifecycle, cancel, orphan detection.
 *
 * Regenerates the raw evidence behind WBS-00-REPORT §2.6 / §2.7 / §2.8 / §3-C.
 * Harmless commands only (`sleep`, `node`). Never touches a user project.
 *
 * Run: node scripts/spikes/process-lifecycle.mjs > docs/dev-evidence/wbs-00/raw/spike-c.json
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const psOf = (pid) => sh(`ps -o pid=,pgid=,ppid=,stat=,args= -p ${pid} 2>/dev/null`);

const R = {
  utc: new Date().toISOString(),
  host: { platform: process.platform, release: os.release(), node: process.versions.node,
          isWSL: fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')) },
  note: 'POSIX only. Windows has no process groups or POSIX signals — see scripts/windows-spikes.mjs.',
  findings: {},
};

const tmp = fs.mkdtempSync('/tmp/juqode-spikec-');
fs.writeFileSync(`${tmp}/kid.js`, `require('child_process').spawn('sleep',['600'],{stdio:'ignore'});setTimeout(()=>{},600000);`);
fs.writeFileSync(`${tmp}/stubborn.js`, `process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setTimeout(()=>{},600000);`);

/* F1 — detached decides whether a group kill hits us too */
{
  const a = spawn('sleep', ['300'], { stdio: 'ignore' });
  const b = spawn('sleep', ['300'], { stdio: 'ignore', detached: true });
  await sleep(400);
  R.findings.F1_spawnModes = {
    question: 'Does detached:true actually give the child its own process group?',
    driver: psOf(process.pid),
    notDetached: psOf(a.pid),
    detached: psOf(b.pid),
    detachedHasOwnPgid: sh(`ps -o pgid= -p ${b.pid}`).trim() === String(b.pid),
    notDetachedSharesDriverPgid: sh(`ps -o pgid= -p ${a.pid}`).trim() === sh(`ps -o pgid= -p ${process.pid}`).trim(),
  };
  a.kill('SIGKILL'); try { process.kill(-b.pid, 'SIGKILL'); } catch {}
}

/* F3 — the crux: killing the parent strands the grandchild */
{
  const kid = spawn('node', [`${tmp}/kid.js`], { stdio: 'ignore' });
  await sleep(900);
  const gc = sh(`pgrep -P ${kid.pid}`).split('\n').filter(Boolean);
  const before = gc.map(psOf);
  kid.kill('SIGKILL');
  await sleep(700);
  R.findings.F3_parentOnlyKill = {
    question: 'Does killing only the parent leave the grandchild running?',
    grandchildrenBefore: before,
    kidAlive: alive(kid.pid),
    grandchildAlive: gc.map((p) => ({ pid: p, alive: alive(Number(p)), ps: psOf(Number(p)) })),
    orphanSurvived: gc.some((p) => alive(Number(p))),
  };
  for (const p of gc) { try { process.kill(Number(p), 'SIGKILL'); } catch {} }
}

/* F3b — group kill reaches the whole tree */
{
  const kid = spawn('node', [`${tmp}/kid.js`], { stdio: 'ignore', detached: true });
  await sleep(900);
  const gc = sh(`pgrep -P ${kid.pid}`).split('\n').filter(Boolean);
  try { process.kill(-kid.pid, 'SIGKILL'); } catch {}
  await sleep(700);
  R.findings.F3b_groupKill = {
    question: 'Does a group kill reach the grandchild?',
    grandchildren: gc,
    kidAlive: alive(kid.pid),
    anyGrandchildAlive: gc.some((p) => alive(Number(p))),
  };
}

/* F4 — SIGTERM then SIGKILL against a child that ignores SIGTERM */
{
  const s = spawn('node', [`${tmp}/stubborn.js`], { stdio: 'ignore', detached: true });
  await sleep(700);
  const t0 = Date.now();
  try { process.kill(-s.pid, 'SIGTERM'); } catch {}
  await sleep(1200);
  const survivedTerm = alive(s.pid);
  try { process.kill(-s.pid, 'SIGKILL'); } catch {}
  await sleep(400);
  R.findings.F4_escalation = {
    question: 'Does SIGTERM→SIGKILL escalation actually fire for a child that traps SIGTERM?',
    survivedSigterm: survivedTerm,
    deadAfterSigkill: !alive(s.pid),
    totalMs: Date.now() - t0,
  };
}

/* F5 — a cleanly-cancelled child exits 0, indistinguishable from success */
{
  const graceful = `${tmp}/graceful.js`;
  fs.writeFileSync(graceful, `process.on('SIGINT',()=>process.exit(0));setTimeout(()=>{},600000);`);
  const g = spawn('node', [graceful], { stdio: 'ignore', detached: true });
  await sleep(700);
  const exit = await new Promise((res) => {
    g.on('exit', (code, signal) => res({ code, signal }));
    try { process.kill(-g.pid, 'SIGINT'); } catch {}
  });
  const raw = spawn('sleep', ['300'], { stdio: 'ignore', detached: true });
  await sleep(400);
  const rawExit = await new Promise((res) => {
    raw.on('exit', (code, signal) => res({ code, signal }));
    try { process.kill(-raw.pid, 'SIGINT'); } catch {}
  });
  R.findings.F5_cancelExitCode = {
    question: 'Can exit code distinguish a cancelled run from a successful one?',
    childThatHandlesSigint: exit,
    childThatDoesNot: rawExit,
    exitCodeIsUsableAsCancelEvidence: exit.code !== 0,
    conclusion: 'A child that handles its own signal exits 0 — identical to success. Exit code is not cancel evidence.',
  };
}

/* F6 — kill(pid,0) reports a zombie as alive */
{
  const zshell = spawn('bash', ['-c', 'sleep 0.3 & sleep 20'], { stdio: 'ignore' });
  await sleep(1200);
  const kids = sh(`pgrep -P ${zshell.pid}`).split('\n').filter(Boolean);
  const zombie = kids.map(Number).find((p) => /^Z/.test(sh(`ps -o stat= -p ${p}`)));
  R.findings.F6_zombieTrap = {
    question: 'Does kill(pid,0) prove a process is running?',
    zombiePid: zombie ?? null,
    killZeroSaysAlive: zombie ? alive(zombie) : null,
    psSaysState: zombie ? sh(`ps -o stat= -p ${zombie}`) : null,
    conclusion: zombie
      ? 'kill(pid,0) returns success for an unreaped zombie. It can prove GONE, never RUNNING.'
      : 'no zombie observed in this run — the trap is documented in WBS-00-REPORT §2.8',
  };
  zshell.kill('SIGKILL');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify(R, null, 2));
