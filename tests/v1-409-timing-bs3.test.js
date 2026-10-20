'use strict';
/* V1-409 · backslash-run adversarial suffixes, prefixes part 3: mask and safeSnapshot at 60k / 120k (inputs and helpers: tests/timing-lib.js) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('./timing-lib.js');
test('backslash-run suffixes, part 3: every prefix class x every suffix unit is linear (time(120k)/time(60k) < 3, < 1 s at 120k)', () => {
  const bad = [];
  for (const pre of L.BS_PREFIXES.slice(Math.ceil(L.BS_PREFIXES.length * 2 / 3), Math.ceil(L.BS_PREFIXES.length * 3 / 3))) bad.push(...L.growth(L.BS_UNITS, { mask: L.SURFACES.mask, safeSnapshot: L.SURFACES.safeSnapshot }, 60000, 120000, { prefix: pre }));
  assert.deepStrictEqual(bad, []);
});
