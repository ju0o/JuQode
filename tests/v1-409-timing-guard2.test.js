'use strict';
/* V1-409 · hostile generators on the boundary surfaces (publicOut) (inputs and helpers: tests/timing-lib.js) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('./timing-lib.js');
test('hostile input: the representative generators are linear through the boundary (publicOut)', () => {
  const surf = { publicOut: L.SURFACES.publicOut };
  assert.deepStrictEqual(L.growth(L.GUARD_UNITS, surf, 80000, 160000), []);
});
