'use strict';
/* V1-409 · single-id IPC arguments: a wrong type or an over-long id is refused before any DB lookup, process action or
 * evidence write, with the channel's EXISTING reason; a real id of another project is still refused as before. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

function rig() {
  const db = openDb(':memory:');
  const a = repo.openProject(db, tempDir('juqode-ids-a-'), 'a');
  const b = repo.openProject(db, tempDir('juqode-ids-b-'), 'b');
  const ev = tempDir('juqode-ids-ev-');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => ev, push() {}, pushQc() {} });
  return { db, a, b, h, ev };
}
const call = (h, ch, ...a) => h[`juqode:${ch}`](null, ...a);
const BAD = { number: 42, array: ['x'], object: { id: 'x' }, long129: 'x'.repeat(129), huge: 'x'.repeat(5_000_000), bool: true };
const snap = (db) => JSON.stringify(['work', 'task', 'quick_command_run'].map((t) => db.prepare(`select * from ${t}`).all()));

test('bad / over-long project, work, task, run and tool ids are refused with the channel\'s existing reason, touching nothing', async () => {
  const { db, a, h, ev } = rig();
  const before = snap(db);
  const table = [
    ['qc-list', (v) => [v], 'no-project'], ['qc-runs', (v) => [v], 'no-project'], ['brief', (v) => [v], 'no-project'], ['history', (v) => [v], 'no-project'],
    ['task-list', (v) => [v], 'no-project'], ['task-create', (v) => [v, { goal: 'g' }], 'no-project'], ['term-open', (v) => [v], 'no-project'],
    ['term-write', (v) => [v, 'ls'], 'no-project'], ['term-stop', (v) => [v], 'no-project'], ['qc-run', (v) => [v, 'qc.build', 'x'], 'no-project'],
    ['qc-route', (v) => [v, 'x'], 'no-project'], ['work-start', (v) => [v, 'x'], 'no-project'], ['legacy-unknown-ack', (v) => [v, 'w', true], 'no-project'],
    ['task-detail', (v) => [v], 'no-task'], ['task-update', (v) => [v, { goal: 'g' }], 'no-task'],
    ['work-get', (v) => [v], 'no-work'], ['work-cancel', (v) => [v], 'no-work'], ['work-allow', (v) => [v, null], 'no-work'], ['work-answer', (v) => [v, 'x'], 'no-work'],
    ['work-signals', (v) => [v], 'no-work'], ['work-changes', (v) => [v], 'no-work'], ['work-revert', (v) => [v], 'restore-safety-hold'], ['work-reader', (v) => [v], 'no-work'],
    ['qc-stop', (v) => [a.id, v], 'not-running'],
  ];
  for (const [ch, args, reason] of table) {
    for (const [kind, v] of Object.entries(BAD)) {
      const t0 = Date.now();
      const r = await call(h, ch, ...args(v));
      assert.strictEqual(r.ok, false, `${ch} accepted a ${kind} id`);
      if (!['legacy-unknown-ack', 'qc-route'].includes(ch)) assert.strictEqual(r.reason, reason, `${ch}/${kind}: ${r.reason}`);
      assert.ok(Date.now() - t0 < 300, `${ch}/${kind}: slow refusal`);
    }
  }
  /* work-allow's own id, idempotency key, work-start's task id */
  const w = repo.beginWork(db, a.id, 'x', {}).work;
  for (const [kind, v] of Object.entries({ number: 7, array: ['t'], object: {}, long129: 't'.repeat(129) })) {
    assert.strictEqual((await call(h, 'work-allow', w.id, v)).reason, 'bad-permission-id', `toolUseId ${kind}`);
  }
  assert.strictEqual((await call(h, 'work-start', a.id, 'x', null, 'k'.repeat(129))).reason, 'bad-input');
  assert.strictEqual((await call(h, 'work-start', a.id, 'x', null, ['k'])).reason, 'bad-input');
  const snapNow = JSON.stringify(db.prepare('select id, status from work').all());
  assert.ok(snapNow.includes(w.id));
  db.exec('delete from work');                         // only the work this test created
  assert.strictEqual(snap(db), before, 'a refused call changed a row');
  const fs = require('node:fs');
  assert.deepStrictEqual(fs.readdirSync(ev), [], 'a refused call wrote evidence');
});

test('a REAL id of another project is still refused for every channel that takes both', async () => {
  const { db, a, b, h } = rig();
  const wb = repo.beginWork(db, b.id, 'in b', {}).work;
  const r = await call(h, 'legacy-unknown-ack', a.id, wb.id, true);
  assert.deepStrictEqual([r.ok, r.reason], [false, 'not-legacy-work']);
  const q = repo.beginQcRun(db, b.id, { phrase: 'x', ruleId: 'qc.dev.start', command: 'npm run dev', status: 'long_running' });
  assert.strictEqual((await call(h, 'qc-stop', a.id, q)).reason, 'not-running', 'another project\'s run was addressable');
  assert.strictEqual((await call(h, 'qc-ack-stopped', a.id, [q], true)).ok, false);
  assert.strictEqual(repo.qcRun(db, q).status, 'long_running', 'the foreign run row changed');
});
