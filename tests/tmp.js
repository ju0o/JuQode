'use strict';
/* One disposable-directory helper for the whole suite.
 *
 * Eight test files each carried their own copy, and each copy cleaned up in `process.on('exit')`
 * — which does not run when a test run is killed, crashes, or is interrupted. MEASURED: after
 * roughly twenty suite runs `/tmp` held 5,991 `juqode-*` directories and 836 MB, the tmpfs quota
 * was reached, and the suite began failing INTERMITTENTLY AND IN DIFFERENT PLACES EACH RUN —
 * `Unknown system error -122` (EDQUOT) in one file, a Work whose changes measured empty in
 * another. A 50% flake rate makes every "N tests pass" claim in this repository worthless, and
 * it took a mutation run to notice, because a flaky suite also silently kills mutants.
 *
 * So cleanup does not depend on this process exiting properly: every run SWEEPS what earlier
 * runs left behind, before it makes anything of its own.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'juqode-';
/* Old enough that a concurrently running suite's directories are never touched. */
const STALE_MS = 30 * 60 * 1000;

let swept = false;

/** Remove `juqode-*` directories older than half an hour, whatever left them behind. */
function sweep() {
  if (swept) return;
  swept = true;
  const root = os.tmpdir();
  const cutoff = Date.now() - STALE_MS;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.name.startsWith(PREFIX)) continue;
    const p = path.join(root, e.name);
    try {
      if (fs.statSync(p).mtimeMs > cutoff) continue;
      fs.rmSync(p, { recursive: true, force: true });
    } catch { /* someone else's, or already gone */ }
  }
}

const mine = [];

/** A disposable directory, removed when this process exits — and swept later if it does not. */
function tempDir(prefix = PREFIX) {
  sweep();
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  mine.push(d);
  return d;
}

process.on('exit', () => {
  for (const d of mine) {
    /* A test may have made a file unreadable on purpose; make it removable again first. */
    try { fs.rmSync(d, { recursive: true, force: true }); }
    catch {
      try { fs.chmodSync(d, 0o700); fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
    }
  }
});

module.exports = { tempDir, sweep, PREFIX, STALE_MS };
