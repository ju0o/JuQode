'use strict';
/* WBS-08 · change-evidence basis, non-Git mechanism (`19` §E, `20` `evidence_kind`).
 *
 * Git is not a precondition for using JuQode (D-121). Without it the basis is a sha256
 * manifest of the project's files, stored in a JuQode-owned directory OUTSIDE the project —
 * nothing is ever written inside the user's folder.
 *
 * Exclusions are applied BY NAME BEFORE A FILE IS OPENED. That is what makes the manifest safe
 * to keep: a secret is never hashed, so its bytes never inform anything JuQode stores, not even
 * indirectly through a digest.
 *
 * The excluded SET is not identical to the Git path's, and pretending otherwise would be wrong:
 * there, `.gitignore` also decides, and the pathspec is case-sensitive where this is not. What
 * both paths share is the secret list and the promise that everything left out is still
 * accounted for in the ledger.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isSecretName, ledger } = require('./exclude');

/* Generated and vendored trees are not the user's changes. This is the interpreter's list plus
 * `vendor`, which it also skips — the two must not drift, because a directory in one list and
 * not the other is a directory whose changes one half of the product cannot see. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next',
                           '.venv', 'venv', '__pycache__', 'vendor']);

function capture(root, { maxBytes = 2 * 1024 * 1024 * 1024 } = {}) {
  const files = [];
  const skippedDirs = [];      // reported, because a skip nobody can see is a silent gap
  let bytes = 0;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch (e) { return { error: 'unreadable-path', detail: rel || '.', code: e.code }; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (isSecretName(e.name)) { skippedDirs.push(child); continue; }   // a secret directory
        if (SKIP_DIRS.has(e.name)) { skippedDirs.push(child); continue; }
        stack.push(child);
        continue;
      }
      if (!e.isFile()) continue;                 // symlinks are recorded by neither mechanism
      if (isSecretName(e.name)) continue;        // excluded BEFORE anything opens it
      let st;
      try { st = fs.statSync(path.join(root, child)); } catch { continue; }
      bytes += st.size;
      if (bytes > maxBytes) return { error: 'too-large', detail: String(bytes) };
      files.push({ path: child, size: st.size });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    try {
      f.sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f.path))).digest('hex');
    } catch { f.sha256 = null; f.unreadable = true; }
  }

  /* One digest over the whole listing: the basis `ref` a `evidence_basis` row stores. */
  const ref = crypto.createHash('sha256')
    .update(files.map((f) => `${f.path}\0${f.size}\0${f.sha256}`).join('\n')).digest('hex');

  /* Everything outside the manifest is accounted for by the ledger: the secret list, and the
   * generated/vendored trees this capture chose not to hash. */
  const extra = [];
  for (const d of skippedDirs) {
    const stack = [d];
    while (stack.length) {
      const rel = stack.pop();
      let entries;
      try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const child = `${rel}/${e.name}`;
        if (e.isDirectory()) { stack.push(child); continue; }
        if (e.isFile()) extra.push(child);
      }
    }
  }
  return { kind: 'hash_manifest', ref, files, skippedDirs: skippedDirs.sort(), excluded: ledger(root, extra) };
}

/** Which files differ between two manifests. Paths only — contents are not carried. */
function diff(before, after) {
  const b = new Map(before.files.map((f) => [f.path, f]));
  const a = new Map(after.files.map((f) => [f.path, f]));
  const out = [];
  for (const [p, f] of a) {
    const prev = b.get(p);
    if (!prev) { out.push({ path: p, change: 'added' }); continue; }
    /* An unreadable file has `sha256: null` on BOTH sides, and `null !== null` is false — so a
     * file that changed from 10 bytes to 29 read as unchanged. Size is compared too, and a
     * file we could not read is reported as such rather than as settled either way. */
    if (f.unreadable || prev.unreadable) {
      if (prev.size !== f.size) out.push({ path: p, change: 'modified', unreadable: true });
      else out.push({ path: p, change: 'unknown', unreadable: true });
      continue;
    }
    if (prev.sha256 !== f.sha256 || prev.size !== f.size) out.push({ path: p, change: 'modified' });
  }
  for (const p of b.keys()) if (!a.has(p)) out.push({ path: p, change: 'removed' });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

module.exports = { capture, diff, SKIP_DIRS };
