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

/* HOW THE APP GETS A DISPLAY -- and who sees it.
 *
 *   xvfb          Linux with `xvfb-run`: a private virtual display. Nothing appears on anyone's screen.
 *   host-display  Linux WITHOUT xvfb-run but with DISPLAY / WAYLAND_DISPLAY (WSLg): the app's REAL windows
 *                 open on the user's desktop.
 *   windows-desktop  Windows has no virtual display here: real windows on the user's desktop.
 * The last two put windows in front of a person, so they are refused unless the run says so with
 * JUQODE_E2E_VISIBLE=yes. A harness must never open windows on a user's screen as a side effect of
 * `npm test`. `node tests/e2e/preflight.mjs` reports the plan without launching anything. */
export const VISIBLE_CONSENT = 'JUQODE_E2E_VISIBLE';

function hasXvfbRun() {
  const r = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' });
  return !(r.error && r.error.code === 'ENOENT');
}

export function displayPlan({ platform = process.platform, env = process.env, haveXvfb = hasXvfbRun } = {}) {
  const consent = env[VISIBLE_CONSENT] === 'yes';
  if (platform === 'win32') return { mode: 'windows-desktop', visible: true, consent };
  if (haveXvfb()) return { mode: 'xvfb', visible: false, consent: true };
  const display = env.DISPLAY || env.WAYLAND_DISPLAY || null;
  if (!display) return { mode: 'refused', visible: false, consent: false, reason: 'no xvfb-run and no DISPLAY/WAYLAND_DISPLAY' };
  return { mode: 'host-display', visible: true, consent, display, wsl: Boolean(env.WSL_DISTRO_NAME) };
}

/** [file, argv] for spawn(). `args` are the app's own arguments, e.g. ['.', '--no-sandbox']. */
export function launchArgs(args, plan = displayPlan()) {
  if (plan.mode === 'refused') throw new Error(`e2e cannot start: ${plan.reason}`);
  if (plan.visible && !plan.consent) {
    throw new Error(`e2e would open real windows on this machine's desktop (${plan.mode}). That needs an explicit ${VISIBLE_CONSENT}=yes from the person at that screen; `
      + 'it was not given, so nothing was launched. (No virtual display is available: install xvfb-run or consent to visible windows.)');
  }
  if (plan.mode === 'windows-desktop') return [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', ELECTRON, ...args]];
  if (plan.mode === 'host-display') return [ELECTRON, args];
  return ['xvfb-run', ['-a', ELECTRON, ...args]];
}

/* Ending what a run started. Both functions take the OWNED ChildProcess HANDLE, never a bare pid:
 * a number says nothing about whose process it is now, and "safe to call on an already-dead pid" was
 * exactly the hazard (the number may have been given to a stranger). A handle that has already exited
 * is never signalled. While the handle is open the OS cannot reuse its pid, which is what makes the one
 * signal sent below land on our process. The tree under it is ended by the platform's own tree/group
 * mechanism -- POSIX process group (the app is spawned `detached`, so the child leads its own group) and
 * Windows `taskkill /T` -- and nothing is ever matched by name or pattern. */
const open = (child) => Boolean(child && Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null);

/** The whole tree under the handle we own. A handle that already exited is left alone. */
export function killTree(child) {
  if (typeof child === 'number') throw new TypeError('killTree needs the owned ChildProcess, not a pid');
  if (!open(child)) return false;
  if (WIN) { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return true; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  return true;
}

/** Graceful tree stop -- the analogue of SIGTERM to the process group. No /F on Windows:
 *  `taskkill /T` alone asks the window to close, which is the path under test. */
export function termTree(child) {
  if (typeof child === 'number') throw new TypeError('termTree needs the owned ChildProcess, not a pid');
  if (!open(child)) return false;
  if (WIN) { spawnSync('taskkill', ['/PID', String(child.pid), '/T'], { stdio: 'ignore' }); return true; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  return true;
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
