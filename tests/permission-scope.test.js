'use strict';
/* V1-004 §7.7 · a file grant is only offered for a file INSIDE the project, on the real filesystem.
 * Synthetic scratch trees only: the "outside" is another temp directory, never /etc or a user project, and nothing outside is written. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const session = require(path.join(R, 'app/main/claude/session.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const POSIX = process.platform !== 'win32';
const edit = (file) => ({ tool: 'Edit', toolUseId: 't1', input: { file_path: file } });
const spec = (cwd, file) => session.scopeOf(edit(file), cwd);

function world() {
  const root = fs.realpathSync(tempDir('juqode-scope-root-'));
  const out = fs.realpathSync(tempDir('juqode-scope-out-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.txt'), 'in\n');
  fs.writeFileSync(path.join(out, 'secret.txt'), 'OUTSIDE-SYNTH\n');
  fs.mkdirSync(path.join(out, 'dir'));
  return { root, out };
}

test('inside the project: existing, new, nested-new and ./.. spellings get exactly the card string', () => {
  const { root } = world();
  assert.deepStrictEqual(spec(root, 'src/a.txt'), { spec: 'Edit(src/a.txt)' });
  assert.deepStrictEqual(spec(root, path.join(root, 'src/a.txt')), { spec: 'Edit(src/a.txt)' });
  assert.deepStrictEqual(spec(root, 'src/new.txt'), { spec: 'Edit(src/new.txt)' });          // does not exist yet
  assert.deepStrictEqual(spec(root, 'src/not/yet/made/new.txt'), { spec: 'Edit(src/not/yet/made/new.txt)' });
  assert.deepStrictEqual(spec(root, './src/../src/a.txt'), { spec: 'Edit(src/a.txt)' });
  assert.strictEqual(session.allowSpec({ tool: 'Write', input: { file_path: 'src/a.txt' } }, root), 'Edit(src/a.txt)', 'Write is granted as Edit');
});

test('outside the project: relative, absolute and prefix-sibling paths are refused as outside-project', () => {
  const { root, out } = world();
  for (const f of ['../x.txt', '../../etc/hosts', path.join(out, 'secret.txt'), path.join(out, 'new.txt'), `${root}-sibling/a.txt`, '/', root, '.', '']) {
    const r = spec(root, f);
    assert.strictEqual(r.spec, undefined, `a grant was offered for ${JSON.stringify(f)}`);
    assert.ok(['outside-project', 'cannot-scope'].includes(r.refusal), f);
  }
  assert.strictEqual(spec(root, path.join(out, 'secret.txt')).refusal, 'outside-project');
  assert.strictEqual(spec(root, `${root}-sibling/a.txt`).refusal, 'outside-project', 'a sibling that shares the prefix is not inside');
});

test('symlinks: a link that leads out is refused whether the target exists or not; a link that stays inside is fine', { skip: !POSIX && 'symlinks need privileges on Windows (H1 not run)' }, () => {
  const { root, out } = world();
  fs.symlinkSync(path.join(out, 'secret.txt'), path.join(root, 'link-file'));          // file link -> outside file
  fs.symlinkSync(path.join(out, 'dir'), path.join(root, 'link-dir'));                  // dir link -> outside dir
  fs.symlinkSync(path.join(out, 'missing.txt'), path.join(root, 'dangling'));          // dangling link -> outside, nothing there yet
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'inner-dir'));                // dir link that STAYS inside
  fs.writeFileSync(path.join(root, 'plain.txt'), 'x');
  fs.writeFileSync(path.join(root, 'file-in-the-way'), 'x');
  for (const f of ['link-file', 'link-dir/new.txt', 'link-dir/deeper/new.txt', 'dangling']) {
    const r = spec(root, f);
    assert.strictEqual(r.spec, undefined, `a grant was offered through the link ${f}`);
    assert.ok(['outside-project', 'cannot-scope'].includes(r.refusal), f);
  }
  assert.strictEqual(spec(root, 'link-file').refusal, 'outside-project');
  assert.strictEqual(spec(root, 'link-dir/new.txt').refusal, 'outside-project', 'a NEW file under a link that leads out');
  assert.strictEqual(spec(root, 'file-in-the-way/x').refusal, 'cannot-scope', 'a file where a directory is expected is ambiguous');
  assert.deepStrictEqual(spec(root, 'inner-dir/a.txt'), { spec: 'Edit(inner-dir/a.txt)' });
  assert.deepStrictEqual(spec(root, 'inner-dir/new.txt'), { spec: 'Edit(inner-dir/new.txt)' });
});

test('a project that is itself reached through a symlink still works, and still refuses outside', { skip: !POSIX && 'symlinks' }, () => {
  const { root, out } = world();
  const via = path.join(out, 'project-link');
  fs.symlinkSync(root, via);
  assert.deepStrictEqual(spec(via, 'src/a.txt'), { spec: 'Edit(src/a.txt)' });
  assert.strictEqual(spec(via, path.join(out, 'secret.txt')).spec, undefined);
});

test('ambiguous / hostile spellings never produce a grant', () => {
  const { root } = world();
  for (const f of ['a),Bash(rm -rf ~', 'src/*', 'src/a.txt\nBash(x)', 'src/{a,b}', 'a\0b']) assert.strictEqual(session.allowSpec(edit(f), root), null, JSON.stringify(f));
  assert.strictEqual(session.allowSpec({ tool: 'WebFetch', input: { url: 'https://x' } }, root), null);
  assert.strictEqual(session.allowSpec(edit('src/a.txt'), path.join(root, 'does-not-exist')), null, 'a project root that cannot be resolved is ambiguous');
});

test('Bash keeps its own contract: the command is the grant, not a path check', () => {
  const { root } = world();
  assert.strictEqual(session.allowSpec({ tool: 'Bash', input: { command: 'npm test' } }, root), 'Bash(npm test:*)');
});

/* ── through the Supervisor: the refusal happens before a grant record, before any process, and leaves the Work waiting ── */
async function waiting(file) {
  const { root, out } = world();
  const db = openDb(':memory:');
  const project = repo.openProject(db, root, 'p');
  const home = tempDir('juqode-scope-cli-');
  const ev = [{ type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_o', message: 'no' },
    { type: 'result', subtype: 'success', is_error: false, result: 'x', permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_o', tool_input: { file_path: typeof file === 'function' ? file({ root, out }) : file } }] }];
  const bin = fake.scriptBin(home, 'deny', `init(); ${ev.map((e) => (e.type === 'result' ? `result(${JSON.stringify(e)});` : `emit(${JSON.stringify(e)});`)).join(' ')} process.exit(0);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: tempDir('juqode-scope-store-'), bin, detect: async () => ({ available: true, version: '9' }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  await r.done;
  const retried = path.join(home, 'RETRIED');
  const e = supervisor.live.get(r.workId);
  e.bin = fake.scriptBin(home, 'retry', `require('fs').writeFileSync(${JSON.stringify(retried)}, 'ran'); init(); result(); process.exit(0);`);
  e.binding = session.bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId: e.sessionId, bin: e.bin });
  e.launchIdentity = null;
  return { db, r, retried, root, out };
}
const rows = (db) => JSON.stringify(['work', 'work_signal', 'work_result', 'step'].map((t) => db.prepare(`select * from ${t} order by rowid`).all()));

for (const [name, make, skip] of [
  ['an absolute path outside the project', ({ out }) => path.join(out, 'secret.txt'), false],
  ['a relative path that leaves the project', () => '../escape.txt', false],
  ['a symlink inside the project that leads out', ({ root, out }) => { fs.symlinkSync(path.join(out, 'secret.txt'), path.join(root, 'ln')); return 'ln'; }, !POSIX],
]) {
  test(`allow(): ${name} - refused as outside-project before any grant or process; Work still waiting; nothing outside written`, { skip: skip && 'symlinks' }, async () => {
    const w = await waiting(make);
    const snap = supervisor.snapshot(w.db, w.r.workId);
    assert.strictEqual(snap.permission.scopable, false, 'the card must not offer a button');
    assert.strictEqual(snap.permission.scopeRefusal, 'outside-project');
    const before = rows(w.db);
    const outBefore = fs.readFileSync(path.join(w.out, 'secret.txt'), 'utf8');
    const res = await supervisor.allow(w.db, w.r.workId, 'tu_o');
    assert.deepStrictEqual([res.ok, res.reason], [false, 'outside-project']);
    assert.strictEqual(rows(w.db), before, 'a refusal records nothing and moves nothing');
    assert.ok(!fs.existsSync(w.retried), 'a retry process was started');
    assert.strictEqual(repo.getWork(w.db, w.r.workId).status, 'permission_waiting');
    assert.strictEqual(fs.readFileSync(path.join(w.out, 'secret.txt'), 'utf8'), outBefore);
    assert.ok(!fs.existsSync(path.join(w.root, '..', 'escape.txt')) || name !== 'a relative path that leaves the project');
  });
}

test('allow(): an inside file still gets the grant and the retry (the contract is narrowed, not removed)', async () => {
  const w = await waiting('src/a.txt');
  assert.strictEqual(supervisor.snapshot(w.db, w.r.workId).permission.spec, 'Edit(src/a.txt)');
  const res = await supervisor.allow(w.db, w.r.workId, 'tu_o', { executionMode: 'dev-compat' });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.ok(fs.existsSync(w.retried));
});

test('source pin: containment is decided in ONE place and the Supervisor refuses before preflight', () => {
  const src = require(path.join(__dirname, 'src.js'));
  const sess = src.code('app/main/claude/session.js');
  assert.ok(/realpathSync\(root\)/.test(sess) && /realTarget\(abs\)/.test(sess));
  const sup = src.code('app/main/work/supervisor.js');
  assert.ok(sup.indexOf("session.scopeOf(denial, entry.cwd)") < sup.indexOf('session.preflightRun('), 'the containment refusal must come before the launch dry run');
});
