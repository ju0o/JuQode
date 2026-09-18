/* WBS-00 Windows-specific spikes — the work that CANNOT be executed on Linux.
 *
 * Answers the questions Spikes B and C left open, on the real target OS:
 *   ConPTY create / output / resize / close / cleanup
 *   child spawn, cancellation, process-tree handling, orphan inspection
 *
 * Writes raw/spikes.json next to the harness output. Uses only harmless commands.
 * Refuses to run anywhere but win32 — a Linux result must never be filed as a Windows one.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') {
  console.error('windows-spikes.mjs: not win32 — refusing to produce Windows evidence on ' + process.platform);
  process.exit(2);
}

const OUT = path.resolve('docs/dev-evidence/wbs-01/windows');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { platform: process.platform, node: process.versions.node, utc: new Date().toISOString(), spikes: {} };

function writeResult() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'spikes.json'), JSON.stringify(R, null, 2));
  // the harness also looks for it beside the per-host raw logs
  for (const d of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (d.isDirectory() && fs.existsSync(path.join(OUT, d.name, 'raw'))) {
      fs.writeFileSync(path.join(OUT, d.name, 'raw', 'spikes.json'), JSON.stringify(R, null, 2));
    }
  }
}

/* A crash used to leave the harness with nothing to read and only 'spikes produced no JSON' to
 * say — which names the symptom and hides the cause. Partial evidence plus the error beats an
 * empty directory, and an unhandled 'error' event from a spawn is emitted asynchronously, so no
 * try/catch around the spike bodies can see it. */
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => {
    R.abortedBy = { event: ev, error: String(e && e.stack || e) };
    try { writeResult(); } catch { /* nothing left to do */ }
    console.error(`windows-spikes.mjs: ${ev}: ${e}`);
    process.exit(3);
  });
}

const ps = (cmd) => {
  try { return execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8' }).trim(); }
  catch (e) { return `ERROR: ${e.message}`; }
};
const alive = (pid) => ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -ne $null`) === 'True';
const treeOf = (pid) => ps(`Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${pid}\\" | Select-Object -ExpandProperty ProcessId`);

/* ---------------------------------------------------------------- B: ConPTY */
R.spikes.conpty = await (async () => {
  const o = { question: 'Does node-pty/ConPTY behave as the POSIX contract assumed?' };
  let pty;
  try { pty = await import('node-pty'); }
  catch (e) { return { ...o, status: 'NOT TESTED', reason: `node-pty not installed: ${e.message}` }; }

  try {
    const p = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile'], { name: 'xterm-256color', cols: 100, rows: 30, cwd: process.cwd(), env: process.env });
    o.created = { pid: p.pid, cols: p.cols, rows: p.rows, process: p.process };
    let data = '';
    p.onData((d) => { data += d; });
    await sleep(2500);
    o.firstOutputBytes = data.length;

    /* stdout/stderr separability — the POSIX finding was that a PTY merges them. */
    p.write('Write-Output OUT-MARKER; Write-Error ERR-MARKER\r');
    await sleep(2000);
    o.stdoutStderrMerged = data.includes('OUT-MARKER') && data.includes('ERR-MARKER');

    /* resize — does the child observe it? */
    p.resize(40, 12);
    await sleep(400);
    p.write('$Host.UI.RawUI.WindowSize.Width\r');
    await sleep(1800);
    o.resizeObservedByChild = /\b40\b/.test(data.slice(-400));
    o.resizeApi = { cols: p.cols, rows: p.rows };

    /* Ctrl-C via the data channel (POSIX: line discipline raises SIGINT on the fg group) */
    p.write('Start-Sleep -Seconds 20\r');
    await sleep(1200);
    p.write('\x03');
    await sleep(2000);
    o.ctrlCInterruptedChild = !/Start-Sleep/.test(data.slice(-120)) || data.includes('^C');

    /* close + cleanup: does killing the PTY leave anything behind? */
    const before = treeOf(p.pid);
    let exitInfo = null;
    p.onExit((e) => { exitInfo = e; });
    p.kill();
    await sleep(2500);
    o.onExitFired = exitInfo !== null;
    o.onExit = exitInfo;
    o.shellAliveAfterKill = alive(p.pid);
    o.childrenBeforeKill = before;
    o.childrenAfterKill = treeOf(p.pid);
    o.status = 'PASS';
  } catch (e) { o.status = 'FAIL'; o.error = String(e); }
  return o;
})();

/* ---------------------------------------------------------------- C: process lifecycle */
R.spikes.processLifecycle = await (async () => {
  const o = { question: 'Do POSIX group-kill / signal findings have a working Windows analogue?' };
  try {
    /* a parent that spawns a grandchild — the crux case */
    const parent = spawn('powershell.exe',
      ['-NoProfile', '-Command', 'Start-Process -NoNewWindow powershell -ArgumentList \'-NoProfile\',\'-Command\',\'Start-Sleep -Seconds 120\'; Start-Sleep -Seconds 120'],
      { detached: true, stdio: 'ignore' });
    parent.on('error', (e) => { o.parentSpawnError = String(e); });
    await sleep(4000);
    o.parentPid = parent.pid;
    o.grandchildrenBefore = treeOf(parent.pid);

    /* 1. signals: Node documents SIGTERM on Windows as an unconditional TerminateProcess.
          Does a graceful tier exist at all? */
    const t0 = Date.now();
    try { process.kill(parent.pid, 'SIGTERM'); } catch (e) { o.sigtermError = String(e); }
    await sleep(1500);
    o.parentAliveAfterSigterm = alive(parent.pid);
    o.sigtermMs = Date.now() - t0;
    o.grandchildAfterParentKill = treeOf(parent.pid);
    o.orphanSurvivedParentKill = o.grandchildAfterParentKill.length > 0;

    /* 2. negative-pid group kill: documented as unsupported on Windows */
    try { process.kill(-parent.pid, 'SIGTERM'); o.negativePidSupported = true; }
    catch (e) { o.negativePidSupported = false; o.negativePidError = e.code || String(e); }

    /* 3. taskkill /T — the documented tree analogue. Does it reach a stranded grandchild? */
    const tk = ps(`taskkill /PID ${parent.pid} /T /F 2>&1 | Out-String`);
    o.taskkillTreeOutput = tk.slice(0, 400);
    await sleep(1500);
    o.parentAliveAfterTaskkill = alive(parent.pid);

    /* 4. leftover sweep by command line — can we even find an orphan? */
    o.orphanSweep = ps(`Get-CimInstance Win32_Process -Filter \\"Name='powershell.exe'\\" | Where-Object { $_.CommandLine -like '*Start-Sleep -Seconds 120*' } | Select-Object -ExpandProperty ProcessId`);
    if (o.orphanSweep && !o.orphanSweep.startsWith('ERROR')) {
      for (const pid of o.orphanSweep.split(/\s+/).filter(Boolean)) {
        ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
      }
    }

    /* 5. exit codes: does a cancelled child report something distinguishable? */
    const c = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 30'], { detached: true, stdio: 'ignore' });
    c.on('error', (e) => { o.cancelChildSpawnError = String(e); });
    await sleep(2000);
    const code = await new Promise((res) => { c.on('exit', (x, s) => res({ code: x, signal: s })); try { process.kill(c.pid, 'SIGTERM'); } catch {} });
    o.cancelledChildExit = code;
    o.exitCodeDistinguishesCancel = code.code !== 0;

    o.status = 'PASS';
  } catch (e) { o.status = 'FAIL'; o.error = String(e); }
  return o;
})();

writeResult();
console.log(JSON.stringify(R, null, 2));
