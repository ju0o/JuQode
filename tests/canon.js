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
const crypto = require('node:crypto');

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

/* The reviewed Private commit these tests accept (tests/canon.pin.json): ids and hashes only. A Canon
 * that is found but whose bytes differ from the pin is not "close enough" -- it FAILS, naming both
 * hashes, so a drifted or wrong checkout cannot make the Canon comparisons pass or fail by accident. */
const PIN_FILE = path.join(__dirname, 'canon.pin.json');
const loadPin = () => JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
const PIN_PATH = { copy: 'docs/current/18_KOREAN_UX_COPY.md', schema: 'docs/data/schema.sql' };

/** The Canon file's bytes, or an error naming every place that was looked at / both hashes. */
function readCanon(kind, encoding, opts = {}) {
  const c = canonPath(kind, opts);
  if (!c.path) {
    const k = KINDS[kind];
    const err = new Error(`Canon ${kind} not found (tried: ${c.tried.join('; ') || 'nothing'}) — set ${k.env} or JUQODE_PRIVATE to a JuQode-Private checkout. Refusing to pass vacuously.`);
    err.canonMissing = true;
    throw err;
  }
  const bytes = fs.readFileSync(c.path);
  const pin = opts.pin ?? loadPin();
  const want = pin.files?.[PIN_PATH[kind]]?.sha256;
  const got = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!want || got !== want) {
    const err = new Error(`Canon ${kind} at ${c.path} (${c.source}) is not the pinned one: sha256 ${got} != pinned ${want ?? '(no pin)'} for Private ${pin.sha ?? '?'}. Refusing to compare against an unreviewed Canon.`);
    err.canonMismatch = true;
    throw err;
  }
  return encoding ? bytes.toString(encoding) : bytes;
}

module.exports = { canonPath, readCanon, loadPin };
