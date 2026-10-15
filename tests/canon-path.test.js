'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonPath, readCanon } = require('./canon.js');

const dirs = [];
const mk = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-canon-'))); dirs.push(d); return d; };
process.on('exit', () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/* a throwaway "private checkout": .git + docs/current + the file. Content is a stand-in, never Canon. */
function checkout(parent, name = 'JuQode-Private') {
  const d = path.join(parent, name);
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs', 'current'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs', 'data'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs', 'current', '18_KOREAN_UX_COPY.md'), 'stand-in copy');
  fs.writeFileSync(path.join(d, 'docs', 'data', 'schema.sql'), 'stand-in schema');
  return d;
}
const root = (parent) => { const r = path.join(parent, 'JuQode'); fs.mkdirSync(r, { recursive: true }); return r; };

test('an explicit env path wins over a valid sibling checkout', () => {
  const parent = mk(); checkout(parent);
  const explicit = path.join(mk(), 'my-copy.md'); fs.writeFileSync(explicit, 'x');
  const c = canonPath('copy', { env: { JUQODE_CANON: explicit }, root: root(parent) });
  assert.strictEqual(c.path, explicit);
  assert.strictEqual(c.source, 'JUQODE_CANON');
});

test('an explicit env path that does not exist FAILS — it never falls through to the sibling', () => {
  const parent = mk(); checkout(parent);
  const c = canonPath('schema', { env: { JUQODE_CANON_DATA: path.join(parent, 'typo.sql') }, root: root(parent) });
  assert.strictEqual(c.path, null);
  assert.match(c.tried.join(), /JUQODE_CANON_DATA=/);
});

test('a real sibling checkout is used when nothing is set', () => {
  const parent = mk(); const d = checkout(parent);
  const c = canonPath('copy', { env: {}, root: root(parent) });
  assert.strictEqual(c.path, path.join(d, 'docs', 'current', '18_KOREAN_UX_COPY.md'));
  assert.strictEqual(canonPath('schema', { env: {}, root: root(parent) }).path, path.join(d, 'docs', 'data', 'schema.sql'));
});

test('JUQODE_PRIVATE is honoured, and a folder that is not a checkout is not accepted', () => {
  const parent = mk(); const d = checkout(parent, 'elsewhere');
  assert.strictEqual(canonPath('copy', { env: { JUQODE_PRIVATE: d }, root: root(mk()) }).source, 'JUQODE_PRIVATE');
  fs.rmSync(path.join(d, '.git'), { recursive: true });                    // a copy of the files with no repository
  assert.strictEqual(canonPath('copy', { env: { JUQODE_PRIVATE: d }, root: root(mk()) }).path, null);
});

test('with no Canon anywhere there is NO substitute: the caller gets null and readCanon throws', () => {
  const opts = { env: { JUQODE_PRIVATE: path.join(mk(), 'nope') }, root: root(mk()) };
  assert.strictEqual(canonPath('copy', opts).path, null);
  assert.throws(() => readCanon('copy', 'utf8', opts), (e) => e.canonMissing === true && /Refusing to pass vacuously/.test(e.message));
  assert.throws(() => canonPath('nonsense'), /unknown Canon kind/);
});
