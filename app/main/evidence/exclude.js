'use strict';
/* JuQode's OWN secret-exclusion list, and the ledger that accounts for what it excludes.
 *
 * D-126a: this list is JuQode's and does NOT come from `.gitignore`. A user who never
 * gitignored `.env` would otherwise get plaintext secrets in permanent evidence — that was
 * measured, not theorised (`07` §8, spike D′).
 *
 * The ledger records `(path, size, mtime_ns)` and NOTHING ELSE. Contents are never opened, so
 * a secret cannot leak through it. That is also its limit, and the limit is the product's
 * sentence: JuQode never says "the excluded files did not change". It can say "these paths are
 * outside the evidence, and these of them changed".
 */
const fs = require('node:fs');
const path = require('node:path');

/** D-126a lists these by name. `.env*` is a prefix rule, not just `.env` and `.env.<x>`. */
const GLOBS = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa', 'id_dsa', '*.p12', '*.pfx'];

const RE = [
  /^\.env/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.jks$/i,
  /^id_rsa/i, /^id_dsa/i, /^id_ecdsa/i, /^id_ed25519/i,
];

const isSecretName = (name) => RE.some((re) => re.test(name));

/** The `add -A` pathspec. Both forms are needed: bare, and at any depth. */
const pathspec = () => [
  ...GLOBS.map((g) => `:(exclude,glob)${g}`),
  ...GLOBS.map((g) => `:(exclude,glob)**/${g}`),
];

/**
 * Metadata for every excluded path under `root`. Never opens a file.
 * @returns {{path:string,size:number,mtimeNs:string}[]} sorted by path
 */
function ledger(root, extra = []) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (child === '.git' || child.endsWith('/.git')) continue;
      if (e.isDirectory()) { walk(child); continue; }
      if (!e.isFile()) continue;                 // a symlink's target is not ours to stat
      if (!isSecretName(e.name) && !extra.includes(child)) continue;
      try {
        /* `{ bigint: true }` is REQUIRED: a plain statSync has no `mtimeNs` at all, so the
         * ledger recorded the string "undefined" for every entry and could only ever detect a
         * SIZE change. A same-size edit — the ordinary case for a rotated credential — was
         * invisible, which is precisely the silence D-126a replaced the old mechanism to avoid.
         * The WBS-00 spike that validated this contract had the same defect and its result
         * held only because that fixture's file also grew. */
        const st = fs.statSync(path.join(root, child), { bigint: true });
        out.push({ path: child, size: Number(st.size), mtimeNs: String(st.mtimeNs) });
      } catch { /* vanished between readdir and stat */ }
    }
  };
  walk('');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * What changed among paths the evidence does not cover.
 * @returns {{path:string, change:'added'|'removed'|'modified'}[]}
 */
function ledgerDiff(before, after) {
  const out = [];
  const byPath = (list) => new Map(list.map((e) => [e.path, e]));
  const b = byPath(before);
  const a = byPath(after);
  for (const [p, e] of a) {
    const prev = b.get(p);
    if (!prev) out.push({ path: p, change: 'added' });
    else if (prev.size !== e.size || prev.mtimeNs !== e.mtimeNs) out.push({ path: p, change: 'modified' });
  }
  for (const p of b.keys()) if (!a.has(p)) out.push({ path: p, change: 'removed' });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

module.exports = { GLOBS, isSecretName, pathspec, ledger, ledgerDiff };
