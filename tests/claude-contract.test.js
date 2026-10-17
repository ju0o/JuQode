'use strict';
/* Claude launch contract + event normalisation, against fixtures reduced from the approved H3 Live Probe (no model call here). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const C = require(path.join(R, 'app/main/provider/claude-contract.js'));
const { permissiveArgs } = require(path.join(R, 'app/main/provider/identity.js'));
const load = (n) => fs.readFileSync(path.join(R, 'tests/fixtures/claude-h3-live', `call${n}.jsonl`), 'utf8').trim().split('\n');
const U1 = '190fd6a6-aed7-4112-84c2-cf743eb78760';
const SHA = { hello: 'a', other: 'b' };

test('call 1: a new explicit session id is echoed by init and result; hooks ran BEFORE init; alias sonnet is not the actual model; restricted claim with 19 MCP tools FAILS', () => {
  const s = C.summarizeRun(load(1), { requestedSessionId: U1, callCwd: '/scratch/dirA', requestedModelAlias: 'sonnet', claimsRestrictedTools: true, claimedTools: [], exitCode: 0 });
  assert.strictEqual(s.session.match, true);
  assert.deepStrictEqual([s.session.requested, s.session.init, s.session.result], [U1, U1, U1]);
  assert.strictEqual(s.hooksBeforeInit, true);
  assert.deepStrictEqual([s.model.requestedAlias, s.model.actual, s.model.aliasIsNotActual], ['sonnet', 'claude-sonnet-5', true]);
  assert.strictEqual(s.tools.mcp.length, 19);
  assert.strictEqual(s.tools.builtin.length, 0);
  assert.ok(s.problems.includes('mcp-exposed'), 'an MCP-exposed run was accepted as restricted');
  assert.strictEqual(s.outcome, 'completed');
  assert.deepStrictEqual(s.fileEffect, { state: 'unobservable', changed: [] });
  assert.ok(s.notes.includes('file-effect-unobservable'));
});

test('session id: a result naming another session, or an init naming another id than requested, is a mismatch; a result without an id is silent', () => {
  const ev = load(1).map((l) => JSON.parse(l));
  const withResult = (id) => ev.map((e) => (e.type === 'result' ? { ...e, session_id: id } : e));
  assert.ok(C.summarizeRun(withResult('other'), { requestedSessionId: U1, callCwd: '/scratch/dirA' }).problems.includes('session-id-mismatch'));
  assert.ok(C.summarizeRun(ev, { requestedSessionId: 'someone-else', callCwd: '/scratch/dirA' }).problems.includes('session-id-mismatch'));
  assert.ok(!C.summarizeRun(withResult(undefined), { requestedSessionId: U1, callCwd: '/scratch/dirA' }).problems.includes('session-id-mismatch'));
  assert.ok(C.summarizeRun(ev.filter((e) => e.subtype !== 'init'), { requestedSessionId: U1 }).problems.includes('no-init'));
});

test('call 2: resume from another cwd keeps the id, init cwd follows the CALLER, and with strict MCP the exposed list is empty', () => {
  const s = C.summarizeRun(load(2), { requestedSessionId: U1, resume: true, callCwd: '/scratch/dirB', claimsRestrictedTools: true, claimedTools: [], exitCode: 0 });
  assert.strictEqual(s.session.match, true);
  assert.strictEqual(s.cwd.init, '/scratch/dirB');
  assert.strictEqual(s.cwd.followsCaller, true);
  assert.deepStrictEqual(s.tools.exposed, []);
  assert.deepStrictEqual(s.problems, []);
  // the session was created in dirA: a caller that assumed the session's own cwd would be wrong
  const wrongAssumption = C.summarizeRun(load(2), { requestedSessionId: U1, callCwd: '/scratch/dirA', exitCode: 0 });
  assert.ok(wrongAssumption.problems.includes('init-cwd-differs-from-call'));
});

test('call 3: Edit(hello.txt) was granted and the tool that RAN was Write on that exact file; a grant never covers another file', () => {
  const ctx = { callCwd: '/scratch/work', grants: ['Edit(hello.txt)'], claimsRestrictedTools: true, claimedTools: ['Read', 'Edit', 'Write'], exitCode: 0, files: { before: SHA, after: { ...SHA, hello: 'c' } } };
  const s = C.summarizeRun(load(3), ctx);
  assert.deepStrictEqual(s.tools.builtin.sort(), ['Edit', 'Read', 'Write']);
  assert.strictEqual(s.writes.length, 1);
  assert.deepStrictEqual([s.writes[0].tool, s.writes[0].path, s.writes[0].ran, s.writes[0].grant.covered], ['Write', '/scratch/work/hello.txt', true, true]);
  assert.deepStrictEqual(s.fileEffect, { state: 'changed', changed: ['hello'] });
  assert.deepStrictEqual(s.problems, []);
  // same events, a grant for ANOTHER file: the write that ran is a violation
  assert.ok(C.summarizeRun(load(3), { ...ctx, grants: ['Edit(other.txt)'] }).problems.includes('write-ran-without-grant:/scratch/work/hello.txt'));
  assert.ok(C.summarizeRun(load(3), { ...ctx, grants: [] }).problems.some((x) => x.startsWith('write-ran-without-grant')));
  // an unrelated tool name is not an Edit rule
  assert.deepStrictEqual(C.coveredByGrant(['Edit(hello.txt)'], { name: 'Bash', input: { file_path: '/scratch/work/hello.txt' } }, '/scratch/work'), { covered: false, why: 'not-a-file-write' });
});

test('call 4: Write(other.txt) denied -- event, tool_use_id, tool_result error and result list all agree; exit 0 + subtype success is NOT the outcome; the file is unchanged (0 changes, not unobservable)', () => {
  const s = C.summarizeRun(load(4), { callCwd: '/scratch/work', grants: ['Edit(hello.txt)'], exitCode: 0, files: { before: SHA, after: { ...SHA } } });
  assert.strictEqual(s.denials.length, 1);
  assert.deepStrictEqual({ ...s.denials[0] }, { toolUseId: 'toolu_017ocBjJTkvmdwrmJUaDhnU6', tool: 'Write', path: '/scratch/work/other.txt', eventSeen: true, resultListed: true, toolResultError: true, linked: true });
  assert.deepStrictEqual([s.exitCode, s.result.subtype, s.result.isError], [0, 'success', false]);
  assert.strictEqual(s.outcome, 'denied');
  assert.ok(s.notes.includes('denied-despite-success-exit'));
  assert.deepStrictEqual(s.fileEffect, { state: 'unchanged', changed: [] });
  assert.strictEqual(s.writes[0].ran, false);
  assert.deepStrictEqual(s.problems, []);
  // a denial the stream names only in the result (no tool_result error) is not linked
  const stripped = load(4).filter((l) => !/"tool_result"/.test(l));
  assert.ok(C.summarizeRun(stripped, { callCwd: '/scratch/work', exitCode: 0 }).problems.some((x) => x.startsWith('denial-not-linked')));
});

test('file effect: nothing observed is not "no change"; a created or removed file counts', () => {
  assert.strictEqual(C.fileEffect(null, { a: 1 }).state, 'unobservable');
  assert.strictEqual(C.fileEffect({ a: 1 }, undefined).state, 'unobservable');
  assert.deepStrictEqual(C.fileEffect({ a: 1 }, { a: 1 }), { state: 'unchanged', changed: [] });
  assert.deepStrictEqual(C.fileEffect({ a: 1 }, { a: 1, b: 2 }), { state: 'changed', changed: ['b'] });
  assert.deepStrictEqual(C.fileEffect({ a: 1, b: 2 }, { a: 1 }), { state: 'changed', changed: ['b'] });
});

test('grant paths are compared canonically: ./x, x, //abs, case on Windows; globs, lists and bare tools are not grants', () => {
  const g = (spec, o) => C.grantPath(spec, '/scratch/work', o);
  const H = path.resolve('/scratch/work/hello.txt');
  assert.strictEqual(g('Edit(hello.txt)').file, H);
  assert.strictEqual(g('Edit(./sub/../hello.txt)').file, H);
  assert.strictEqual(g('Edit(//scratch/work/hello.txt)').file, H);
  assert.strictEqual(g('Edit(HELLO.txt)', { caseInsensitive: true }).file, H.toLowerCase());
  assert.notStrictEqual(g('Edit(HELLO.txt)').file, H);
  for (const bad of ['Edit', 'Edit(*)', 'Edit(src/**)', 'Edit(a),Bash(b)', '']) assert.strictEqual(C.grantPath(bad, '/scratch/work'), null, bad);
  // with a realpath function: a plain file is covered; a symlink between name and bytes, or a path that cannot be resolved, is NOT
  const plain = (p) => path.resolve(p);
  const via = { realpath: (p) => path.resolve(p).replace(path.resolve('/x/link'), path.resolve('/x/real')) };
  assert.strictEqual(C.coveredByGrant(['Edit(//x/plain.txt)'], { name: 'Write', input: { file_path: '/x/plain.txt' } }, '/x', { realpath: plain }).covered, true);
  assert.strictEqual(C.coveredByGrant(['Edit(//x/link/f.txt)'], { name: 'Write', input: { file_path: '/x/link/f.txt' } }, '/x', via).why, 'symlink-redirect');
  assert.strictEqual(C.coveredByGrant(['Edit(//x/f.txt)'], { name: 'Write', input: { file_path: '/x/f.txt' } }, '/x', { realpath: () => { throw new Error('ENOENT'); } }).why, 'path-unverifiable');
  // a not-yet-existing file is resolved through its directory
  const dirOnly = { realpath: (p) => { if (path.basename(p) === 'new.txt') throw new Error('ENOENT'); return path.resolve(p); } };
  assert.strictEqual(C.coveredByGrant(['Edit(//x/new.txt)'], { name: 'Write', input: { file_path: '/x/new.txt' } }, '/x', dirOnly).covered, true);
});

test('buildArgs: same argv shape as before; restricted tools always carry --strict-mcp-config; unscoped grants, bad ids and permissive values are refused', () => {
  const a = C.buildArgs({ sessionId: U1 });
  assert.deepStrictEqual(a.args, ['-p', '--output-format', 'stream-json', '--verbose', '--session-id', U1]);
  assert.deepStrictEqual(C.buildArgs({ sessionId: U1, resume: true, allowedTools: ['Edit(a.txt)'] }).args,
    ['--resume', U1, '-p', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Edit(a.txt)']);
  const t = C.buildArgs({ sessionId: U1, tools: '' });
  assert.deepStrictEqual(t.args.slice(-3), ['--tools', '', '--strict-mcp-config']);
  assert.deepStrictEqual([t.containment.mcp, t.containment.hooks, t.containment.permissions, t.containment.attested], ['closed-by-flag', 'UNKNOWN', 'UNKNOWN', false]);
  assert.deepStrictEqual(C.buildArgs({ sessionId: U1 }).containment.mcp, 'not-restricted');
  for (const [o, why] of [[{ sessionId: '--dangerously-skip-permissions' }, 'bad-session-id'], [{ sessionId: 'a b' }, 'bad-session-id'], [{ sessionId: '' }, 'bad-session-id'], [{ sessionId: undefined }, 'bad-session-id'], [{ sessionId: U1, allowedTools: ['Edit'] }, 'unscoped-grant'], [{ sessionId: U1, allowedTools: ['Edit(*)'] }, 'unscoped-grant'],
    [{ sessionId: U1, allowedTools: ['Edit(a),Bash(b)'] }, 'unscoped-grant'], [{ sessionId: U1, tools: 5 }, 'bad-tools']]) assert.deepStrictEqual(C.buildArgs(o), { ok: false, reason: why });
});

test('permissive options are found when the value is a SEPARATE argument too; ordinary values are not', () => {
  assert.deepStrictEqual(permissiveArgs(['--sandbox', 'danger-full-access']), ['--sandbox danger-full-access']);
  assert.deepStrictEqual(permissiveArgs(['-s', 'danger-full-access', '-a', 'never']), ['-s danger-full-access', '-a never']);
  assert.deepStrictEqual(permissiveArgs(['--ask-for-approval', 'never']), ['--ask-for-approval never']);
  assert.deepStrictEqual(permissiveArgs(['--permission-mode', 'bypassPermissions', '--permission-mode', 'acceptEdits']), ['--permission-mode bypassPermissions', '--permission-mode acceptEdits']);
  assert.deepStrictEqual(permissiveArgs(['-c', 'approval_policy="never"', '--config', 'sandbox_mode=danger-full-access']), ['-c approval_policy="never"', '--config sandbox_mode=danger-full-access']);
  assert.deepStrictEqual(permissiveArgs(['--permission-mode=bypassPermissions', '--allow-dangerously-skip-permissions', '--dangerously-load-development-channels']).length, 3);
  assert.deepStrictEqual(permissiveArgs(['--sandbox', 'read-only', '--ask-for-approval', 'on-request', '--permission-mode', 'plan', '-c', 'model="x"', '--sandbox']), []);
  assert.strictEqual(C.buildArgs({ sessionId: U1, allowedTools: ['Edit(a.txt)'] }).ok, true);
});

test('containment is never an attestation: hooks and effective permissions are UNKNOWN, and a privileged launch is refused when attestation is demanded', () => {
  const c = C.containment({ tools: '' });
  assert.strictEqual(c.attested, false);
  assert.strictEqual(C.privilegedAllowed(c, { requireAttestation: true, privileged: true }), false);
  assert.strictEqual(C.privilegedAllowed(c, { requireAttestation: true, privileged: false }), true);
  assert.strictEqual(C.privilegedAllowed(c, { privileged: true }), true, 'default keeps the existing, user-approved grant flow');
  assert.throws(() => { 'use strict'; c.attested = true; }, TypeError);
});

test('preflight: the path to be executed must be the recorded binary with the recorded bytes and version; hooks/permissions stay UNKNOWN; attestation demanded = refused', () => {
  const os = require('node:os');
  const { identify } = require(path.join(R, 'app/main/provider/identity.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-pf-')); const other = path.join(dir, 'other'); const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, 'v1'); fs.writeFileSync(other, 'v1');
  try {
    const run = () => '2.1.283 (Claude Code)';
    const recorded = identify(bin, run).id;
    const build = { sessionId: U1, tools: '' };
    const ok = C.preflight({ recorded, bin, run, build });
    assert.deepStrictEqual([ok.ok, ok.containment.attested, ok.containment.hooks, ok.args.includes('--strict-mcp-config')], [true, false, 'UNKNOWN', true]);
    assert.strictEqual(C.preflight({ recorded, bin: other, run, build }).reason, 'not-the-recorded-binary');
    assert.strictEqual(C.preflight({ recorded, bin: path.join(dir, 'nope'), run, build }).reason, 'binary-not-found');
    assert.strictEqual(C.preflight({ recorded, bin, run: () => '2.1.290 (Claude Code)', build }).reason, 'version-changed');
    assert.strictEqual(C.preflight({ recorded: null, bin, run, build }).reason, 'not-the-recorded-binary');
    assert.strictEqual(C.preflight({ recorded, bin, run, build: { sessionId: U1, allowedTools: ['Edit'] } }).reason, 'unscoped-grant');
    assert.strictEqual(C.preflight({ recorded, bin, run, build, requireAttestation: true, privileged: true }).reason, 'safety-unattested');
    fs.writeFileSync(bin, 'v2-other-bytes');
    assert.strictEqual(C.preflight({ recorded, bin, run, build }).reason, 'binary-changed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preflightLaunch: modes, privilege, identity cache; an unknown mode is protected; an unreadable recorded binary is a change', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-pl-')); const bin = path.join(dir, 'claude'); const shim = path.join(dir, 'claude.cmd');
  fs.writeFileSync(bin, 'v1'); fs.writeFileSync(shim, '@echo off');
  try {
    const cache = C.createIdentityCache();
    const pl = (o) => C.preflightLaunch({ bin, cache, build: { sessionId: U1 }, ...o });
    const grant = { sessionId: U1, resume: true, allowedTools: ['Edit(a.txt)'], tools: 'Read,Edit' };
    const a = pl({ build: grant, mode: 'dev-compat' });
    assert.deepStrictEqual([a.ok, a.safety, a.identityVerified, a.privileged], [true, 'dev-compat-unattested', true, true]);
    for (const mode of ['v1-protected', 'banana', undefined, '']) assert.strictEqual(pl({ build: grant, mode }).reason, 'safety-unattested', String(mode));
    assert.strictEqual(pl({ build: { sessionId: U1, tools: null }, mode: 'v1-protected' }).reason, 'safety-unattested', 'the default tool set can write');
    const ro = pl({ build: { sessionId: U1, tools: 'Read' }, mode: 'v1-protected' });
    assert.deepStrictEqual([ro.ok, ro.safety, ro.privileged], [true, 'v1-protected-unprivileged', false]);
    // identity cache: same fingerprint -> cached; changed bytes -> new sha
    assert.strictEqual(cache.get(bin).cached, true);
    const sha1 = cache.get(bin).id.sha256;
    fs.writeFileSync(bin, 'v2-longer-bytes');
    const again = cache.get(bin);
    assert.deepStrictEqual([again.cached, again.id.sha256 !== sha1], [false, true]);
    // recorded identity
    const rec = { path: fs.realpathSync(bin), sha256: again.id.sha256, version: null };
    assert.strictEqual(pl({ recorded: rec, mode: 'dev-compat' }).ok, true);
    assert.strictEqual(pl({ recorded: { ...rec, sha256: '0'.repeat(64) }, mode: 'dev-compat' }).reason, 'binary-changed');
    assert.strictEqual(pl({ recorded: { ...rec, path: '/elsewhere' }, mode: 'dev-compat' }).reason, 'not-the-recorded-binary');
    assert.strictEqual(C.preflightLaunch({ bin, cache: C.createIdentityCache({ run: () => '2.2.2' }), build: { sessionId: U1 }, recorded: { ...rec, version: '1.1.1' }, mode: 'dev-compat' }).reason, 'version-changed');
    // a shim / missing file: tolerated once in dev-compat, never in protected, never when an identity was recorded
    const unreadable = (o) => C.preflightLaunch({ bin: shim, cache, build: { sessionId: U1 }, ...o });
    assert.deepStrictEqual([unreadable({ mode: 'dev-compat' }).ok, unreadable({ mode: 'dev-compat' }).identityVerified], [true, false]);
    assert.strictEqual(unreadable({ mode: 'v1-protected' }).reason, 'identity-unverifiable:script-shim-not-a-binary');
    assert.strictEqual(unreadable({ mode: 'dev-compat', recorded: rec }).reason, 'binary-changed');
    assert.strictEqual(C.preflightLaunch({ bin: path.join(dir, 'nope'), cache, build: { sessionId: U1 }, recorded: rec, mode: 'dev-compat' }).reason, 'binary-changed');
    // argv problems come first, whatever the mode
    assert.strictEqual(pl({ build: { sessionId: U1, allowedTools: ['Edit'] }, mode: 'dev-compat' }).reason, 'unscoped-grant');
    assert.deepStrictEqual([C.scopedRetryTools({ tool: 'Edit' }), C.scopedRetryTools({ tool: 'Write' }), C.scopedRetryTools({ tool: 'Bash' }), C.scopedRetryTools({ tool: 'WebFetch' }), C.scopedRetryTools({ tool: 'mcp__a__b' }), C.scopedRetryTools(null)],
      ['Read,Edit,Write', 'Read,Edit,Write', 'Read,Bash', null, null, null]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('bashCovered: only a plain prefix/exact match of the granted rule; chaining, substitution and look-alike prefixes are not covered', () => {
  const g = ['Bash(ls:*)'];
  for (const c of ['ls', 'ls -la', 'ls a/b']) assert.strictEqual(C.bashCovered(g, c), true, c);
  for (const c of ['lsof', 'ls; id', 'ls && id', 'ls | sh', 'ls $(id)', 'ls `id`', 'ls > f', 'ls\nid', '', null, 'cat x']) assert.strictEqual(C.bashCovered(g, c), false, String(c));
  assert.strictEqual(C.bashCovered(['Bash(git status)'], 'git status'), true);
  assert.strictEqual(C.bashCovered(['Bash(git status)'], 'git status -s'), false);
  assert.strictEqual(C.bashCovered(['Edit(ls)'], 'ls'), false, 'an Edit rule is not a Bash rule');
});

test('identity cache: prewarm hashes in the background and the later sync check is a hit; a file that changed gets a NEW identity; an unreadable one is never cached', async () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'juqode-pw-')); const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, 'bytes-one');
  try {
    const cache = C.createIdentityCache();
    assert.deepStrictEqual(await cache.prewarm(bin), { ok: true, cached: false });
    const a = cache.get(bin);
    assert.deepStrictEqual([a.ok, a.cached], [true, true]);
    assert.deepStrictEqual(await cache.prewarm(bin), { ok: true, cached: true });
    fs.writeFileSync(bin, 'bytes-two-longer');
    const b = cache.get(bin);
    assert.deepStrictEqual([b.cached, b.id.sha256 === a.id.sha256], [false, false]);
    assert.strictEqual((await cache.prewarm(path.join(dir, 'nope'))).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
