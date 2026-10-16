#!/usr/bin/env node
/* E2E preflight: says what a run WOULD do on this host and what it would touch. It launches nothing,
 * opens no window, and writes nothing.
 *
 *   node tests/e2e/preflight.mjs            # prints JSON, exit 0 = ready, 2 = blocked
 *   JUQODE_E2E_VISIBLE=yes node tests/e2e/preflight.mjs   # what it would say once the person at this screen agreed
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { displayPlan, countElectron, ROOT, VISIBLE_CONSENT } from './launch.mjs';

const plan = displayPlan();
const blockers = [];
const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const electronPresent = fs.existsSync(electronBin);
if (!electronPresent) blockers.push('the Electron binary is not installed in this checkout (node node_modules/electron/install.js; nothing was downloaded by this check)');
if (plan.mode === 'refused') blockers.push(plan.reason);
if (plan.visible && !plan.consent) blockers.push(`real windows would open on this desktop; needs ${VISIBLE_CONSENT}=yes from the person at the screen`);

const golden = path.join('docs', 'dev-evidence', 'screens');
const dirty = spawnSync('git', ['status', '--porcelain', '--', golden], { cwd: ROOT, encoding: 'utf8' });
const host = (process.env.JUQODE_E2E_HOST || process.platform).replace(/[^A-Za-z0-9_-]/g, '');

const report = {
  host: { platform: process.platform, release: os.release(), wsl: Boolean(process.env.WSL_DISTRO_NAME), label: host },
  display: plan,
  willOpenVisibleWindows: plan.visible,
  consentGiven: plan.consent,
  data: {
    note: 'every run creates its own temp JUQODE_DB and JUQODE_USER_DATA (mkdtemp under the OS temp dir); the real user data directory is never passed',
    tempRoot: os.tmpdir(),
    realUserDataTouched: false,
  },
  screenshots: plan.mode === 'xvfb' ? 'tmp-visual (untracked)' : `tmp-visual-${host} (untracked)`,
  goldens: { path: golden, wouldBeModified: false, workingTreeDirty: Boolean(dirty.stdout?.trim()), updateRefusedUnless: 'xvfb' },
  electronBinaryPresent: electronPresent,
  existingElectronProcessesOfThisCheckout: countElectron(),
  /* What a real run would put in front of a person and on disk -- disclosed BEFORE anything starts. */
  disclosure: {
    windows: plan.visible
      ? `the app's real windows (the main window and any dialog it opens) on ${plan.mode === 'windows-desktop' ? 'this Windows desktop' : `display ${plan.display ?? '?'}${plan.wsl ? ' via WSLg' : ''}`}, for roughly the length of the suite; ordinary windows of the user are not touched`
      : 'none -- a private virtual display nobody sees',
    userDataAndDb: 'a fresh mkdtemp JUQODE_DB and JUQODE_USER_DATA per launch under the OS temp dir, removed at exit; the real application data directory is never passed',
    screenshotsGoTo: plan.mode === 'xvfb' ? 'tmp-visual (untracked)' : `tmp-visual-${host} (untracked); the tracked goldens are neither written nor replaced`,
    otherFootprint: 'local-only DevTools ports from JUQODE_E2E_PORT (default 9223, three consecutive) on 127.0.0.1; fixture projects, fake CLIs and a bare evidence store under the temp dir; Chromium profile inside the temp user-data dir; nothing outside the temp dir and the screenshot directory',
    endingProcesses: 'only the process tree of each launch the run itself started, through that launch\'s own ChildProcess handle (a handle that already exited is never signalled)',
    network: 'none by the app (the e2e guard blocks outbound requests); the checkout needs its Electron binary installed beforehand',
  },
  cleanup: 'only the process tree this run started (its own pid): process group on POSIX, taskkill /PID <own pid> /T on Windows',
  blockers,
  ready: blockers.length === 0,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ready ? 0 : 2);
