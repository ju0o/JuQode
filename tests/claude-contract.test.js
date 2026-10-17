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
  // a symlink or realpath mapping is applied to BOTH sides
  const real = (p) => path.resolve(p.split(path.sep).join('/').replace(/\/link\//, '/real/'));
  assert.strictEqual(C.coveredByGrant(['Edit(//link/f.txt)'], { name: 'Write', input: { file_path: '/real/f.txt' } }, '/x', { realpath: real }).covered, true);
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
