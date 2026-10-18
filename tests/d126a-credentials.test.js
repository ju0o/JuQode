/* V1-409 · the credential-file names D-126a did not list (.npmrc .netrc .pypirc credentials.json
 * service-account.json *.keystore) are excluded on all three paths: the name check, the `add -A`
 * pathspec, and `rm --cached` on the index copy - plus the metadata-only ledger.
 * Synthetic scratch repository only; no real credential file is opened. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const R = path.resolve(__dirname, '..');
const X = require(path.join(R, 'app/main/evidence/exclude.js'));
const G = require(path.join(R, 'app/main/evidence/git.js'));
const { isSecret } = require(path.join(R, 'app/main/interpret/scan.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const NEW = ['.npmrc', '.netrc', '.pypirc', 'credentials.json', 'service-account.json', 'release.keystore'];
const MARK = 'SYNTH-CRED-9f3a71c2';

test('isExcludedPath / isSecretName: the six names, any depth, any case; look-alikes stay in', () => {
  for (const f of NEW) {
    for (const p of [f, `a/b/${f}`, f.toUpperCase(), `x/${f[0].toUpperCase()}${f.slice(1)}`, `.NpmRc`]) {
      assert.strictEqual(X.isExcludedPath(p), true, p);
    }
    assert.strictEqual(isSecret(f), true, `interpret scan shares the list: ${f}`);
  }
  assert.strictEqual(X.isExcludedPath('Prod.KeyStore'), true);
  assert.strictEqual(X.isExcludedPath('.npmrc/inner.txt'), true, 'a directory with the name is a secret');
  for (const ok of ['npmrc', 'x.npmrc.md', 'credentials.jsonc', 'my-credentials.json', 'service-account.json.md', 'keystore', 'keystore.js', 'src/netrc.js', 'pypirc.txt']) {
    assert.strictEqual(X.isExcludedPath(ok), false, `wrongly excluded: ${ok}`);
  }
  assert.ok(X.pathspec().some((s) => s.includes('.npmrc')) && X.pathspec().some((s) => s.includes('*.keystore')));
});

const g = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (p === '.git') { out['.git/index'] = sha(path.join(dir, '.git/index')); out['.git/HEAD'] = sha(path.join(dir, '.git/HEAD')); continue; }
      if (e.isDirectory()) walk(p); else if (e.isFile()) out[p] = sha(path.join(dir, p));
    }
  };
  walk('');
  return out;
}

test('Git Evidence: new, already-tracked, nested and mixed-case credential files never enter the basis or the store', () => {
  const dir = tempDir('juqode-d126a-');
  const store = tempDir('juqode-d126a-store-');
  g(dir, 'init', '-q', '.'); g(dir, 'config', 'user.email', 't@t'); g(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'deploy/Env'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'export const a = 1;\n');
  const tracked = ['.npmrc', 'deploy/Env/.NetRC'];                     // committed BEFORE the Work
  const fresh = ['.pypirc', 'sub/Credentials.JSON', 'sub/deep/service-account.json', 'release.KeyStore'];
  fs.mkdirSync(path.join(dir, 'sub/deep'), { recursive: true });
  for (const f of tracked) fs.writeFileSync(path.join(dir, f), `token=${MARK}-${f}\n`);
  g(dir, 'add', '-A', '.'); g(dir, 'commit', '-qm', 'baseline');
  for (const f of fresh) fs.writeFileSync(path.join(dir, f), `token=${MARK}-${f}\n`);        // untracked, new

  const userBefore = snapshot(dir);
  const before = G.capture(dir, store, 'before');
  /* the basis starts from an EMPTY index (git.js), so a tracked credential never arrives; `rm --cached` is the belt */
  assert.ok(before.excluded.map((e) => e.path).includes('.npmrc') && before.excluded.map((e) => e.path).includes('release.KeyStore'));
  assert.ok(!JSON.stringify(before).includes(MARK), 'ledger / basis record hold paths and sizes, never content');
  for (const e of before.excluded) assert.deepStrictEqual(Object.keys(e).sort(), ['mtimeNs', 'path', 'size']);

  /* the Work changes an ordinary file AND every credential file */
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'export const a = 2;\n');
  for (const f of [...tracked, ...fresh]) fs.writeFileSync(path.join(dir, f), `token=${MARK}-CHANGED-${f}\n`);
  const after = G.capture(dir, store, 'after');

  for (const ref of [before.ref, after.ref]) {
    for (const f of G.treePaths(dir, store, ref)) assert.ok(!X.isExcludedPath(f), `credential file in the basis tree: ${f}`);
  }
  assert.deepStrictEqual(G.changedPaths(dir, store, before.ref, after.ref), ['src/app.js']);
  assert.ok(!G.diff(dir, store, before.ref, after.ref).includes(MARK));
  /* no secret blob (original or changed content) was written to JuQode's own object store */
  for (const f of [...tracked, ...fresh]) {
    for (const body of [`token=${MARK}-${f}\n`, `token=${MARK}-CHANGED-${f}\n`]) {
      const tmp = path.join(tempDir('juqode-d126a-h-'), 'b'); fs.writeFileSync(tmp, body);
      const h = g(dir, 'hash-object', tmp).trim();
      if (body.includes('CHANGED') || fresh.includes(f)) {
        assert.ok(!fs.existsSync(path.join(store, 'objects', h.slice(0, 2), h.slice(2))), `${f}: blob written to the evidence store`);
      }
    }
  }
  /* what DID change among excluded paths is reported as metadata */
  const d = X.ledgerDiff(before.excluded, after.excluded).map((x) => x.path);
  for (const f of [...tracked, ...fresh]) assert.ok(d.includes(f), `${f}: change not reported`);

  /* the user's worktree and index are exactly what the Work left them (only our own edits differ) */
  const userAfter = snapshot(dir);
  assert.strictEqual(userAfter['.git/index'], userBefore['.git/index'], 'user .git/index untouched');
  assert.strictEqual(userAfter['.git/HEAD'], userBefore['.git/HEAD']);
  assert.strictEqual(g(dir, 'status', '--porcelain', '--', '.npmrc').trim().startsWith('M'), true, 'tracked credential file still tracked in the USER repo');
});
