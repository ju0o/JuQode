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

/* ═══ QA round 2 ═══ */
const { reduce, KIND } = require(path.join(R, 'app/main/work/reducer.js'));

test('F2: scopeOf offers a grant ONLY if the launch gate would accept it (one predicate) - full corpus', () => {
  const root = world();
  fs.writeFileSync(path.join(root, 'my file.txt'), 'x');
  const files = ['src/a.txt', 'src/new.txt', 'my file.txt', '.gitignore', '~/x', 'src\\a', ' src/a.txt', 'src/a.txt ', 'src/\u200ba', 'src/a\tb', 'src/a\nb', 'src/', 'src/*', 'a),Bash(rm -rf ~', '#c', '@x', '$HOME/x', '.claude/settings.json', '.git/config'];
  const cmds = ['npm test', 'ls', ' ls', 'ls ', 'make\tall', 'echo\u200b', 'echo \u202ea', 'ls\u00a0', 'echo "a b"', 'git status', 'a:b', ':', ':*', 'ls && rm -rf x', 'echo $(id)', 'a*', 'x?', 'rm -rf /'];
  const denials = [...files.map((f) => ({ tool: 'Edit', input: { file_path: f } })), ...files.map((f) => ({ tool: 'Write', input: { file_path: f } })), ...cmds.map((c) => ({ tool: 'Bash', input: { command: c } }))];
  for (const d of denials) {
    const r = session.scopeOf(d, root);
    if (r.spec) assert.strictEqual(C.grantRefusal(r.spec), null, `offered but launch gate refuses: ${JSON.stringify(d)} -> ${r.spec}`);
    else assert.ok(r.refusal, JSON.stringify(d));
  }
  for (const c of [' ls', 'make\tall', 'echo\u200b', 'ls ']) {
    const r = session.scopeOf({ tool: 'Bash', input: { command: c } }, root);
    assert.deepStrictEqual(r, { refusal: 'cannot-scope' }, JSON.stringify(c));
  }
  assert.strictEqual(session.scopeOf({ tool: 'Edit', input: { file_path: 'my file.txt' } }, root).spec, 'Edit(my file.txt)', 'an ordinary name with a space is still offered');
  assert.strictEqual(session.scopeOf({ tool: 'Bash', input: { command: 'npm test' } }, root).spec, 'Bash(npm test:*)');
});

test('mutation guard: the comma-joined second grant is refused by the launch gate itself', () => {
  assert.strictEqual(C.grantRefusal('Edit(a),Bash(rm -rf ~)'), 'unscoped-grant');
  assert.deepStrictEqual(build({ allowedTools: ['Edit(a),Bash(rm -rf ~)'] }), { ok: false, reason: 'unscoped-grant' });
});

test('F3/F4: project allow rules - bare READ tools pass, bare write/exec tools and pattern-everywhere file rules are refused', () => {
  for (const r of ['Read', 'Glob', 'Grep', 'LS', 'Read(./src/**)', 'Bash(npm test:*)', 'Edit(src/a.txt)', 'WebFetch(domain:example.com)', 'Edit(src/**)']) assert.strictEqual(C.allowRuleWidens(r), false, r);
  for (const r of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'mcp__x', 'mcp__x__tool', 'Bash(*)', 'Bash()', 'Bash(:*)', 'Edit(**)', 'Edit(**/*)', 'Edit(//**)', 'Edit(/**)',
    'Edit(./**)', 'Write(**/*)', 'MultiEdit(**)', 'NotebookEdit(**)', 'Edit(//etc/**)', 'Edit(~/x)', 'Edit(../x)', 7, null, '', '(']) assert.strictEqual(C.allowRuleWidens(r), true, String(r));
});
for (const [name, allow, ok] of [['bare Read/Glob/Grep/LS', ['Read', 'Glob', 'Grep', 'LS'], true], ['bare WebSearch (OPEN: refused, risk unmeasured)', ['WebSearch'], false],
  ['bare mcp__x (OPEN: refused, risk unmeasured)', ['mcp__x'], false], ['Edit(**/*)', ['Edit(**/*)'], false], ['Edit(//**)', ['Edit(//**)'], false],
  ['Edit(src/**) (OPEN: directory pattern characterized, not judged)', ['Edit(src/**)'], true], ['allow is not a list', 'Read', false]]) {
  test(`start(): project allow ${name} -> ${ok ? 'starts' : 'refused before any row or child'}`, async () => {
    const w = setup({ permissions: { allow } });
    const r = await w.start();
    if (ok) { assert.strictEqual(r.ok, true, JSON.stringify(r)); await r.done; return; }
    assert.deepStrictEqual([r.ok, r.reason, r.detail.reason], [false, 'effective-permission-widened', 'project-settings-unscoped-allow']);
    assert.deepStrictEqual(counts(w.db), [0, 0, 0, 0]);
    assert.ok(!fs.existsSync(w.marker));
  });
}
test('mutation guard: defaultMode auto is a permissive mode', async () => {
  const w = setup({ permissions: { defaultMode: 'auto' } });
  const r = await w.start();
  assert.strictEqual(r.detail?.reason, 'project-settings-permissive-mode');
  assert.ok(!fs.existsSync(w.marker));
});

test('F4 characterization (OPEN): a directory file_path "src/" is granted as Edit(src); gitignore-style semantics of that rule are UNKNOWN', () => {
  const root = world();
  assert.deepStrictEqual(session.scopeOf({ tool: 'Edit', input: { file_path: 'src/' } }, root), { spec: 'Edit(src)' });
});

test('F6: the project\'s own settings, MCP config and git internals are never offered as a one-file grant', { skip: process.platform === 'win32' && 'symlinks' }, () => {
  const root = world();
  fs.mkdirSync(path.join(root, '.git/hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), '{}');
  fs.symlinkSync(path.join(root, '.claude/settings.json'), path.join(root, 'innocent.json'));
  for (const f of ['.claude/settings.json', '.claude/settings.local.json', '.CLAUDE/Settings.json', '.git/hooks/pre-commit', '.git/hooks/new-hook', '.git/config', '.git', '.mcp.json', './.git/hooks/x', 'src/../.git/config', 'innocent.json']) {
    for (const tool of ['Edit', 'Write']) assert.deepStrictEqual(session.scopeOf({ tool, input: { file_path: f } }, root), { refusal: 'cannot-scope' }, `${tool} ${f}`);
  }
  for (const f of ['.gitignore', '.github/workflows/ci.yml', '.claude/commands/x.md', 'src/a.txt']) assert.ok(session.scopeOf({ tool: 'Edit', input: { file_path: f } }, root).spec, f);
});

test('F7: an empty / whitespace settings file is UNKNOWN (Claude may read it as {}) and stays refused; an unknown project folder is refused', async () => {
  for (const body of ['', '   \n']) {
    const w = setup(body);
    const r = await w.start();
    assert.deepStrictEqual([r.ok, r.reason, r.detail.reason], [false, 'effective-permission-widened', 'project-settings-unreadable'], JSON.stringify(body));
    assert.ok(!fs.existsSync(w.marker));
  }
  for (const p of [undefined, null, '', 5]) assert.deepStrictEqual(C.projectSettingsRefusal(p), { reason: 'project-path-unknown', source: null }, String(p));
});

test('F7 (documented): narrate / explain runs carry tools "" - no tool can write, so the project-settings gate is not needed for them', () => {
  const b = build({ tools: '' });
  assert.deepStrictEqual(b.args.slice(-3), ['--tools', '', '--strict-mcp-config']);
  assert.strictEqual(C.isPrivileged({ allowedTools: [], tools: '' }), false);
  const src = require(path.join(__dirname, 'src.js'));
  for (const f of ['app/main/interpret/narrate.js', 'app/main/change/explain.js']) assert.ok(/tools: NO_TOOLS/.test(src.code(f)), f);
});

test('Task path: the settings check runs BEFORE beginWork - no Work row for a Task Run either', async () => {
  const w = setup({ permissions: { defaultMode: 'bypassPermissions' } });
  const project = w.db.prepare('select * from project').get();
  const task = repo.createTask(w.db, project.id, { goal: 'a goal' });
  const r = await supervisor.start(w.db, project, 'do it', { taskId: task.id, evidenceStore: tempDir('juqode-pre-store-'), bin: path.join(w.root, 'nope'), detect: async () => ({ available: true, version: '9' }) });
  assert.deepStrictEqual([r.ok, r.reason], [false, 'effective-permission-widened']);
  assert.deepStrictEqual(counts(w.db), [0, 0, 0, 0]);
});

test('answer(): project settings widened AFTER the start refuse the answer before it is recorded or any child exists', async () => {
  const root = world();
  const db = openDb(':memory:');
  const project = repo.openProject(db, root, 'p');
  const home = tempDir('juqode-pre-cli3-');
  const denial = { type: 'result', subtype: 'success', is_error: false, result: 'x', permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_1', tool_input: { file_path: 'a.txt' } }] };
  const bin = fake.scriptBin(home, 'first', `init(); emit({ type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_1', message: 'no' }); result(${JSON.stringify(denial)}); process.exit(0);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: tempDir('juqode-pre-store-'), bin, detect: async () => ({ available: true, version: '9' }) });
  assert.strictEqual(r.ok, true);
  await r.done;
  const e = supervisor.live.get(r.workId);
  e.state = reduce(e.state, { kind: KIND.INPUT_REQUEST, payload: { text: 'which?' } }, new Date().toISOString());
  repo.setWorkState(db, r.workId, { status: 'input_waiting' });
  const marker = path.join(home, 'RESUMED');
  e.bin = fake.scriptBin(home, 'resume', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); init(); result(); process.exit(0);`);
  e.binding = session.bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId: e.sessionId, bin: e.bin });
  e.launchIdentity = null;
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  const before = JSON.stringify(['work', 'work_signal'].map((t) => db.prepare(`select * from ${t} order by rowid`).all()));
  const res = await supervisor.answer(db, r.workId, 'use the second one');
  assert.deepStrictEqual([res.ok, res.reason], [false, 'effective-permission-widened']);
  assert.strictEqual(JSON.stringify(['work', 'work_signal'].map((t) => db.prepare(`select * from ${t} order by rowid`).all())), before, 'nothing was recorded');
  assert.ok(!fs.existsSync(marker), 'a child was spawned');
});

/* ── F1: a refused allow / answer is VISIBLE (existing copy only: the start-refusal sentence + the raw code) ── */
test('F1: refusalNote turns every refused allow/answer into the existing refusal sentence + code; success and input-size problems unchanged', async () => {
  const m = await import(require('node:url').pathToFileURL(path.join(R, 'app/renderer/input-problem.js')).href);
  const { C: copy } = await import(require('node:url').pathToFileURL(path.join(R, 'app/renderer/copy.js')).href);
  assert.strictEqual(m.refusalNote({ ok: true, workId: 'w' }), null);
  assert.strictEqual(m.refusalNote(undefined), null);
  assert.strictEqual(m.refusalNote({ ok: false, reason: 'outside-project' }), `${copy.gap.workRefused} outside-project`);
  assert.strictEqual(m.refusalNote({ ok: false, reason: 'preflight-refused', detail: 'safety-unattested' }), `${copy.gap.workRefused} preflight-refused:safety-unattested`);
  assert.strictEqual(m.refusalNote({ ok: false, reason: 'effective-permission-widened', detail: { reason: 'project-settings-permissive-mode', source: 'settings.json' } }), `${copy.gap.workRefused} effective-permission-widened:project-settings-permissive-mode`);
  assert.strictEqual(m.refusalNote({ ok: false, reason: 'input-too-long', unit: 'chars', limit: 5 }), m.inputProblem({ ok: false, reason: 'input-too-long', unit: 'chars', limit: 5 }));
});
test('F1: both screens route the result of workAllow and workAnswer through refusalNote into a visible element (no discarded result)', () => {
  const src = require(path.join(__dirname, 'src.js'));
  for (const f of ['app/renderer/screens/sc03.js', 'app/renderer/screens/sc02.js']) {
    const code = src.code(f);
    assert.ok(/allowNote\.textContent = refusalNote\(await api\.workAllow\(/.test(code), `${f}: workAllow result`);
    assert.ok(/panel\.appendChild\(allowNote\)/.test(code), `${f}: allowNote not attached`);
    assert.ok(/note\.textContent = refusalNote\(await api\.workAnswer\(/.test(code), `${f}: workAnswer result`);
    assert.ok(!/^\s*await api\.workAllow\(/m.test(code), `${f}: a workAllow result is discarded`);
  }
});
