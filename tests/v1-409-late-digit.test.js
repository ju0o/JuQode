'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { mask } = require(path.join(root, 'app/main/qc/run.js'));
const { safeSnapshot } = require(path.join(root, 'app/main/work/context.js'));

function mixedValue(length, digitAt) {
  return `${'A'.repeat(digitAt)}1${'B'.repeat(length - digitAt - 1)}`;
}

test('saved snapshots redact a credential when its first digit occurs anywhere in the value', () => {
  for (const [length, digitAt] of [[16, 15], [513, 512], [514, 513], [1024, 900], [8192, 8191]]) {
    const value = mixedValue(length, digitAt);
    for (const input of [`TOKEN_ID=${value}`, `TOKEN_ID = "${value}"`, `TOKEN_ID: ${value}`]) {
      const saved = safeSnapshot(input).safe;
      assert.ok(!saved.includes(value), `length ${length}, digit offset ${digitAt}, form ${input.slice(0, 16)} leaked`);
    }
  }
});

test('display masking redacts api_key credentials when digits occur after every previous scan window', () => {
  for (const [length, digitAt] of [[16, 15], [513, 512], [514, 513], [1024, 900], [8192, 8191]]) {
    const value = mixedValue(length, digitAt);
    for (const input of [`api_key=${value}`, `TOKEN_ID = ${value}`, `TOKEN_ID: ${value}`]) {
      const shown = mask(input);
      assert.ok(!shown.includes(value), `length ${length}, digit offset ${digitAt}, form ${input.slice(0, 16)} leaked`);
    }
  }
  assert.equal(mask(`api_key=${'1'.repeat(16)}`), '***', 'all-digit api_key values were already covered by the display rule');
});
