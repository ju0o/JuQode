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

/* ---- round 9 ---- */
const ss = (t) => safeSnapshot(t).safe;
const C9 = 'ZQ9XKP2LM8VN4RT6';
const PROSE_AND_CODE = [
  'function parse(cookie, options = {}) {', 'const { cookie, ...rest } = opts;', 'cookie, secure = false,', 'this.cookie = cookie || ""; let a = b;', 'cookie: str = ""', 'cookie: Cookie | undefined = undefined;',
  'c.cookie, err = req.Cookie("sid")', 'document.cookie = "theme=dark; path=/";', 'Set the cookie, then reload (a=1).', 'let cookie = `${name}=${value}`;',
  '로그인 후 cookie, maxAge = 7일로 설정해줘', 'Cookie: 만료 = 7일', 'fix cookie, session = null bug'];
const SNAPSHOT_SAFE = ['function parse(cookie, options = {}) {', 'const { cookie, ...rest } = opts;', 'cookie, secure = false,', 'c.cookie, err = req.Cookie("sid")', 'Set the cookie, then reload (a=1).',
  '로그인 후 cookie, maxAge = 7일로 설정해줘', 'Cookie: 만료 = 7일', 'fix cookie, session = null bug', 'cookie: str = ""'];
test('round 9 item 1: "cookie," is not a header; defaults, destructuring and Korean prose are untouched (display masker and write-time masker)', () => {
  for (const t of PROSE_AND_CODE) assert.strictEqual(mask(t), t, `mask: ${t}`);
  for (const t of SNAPSHOT_SAFE) assert.strictEqual(ss(t), t, `snapshot: ${t}`);
  /* the call forms with a QUOTED header-name literal are still headers */
  for (const t of [`req.setHeader('Cookie','sid=${C9}')`, `headers.append("Cookie", "sid=${C9}")`, `res.setHeader('Set-Cookie', ['sid=${C9}'])`, `x = ['set-cookie', 'sid=${C9}']`, `Cookie=sid=${C9}`])
    for (const out of [mask(t), ss(t)]) assert.ok(!out.includes(C9), t);
  /* a default literal / comparison is not a pair; any other = after the colon is */
  assert.ok(mask('Cookie: a = "" ; sid=Zq9').includes('Zq9') === false);
  assert.strictEqual(mask('cookie: x = 12'), 'cookie: x = 12');
  assert.ok(!mask('cookie: x = 12345').includes('12345'));
});

test('round 9 item 2: comparison runs never fail open - 63 / 64 / 65 / 128 / 1000 comparisons before a real pair', () => {
  for (const n of [0, 1, 63, 64, 65, 128, 1000]) for (const out of [mask(`Cookie: ${'a == b '.repeat(n)}sid=${C9}`), ss(`Cookie: ${'a == b '.repeat(n)}sid=${C9}`)]) assert.ok(!out.includes(C9), `${n} comparisons`);
  assert.strictEqual(mask(`Cookie: ${'a == b '.repeat(200)}`), `Cookie: ${'a == b '.repeat(200)}`);
});

test('round 9 item 3: escaped quotes and escaped tabs in long-name assignments and Digest, JSON depth 1-3', () => {
  const NAME = 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN';
  const j = (t, d) => { let x = t; for (let i = 0; i < d; i++) x = JSON.stringify(x); return x; };
  for (let d = 1; d <= 3; d++) for (const t of [`${NAME} = "${mix(20)}"`, `${NAME}\t=\t"${mix(20)}"`, `const ${NAME} = "${mix(20)}";`, `${NAME}: "${mix(20)}"`, `${NAME}="${mix(20)}"`, `Authorization: Digest username="u"\tresponse=${mix(20)}`])
    for (const out of [mask(j(t, d)), ss(j(t, d))]) assert.ok(!out.includes(mix(20)), `depth ${d}: ${t.slice(0, 50)}`);
});

test('round 9 item 4: dotenv values end at the value, configuration names and benign values are kept, quoted strings are masked whole', () => {
  for (const t of ['COOKIE_SECURE=true', 'export COOKIE_DOMAIN=.example.com', 'SESSION_COOKIE_NAME=connect.sid', 'export TOKEN_TIMEOUT_SECONDS=3600 # x'.replace('TOKEN_TIMEOUT_SECONDS', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN_TTL'),
    'export MY_COMPANY_BILLING_SERVICE_GOOGLE_APPLICATION_CREDENTIALS=/path/to/config.json'  , 'SECRET_SANTA_LIST_FOR_THE_COMPANY_CSV_X = "participants2024secret.csv"'.replace('_X', '')])
    assert.strictEqual(ss(t), t, `snapshot: ${t}`);
  for (const t of ['MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=true', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=3600']) assert.strictEqual(mask(t), t, `display: ${t}`);   // (the generic write-time rule still masks ...TOKEN=true; pre-existing)
  assert.strictEqual(ss('MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN="my awesome password"'), '[redacted]');                  // the whole quoted string
  assert.strictEqual(ss(`foo('MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=${C9}\\n');`), "foo('[redacted]\\n');");              // the code after the value survives
  assert.strictEqual(ss(`x(MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=${C9}); y`), 'x([redacted]); y');
  assert.strictEqual(mask('PGPASSWORD="my awesome password" x'), '*** x');
  assert.ok(!ss(`MY_COMPANY_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY=${C9}`).includes(C9), 'a name with PRIVATE_KEY masks');
});

test('round 9 item 7: curl -b / --cookie with a cookie pair', () => {
  for (const t of [`curl -b "sid=${C9}" https://x`, `curl --cookie sid=${C9} https://x`, `curl -s -b 'a=1; sid=${C9}' x`.replace('a=1; ', '')]) for (const out of [mask(t), ss(t)]) assert.ok(!out.includes(C9), t);
  assert.strictEqual(mask('mycmd -b sid=1'), 'mycmd -b sid=1');
  assert.strictEqual(mask('curl -b cookies.txt https://x'), 'curl -b cookies.txt https://x');         // a cookie JAR file name has no '='
});

test('round 9 survivor pins: CRLF end, mixed escaped/plain quotes in one text, Digest look window, 255-character prefix, escaped Set-Cookie arrays', () => {
  assert.strictEqual(mask('Cookie: a=b\r\nnext'), 'Cookie: ***\r\nnext');
  const mixed = `{"Cookie":"a=${C9}1"} and {\\"Cookie\\":\\"c=${C9}2\\"}`;
  assert.ok(!mask(mixed).includes(C9) && !ss(mixed).includes(C9), mixed);
  assert.ok(!mask(`Authorization: Digest ${'k'.repeat(4095)}=v\nz`).includes('=v'), 'an = 4095 characters in is inside the window');
  assert.ok(mask(`Authorization: Digest ${'k'.repeat(4096)}=v\nz`).includes('=v'), 'an = 4096 characters in is not');
  assert.ok(!mask(`${'A'.repeat(254)}_TOKEN=abc12345`).includes('abc12345'), 'a 255-character prefix');
  for (let d = 1; d <= 3; d++) { let x = JSON.stringify({ 'Set-Cookie': [`sid=${C9}`] }); for (let i = 1; i < d; i++) x = JSON.stringify(x); for (const out of [mask(x), ss(x)]) assert.ok(!out.includes(C9), `depth ${d}`); }
  assert.ok(mask('MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN = abc').includes('abc'), 'a spaced assignment needs a credential-looking value');
  assert.ok(same('const SESSION_COOKIE = "sid";') && same('const MY_COMPANY_BILLING_SERVICE_SESSION_COOKIE = "sid";'));
});

test('round 9 survivor pins (2): PRIVATE_KEY long names, escaped array shape, default-literal spacing, single-quoted values', () => {
  assert.ok(!mask(`MY_COMPANY_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY=${C9}`).includes(C9), 'display: a long name with PRIVATE_KEY');
  let x = JSON.stringify(JSON.stringify({ 'Set-Cookie': [`sid=${C9}`] }));
  assert.strictEqual(mask(x), x.replace(`sid=${C9}`, '***'), 'depth-2 array: only the value changes, the escaped quotes and brackets stay');
  x = JSON.stringify({ 'Set-Cookie': [`sid=${C9}`] });
  assert.strictEqual(mask(x), x.replace(`sid=${C9}`, '***'));
  assert.ok(!mask('Cookie: sid= 12').includes('12'), 'a default literal needs a space on BOTH sides of the =');
  assert.strictEqual(mask("PGPASSWORD='my awesome password' x"), '*** x');
});

/* ---- round 10 ---- */
const CRED = 'Zq7Xk9Lm2Pw4Rt8Vb3Nc6';
test('round 10 item 2: a configuration-looking name exempts only a configuration-looking VALUE (each benign word, display and write-time)', () => {
  for (const w of ['SECURE', 'DOMAIN', 'TTL', 'NAME', 'PATH', 'FILE', 'URL', 'ID', 'MODE', 'ENABLED', 'TIMEOUT', 'AGE', 'CSV', 'DIR', 'HOST', 'PORT', 'EXPIRES', 'VERSION', 'LENGTH', 'SIZE', 'COUNT', 'LIMIT', 'TYPE', 'ALGORITHM', 'HEADER', 'PREFIX', 'SUFFIX']) {
    const name = `MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN_${w}`;
    assert.ok(!mask(`${name}=${CRED}`).includes(CRED), `display: ${w} + credential`);
    assert.ok(!ss(`${name}=${CRED}`).includes(CRED), `write-time: ${w} + credential`);
    assert.strictEqual(mask(`${name}=true`), `${name}=true`, `display: ${w} + true`);
    assert.strictEqual(mask(`${name}=/run/secrets/x`), `${name}=/run/secrets/x`, `display: ${w} + path`);
    assert.strictEqual(ss(`${name}=3600`), `${name}=3600`, `write-time: ${w} + number`);
  }
  for (const n of ['TOKEN_ID', 'API_KEY_ID', 'SECRET_NAME', 'PASSWORD_FILE', 'API_KEY_PATH', 'GITHUB_TOKEN_SECURE', 'MY_API_KEY_HEADER', 'AUTH_TOKEN_PREFIX', 'PASSWORD_HOST', 'DB_PASSWORD_VERSION', 'SECRET_MODE', 'API_KEY_ENABLED', 'JWT_SECRET_FILE', 'CLIENT_SECRET_ID', 'PASSWORD_URL', 'TOKEN_LIMIT'])
    for (const out of [mask(`${n}=${CRED}`), ss(`${n}=${CRED}`)]) assert.ok(!out.includes(CRED), n);
  for (const t of ['DB_PASSWORD_FILE=/run/secrets/x', 'COOKIE_SECURE=true', 'COOKIE_DOMAIN=.example.com', 'SESSION_COOKIE_NAME=connect.sid', 'GOOGLE_APPLICATION_CREDENTIALS=/path/to/config.json'])
    assert.strictEqual(ss(t), t, t);
  /* the word must END the name: TOKEN_IDENTIFIER is not "..._ID" */
  assert.ok(!ss('MY_COMPANY_BILLING_SERVICE_TOKEN_IDENTIFIER=secretvalue1234').includes('secretvalue1234'));
  assert.ok(!mask('MY_COMPANY_BILLING_SERVICE_TOKEN_IDENTIFIER=secretvalue1234').includes('secretvalue1234'));
  /* a value that continues as a file name / host is not a token */
  assert.strictEqual(mask(`MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN_ID=${CRED}.csv`), `MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN_ID=${CRED}.csv`);
});

test('round 10 item 3: prose before a name=value pair does not protect it; an unquoted Cookie before a comma needs a pair after it', () => {
  for (const t of [`Cookie: 한글 sid=${CRED}`, `Set-Cookie: 가=1; sid=${CRED}`, `Cookie:한글sid=${CRED}`, `Cookie: 토큰${CRED}=1`, `headers.set(Cookie, sid=${CRED})`, `res.setHeader(Cookie, "sid=${CRED}")`, `Cookie, sid=${CRED}`, `cookie , sid=${CRED}`])
    for (const out of [mask(t), ss(t)]) assert.ok(!out.includes(CRED), t);
  for (const t of ['Cookie: 만료 = 7일', 'fix cookie, session = null bug', 'cookie, secure = false,', 'function parse(cookie, options = {}) {', '로그인 후 cookie, maxAge = 7일로 설정해줘']) {
    assert.strictEqual(mask(t), t, t);
  }
  /* decision: a spaced '=' after prose is prose; an UNSPACED a=b after prose is a pair (Set-Cookie: 헤더 관련해서 a=b 처럼 처리 is masked) */
  assert.strictEqual(mask('Set-Cookie: 헤더 관련해서 a=b 처럼 처리'), 'Set-Cookie: ***');
  /* a Latin-1 / Latin letter is ASCII-adjacent prose too: it does not hide a pair */
  assert.ok(!mask(`Cookie: café sid=${CRED}`).includes(CRED));
  /* two headers on two lines are two decisions */
  assert.strictEqual(mask('Cookie: a=b\nCookie: please accept the terms'), 'Cookie: ***\nCookie: please accept the terms');
  assert.strictEqual(mask('Cookie: please accept the terms\nCookie: a=b'), 'Cookie: please accept the terms\nCookie: ***');
});

test('round 10 item 4: curl -b / --cookie consume the whole quoted argument', () => {
  for (const t of [`curl -b 'a=1; sid=${CRED}' https://x`, `curl -b "a=1; sid=${CRED}" https://x`, `curl --cookie "a=1; sid=${CRED}" https://x`, `curl --cookie='a=1; sid=${CRED}' https://x`.replace("='", " '"), `curl -b sid=${CRED} https://x`])
    for (const out of [mask(t), ss(t)]) assert.ok(!out.includes(CRED) && out.endsWith(' https://x'), `${t} -> ${out}`);
  assert.strictEqual(mask('curl -b cookies.txt https://x'), 'curl -b cookies.txt https://x');
  assert.strictEqual(mask('curl -b "cookies.txt" https://x'), 'curl -b "cookies.txt" https://x');
  assert.strictEqual(mask("curl -b 'my jar.txt' https://x"), "curl -b 'my jar.txt' https://x");
  assert.ok(mask(`curl -b a=b -H "X: y" https://x`).includes('-H "X: y"'));
});

test('round 10 item 6: escaped quotes with any practical depth of backslashes in dotenv values', () => {
  let q = `X_TOKEN="${CRED}"`;
  for (let d = 1; d <= 9; d++) { q = JSON.stringify(q); for (const out of [mask(q), ss(q)]) assert.ok(!out.includes(CRED), `depth ${d}`); }
});

test('round 10 item 7: assorted scan details', () => {
  assert.strictEqual(mask('cookie: x = false'), 'cookie: x = false');
  assert.strictEqual(mask('cookie: x = `a`'.replace('`a`', '``')), 'cookie: x = ``');
  assert.strictEqual(mask('cookie: x = {}'), 'cookie: x = {}');
  assert.strictEqual(mask('cookie: x = []'), 'cookie: x = []');
  assert.strictEqual(mask('cookie: x = null'), 'cookie: x = null');
  assert.strictEqual(mask("cookie: x = ''"), "cookie: x = ''");
  assert.ok(!mask('cookie: x = nullish1').includes('nullish1'), 'null must end at a word boundary');
  assert.ok(!mask('cookie: x = 1234').includes('1234'), 'four digits are not a small default');
  for (const v of ['~/jars/x', './x', '../x', '/abs', '.example.com']) assert.strictEqual(mask(`MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=${v}`), `MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=${v}`, v);
  assert.strictEqual(ss('foo(MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=abcd1234, x)'), 'foo([redacted], x)');   // a comma ends an unquoted value
  assert.strictEqual(ss('foo(MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=abcd1234`)'), 'foo([redacted]`)');      // a backtick ends it too
});
