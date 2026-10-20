'use strict';
/* V1-409 · REGRESSION GUARD. Every earlier round fixed one class and silently regressed another, so this matrix pins the
 * whole picture: a compact spec of (secret class x context x surface) generates ~400 synthetic-canary probes. A probe is
 * "masked" when the canary is absent from the serialized result. Every cell that is masked today MUST stay masked: the
 * only way a cell may leak is to be listed in KNOWN_OPEN below (a deliberate, reviewed decision). When an OPEN cell gets
 * fixed the test says so and the entry is deleted - the list can only shrink.
 * A second block pins strings that must stay BYTE-IDENTICAL (the data-loss guard). Synthetic canaries only. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { mask } = require(path.join(R, 'app/main/qc/run.js'));
const { safeSnapshot } = require(path.join(R, 'app/main/work/context.js'));
const guard = require(path.join(R, 'app/main/ipc-guard.js'));

const C = 'ZQ9XKP2LM8VN4RT6';                          // the canary core: every probe carries it
const CLASSES = {
  gh: `ghp_${C}${'a1B2'.repeat(5)}`,
  ant: `sk-ant-api03-${C}${'aB3_'.repeat(4)}`,
  akia: `AKIA${C.slice(0, 12)}${C.slice(0, 4)}`,
  npm: `npm_${C}${'aB3d'.repeat(5)}`,
  aiza: `AIza${C}${'aB3_-'.repeat(4)}`,
  slack: `https://hooks.slack.com/services/T0000000/B0000000/${C}XXXXXXXX`,
  envup: `API_TOKEN=${C}`,
  envlong: `MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=${C}`,
  envlong100: `${'A'.repeat(100)}_TOKEN=${C}`,
  httpcookie: `HTTP_COOKIE=sid=${C}`,
  bearer: `Authorization: Bearer ${C}`,
  bearerlow: `authorization: bearer ${C}`,
  basic: `Authorization: Basic ${Buffer.from(`user:${C}`).toString('base64')}`,
  basicdot: `Authorization: Basic ${Buffer.from(`user:${C}`).toString('base64')}.x`,
  digest: `Proxy-Authorization: Digest username="u", response="${C}"`,
  negotiate: `Authorization: Negotiate ${C}${'Ab1'.repeat(3)}`,
  token: `Authorization: Token ${C}1`,
  urlcred: `https://user:${C}@host/p`,
  urlcred40: `${'ab'.repeat(20)}://user:${C}@host/p`,
  jwt: `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI${C}.${'s'.repeat(20)}`,
  jsontok: `{"API_TOKEN":"${C}"}`,
  jsonauth: `{"Authorization":"${C}${C}"}`,
  jsoncookie: `{"Cookie":"sid=${C}"}`,
  cookie: `Cookie: sid=${C}`,
  setcookie: `Set-Cookie: session=${C}; Path=/`,
  cookieq: `Cookie: sid="${C}"`,
  xauth: `X-Auth-Token: ${C}`,
  xapikey: `x-api-key: ${C}`,
  curl: `curl -u admin:${C} https://x.example`,
  pkeyopen: `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC${C}\ntail`,
  pkeyclosed: `-----BEGIN RSA PRIVATE KEY-----\n${'AAAA'.repeat(12)}${C}\n-----END RSA PRIVATE KEY-----\ntail`,
  setcookiearr: `{"Set-Cookie":["sid=${C}"]}`,
  cookiejson: `{"cookie": "a=1; sid=${C}"}`,
  cookie65sp: `Cookie:${' '.repeat(100)}sid=${C}`,
  longcolon: `MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: ${C}1`,
  cookieEqSp: `Cookie: sid = ${C}`,
  setcookieEqSp: `Set-Cookie: sid = ${C}; Path=/`,
  cookieFirstBad1: `Cookie: a=>b; sid=${C}`,
  cookieFirstBad2: `Cookie: =x; sid=${C}`,
  cookieFirstBad3: `Cookie: sid==${C}`,
  cookieTab: `Cookie: a=1;\\tsid=${C}`,
  cookieSetHeader: `req.setHeader('Cookie','sid=${C}')`,
  cookieAppend: `headers.append("Cookie", "sid=${C}")`,
  cookieSetHeaderArr: `res.setHeader('Set-Cookie', ['sid=${C}'])`,
  cookieEqForm: `Cookie=sid=${C}`,
  cookieSpaceName: `Cookie: a b=${C}`,
  cookieQuotedName: `Cookie: "sid"=${C}`,
  digestSpaced: `Authorization: Digest username = "u", response="${C}"`,
  exportLong: `export TOKEN_FOO_BAR_BAZ_${'Q'.repeat(30)}=${C}`,
  envLongColon: `ENV_LONG_NAME_FOR_THE_API_SECRET_VALUE: ${C}`,
  assign: `client_secret = ${C}`,
  assignlong: `${'x'.repeat(80)}_password=${C}`,
};
const nest = (t, d) => { let x = t; for (let i = 0; i < d; i++) x = JSON.stringify(x); return x; };
const CONTEXTS = {
  plain: (t) => t,
  prefix: (t) => `see: ${t}`,
  korean: (t) => `로그인 토큰 ${t} 확인`,
  escNL: (t) => `a\\n${t}`,
  escCR: (t) => `a\\r${t}`,
  escTab: (t) => `a\\t${t}`,
  pct: (t) => `x%0A${t}`,
  gt: (t) => `>${t}`, lb: (t) => `[${t}`, eq: (t) => `=${t}`, pipe: (t) => `|${t}`, slash: (t) => `/${t}`, lt: (t) => `<${t}`, star: (t) => `*${t}`, dash: (t) => `-${t}`, bsl: (t) => `\\${t}`,
  bsrun: (t) => `${t}${'\\'.repeat(300)}`,
  json1: (t) => nest(t, 1),
  json3: (t) => nest({ line: t }, 3),
  json9: (t) => nest({ text: t }, 9),
};
const SURFACES = {
  mask: (t) => mask(t),
  safeSnapshot: (t) => safeSnapshot(t).safe,
  publicOut: (t) => JSON.stringify(guard.publicOut('juqode:x', { ok: true, a: { b: [t] } })),
};

/* Cells that leak TODAY and are accepted as OPEN, as `class|context|surface` globs (`*` = any). Edit by deleting entries only. */
const KNOWN_OPEN = [
  // lowercase `name = value` assignments: the display masker has no generic rule for them (upper-case env names only) - OPEN, see the report
  'assign|*|mask', 'assign|*|publicOut', 'assignlong|*|mask', 'assignlong|*|publicOut',
];
const isOpen = (key) => KNOWN_OPEN.some((g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^|]*')}$`).test(key));

/** every leaking cell of the matrix for the given surfaces, minus KNOWN_OPEN; plus KNOWN_OPEN entries that no longer leak */
function evaluate(surfaces) {
  const leaking = [];
  let cells = 0;
  for (const [cn, secret] of Object.entries(CLASSES)) for (const [xn, ctx] of Object.entries(CONTEXTS)) for (const [sn, surf] of Object.entries(surfaces)) {
    cells++;
    const key = `${cn}|${xn}|${sn}`;
    const out = surf(ctx(secret));
    if (out.includes(C)) { if (!isOpen(key)) leaking.push(key); } else if (isOpen(key)) leaking.push(`${key} (is masked now - delete it from KNOWN_OPEN)`);
  }
  return { cells, leaking };
}

test(`regression matrix: ${Object.keys(CLASSES).length} classes x ${Object.keys(CONTEXTS).length} contexts x 3 surfaces - no masked cell may start to leak`, () => {
  const { cells, leaking } = evaluate(SURFACES);
  assert.ok(cells >= 300, `${cells} cells`);
  assert.deepStrictEqual(leaking, []);
});

test('the guard itself works: a masker mutated IN MEMORY to leak one cell is caught (and an un-mutated one is not)', () => {
  const leakOneCell = { ...SURFACES, mask: (t) => (t.startsWith('Cookie: sid = ') && !t.includes('\\') ? t : mask(t)) };
  const { leaking } = evaluate(leakOneCell);
  assert.ok(leaking.some((k) => k.startsWith('cookieEqSp|plain|mask')), `the mutated cell was not reported: ${leaking.slice(0, 3)}`);
  assert.deepStrictEqual(evaluate(SURFACES).leaking, []);
});

/* DOCUMENTED OPEN ITEMS, each with its CURRENT state per surface: `true` = the canary leaks, `false` = masked. Any change in either direction
 * fails this test, so a fix (or a regression) is noticed and the list is updated on purpose. */
const OPEN_PROBES = {
  digestQuoted: [`Authorization: Digest "${C}"`, { mask: true, snap: true }],
  rawAuth: [`Authorization: ${C}`, { mask: true, snap: false }],
  rawAuthEq: [`AUTHORIZATION=${C}`, { mask: true, snap: false }],
  authEq: [`AUTH=${C}`, { mask: true, snap: false }],
  envOver255: [`${'A'.repeat(300)}_TOKEN=${C}`, { mask: true, snap: false }],
  jsonLowerToken: [`{"token":"${C}"}`, { mask: true, snap: true }],
  jsonLowerPassword: [`{"password":"${C}"}`, { mask: true, snap: true }],
  camelCase: [`apiKey: "${C}"`, { mask: true, snap: false }],
  flagForm: [`--token ${C}`, { mask: true, snap: true }],
  urlEncoded: [`token%3D${C}`, { mask: true, snap: true }],
  lowerAssign: [`client_secret = ${C}`, { mask: true, snap: false }],
};
test('documented OPEN items: the recorded state (leaks / masked) still holds on both maskers', () => {
  const changed = [];
  for (const [name, [text, want]] of Object.entries(OPEN_PROBES)) {
    const got = { mask: mask(text).includes(C), snap: safeSnapshot(text).safe.includes(C) };
    if (got.mask !== want.mask || got.snap !== want.snap) changed.push(`${name}: recorded ${JSON.stringify(want)} now ${JSON.stringify(got)}`);
  }
  assert.deepStrictEqual(changed, []);
  /* known write-time false positives (data erased, not leaked) */
  assert.strictEqual(safeSnapshot('Cookie: word').safe, '[redacted]');
  assert.strictEqual(safeSnapshot('x-api-key: header name').safe, '[redacted] name');
  assert.strictEqual(mask('Cookie: please = accept'), 'Cookie: ***');
});

const INTENTS = ['Rename MAX_TOKENS = 4096 to MAX_CONTEXT', 'Set PASSWORD_MIN_LENGTH = 8 in the form', 'Support Basic authentication-based-access in the proxy', 'Add sk_render_pipeline_configuration_value to docs',
  'Raise TOKEN_LIMIT to 4096', 'Read SECRET_FILE from the vault folder', "SyntaxError: Unexpected token: '}' at line 12", 'Send the Bearer token in the header', '개발 서버를 켜고 로그인 토큰 만료를 확인해 주세요'];
test('data-loss guard: non-secret text stays byte-identical through the display masker, the write-time masker and the boundary', () => {
  const blob = Buffer.from(JSON.stringify({ rows: 'x'.repeat(30000), p: '+/' })).toString('base64');
  const keep = [
    'const HTTP2_HEADER_COOKIE: string;', 'const SSL_OP_COOKIE_EXCHANGE: number;', 'HTTP2_HEADER_SET_COOKIE: string;', "'set-cookie': ['foo=bar', 'a=b']",
    'const HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS: string;', 'Add an Authorization: Bearer header to every request', 'Authorization: Token refresh the thing',
    'Authorization: Basic authentication flow', '로그인 Authorization: Bearer 헤더를 추가해줘',
    'cb: (err: Error | null, cookie: unknown) => void) & x', 'set cookie: yes => no', 'Cookie: please accept the terms', 'cookie: string;', 'const SESSION_COOKIE = "sid";', 'process.env.X_COOKIE = value;',
    'export const METRIC_GEN_AI_SERVER_TIME_PER_OUTPUT_TOKEN = "gen_ai.server.time";', 'const DEEP_HEADER_SET_COOKIE = {', '쿠키 COOKIE_MAX_AGE = 3600 으로 변경',
    '개발 서버를 켜고 로그인 만료를 확인해 주세요', '/home/u/proj/src/app.ts:14:2', '+const x = 4096;', 'https://example.com/a?b=c', 'ssh git@github.com:org/r.git',
    `data:application/json;base64,${blob}`, `{"version":3,"mappings":"${'AAAA,CAAC;'.repeat(2000)}"}`, `payload=${blob}`, 'ba1cb02f1e0b6a8c7d5e4f3a2b1c0d9e8f7a6b5c',
    'Use -----BEGIN PRIVATE KEY----- headers in tests.\n' + 'const x = 1;\n'.repeat(1000),
  ];
  for (const t of keep) {
    assert.strictEqual(mask(t), t, `mask: ${t.slice(0, 60)}`);
    assert.strictEqual(JSON.stringify(guard.publicOut('juqode:x', { a: [t] })), JSON.stringify({ a: [t] }), `publicOut: ${t.slice(0, 60)}`);
  }
  /* the REAL nine intent strings: a Work intent is stored through safeSnapshot and echoed back through the boundary - both must be byte-identical */
  for (const t of INTENTS) {
    assert.strictEqual(safeSnapshot(t).safe, t, `stored: ${t}`);
    assert.strictEqual(guard.publicOut('juqode:work-get', { ok: true, work: { intent: t } }).work.intent, t, `echoed: ${t}`);
    assert.strictEqual(guard.publicPush({ work: { intent: t } }).work.intent, t, `pushed: ${t}`);
  }
  /* write-time masker: the stored form of a declaration must not be erased (the old rule stored `const [redacted];`) */
  for (const t of ['const HTTP2_HEADER_COOKIE: string;', 'const SSL_OP_COOKIE_EXCHANGE: number;', 'HTTP2_HEADER_SET_COOKIE: string;', "'set-cookie': ['foo=bar']", 'Add an Authorization: Bearer header to every request', `data:application/json;base64,${blob}`])
    assert.strictEqual(safeSnapshot(t).safe, t, `safeSnapshot: ${t.slice(0, 60)}`);
});
