'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { identify, guardLaunch, permissiveArgs, capability, launchable } = require(path.join(__dirname, '../app/main/provider/identity.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-pid-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const bin = path.join(dir, 'tool'); fs.writeFileSync(bin, 'v1');
const run = (v) => () => `${v}\nsecond line`;

test('identity needs an absolute real binary and a readable version; shims, relative names and missing files are refused', () => {
  const ok = identify(bin, run('tool 1.19.0'));
  assert.deepStrictEqual([ok.ok, ok.id.version, ok.id.sha256.length], [true, 'tool 1.19.0', 64]);
  for (const [p, why] of [['opencode', 'not-an-absolute-path'], ['./tool', 'not-an-absolute-path'], [path.join(dir, 'x.cmd'), 'script-shim-not-a-binary'],
    [path.join(dir, 'x.ps1'), 'script-shim-not-a-binary'], [path.join(dir, 'missing'), 'not-found'], [dir, 'not-a-file'], [null, 'not-an-absolute-path']]) {
    assert.deepStrictEqual(identify(p, run('v')), { ok: false, reason: why }, String(p));
  }
  assert.strictEqual(identify(bin, () => '').reason, 'version-unreadable');
  assert.strictEqual(identify(bin, () => { throw new Error('x'); }).reason, 'version-unreadable');
});

test('a launch is refused when the recorded path now holds other bytes or reports another version; a symlink resolves to its target', () => {
  const rec = identify(bin, run('tool 1.19.0')).id;
  assert.deepStrictEqual(guardLaunch(rec, run('tool 1.19.0')), { ok: true });
  assert.strictEqual(guardLaunch(rec, run('tool 2.0.31')).reason, 'version-changed');
  const link = path.join(dir, 'link');
  try { fs.symlinkSync(bin, link); assert.strictEqual(identify(link, run('t')).id.path, fs.realpathSync(bin)); } catch (e) { if (e.code !== 'EPERM') throw e; }
  fs.writeFileSync(bin, 'v2-different-bytes');
  assert.strictEqual(guardLaunch(rec, run('tool 1.19.0')).reason, 'binary-changed');
  fs.rmSync(bin); assert.strictEqual(guardLaunch(rec, run('x')).reason, 'not-found');
  for (const bad of [null, {}, { path: bin }, { path: bin, sha256: 'a' }]) assert.strictEqual(guardLaunch(bad, run('x')).reason, 'no-recorded-identity');
});

test('flags that drop the provider\'s own permission checks are found, ordinary ones are not', () => {
  assert.deepStrictEqual(permissiveArgs(['run', '--auto', '--model', 'm', '--dangerously-skip-permissions', 'approval_policy = "never"', 'sandbox_mode=danger-full-access']),
    ['--auto', '--dangerously-skip-permissions', 'approval_policy = "never"', 'sandbox_mode=danger-full-access']);
  assert.deepStrictEqual(permissiveArgs(['--sandbox', 'read-only', '--allowedTools', 'Edit(hello.txt)']), []);
  assert.deepStrictEqual(permissiveArgs(null), []);
});

test('capability states are a closed set; unmeasured is UNKNOWN; only SUPPORTED/LIMITED may launch', () => {
  assert.strictEqual(capability('codex', 'H2', 'PASS', 'x').state, 'UNKNOWN');
  assert.strictEqual(capability('codex', 'H2', undefined).state, 'UNKNOWN');
  for (const [s, l] of [['SUPPORTED', true], ['LIMITED', true], ['UNSUPPORTED', false], ['UNKNOWN', false]]) assert.strictEqual(launchable(capability('p', 'h', s, '')), l, s);
  assert.strictEqual(launchable(null), false);
  assert.throws(() => { 'use strict'; capability('p', 'h', 'SUPPORTED', '').state = 'x'; }, TypeError);
});
