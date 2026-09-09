'use strict';
/* WBS-08 · change-evidence basis, non-Git mechanism (`19` §E, `20` `evidence_kind`).
 *
 * Git is not a precondition for using JuQode (D-121). Without it the basis is a sha256
 * manifest of the project's files, stored in a JuQode-owned directory OUTSIDE the project —
 * nothing is ever written inside the user's folder.
 *
 * Exclusions are applied BY NAME BEFORE A FILE IS OPENED, exactly as on the Git path. That is
 * what makes the manifest safe to keep: a secret is never hashed, so its bytes never inform
 * anything JuQode stores, not even indirectly through a digest.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isSecretName, ledger } = require('./exclude');

/* Generated and vendored trees are not the user's changes. Same list the interpreter skips. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.venv', 'venv', '__pycache__']);

function capture(root, { maxBytes = 2 * 1024 * 1024 * 1024 } = {}) {
  const files = [];
  let bytes = 0;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch (e) { return { error: 'unreadable-path', detail: rel || '.', code: e.code }; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(child); continue; }
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

  return { kind: 'hash_manifest', ref, files, excluded: ledger(root) };
}

/** Which files differ between two manifests. Paths only — contents are not carried. */
function diff(before, after) {
  const b = new Map(before.files.map((f) => [f.path, f]));
  const a = new Map(after.files.map((f) => [f.path, f]));
  const out = [];
  for (const [p, f] of a) {
    const prev = b.get(p);
    if (!prev) out.push({ path: p, change: 'added' });
    else if (prev.sha256 !== f.sha256) out.push({ path: p, change: 'modified' });
  }
  for (const p of b.keys()) if (!a.has(p)) out.push({ path: p, change: 'removed' });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

module.exports = { capture, diff, SKIP_DIRS };
