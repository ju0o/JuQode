'use strict';
/* The e2e launch policy (tests/e2e/launch.mjs) and its non-launching preflight. Nothing here starts
 * Electron: the plan is computed from injected facts, and the preflight is run as a process that only
 * reports. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const load = () => import(path.join(R, 'tests/e2e/launch.mjs'));

test('a private virtual display needs no consent; a real desktop does, on every host', async () => {
  const { displayPlan, launchArgs, VISIBLE_CONSENT } = await load();
  const xvfb = displayPlan({ platform: 'linux', env: {}, haveXvfb: () => true });
  assert.deepStrictEqual([xvfb.mode, xvfb.visible], ['xvfb', false]);
  assert.deepStrictEqual(launchArgs(['.'], xvfb)[0], 'xvfb-run');

  const wsl = (env) => displayPlan({ platform: 'linux', env: { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', WSL_DISTRO_NAME: 'Ubuntu', ...env }, haveXvfb: () => false });
  const no = wsl({});
  assert.deepStrictEqual([no.mode, no.visible, no.consent, no.wsl], ['host-display', true, false, true]);
  assert.throws(() => launchArgs(['.'], no), /real windows on this machine's desktop.*JUQODE_E2E_VISIBLE=yes.*nothing was launched/s);
  for (const wrong of ['1', 'true', 'YES', '']) {
    assert.throws(() => launchArgs(['.'], wsl({ [VISIBLE_CONSENT]: wrong })), /explicit/, `consent accepted from ${JSON.stringify(wrong)}`);
  }
  const yes = wsl({ [VISIBLE_CONSENT]: 'yes' });
  assert.strictEqual(yes.consent, true);
  assert.strictEqual(launchArgs(['.', '--no-sandbox'], yes)[0].endsWith('electron'), true, 'host-display must not wrap in xvfb-run');

  const winNo = displayPlan({ platform: 'win32', env: {} });
  assert.deepStrictEqual([winNo.mode, winNo.visible, winNo.consent], ['windows-desktop', true, false]);
  assert.throws(() => launchArgs(['.'], winNo), /real windows/);
  assert.strictEqual(launchArgs(['.'], displayPlan({ platform: 'win32', env: { [VISIBLE_CONSENT]: 'yes' } }))[1][0], '/d');

  const none = displayPlan({ platform: 'linux', env: {}, haveXvfb: () => false });
  assert.strictEqual(none.mode, 'refused');
  assert.throws(() => launchArgs(['.'], none), /cannot start/);
});

test('preflight reports and exits without launching: blocked 2 when consent is missing, ready only when nothing blocks', () => {
  const env = (extra) => ({ ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '', ...extra });
  const r = spawnSync(process.execPath, [path.join(R, 'tests/e2e/preflight.mjs')], { encoding: 'utf8', env: env({}) });
  const report = JSON.parse(r.stdout);
  assert.ok('display' in report && 'willOpenVisibleWindows' in report && 'goldens' in report && Array.isArray(report.blockers));
  assert.strictEqual(report.data.realUserDataTouched, false);
  assert.strictEqual(report.goldens.wouldBeModified, false);
  assert.strictEqual(r.status, report.ready ? 0 : 2);
  assert.strictEqual(report.ready, report.blockers.length === 0);
  // a host that can only show real windows is blocked until the person says yes
  if (report.display.mode !== 'xvfb') assert.ok(report.blockers.some((b) => /consent|JUQODE_E2E_VISIBLE|windows|xvfb|Electron/.test(b)));
  assert.ok(/tmp-visual/.test(report.screenshots));
});

test('visual.mjs refuses --update-golden outside xvfb and keeps host screenshots out of the goldens', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(R, 'tests/e2e/visual.mjs'), 'utf8');
  assert.match(src, /UPDATE && PLAN\.mode !== 'xvfb'/, '--update-golden is no longer refused under a visible host display');
  assert.match(src, /tmp-visual-\$\{HOST_LABEL\}/);
  assert.match(src, /points into the tracked goldens/);
  assert.match(fs.readFileSync(path.join(R, '.gitignore'), 'utf8'), /^tmp-visual-\*\/$/m, 'host screenshot dirs must be untracked');
});

test('every e2e launch site hands the app a temp JUQODE_DB AND JUQODE_USER_DATA (the real user data is never reachable)', () => {
  const fs = require('node:fs');
  for (const f of ['boot.test.mjs', 'visual.mjs', 'offline-shutdown.mjs']) {
    const lines = fs.readFileSync(path.join(R, 'tests/e2e', f), 'utf8').split('\n');
    let sites = 0;
    lines.forEach((l, i) => {
      if (!/\b(launchArgs|spawnApp)\(\[/.test(l) || /\.\.\.args/.test(l)) return;           // the shared wrapper itself, not a launch site
      sites += 1;
      const window = lines.slice(i, i + 8).join('\n');
      assert.ok(/JUQODE_USER_DATA/.test(window) && /JUQODE_DB/.test(window), `${f}:${i + 1} launches the app without both temp data variables`);
    });
    assert.ok(sites >= 1, `${f}: no launch site found -- the pattern this guard relies on changed`);
  }
});
