'use strict';
/* V1-409 · boundary pins (min-1 / min / min+1) for the long-name and header rules, kept in a FAST file so a mutation sweep can run it. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { mask } = require(path.join(R, 'app/main/qc/run.js'));
const { safeSnapshot } = require(path.join(R, 'app/main/work/context.js'));

const NAME = 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN';      // 45 characters: only the LONG-name rules can see it
const mix = (n) => `Zq7${'a1'.repeat(10)}`.slice(0, n).padEnd(n, 'b');
const same = (t) => mask(t) === t;

test('long name, spaced assignment (rule b): the value needs 16+ characters mixing letters and digits, in the plain class, and both quotes go', () => {
  for (const [n, masked] of [[15, false], [16, true], [17, true]]) assert.strictEqual(!same(`${NAME} = "${mix(n)}"`), masked, `len ${n}`);
  assert.strictEqual(mask(`${NAME} = "${mix(16)}";`), '***;');                       // no stray quote
  assert.ok(same(`${NAME} = "${'1'.repeat(20)}"`), 'digits only');
  assert.ok(same(`${NAME} = "${'a'.repeat(20)}"`), 'letters only');
  assert.ok(same(`${NAME} = "connect.sid.production.v2"`), 'dotted words');
  assert.ok(same(`${NAME} = "banner-v2-2024-01-01-final"`), 'dashed words');
  assert.ok(same(`const ${NAME.slice(0, 20)}_COOKIE = "sid";`));
});

test('long name, colon form (rule c): 12+ characters mixing letters and digits, not followed by ; or a bracket', () => {
  for (const [n, masked] of [[11, false], [12, true], [13, true]]) assert.strictEqual(!same(`${NAME}: ${mix(n)}`), masked, `len ${n}`);
  assert.ok(same(`${NAME}: ${mix(14)};`), 'followed by ;');
  assert.ok(same(`${NAME}: ${mix(14)}<T>`), 'followed by a generic bracket');
  assert.ok(!same(`${NAME}: ${mix(14)},`), 'followed by a comma');
  assert.ok(!same(`${NAME}: ${mix(14)}`), 'end of text');
  assert.ok(same(`${NAME}: string;`) && same(`${NAME}: Record<string, X>;`) && same(`${NAME}: {`));
  assert.ok(!same(`${NAME}: "${mix(14)}"`), 'quoted');
});

test('long name, dotenv form (rule a): up to 255 characters of name, nothing around the =', () => {
  const name = (n) => `${'A'.repeat(n - 6)}_TOKEN`.slice(-n);
  for (const n of [33, 100, 255]) assert.ok(!same(`${name(n)}=abc12345`), `name ${n}`);
  assert.ok(same('SESSION_COOKIE_ID = x'));
  assert.ok(!same('HTTP_COOKIE=sid=1'));
});

test('Digest: the credential runs to the end of the LINE (not of the text); prose without = stays', () => {
  assert.strictEqual(mask('Authorization: Digest a=b X\nnext'), 'Authorization: Digest ***\nnext');
  assert.strictEqual(mask('Authorization: Digest a=b X\r\nnext'), 'Authorization: Digest ***\r\nnext');
  assert.strictEqual(mask('Authorization: Digest username = "u", response="r"\nnext'), 'Authorization: Digest ***\nnext');
  assert.strictEqual(mask('Authorization: Digest realm only\nnext'), 'Authorization: Digest realm only\nnext');
  assert.strictEqual(mask('Authorization: Digest a=b X\\nnext'), 'Authorization: Digest ***\\nnext');
});

test('Cookie: the closing quote ends the value, an escaped quote does not; an escaped line break ends it, an escaped tab does not', () => {
  assert.strictEqual(mask('curl -H "Cookie: a=b" -H "X: y" z'), 'curl -H "Cookie: ***" -H "X: y" z');
  assert.strictEqual(mask("-H 'Cookie: a=b' -H 'X: y'"), "-H 'Cookie: ***' -H 'X: y'");
  assert.strictEqual(mask('"Cookie":"a=b\\"c=d","X":"y"'), '"Cookie":"***","X":"y"');
  assert.strictEqual(mask('Cookie: a=b\\nnext'), 'Cookie: ***\\nnext');
  assert.strictEqual(mask('Cookie: a=b\\rnext'), 'Cookie: ***\\rnext');
  assert.strictEqual(mask('Cookie: a=b\\tc=d'), 'Cookie: ***');
  assert.strictEqual(mask('Cookie: a=b\nc=d'), 'Cookie: ***\nc=d');
  assert.strictEqual(mask('Cookie: sid="x y" z'), 'Cookie: ***');
  for (const t of ['Cookie: sid = Zq9x', 'Cookie: "sid"=Zq9x', '"Cookie": "a=Zq9x"', 'x"Cookie: sid="Zq9x""']) assert.ok(!safeSnapshot(t).safe.includes('Zq9x') && !mask(t).includes('Zq9x'), t);
});

test('comparison operators are not pairs, other = signs are (spaced ==, ===, !=, !==, <=, >=, =>) and the 64-operator bound is safe', () => {
  for (const op of ['==', '===', '!=', '!==', '<=', '>=', '=>']) assert.ok(same(`cookie: a ${op} b`), op);
  for (const op of ['a==b', 'a=>b', 'a<=b']) assert.ok(!same(`cookie: ${op}`), op);
  mask(`cookie: ${'a == b '.repeat(100)}`);                       // 65+ operators: either answer, but it must terminate
  assert.ok(!same(`cookie: ${'a == b '.repeat(10)} sid=x`));
});

test('mutation-sweep pins: operator spacing, URL scheme span and leading characters, npm_ length, colon-form name window', () => {
  assert.ok(!same('cookie: a<= b'), 'an operator glued on the left is not a spaced comparison');
  assert.ok(!same('cookie: a =>b'), 'an operator glued on the right is not a spaced comparison');
  assert.strictEqual(mask(`${'ab'.repeat(20)}://user:SECRET@h/p`), '***h/p');           // the whole 40-character scheme goes with the credentials
  assert.strictEqual(mask('9+http://user:pw@h'), '9+***h');                              // a scheme starts with a letter: the leading "9+" is not part of it
  assert.strictEqual(mask('run npm_install now'), 'run npm_install now');               // npm_ tokens are 36+ characters
  assert.ok(mask(`npm_${'aB3d'.repeat(9)}`).endsWith('***') && !mask(`x npm_${'aB3d'.repeat(10)} y`).includes('aB3d'));
  assert.strictEqual(mask('MY_SERVICE_ACCOUNT_API_TOKEN: abcdefgh'), '***');             // the 32-character colon-form window
  assert.strictEqual(mask('API_TOKEN_VALUE_FOR_THE_SERVICE_X: abcdefgh'), '***');
});
