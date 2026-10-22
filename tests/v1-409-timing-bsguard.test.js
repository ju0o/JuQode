'use strict';
/* V1-409 · backslash-run suffixes through the scrub / boundary path (inputs and helpers: tests/timing-lib.js) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('./timing-lib.js');
test('backslash-run suffixes: scrubString, scrubDetail and publicOut stay linear at 120k', () => {
  const bad = [];
  const surf = { scrubString: L.guard.scrubString, scrubDetail: (x) => L.guard.scrubDetail({ a: x }), publicOut: (x) => L.guard.publicOut('juqode:x', { a: { b: [x] } }) };
  for (const pre of ['Cookie: a=b', 'Authorization: Digest a=b', 'Authorization: Token Ab12', '"API_TOKEN":"']) for (const unit of ['\\', '\\\\n', '\\"']) {
    const s = pre + L.make(unit, 120000);
    for (const [sn, f] of Object.entries(surf)) { const b = L.best(f, s); if (b >= 1500) bad.push(`${JSON.stringify(pre)} x ${JSON.stringify(unit)} ${sn}: ${b.toFixed(0)} ms @120k`); }
  }
  assert.deepStrictEqual(bad, []);
});
