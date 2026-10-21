'use strict';
/* Shared inputs and helpers for the V1-409 hostile-input TIMING tests (several small files so none of them nears the per-file limit under load).
 * Not a test file itself (no .test.js suffix). */
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { mask } = require(path.join(R, 'app/main/qc/run.js'));
const { safeSnapshot } = require(path.join(R, 'app/main/work/context.js'));
const guard = require(path.join(R, 'app/main/ipc-guard.js'));

const HOSTILE = ['TOKEN_ID=', 'PASSWORD_FILE=', 'API_KEY_PATH=', 'SECRET_NAME=', 'DB_PASSWORD_VERSION=', 'GITHUB_TOKEN_SECURE=', 'NAME=a1a1a1a1a1.', 'TOKEN_ID=123e4567-e89b-12d3-a456-426614174000 ', 'COOKIE_VERSION=2024-01-01-abc123-final ',
  'export TOKEN_ID=', 'TOKEN_ID: ', 'TOKEN_ID = ', 'TOKEN_ID="', "TOKEN_ID='", 'TOKEN_ID=a1', 'SECRET_NAME=a1a1a1a1a1a1a1a1a1a1 ', 'curl -b ' + '\\'.repeat(300) + '"=', 'X_TOKEN=' + '\\'.repeat(300) + '"', 'Cookie: 한글 ', 'Cookie, ', 'curl -b \'a=1; ', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN = ', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN: ', 'Authorization: Digest ', 'Proxy-Authorization: Digest ', 'Cookie: ', 'Cookie: aaaa ', 'Set-Cookie: ', 'Authorization: Basic ', 'Authorization: Bearer ', 'Authorization: Token ', 'Authorization: Negotiate ',
  'curl -u ', 'curl -s --user ', 'a\\ncurl -u ', 'curl -u a:b\\n', 'Cookie: a=b\\n', 'Cookie: a="b ', '>Cookie: ', 'Authorization: Token x\\n', 'Authorization: Negotiate Ab1\\n', 'HTTP_COOKIE=', 'A_TOKEN=', 'X-Api-Key: ', 'eyJ-', 'eyJaaaaaaaaaa.', 'a-', 'a.', 'a://', 'a://u:', '-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----\nAAAA\n', '-----BEGIN ', 'token=', 'API_TOKEN=', '"API_TOKEN":', '\\"', 'a\\n', '%20', 'AKIA', 'sk-', 'ghp_', 'Bearer ', 'Basic ', '\n', ' '];
const GUARD_UNITS = ['TOKEN_ID=', 'PASSWORD_FILE=', 'COOKIE_VERSION=2024-01-01-abc123-final ', 'TOKEN_ID = ', 'Authorization: Digest ', 'Cookie: ', 'Cookie: aaaa ', 'Authorization: Bearer ', 'curl -u ', 'eyJ-', 'a-', 'a://u:', '-----BEGIN PRIVATE KEY-----', '"API_TOKEN":', 'a\\n', '%20'];
const SURFACES = {
  mask: (s) => mask(s), safeSnapshot: (s) => safeSnapshot(s),
  scrubString: (s) => guard.scrubString(s), scrubDetail: (s) => guard.scrubDetail({ a: s, b: [s] }),
  publicOut: (s) => guard.publicOut('juqode:x', { ok: true, a: { b: [s] }, detail: { x: s } }),
};
const BS_PREFIXES = ['Cookie: a=b', 'Set-Cookie: a=b', '{"Cookie":"a=b', 'Cookie: a=b;', '>Cookie: a=b', 'Cookie: ', 'Authorization: Digest a=b', 'Authorization: Digest ', 'Proxy-Authorization: Digest a=b', 'Authorization: Negotiate Ab1',
  'Authorization: Token Ab12', 'Authorization: Basic Yt12', 'Authorization: Bearer Ab12', 'curl -u a:b', 'x-api-key: ', '-----BEGIN PRIVATE KEY-----\\n', '-----BEGIN PRIVATE KEY-----\n', 'https://u:p', 'a'.repeat(20) + '://u:p',
  'eyJhbGciOiJIUzI1NiJ9.', 'API_TOKEN=', 'MY_COMPANY_BILLING_SERVICE_ACCOUNT_API_TOKEN=', 'password: string', '"API_TOKEN":"'];
const BS_UNITS = ['\\', '\\\\n', '\\x', '\\\\\\\\', '\\n\\', '\\"', ' \\ '];

/** best of `runs` wall times (ms) of f(s): a loaded machine adds noise, never speed */
function best(f, s, runs = 3) { let m = Infinity; for (let i = 0; i < runs; i++) { const t = process.hrtime.bigint(); f(s); m = Math.min(m, Number(process.hrtime.bigint() - t) / 1e6); } return m; }
const make = (unit, n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
/** growth check: time(big)/time(small) < 3 (when slow enough to matter) and time(big) < limit; returns the failures */
function growth(units, surfaces, small, big, { prefix = '', limit = 1000, ratioFloor = 400 } = {}) {
  const bad = [];
  const suspicious = (a, b) => b >= limit || (b / Math.max(a, 1) >= 3 && b > ratioFloor);   // the ratio only counts above a floor: below it timer / GC noise dominates
  for (const unit of units) for (const [sn, f] of Object.entries(surfaces)) {
    const sa = prefix + make(unit, small), sb = prefix + make(unit, big);
    let a = best(f, sa), b = best(f, sb);
    if (suspicious(a, b)) { a = Math.min(a, best(f, sa, 5)); b = Math.min(b, best(f, sb, 5)); }   // looks slow: measure again, best of 5, before calling it
    if (suspicious(a, b)) bad.push(`${JSON.stringify(unit)} ${sn}: ${a.toFixed(0)} -> ${b.toFixed(0)} ms`);
  }
  return bad;
}
module.exports = { mask, safeSnapshot, guard, HOSTILE, GUARD_UNITS, SURFACES, BS_PREFIXES, BS_UNITS, best, make, growth };
