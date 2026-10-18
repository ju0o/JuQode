'use strict';
/* RESTORE SAFETY HOLD (PM 2026-10-18) · the user-facing restore is refused at the IPC door, before any file moves,
 * while restore() itself (tests/restore-boundary.test.js) keeps its own boundary tests. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const gitEvidence = require(path.join(R, 'app/main/evidence/git.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));
const { code } = require(path.join(__dirname, 'src.js'));

function tree(root) {
  const out = {};
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) {
    if (n === '.git') continue;
    const p = path.join(d, n); const st = fs.lstatSync(p);
    if (st.isDirectory()) walk(p); else out[path.relative(root, p)] = st.isSymbolicLink() ? 'L:' + fs.readlinkSync(p)
      : crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  walk(root); return JSON.stringify(out);
}

/** An ENDED Work with real before/after git bases whose restore WOULD change files — if it ran. */
function rig() {
  const root = tempDir('juqode-hold-');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const g = (...a) => execFileSync('git', a, { cwd: root, env });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n'); g('add', '-A'); g('commit', '-qm', 'base');
  const store = path.join(tempDir('juqode-hold-store-'), 'evidence');
  const before = gitEvidence.capture(root, store, 'before');
  fs.writeFileSync(path.join(root, 'a.txt'), 'two\n'); fs.writeFileSync(path.join(root, 'b.txt'), 'new\n');
  const after = gitEvidence.capture(root, store, 'after');
  const db = openDb(':memory:');
  const p = repo.openProject(db, root, 'p');
  const w = repo.beginWork(db, p.id, 'x', {}).work;
  repo.saveBasis(db, w.id, 'before', { kind: 'git_tree', ref: before.ref, excluded: before.excluded });
  repo.saveBasis(db, w.id, 'after', { kind: 'git_tree', ref: after.ref, excluded: after.excluded });
  db.prepare("update work set status='ended', outcome='complete', ended_at=? where id=?").run(new Date().toISOString(), w.id);
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => store, push() {}, pushQc() {} });
  return { root, db, w, h };
}

test('work-revert on an ended Work with a real basis is refused with restore-safety-hold and no file, row or process changes', async () => {
  const { root, db, w, h } = rig();
  const files = tree(root);
  const rows = JSON.stringify(['work', 'work_signal', 'evidence_basis'].map((t) => db.prepare(`select * from ${t}`).all()));
  const out = await h['juqode:work-revert'](null, w.id);
  assert.deepStrictEqual(out, { ok: false, reason: 'restore-safety-hold' });
  assert.strictEqual(tree(root), files, 'a refused restore changed the project');
  assert.strictEqual(JSON.stringify(['work', 'work_signal', 'evidence_basis'].map((t) => db.prepare(`select * from ${t}`).all())), rows);
  assert.strictEqual(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'two\n');
  assert.ok(fs.existsSync(path.join(root, 'b.txt')));
});

test('the hold also refuses unknown / invalid ids the same way, and read-only history/changes/reader still answer', async () => {
  const { h, w } = rig();
  for (const v of [undefined, null, 42, 'nope', 'x'.repeat(129)]) {
    assert.strictEqual((await h['juqode:work-revert'](null, v)).reason, 'restore-safety-hold');
  }
  const changes = await h['juqode:work-changes'](null, w.id);
  assert.strictEqual(changes.ok, true, 'viewing the changes must survive the hold');
  assert.strictEqual((await h['juqode:work-get'](null, w.id)).ok, true);
  assert.strictEqual((await h['juqode:work-reader'](null, w.id)).ok, true);
});

test('the hold has no bypass: no env, setting or argument is read by the work-revert handler, and the renderer offers no restore control', () => {
  const ipc = code('app/main/ipc.js');
  const a = ipc.indexOf("'juqode:work-revert'");
  const handler = ipc.slice(a, ipc.indexOf("'juqode:work-reader'"));
  assert.ok(/RESTORE_SAFETY_HOLD\) return \{ ok: false, reason: 'restore-safety-hold' \}/.test(handler));
  assert.ok(handler.indexOf('RESTORE_SAFETY_HOLD') < handler.indexOf('workOr'));
  assert.ok(handler.indexOf('RESTORE_SAFETY_HOLD') < handler.indexOf('supervisor.revert'));
  assert.ok(!/process\.env|settings|flag|opts|\barg\b/.test(handler.slice(0, handler.indexOf('supervisor.revert'))), 'the handler reads something that could lift the hold');
  assert.ok(/const RESTORE_SAFETY_HOLD = true;/.test(ipc));
  const sc03 = code('app/renderer/screens/sc03.js');
  assert.ok(/const RESTORE_SAFETY_HOLD = true;/.test(sc03));
  assert.ok(/canOffer = !RESTORE_SAFETY_HOLD/.test(sc03));
});

test('permission refusal sentences are neutral about earlier changes: same fixed text for zero / some / unknown changes, never a claim that files changed or did not', () => {
  const { text } = require(path.join(__dirname, 'src.js'));
  const C = text('app/renderer/copy.js');
  const grab = (k) => new RegExp(`${k}:\\s*'([^']*)'`).exec(C)?.[1];
  const neutral = '이전에 변경된 내용이 있는지는 변경 내역에서 확인할 수 있어요.';
  for (const k of ['workOutsideProject', 'workArgsHiddenRefused']) {
    const s = grab(k);
    assert.ok(s, `${k} missing`);
    assert.ok(s.endsWith(neutral), `${k}: ${s}`);
    assert.ok(!/바뀐 파일|바뀌었|아무것도|변경됐|변경되었/.test(s), `${k} asserts a state: ${s}`);
  }
  assert.ok(/이 요청은 허용하지 않았어요/.test(grab('workOutsideProject')));
  assert.ok(/이번 허용과 재시도는 하지 않았어요/.test(grab('workArgsHiddenRefused')));
  // the sentence is a constant: the renderer never interpolates a change count into it
  const sc03 = require(path.join(__dirname, 'src.js')).code('app/renderer/screens/sc03.js');
  assert.ok(!/workOutsideProject\(|workArgsHiddenRefused\(/.test(sc03));
});
