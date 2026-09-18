/* One place that knows how to start Electron for an e2e run, on either OS.
 *
 * Linux has no display in CI, so the app goes under `xvfb-run`. Windows has a real desktop and
 * has neither `xvfb-run` nor `node_modules/.bin/electron` — there the shim is `electron.cmd`,
 * and Node refuses to spawn a `.cmd` directly (CVE-2024-27980), so it must go through
 * `cmd.exe /d /s /c`. That is the same rule the product itself follows in
 * `app/main/claude-detect.js` — getting it wrong there made every Work fail to start on
 * Windows while detection still reported success.
 *
 * Killing is the other half: on Linux `detached` puts the whole tree in one process group and
 * a negative-pid signal stops it. Windows has no process groups to signal, and killing the
 * `cmd.exe` wrapper leaves the real electron.exe running — the leak `verify-windows.ps1`
 * reported. `taskkill /T /F` is the documented tree analogue.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WIN = process.platform === 'win32';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ELECTRON = path.join(ROOT, 'node_modules', '.bin', WIN ? 'electron.cmd' : 'electron');

/** [file, argv] for spawn(). `args` are the app's own arguments, e.g. ['.', '--no-sandbox']. */
export function launchArgs(args) {
  return WIN
    ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', ELECTRON, ...args]]
    : ['xvfb-run', ['-a', ELECTRON, ...args]];
}

/** The whole tree, not just the process we hold. Safe to call on an already-dead pid. */
export function killTree(pid) {
  if (!pid) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }
}

/** Graceful tree stop — the analogue of SIGTERM to the process group. No /F on Windows:
 *  `taskkill /T` alone asks the window to close, which is the path under test. */
export function termTree(pid) {
  if (!pid) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ } }
}

/** How many Electron processes belonging to THIS checkout are running, as a string.
 *  Scoped to this node_modules on purpose: any other Electron app on the machine is also
 *  called `electron.exe`, and counting those would fail the orphan assertions for no reason. */
export function countElectron() {
  if (WIN) {
    const like = path.join(ROOT, 'node_modules', 'electron') + '*';
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |` +
      ` Where-Object { $_.ExecutablePath -like '${like.replace(/'/g, "''")}' }).Count`],
      { encoding: 'utf8' });
    return (r.stdout || '0').trim() || '0';
  }
  const r = spawnSync('bash', ['-lc', `pgrep -f "${ROOT}/node_module[s]/electron" | wc -l`], { encoding: 'utf8' });
  return (r.stdout || '0').trim();
}
