'use strict';
/* V1-109 / V1-405 slice A · provider-neutral PRE-START permission validation.
 * Every refusal here must happen before a Work row, a basis, or a child process exists. Synthetic temp trees and the fake CLI only; no model, no ~/.claude. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const session = require(path.join(R, 'app/main/claude/session.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const C = require(path.join(R, 'app/main/provider/claude-contract.js'));
const { permissiveArgs } = require(path.join(R, 'app/main/provider/identity.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const SID = '11111111-1111-4111-8111-111111111111';
const build = (o) => C.buildArgs({ sessionId: SID, ...o });

test('permissiveArgs: every spelling of a permission-removing option is refused (case, =, joined short, quotes, invisible characters)', () => {
  const refused = [['--AUTO'], ['--auto=true'], ['--yolo=1'], ['--Dangerously-Skip-Permissions'], ['--permission-mode', 'BypassPermissions'], ['--permission-mode=bypasspermissions'],
    ['--permission-mode', '"bypassPermissions"'], ["--permission-mode='auto'"], ['--permission-mode=acceptEdits'], ['-sdanger-full-access'], ['-s=danger-full-access'], ['--sandbox', 'DANGER-FULL-ACCESS'],
    ['-anever'], ['-a=never'], ['--ask-for-approval=NEVER'], ["-c", "approval_policy='never'"], ['--config=approval_policy=never'], ['-capproval_policy=never'],
    ['--dangerously​-skip-permissions'], ['--ａuto'], ['--add-dir', '/etc'], ['--add-dir=/'],
    ['--permission-mode', 'default', '--permission-mode', 'bypassPermissions']];
  for (const a of refused) assert.ok(permissiveArgs(a).length > 0, `passed: ${JSON.stringify(a)}`);
  const allowed = [['-p', '--output-format', 'stream-json', '--verbose', '--session-id', SID], ['--permission-mode', 'plan'], ['--permission-mode=default'], ['--sandbox', 'workspace-write'],
    ['-a', 'on-request'], ['-c', 'approval_policy=on-request'], ['--allowedTools', 'Edit(src/a.txt)'], ['--tools', 'Read,Edit,Write', '--strict-mcp-config']];
  for (const a of allowed) assert.deepStrictEqual(permissiveArgs(a), [], `refused: ${JSON.stringify(a)}`);
});

test('buildArgs: a grant wider than one narrow input, or reading differently from the card, is refused', () => {
  for (const g of ['Edit(**/*)', 'Edit(/**)', 'Edit(src/**)', 'Edit(src/*.js)', 'Edit(../x)', 'Edit(src/../../x)', 'Edit(//etc/passwd)', 'Edit(/etc/passwd)', 'Edit(~/.ssh/x)', 'Edit(~)',
    'Edit(a\\..\\b)', 'Edit( )', 'Edit( a.txt)', 'Edit(a‮.txt)', 'Edit(a​.txt)', 'Bash(:*)', 'Bash(*:*)', 'Bash(rm *:*)', 'WebFetch(domain:*)', 'Read(//**)', 'Bash(*)', 'Edit(*)']) {
    assert.deepStrictEqual(build({ allowedTools: [g] }), { ok: false, reason: 'unscoped-grant' }, g);
  }
  assert.deepStrictEqual(build({ allowedTools: null }), { ok: false, reason: 'unscoped-grant' }, 'null must refuse, not throw');
  for (const g of ['Edit(src/a.txt)', 'Edit(a.txt)', 'Bash(npm test:*)', 'Bash(git status:*)', 'Bash(rm -rf /)']) assert.strictEqual(build({ allowedTools: [g] }).ok, true, g);
});

test('buildArgs: a tools list is plain tool names only (no default/*/spec/flag-looking token)', () => {
  for (const t of ['default', '*', 'Read,*', 'Read,Bash(*)', 'Read --auto', 'Edit,--dangerously-skip-permissions', ' ', 'Read,', 'Read\n--permission-mode=bypassPermissions', 5]) {
    assert.deepStrictEqual(build({ tools: t }), { ok: false, reason: 'bad-tools' }, JSON.stringify(t));
  }
  for (const t of ['', 'Read', 'Read,Edit,Write', 'Read,Bash']) assert.strictEqual(build({ tools: t }).ok, true, JSON.stringify(t));
  assert.strictEqual(build({}).ok, true);
});

function world() {
  const root = fs.realpathSync(tempDir('juqode-pre-root-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.txt'), 'in\n');
  return root;
}
test('scopeOf: what the card shows is what the flag means (home expansion, backslash, edge whitespace, invisible characters, Bash-as-file, missing project)', () => {
  const root = world();
  const edit = (f) => session.scopeOf({ tool: 'Edit', input: { file_path: f } }, root);
  for (const f of ['~/x', '~', '~root/x', 'src\\a.txt', 'src\\..\\..\\x', ' src/a.txt', 'src/a.txt ', 'src/​a.txt', 'src/a‮.txt']) {
    assert.strictEqual(edit(f).spec, undefined, `a grant was offered for ${JSON.stringify(f)}`);
    assert.ok(edit(f).refusal, f);
  }
  assert.deepStrictEqual(edit('src/a.txt'), { spec: 'Edit(src/a.txt)' });
  assert.deepStrictEqual(session.scopeOf({ tool: 'Bash', input: { file_path: 'src/a.txt' } }, root), { refusal: 'cannot-scope' }, 'Bash(<file>) is a command rule, not that file');
  assert.deepStrictEqual(session.scopeOf({ tool: 'Bash', input: { command: 'npm test', file_path: 'a' } }, root), { spec: 'Bash(npm test:*)' });
  for (const none of [undefined, null, '']) assert.deepStrictEqual(session.scopeOf({ tool: 'Edit', input: { file_path: 'etc/passwd' } }, none), { refusal: 'cannot-scope' }, 'no project folder: nothing is "inside"');
});

/* ── start(): refusals leave 0 Work rows, 0 signals, and no child ── */
const counts = (db) => ['work', 'work_signal', 'work_result', 'step'].map((t) => db.prepare(`select count(*) n from ${t}`).get().n);
function setup(settings) {
  const root = world();
  if (settings !== undefined) {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude/settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
  }
  const db = openDb(':memory:');
  const project = repo.openProject(db, root, 'p');
  const home = tempDir('juqode-pre-cli-');
  const marker = path.join(home, 'SPAWNED');
  const bin = fake.scriptBin(home, 'ok', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); init(); result({ result: 'done' }); process.exit(0);`);
  const start = () => supervisor.start(db, project, 'do it', { evidenceStore: tempDir('juqode-pre-store-'), bin, detect: async () => ({ available: true, version: '9' }) });
  return { db, start, marker, root };
}
const REFUSED = [
  ['permissions.defaultMode bypassPermissions', { permissions: { defaultMode: 'bypassPermissions' } }, 'project-settings-permissive-mode'],
  ['permissions.defaultMode acceptEdits (any case)', { permissions: { defaultMode: 'AcceptEdits' } }, 'project-settings-permissive-mode'],
  ['permissions.defaultMode of the wrong type', { permissions: { defaultMode: 7 } }, 'project-settings-permissive-mode'],
  ['bare-tool allow rule', { permissions: { allow: ['Read', 'Bash'] } }, 'project-settings-unscoped-allow'],
  ['wildcard-only allow rule', { permissions: { allow: ['Bash(*)'] } }, 'project-settings-unscoped-allow'],
  ['additionalDirectories', { permissions: { additionalDirectories: ['/'] } }, 'project-settings-additional-directories'],
  ['unparseable settings file (unknown = refused)', '{ not json', 'project-settings-unreadable'],
  ['settings file that is not an object', '[]', 'project-settings-unreadable'],
];
for (const [name, settings, why] of REFUSED) {
  test(`start(): ${name} -> refused before any Work row or child`, async () => {
    const w = setup(settings);
    const r = await w.start();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'effective-permission-widened');
    assert.strictEqual(r.detail.reason, why);
    assert.deepStrictEqual(counts(w.db), [0, 0, 0, 0], 'a refused start leaves no Work');
    assert.ok(!fs.existsSync(w.marker), 'a child process was spawned');
  });
}
test('start(): a settings.local.json is judged the same way', async () => {
  const w = setup();
  fs.mkdirSync(path.join(w.root, '.claude'));
  fs.writeFileSync(path.join(w.root, '.claude/settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  const r = await w.start();
  assert.deepStrictEqual([r.ok, r.reason, r.detail.source], [false, 'effective-permission-widened', 'settings.local.json']);
  assert.ok(!fs.existsSync(w.marker));
});
for (const [name, settings] of [['no .claude folder', undefined], ['empty settings', {}], ['scoped allow rules and plan mode', { permissions: { defaultMode: 'plan', allow: ['Bash(npm test:*)', 'Read(./src/**)'], deny: ['Read(./.env)'] } }], ['unrelated keys', { model: 'x', env: { A: '1' } }]]) {
  test(`start(): ${name} -> still starts (normal Work is not blocked)`, async () => {
    const w = setup(settings);
    const r = await w.start();
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    await r.done;
    assert.ok(fs.existsSync(w.marker));
    assert.strictEqual(counts(w.db)[0], 1);
  });
}

test('allow(): project settings widened AFTER the start refuse the resume before any grant record or child', async () => {
  const root = world();
  const db = openDb(':memory:');
  const project = repo.openProject(db, root, 'p');
  const home = tempDir('juqode-pre-cli2-');
  const deny = { type: 'result', subtype: 'success', is_error: false, result: 'x', permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_1', tool_input: { file_path: 'src/a.txt' } }] };
  const bin = fake.scriptBin(home, 'deny', `init(); emit({ type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_1', message: 'no' }); result(${JSON.stringify(deny)}); process.exit(0);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: tempDir('juqode-pre-store-'), bin, detect: async () => ({ available: true, version: '9' }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  await r.done;
  const marker = path.join(home, 'RETRIED');
  const e = supervisor.live.get(r.workId);
  e.bin = fake.scriptBin(home, 'retry', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); init(); result(); process.exit(0);`);
  e.binding = session.bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId: e.sessionId, bin: e.bin });
  e.launchIdentity = null;
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  const before = JSON.stringify(counts(db));
  const res = await supervisor.allow(db, r.workId, 'tu_1', { executionMode: 'dev-compat' });
  assert.deepStrictEqual([res.ok, res.reason], [false, 'effective-permission-widened']);
  assert.strictEqual(JSON.stringify(counts(db)), before);
  assert.ok(!fs.existsSync(marker), 'a resume child was spawned');
});
