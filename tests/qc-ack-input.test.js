'use strict';
/* V1-409 · `qc-ack-stopped` input boundary: shape and size are refused BEFORE any hold, ack file or DB row is touched;
 * per-run confirmation (partial success, foreign project, duplicates) is unchanged. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const guard = require(path.join(R, 'app/main/ipc-guard.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

function bench() {
  const was = process.env.JUQODE_CLAUDE_BIN;
  process.env.JUQODE_CLAUDE_BIN = path.join(tempDir('juqode-ai-'), 'no-such-claude');
  const db = openDb(':memory:');
  const evidence = tempDir('juqode-ai-ev-');
  const project = repo.openProject(db, tempDir('juqode-ai-p-'), 'p');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => evidence, push() {}, pushQc() {} });
  const stranded = (projectId = project.id, pid = 4242) => {
    const id = repo.beginQcRun(db, projectId, { phrase: 'x', ruleId: 'qc.dev.start', command: 'npm run dev', status: 'long_running' });
    repo.setQcRunner(db, id, { sessionId: 's', pid, startedAt: new Date().toISOString() });
    db.prepare('update quick_command_run set status = ?, ended_at = ? where id = ?').run('unknown', new Date().toISOString(), id);
    return id;
  };
  return { db, evidence, project, h, stranded, restore: () => { if (was === undefined) delete process.env.JUQODE_CLAUDE_BIN; else process.env.JUQODE_CLAUDE_BIN = was; } };
}
const ack = (b, ...a) => b.h['juqode:qc-ack-stopped'](null, ...a);
const acksOnDisk = (b) => (fs.existsSync(path.join(b.evidence, 'qc-ack')) ? fs.readdirSync(path.join(b.evidence, 'qc-ack')) : []);
const state = (b) => JSON.stringify(b.db.prepare('select * from quick_command_run order by id').all());

test('refused shapes and sizes leave DB, ack records and the Writer hold exactly as they were', (t) => {
  const b = bench(); t.after(b.restore);
  const id = b.stranded();
  const before = state(b);
  const cases = {
    'id of 129 chars': [[id, 'x'.repeat(129)], 'bad-input'],
    'non-string element': [[id, 42], 'bad-input'],
    'nested array element': [[[id]], 'bad-input'],
    'object element': [[{ runId: id }], 'bad-input'],
    'empty string element': [[''], 'bad-input'],
    '51 ids': [Array.from({ length: 51 }, (_, i) => `r${i}`), 'input-too-long'],
    '5M-id array': [new Array(5_000_000).fill('a'), 'input-too-long'],
    'string instead of array': [id, 'no-runs-named'],
    'null': [null, 'no-runs-named'],
    'empty array': [[], 'no-runs-named'],
  };
  for (const [name, [arg, reason]] of Object.entries(cases)) {
    const t0 = Date.now();
    const r = ack(b, b.project.id, arg, true);
    assert.strictEqual(r.ok, false, name);
    assert.strictEqual(r.reason, reason, name);
    assert.ok(Date.now() - t0 < 200, `${name}: refused slowly`);
  }
  assert.strictEqual(ack(b, 'p'.repeat(129), [id], true).reason, 'bad-input');
  assert.strictEqual(ack(b, { id: 1 }, [id], true).reason, 'bad-input');
  assert.strictEqual(state(b), before, 'a run row changed');
  assert.deepStrictEqual(acksOnDisk(b), [], 'an ack record was written');
  assert.strictEqual(b.h['juqode:qc-list'](null, b.project.id).held.length, 1, 'the hold was released');
  assert.strictEqual(guard.LIMITS.ackRuns, 50);
});

test('exactly 50 and exactly 128 chars pass the guard; duplicates act once; foreign and unknown runs are reported per run', (t) => {
  const b = bench(); t.after(b.restore);
  const other = repo.openProject(b.db, tempDir('juqode-ai-o-'), 'o');
  const mine = b.stranded(b.project.id, 1001);
  const foreign = b.stranded(other.id, 1002);
  b.h['juqode:qc-list'](null, b.project.id);          // build the holds, as the panel does
  const pad = ['z'.repeat(128), ...Array.from({ length: 46 }, (_, i) => `n${i}`)];
  const r = ack(b, b.project.id, [mine, mine, foreign, ...pad], true);          // 50 entries, with a duplicate
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.acked.map((x) => x.runId), [mine], 'a duplicate acknowledged twice or a foreign run released');
  assert.ok(r.skipped.some((x) => x.runId === foreign && x.reason === 'not-held-by-this-project'));
  assert.ok(r.skipped.some((x) => x.runId === 'z'.repeat(128)));
  assert.strictEqual(acksOnDisk(b).filter((n) => n.startsWith(mine)).length, 1);
  assert.deepStrictEqual(r.stillHeld, []);
  assert.strictEqual(b.h['juqode:qc-list'](null, other.id).held.length, 1, 'the other project lost its hold');
});
