'use strict';
/* V1-409 · hostile-input TIMING bounds (split out of v1-409-out-boundary so each file stays well under the per-file time limit).
 * For every generator and surface: time(160k)/time(80k) < 3 (or small) and time(160k) < 1 s, best of 5; the backslash-run family at 60k/120k. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { mask } = require(path.join(R, 'app/main/qc/run.js'));
const { safeSnapshot } = require(path.join(R, 'app/main/work/context.js'));
const guard = require(path.join(R, 'app/main/ipc-guard.js'));

/* tight growth-based bounds, best of 5, for every hostile generator, on every surface */
const HOSTILE = ['Authorization: Digest ', 'Proxy-Authorization: Digest ', 'Cookie: ', 'Cookie: aaaa ', 'Set-Cookie: ', 'Authorization: Basic ', 'Authorization: Bearer ', 'Authorization: Token ', 'Authorization: Negotiate ',
  'curl -u ', 'curl -s --user ', 'a\\ncurl -u ', 'curl -u a:b\\n', 'Cookie: a=b\\n', 'Cookie: a="b ', '>Cookie: ', 'Authorization: Token x\\n', 'Authorization: Negotiate Ab1\\n', 'HTTP_COOKIE=', 'A_TOKEN=', 'X-Api-Key: ', 'eyJ-', 'eyJaaaaaaaaaa.', 'a-', 'a.', 'a://', 'a://u:', '-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\nAAAA\n', '-----BEGIN ', 'token=', 'API_TOKEN=', '"API_TOKEN":', '\\"', 'a\\n', '%20', 'AKIA', 'sk-', 'ghp_', 'Bearer ', 'Basic ', '\n', ' '];
const GUARD_UNITS = ['Authorization: Digest ', 'Cookie: ', 'Cookie: aaaa ', 'Authorization: Bearer ', 'curl -u ', 'eyJ-', 'a-', 'a://u:', '-----BEGIN PRIVATE KEY-----', '"API_TOKEN":', 'a\\n', '%20'];
const SURFACES = {
  mask: (s) => mask(s), safeSnapshot: (s) => safeSnapshot(s),
  scrubString: (s) => guard.scrubString(s), scrubDetail: (s) => guard.scrubDetail({ a: s, b: [s] }),
  publicOut: (s) => guard.publicOut('juqode:x', { ok: true, a: { b: [s] }, detail: { x: s } }),
};
test('hostile input: for every generator and surface time(160k)/time(80k) < 3 and time(160k) < 1 s (best of 5)', () => {
  const bad = [];
  for (const unit of HOSTILE) for (const [sn, f] of Object.entries(SURFACES)) {
    if ((sn === 'scrubString' || sn === 'scrubDetail' || sn === 'publicOut') && !GUARD_UNITS.includes(unit)) continue;   // the scrub path runs both maskers + path rewrites: a representative subset keeps the file fast
    const best = (n) => { const s = unit.repeat(Math.ceil(n / unit.length)).slice(0, n); let m = Infinity; for (let i = 0; i < 5; i++) { const t = process.hrtime.bigint(); f(s); m = Math.min(m, Number(process.hrtime.bigint() - t) / 1e6); } return m; };
    const a = best(80000), b = best(160000);
    if (b >= 1000 || (b / Math.max(a, 1) >= 3 && b > 250)) bad.push(`${JSON.stringify(unit)} ${sn}: ${a.toFixed(0)} -> ${b.toFixed(0)} ms`);
  }
  assert.deepStrictEqual(bad, []);
});


const BS_PREFIXES = ['Cookie: a=b', 'Set-Cookie: a=b', '{"Cookie":"a=b', 'Cookie: a=b;', '>Cookie: a=b', 'Cookie: ', 'Authorization: Digest a=b', 'Authorization: Digest ', 'Proxy-Authorization: Digest a=b', 'Authorization: Negotiate Ab1',
  'Authorization: Token Ab12', 'Authorization: Basic Yt12', 'Authorization: Bearer Ab12', 'curl -u a:b', 'x-api-key: ', '-----BEGIN PRIVATE KEY-----\\n', '-----BEGIN PRIVATE KEY-----\n', 'https://u:p', 'a'.repeat(20) + '://u:p',
  'eyJhbGciOiJIUzI1NiJ9.', 'API_TOKEN=', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=', 'password: string', '"API_TOKEN":"'];
const BS_UNITS = ['\\', '\\\\n', '\\x', '\\\\\\\\', '\\n\\', '\\"', ' \\ '];
test('backslash-run adversarial suffixes: every prefix class x every suffix unit is linear (time(120k)/time(60k) < 3, < 1 s at 120k)', () => {
  const bad = [];
  const best = (f, s) => { let m = Infinity; for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); f(s); m = Math.min(m, Number(process.hrtime.bigint() - t) / 1e6); } return m; };
  for (const pre of BS_PREFIXES) for (const unit of BS_UNITS) {
    const mk = (n) => pre + unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    for (const [sn, f] of [['mask', mask], ['safeSnapshot', safeSnapshot]]) {
      const a = best(f, mk(60000)), b = best(f, mk(120000));
      if (b >= 1000 || (b / Math.max(a, 1) >= 3 && b > 250)) bad.push(`${JSON.stringify(pre)} x ${JSON.stringify(unit)} ${sn}: ${a.toFixed(0)} -> ${b.toFixed(0)} ms`);
    }
  }
  for (const pre of ['Cookie: a=b', 'Authorization: Digest a=b', 'Authorization: Token Ab12', '"API_TOKEN":"']) for (const unit of ['\\', '\\\\n', '\\"']) {
    const s = pre + unit.repeat(Math.ceil(120000 / unit.length)).slice(0, 120000);
    for (const [sn, f] of [['scrubString', guard.scrubString], ['scrubDetail', (x) => guard.scrubDetail({ a: x })], ['publicOut', (x) => guard.publicOut('juqode:x', { a: { b: [x] } })]]) {
      const b = best(f, s);
      if (b >= 1500) bad.push(`${JSON.stringify(pre)} x ${JSON.stringify(unit)} ${sn}: ${b.toFixed(0)} ms @120k`);
    }
  }
  assert.deepStrictEqual(bad, []);
});

