/* Xvfb display hygiene for the e2e runs.
 *
 * `xvfb-run -a` picks the first FREE display by scanning `/tmp/.X<n>-lock`. A run killed before
 * its Xvfb exits leaves both the lock and the socket behind, and they accumulate.
 *
 * MEASURED, in this session: after roughly fifteen e2e runs `/tmp` held 156 stale locks and 100
 * sockets, `xvfb-run -a` could no longer obtain a display, and EVERY e2e failed with
 * `app never became ready` — while the app booted perfectly when started by hand. A harness
 * leak reported as a product failure, and it cost a long detour to tell the two apart.
 *
 * Same lesson as `tests/tmp.js`: cleanup that only runs when a process exits cleanly is not
 * cleanup. Each run sweeps what earlier runs left behind, before asking for anything of its own.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Displays below this belong to real sessions and are never touched. */
const FIRST_SCRATCH_DISPLAY = 100;

export function sweepDisplays() {
  let names;
  try { names = fs.readdirSync('/tmp'); } catch { return 0; }

  let removed = 0;
  for (const name of names) {
    const m = /^\.X(\d+)-lock$/.exec(name);
    if (!m) continue;
    const display = Number(m[1]);
    if (display < FIRST_SCRATCH_DISPLAY) continue;

    const lock = path.join('/tmp', name);
    try {
      const pid = Number(fs.readFileSync(lock, 'utf8').trim());
      /* `kill(pid, 0)` asks whether the process exists; it sends nothing. A live Xvfb keeps its
       * lock — another e2e may be running right now. */
      if (pid > 0) { process.kill(pid, 0); continue; }
    } catch { /* unreadable, or no such process: the lock is stale */ }

    try { fs.rmSync(lock, { force: true }); removed += 1; } catch { /* someone else got it */ }
    try { fs.rmSync(path.join('/tmp/.X11-unix', `X${display}`), { force: true }); } catch { /* gone */ }
  }
  return removed;
}
