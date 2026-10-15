'use strict';
/* Where the Private Canon lives, for the two tests that compare shipped files with it.
 *
 * Order, and nothing else:
 *   1. the explicit env var — if it is SET it is the answer, even when it is wrong. A typo must
 *      fail loudly, not quietly fall through to some other copy;
 *   2. `JUQODE_PRIVATE` (a checkout root) then the sibling `../JuQode-Private`, each accepted only
 *      when it is a real checkout (`.git` present and `docs/current` present).
 * No fixture, bundled copy or default content ever stands in for a missing Canon: the caller gets
 * `path: null` and must fail. The Canon text itself is never copied into this repository. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const KINDS = {
  copy:   { env: 'JUQODE_CANON',      rel: ['docs', 'current', '18_KOREAN_UX_COPY.md'] },
  schema: { env: 'JUQODE_CANON_DATA', rel: ['docs', 'data', 'schema.sql'] },
};

const isCheckout = (dir) => {
  try { return fs.existsSync(path.join(dir, '.git')) && fs.statSync(path.join(dir, 'docs', 'current')).isDirectory(); }
  catch { return false; }
};

function canonPath(kind, { env = process.env, root = ROOT } = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown Canon kind: ${kind}`);
  const tried = [];
  if (env[k.env]) {
    const p = path.resolve(env[k.env]);
    tried.push(`${k.env}=${p}`);
    return fs.existsSync(p) ? { path: p, source: k.env, tried } : { path: null, source: null, tried };
  }
  for (const [label, dir] of [['JUQODE_PRIVATE', env.JUQODE_PRIVATE && path.resolve(env.JUQODE_PRIVATE)],
                              ['sibling ../JuQode-Private', path.resolve(root, '..', 'JuQode-Private')]]) {
    if (!dir) continue;
    const p = path.join(dir, ...k.rel);
    tried.push(`${label}=${p}`);
    if (isCheckout(dir) && fs.existsSync(p)) return { path: p, source: label, tried };
  }
  return { path: null, source: null, tried };
}

/** The Canon file's bytes, or a failure message naming every place that was looked at. */
function readCanon(kind, encoding, opts) {
  const c = canonPath(kind, opts);
  if (!c.path) {
    const k = KINDS[kind];
    const err = new Error(`Canon ${kind} not found (tried: ${c.tried.join('; ') || 'nothing'}) — set ${k.env} or JUQODE_PRIVATE to a JuQode-Private checkout. Refusing to pass vacuously.`);
    err.canonMissing = true;
    throw err;
  }
  return fs.readFileSync(c.path, encoding);
}

module.exports = { canonPath, readCanon };
