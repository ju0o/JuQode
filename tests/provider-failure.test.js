'use strict';
/* V1-407 slice A: the Provider-neutral failure classifier (app/main/provider/failure.js). */
process.env.JUQODE_CLAUDE_TIMEOUT_MS = '400';          // before claude-detect is loaded
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { classify, isKnownClaudeEvent, CLASSES, RECOVERIES } = require(path.join(R, 'app/main/provider/failure.js'));
const { scriptBin } = require('./fakecli.js');
const { code: productCode } = require('./src.js');

const shape = (r) => [r.class, r.retryable, r.recovery, r.reasonCode];
const FALLBACK_WORDS = /codex|opencode|gemini|other agent|another agent|fallback|switch/i;

test('table: every recorded Claude shape maps to a fixed class / recovery / reasonCode', () => {
  const T = [
    [{ source: 'detect', code: 'not-installed' }, ['cli-missing', false, 'install-or-fix-path', 'detect-not-installed']],
    [{ source: 'detect', code: 'no-response' }, ['cli-interrupted', true, 'recheck', 'detect-no-response']],
    [{ source: 'detect', code: 'logged-out' }, ['auth-expired', false, 'reauth-in-cli', 'detect-logged-out']],
    [{ source: 'detect', code: 'unreadable-auth' }, ['unknown', false, 'recheck', 'detect-unreadable-auth']],
    [{ source: 'detect', code: 'error' }, ['cli-broken', false, 'recheck', 'detect-error']],
    [{ source: 'preflight', code: 'binary-not-found' }, ['cli-missing', false, 'install-or-fix-path', 'preflight-cli-missing']],
    [{ source: 'preflight', code: 'version-changed' }, ['version-drift', false, 'recheck', 'preflight-version-drift']],
    [{ source: 'preflight', code: 'binary-changed' }, ['version-drift', false, 'recheck', 'preflight-version-drift']],
    [{ source: 'preflight', code: 'not-the-recorded-binary' }, ['version-drift', false, 'recheck', 'preflight-version-drift']],
    [{ source: 'preflight', code: 'identity-unverifiable:binary-unreadable' }, ['cli-broken', false, 'recheck', 'preflight-cli-broken']],
    [{ source: 'preflight', code: 'script-shim-not-a-binary' }, ['cli-broken', false, 'install-or-fix-path', 'preflight-cli-broken']],
    [{ source: 'preflight', code: 'safety-unattested' }, ['unknown', false, 'none', 'preflight-refused']],
    [{ source: 'preflight', code: 'permissive-arg:--yolo' }, ['unknown', false, 'none', 'preflight-refused']],
    [{ source: 'exit', exitCode: 1 }, ['cli-broken', true, 'retry-same', 'exit-nonzero']],
    [{ source: 'exit', exitCode: null, signal: 'SIGKILL' }, ['cli-interrupted', true, 'retry-same', 'exit-signal']],
    [{ source: 'exit', exitCode: 137, signal: 'SIGTERM' }, ['cli-interrupted', true, 'retry-same', 'exit-signal']],
    [{ source: 'exit', exitCode: 0 }, ['unknown', false, 'none', 'exit-no-failure-evidence']],
    [{ source: 'stream', unknownEvent: { type: 'brand_new_event' } }, ['protocol-drift', false, 'recheck', 'stream-unknown-event']],
    [{ source: 'stream', unknownEvent: { type: 'system', subtype: 'brand_new' } }, ['protocol-drift', false, 'recheck', 'stream-unknown-event']],
    [{ source: 'stream', unknownEvent: { type: 'rate_limit_event' } }, ['unknown', false, 'none', 'stream-event-is-known']],
    [{ source: 'stream', apiErrorStatus: null }, ['unknown', false, 'none', 'stream-no-failure-evidence']],
    [{ source: 'stream', apiErrorStatus: 401 }, ['unknown', false, 'recheck', 'api-error-status-unmeasured']],
    [{ source: 'stream', apiErrorStatus: 429 }, ['unknown', false, 'recheck', 'api-error-status-unmeasured']],
    [{ source: 'version', expectedVersion: '2.1.266', actualVersion: '2.1.283' }, ['version-drift', false, 'recheck', 'version-changed']],
    [{ source: 'version', expectedVersion: '2.1.266', actualVersion: '2.1.266' }, ['unknown', false, 'none', 'version-same']],
    [{ source: 'version', expectedVersion: '2.1.266', actualVersion: '' }, ['unknown', false, 'recheck', 'version-unreadable']],
    [{ source: 'version', actualVersion: '2.1.266' }, ['unknown', false, 'recheck', 'version-not-recorded']],
  ];
  for (const [obs, want] of T) assert.deepStrictEqual(shape(classify(obs)), want, JSON.stringify(obs));
});

test('malformed / boundary inputs fail closed: unknown, never retryable, no throw', () => {
  const BAD = [undefined, null, 0, 1, '', 'exit', [], [{ source: 'exit', exitCode: 1 }], () => {}, {}, { source: 'nope' }, { source: 'exit' },
    { source: 'exit', exitCode: '1' }, { source: 'exit', exitCode: 1.5 }, { source: 'exit', exitCode: NaN }, { source: 'exit', signal: '' }, { source: 'exit', signal: 9 },
    { source: 'detect' }, { source: 'detect', code: 'logged_out' }, { source: 'detect', code: '__proto__' }, { source: 'detect', code: 'toString' },
    { source: 'preflight' }, { source: 'preflight', code: '' }, { source: 'preflight', code: '__proto__' }, { source: 'preflight', code: 'constructor:x' },
    { source: 'stream' }, { source: 'stream', unknownEvent: 'x' }, { source: 'version' }, { source: 'version', expectedVersion: 1, actualVersion: 2 }];
  for (const b of BAD) {
    const r = classify(b);
    assert.strictEqual(r.class, 'unknown', JSON.stringify(b));
    assert.strictEqual(r.retryable, false, JSON.stringify(b));
    assert.strictEqual(r.autoFallback, false);
    assert.ok(['recheck', 'none'].includes(r.recovery));
  }
  /* a getter that throws is the caller's bug, not a silent success */
  assert.throws(() => classify({ get source() { throw new Error('x'); } }));
});

test('stderr is never interpreted and never echoed (huge, unicode, secret-looking)', () => {
  const base = classify({ source: 'exit', exitCode: 2 });
  const noise = ['x'.repeat(5_000_000), '인증이 만료되었어요 401 Unauthorized', 'ENOTFOUND api.anthropic.com offline', 'rate limit 429', 'sk-ant-SECRET-token', '\u0000\ud800'];
  for (const stderrTail of noise) {
    const r = classify({ source: 'exit', exitCode: 2, stderrTail });
    assert.deepStrictEqual(r, base);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
    assert.ok(Object.keys(r).length === 5);
  }
  assert.strictEqual(classify({ source: 'stream', stderrTail: '401 expired' }).class, 'unknown');
});

test('offline / rate-limited / auth text or status is NOT classified (no recorded Claude shape)', () => {
  for (const o of [{ source: 'stream', apiErrorStatus: 401 }, { source: 'stream', apiErrorStatus: 429 }, { source: 'stream', apiErrorStatus: 529 }, { source: 'stream', apiErrorStatus: 'overloaded' },
    { source: 'exit', exitCode: 1, stderrTail: 'ENOTFOUND' }, { source: 'detect', code: 'offline' }, { source: 'detect', code: 'rate-limited' }, { source: 'preflight', code: 'auth-expired' }]) {
    const c = classify(o).class;
    assert.ok(c === 'unknown' || c === 'cli-broken', `${JSON.stringify(o)} -> ${c}`);
    assert.ok(!['offline', 'rate-limited', 'auth-expired'].includes(c));
  }
});

test('other providers: nothing about Codex / OpenCode is interpreted', () => {
  for (const provider of ['codex', 'opencode', 'Codex', 'claude ', 'CLAUDE', null, 0]) {
    for (const o of [{ source: 'detect', code: 'logged-out' }, { source: 'exit', exitCode: 1 }, { source: 'preflight', code: 'binary-changed' }, { source: 'stream', unknownEvent: { type: 'x' } }, { source: 'version', expectedVersion: 'a', actualVersion: 'b' }]) {
      const r = classify({ ...o, provider });
      assert.deepStrictEqual(shape(r), ['unknown', false, 'none', 'provider-unmeasured'], `${provider} ${JSON.stringify(o)}`);
    }
  }
  assert.strictEqual(classify({ source: 'detect', code: 'logged-out', provider: 'claude' }).class, 'auth-expired');
  for (const code of ['codex-login-required', 'opencode-auth', 'codex:exec-failed', 'ENOENT codex']) {
    assert.strictEqual(classify({ source: 'detect', code }).class, 'unknown');
    assert.strictEqual(classify({ source: 'preflight', code }).class, 'unknown');
  }
  assert.strictEqual(classify({ source: 'stream', unknownEvent: { type: 'turn.failed' } }).class, 'protocol-drift');   // unknown to Claude's table: drift, not a Codex reading
});

test('property: autoFallback is always false, result is closed-set, frozen, never names another Agent, unknown never retryable', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const junk = () => pick([undefined, null, 0, 1, -1, 137, 1.5, NaN, '', 'x', 'SIGTERM', 'logged-out', 'version-changed', '인증', 'a'.repeat(1000), [], {}, { type: 'result' }, { type: 'zzz' }, true]);
  const SRC = ['detect', 'preflight', 'exit', 'stream', 'version', 'bogus', undefined];
  for (let i = 0; i < 20000; i += 1) {
    const o = { source: pick(SRC), code: junk(), exitCode: junk(), signal: junk(), apiErrorStatus: junk(), stderrTail: junk(), expectedVersion: junk(), actualVersion: junk(), unknownEvent: junk(), provider: rnd() < 0.8 ? undefined : junk() };
    const r = classify(o);
    assert.strictEqual(r.autoFallback, false);
    assert.ok(CLASSES.includes(r.class) && RECOVERIES.includes(r.recovery));
    assert.ok(Object.isFrozen(r));
    assert.deepStrictEqual(Object.keys(r).sort(), ['autoFallback', 'class', 'reasonCode', 'recovery', 'retryable']);
    assert.ok(!FALLBACK_WORDS.test(r.reasonCode));
    if (r.class === 'unknown') { assert.strictEqual(r.retryable, false); assert.ok(r.recovery !== 'retry-same'); }
    if (r.retryable) assert.strictEqual(r.recovery === 'retry-same' || r.recovery === 'recheck', true);
    assert.ok(!['offline', 'rate-limited'].includes(r.class), 'unreachable classes became reachable without a measured shape');
  }
  /* the result object cannot be flipped */
  const r = classify({ source: 'exit', exitCode: 1 });
  assert.throws(() => { 'use strict'; r.autoFallback = true; });
  assert.strictEqual(classify({ source: 'exit', exitCode: 1 }).autoFallback, false);
});

test('fixtures: every recorded Claude event is known; replayed streams carry no failure evidence', () => {
  const fx = path.join(R, 'tests/fixtures');
  const files = [path.join(fx, 'stream-permission-denied.ndjson'), ...[1, 2, 3, 4].map((n) => path.join(fx, 'claude-h3-live', `call${n}.jsonl`))];
  for (const f of files) {
    const ev = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(ev.length > 5, f);
    for (const e of ev) {
      assert.ok(isKnownClaudeEvent(e), `${path.basename(f)}: ${e.type}/${e.subtype}`);
      assert.strictEqual(classify({ source: 'stream', unknownEvent: e }).class, 'unknown');
    }
    const res = ev.find((e) => e.type === 'result');
    assert.ok(res);
    const r = classify({ source: 'stream', apiErrorStatus: res.api_error_status });
    assert.deepStrictEqual(shape(r), ['unknown', false, 'none', 'stream-no-failure-evidence'], 'a clean recorded run was classified as a failure or a success');
    /* init version of the recording is stable against itself */
    const init = ev.find((e) => e.type === 'system' && e.subtype === 'init');
    if (init?.claude_code_version) assert.strictEqual(classify({ source: 'version', expectedVersion: init.claude_code_version, actualVersion: init.claude_code_version }).class, 'unknown');
  }
  /* protocol drift: the same recording with one event renamed is caught */
  const ev = fs.readFileSync(files[0], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const drifted = ev.map((e) => (e.type === 'rate_limit_event' ? { ...e, type: 'rate_limit_event_v2' } : e)).filter((e) => !isKnownClaudeEvent(e));
  assert.strictEqual(drifted.length, 1);
  assert.strictEqual(classify({ source: 'stream', unknownEvent: drifted[0] }).class, 'protocol-drift');
});

test('fakecli failure modes: real exit codes / signals / detect reasons classify and never suggest a fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jq-fail-'));
  try {
    const run = (name, src) => spawnSync(scriptBin(dir, name, src), ['-p'], { encoding: 'utf8' });
    const crash = run('crash', 'process.stderr.write("boom"); process.exit(3);');
    assert.deepStrictEqual(shape(classify({ source: 'exit', exitCode: crash.status, signal: crash.signal })), ['cli-broken', true, 'retry-same', 'exit-nonzero']);
    const killed = run('killed', 'process.kill(process.pid, "SIGKILL");');
    assert.strictEqual(killed.signal, 'SIGKILL');
    assert.deepStrictEqual(shape(classify({ source: 'exit', exitCode: killed.status, signal: killed.signal })), ['cli-interrupted', true, 'retry-same', 'exit-signal']);
    const clean = run('clean', 'init(); result();');
    assert.strictEqual(classify({ source: 'exit', exitCode: clean.status, signal: clean.signal }).class, 'unknown');
    const drift = run('drift', 'init(); emit({type:"brand_new_event"}); result();');
    const evs = drift.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const odd = evs.filter((e) => !isKnownClaudeEvent(e));
    assert.strictEqual(odd.length, 1);
    assert.strictEqual(classify({ source: 'stream', unknownEvent: odd[0] }).class, 'protocol-drift');

    /* detect() reasons from real fake binaries */
    const detectWith = (bin, ms = '5000') => {
      const r = spawnSync(process.execPath, ['-e', `process.env.JUQODE_CLAUDE_BIN=${JSON.stringify(bin)};require(${JSON.stringify(path.join(R, 'app/main/claude-detect.js'))}).detect().then(r=>console.log(JSON.stringify(r)))`],
        { encoding: 'utf8', env: { ...process.env, JUQODE_CLAUDE_TIMEOUT_MS: ms } });
      return JSON.parse(r.stdout);
    };
    const cases = [
      [path.join(dir, 'does-not-exist'), 'not-installed', 'cli-missing'],
      [scriptBin(dir, 'v-crash', 'if (A.includes("--version")) process.exit(3); process.exit(0);'), 'error', 'cli-broken'],
      [scriptBin(dir, 'logged-out', 'if (A.includes("--version")) { console.log("2.1.0"); } else { console.log(\'{"loggedIn":false}\'); process.exit(1); }'), 'logged-out', 'auth-expired'],
      [scriptBin(dir, 'garbage-auth', 'if (A.includes("--version")) { console.log("2.1.0"); } else { console.log("not json"); }'), 'unreadable-auth', 'unknown'],
      [scriptBin(dir, 'hang', 'setInterval(()=>{},1000)'), 'no-response', 'cli-interrupted'],
    ];
    for (const [bin, reason, cls] of cases) {
      const d = detectWith(bin, reason === 'no-response' ? '400' : '5000');
      assert.strictEqual(d.available, false); assert.strictEqual(d.reason, reason);
      const c = classify({ source: 'detect', code: d.reason });
      assert.strictEqual(c.class, cls, reason);
      assert.strictEqual(c.autoFallback, false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('product contracts the classifier mirrors: preflight reasons come from the real modules, and no app code fills in another Agent', () => {
  const src = productCode('app/main/provider/claude-contract.js') + productCode('app/main/provider/identity.js');
  for (const code of ['binary-not-found', 'binary-changed', 'version-changed', 'not-the-recorded-binary', 'no-recorded-identity', 'binary-unreadable', 'changed-while-hashing', 'script-shim-not-a-binary', 'path-changed']) {
    assert.ok(src.includes(`'${code}'`), `${code} no longer exists in the product; the classifier table is stale`);
    assert.notStrictEqual(classify({ source: 'preflight', code }).reasonCode, 'preflight-refused', code);
  }
  const own = productCode('app/main/provider/failure.js');
  assert.ok(!/require\(['"](node:)?(child_process|net|http|https|dns|fs)/.test(own), 'classifier must stay pure');
  assert.ok(!/process\.env|spawn|exec/.test(own));
});
