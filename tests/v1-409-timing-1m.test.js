'use strict';
/* V1-409 · one 1M-character spot check per masker family (inputs and helpers: tests/timing-lib.js) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('./timing-lib.js');
test('1M characters: benign-suffix names (once quadratic in the write-time masker) finish well under 1.5 s', () => {
  const bad = [];
  for (const unit of ['TOKEN_ID=', 'PASSWORD_FILE=', 'API_KEY_PATH=', 'SECRET_NAME=', 'NAME=a1a1a1a1a1.', 'COOKIE_VERSION=2024-01-01-abc123-final ']) {
    const s = L.make(unit, 1000000);
    for (const [sn, f] of [['mask', L.mask], ['safeSnapshot', L.safeSnapshot]]) { const t = L.best(f, s, 1); if (t >= 1500) bad.push(`${JSON.stringify(unit)} ${sn}: ${t.toFixed(0)} ms`); }
  }
  assert.deepStrictEqual(bad, []);
});

test('1M characters: the shapes that were once quadratic finish in a few seconds', () => {
  const bad = [];
  for (const unit of ['Authorization: Digest ', 'Cookie: ', 'eyJ-', 'a-', '-----BEGIN PRIVATE KEY-----', 'Cookie: a=b\\', 'curl -u ', 'Cookie: a == b ']) {
    const s = L.make(unit, 1000000);
    for (const [sn, f] of [['mask', L.mask], ['safeSnapshot', L.safeSnapshot]]) { const t = L.best(f, s, 1); if (t >= 5000) bad.push(`${JSON.stringify(unit)} ${sn}: ${t.toFixed(0)} ms`); }
  }
  assert.deepStrictEqual(bad, []);
});
