'use strict';
/* scripts/canon-checkout.mjs against a throwaway local "Private" repository (stand-in files, no network).
 * The real pin is in tests/canon.pin.json; here a pin of the same shape is built for the stand-in. */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const SCRIPT = path.join(R, 'scripts', 'canon-checkout.mjs');
const dirs = [];
const tmp = (p) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' }).trim();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function standIn() {
  const repo = tmp('juqode-canon-src-');
  g(repo, 'init', '-q');
  const files = { 'docs/current/a.md': 'stand-in A\n', 'docs/data/b.sql': 'stand-in B\n', 'docs/other/private-note.md': 'must not be checked out\n' };
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), body); }
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'one');
  const sha = g(repo, 'rev-parse', 'HEAD');
  const pin = { repo: 'ju0o/stand-in', sha, files: {
    'docs/current/a.md': { blob: g(repo, 'rev-parse', 'HEAD:docs/current/a.md'), sha256: sha256('stand-in A\n') },
    'docs/data/b.sql': { blob: g(repo, 'rev-parse', 'HEAD:docs/data/b.sql'), sha256: sha256('stand-in B\n') },
  } };
  return { repo, sha, pin };
}
const run = (pin, repo, out, extra = {}) => {
  const pinFile = path.join(tmp('juqode-pin-'), 'pin.json');
  fs.writeFileSync(pinFile, JSON.stringify(pin));
  return spawnSync(process.execPath, [SCRIPT, '--out', out, '--pin', pinFile, '--url', repo], { encoding: 'utf8', env: { ...process.env, ...extra } });
};
const globalConfigFingerprint = () => {
  const r = spawnSync('git', ['config', '--global', '--list'], { encoding: 'utf8' });
  return sha256(`${r.status}|${r.stdout}`);
};

test('a pinned sparse checkout contains ONLY the pinned files, at the pinned commit, and prints a manifest', () => {
  const { repo, sha, pin } = standIn();
  const out = tmp('juqode-canon-out-');
  const before = globalConfigFingerprint();
  const r = run(pin, repo, out);
  assert.strictEqual(r.status, 0, r.stderr);
  const dest = path.join(out, 'JuQode-Private');
  assert.strictEqual(g(dest, 'rev-parse', 'HEAD'), sha);
  assert.ok(fs.existsSync(path.join(dest, 'docs/current/a.md')) && fs.existsSync(path.join(dest, 'docs/data/b.sql')));
  assert.ok(!fs.existsSync(path.join(dest, 'docs/other/private-note.md')), 'sparse checkout pulled a file that was not pinned');
  const manifest = JSON.parse(r.stdout);
  assert.strictEqual(manifest.sha, sha);
  assert.strictEqual(manifest.files['docs/current/a.md'].sha256, sha256('stand-in A\n'));
  assert.ok(!r.stdout.includes('stand-in A'), 'Canon text was printed');
  assert.strictEqual(globalConfigFingerprint(), before, 'global Git config changed');
  assert.ok(!/credential|token/i.test(fs.readFileSync(path.join(dest, '.git', 'config'), 'utf8')), 'a credential setting was written');
});

const SIBLING = path.resolve(R, '..', 'JuQode-Private');
test('the REAL pin: a checkout of the pinned Private commit is found by the test helper and its bytes verify', { skip: !fs.existsSync(path.join(SIBLING, '.git')) && 'no local JuQode-Private to fetch from (the real fetch is `--url` = GitHub)' }, () => {
  const out = tmp('juqode-canon-real-');
  const r = spawnSync(process.execPath, [SCRIPT, '--out', out, '--url', `file://${SIBLING}`], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const { canonPath, readCanon, loadPin } = require('./canon.js');
  const env = { JUQODE_PRIVATE: path.join(out, 'JuQode-Private') };
  const c = canonPath('copy', { env, root: tmp('juqode-root-') });
  assert.ok(c.path && c.path.startsWith(out), `not found in the checkout: ${JSON.stringify(c)}`);
  assert.strictEqual(readCanon('schema', null, { env, root: tmp('juqode-root-') }).length > 0, true);   // verifies sha256 against the real pin
  assert.strictEqual(JSON.parse(r.stdout).sha, loadPin().sha);
});

test('any mismatch (sha, blob, bytes) FAILS and leaves nothing behind', () => {
  const { repo, sha, pin } = standIn();
  const cases = {
    'wrong commit': { ...pin, sha: 'f'.repeat(40) },
    'wrong blob id': { ...pin, files: { ...pin.files, 'docs/data/b.sql': { ...pin.files['docs/data/b.sql'], blob: 'a'.repeat(40) } } },
    'wrong content hash': { ...pin, files: { ...pin.files, 'docs/current/a.md': { ...pin.files['docs/current/a.md'], sha256: '0'.repeat(64) } } },
    'file not in the commit': { ...pin, files: { ...pin.files, 'docs/missing.md': { blob: 'b'.repeat(40), sha256: '1'.repeat(64) } } },
    'not a commit sha': { ...pin, sha: 'main' },
  };
  for (const [name, bad] of Object.entries(cases)) {
    const out = tmp('juqode-canon-out-');
    const r = run(bad, repo, out);
    assert.strictEqual(r.status, 1, `${name}: exit ${r.status}`);
    assert.ok(!fs.existsSync(path.join(out, 'JuQode-Private')), `${name}: a half-trusted checkout was left behind`);
    assert.ok(/canon-checkout:/.test(r.stderr), name);
  }
  assert.ok(sha);
});

test('an unreachable repository fails without prompting, and an existing directory is never reused', () => {
  const { pin } = standIn();
  const out = tmp('juqode-canon-out-');
  const r = run(pin, path.join(tmp('juqode-nope-'), 'no-repo'), out, { GIT_TERMINAL_PROMPT: '1' });   // the script forces it off
  assert.strictEqual(r.status, 1);
  assert.ok(!fs.existsSync(path.join(out, 'JuQode-Private')));
  fs.mkdirSync(path.join(out, 'JuQode-Private'));
  const again = run(pin, '/nowhere', out);
  assert.strictEqual(again.status, 1);
  assert.match(again.stderr, /already exists/);
  assert.ok(fs.existsSync(path.join(out, 'JuQode-Private')), 'the script deleted a directory it did not create');
});
