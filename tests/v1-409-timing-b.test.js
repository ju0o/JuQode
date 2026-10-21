'use strict';
/* V1-409 · hostile generators, part b: mask and safeSnapshot, time(160k)/time(80k) < 3 and time(160k) < 1 s (best of 3) (inputs and helpers: tests/timing-lib.js) */
const test = require('node:test');
const assert = require('node:assert');
const L = require('./timing-lib.js');
test('hostile input, part b: every generator x (mask, safeSnapshot) is linear', () => {
  assert.deepStrictEqual(L.growth(L.HOSTILE.slice(Math.ceil(L.HOSTILE.length * 1 / 2), Math.ceil(L.HOSTILE.length * 2 / 2)), { mask: L.SURFACES.mask, safeSnapshot: L.SURFACES.safeSnapshot }, 80000, 160000), []);
});
