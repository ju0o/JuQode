'use strict';
/* V1-409 · what the structured IPC answers (`work-signals`, `work-reader`, `work-get`) carry back to the renderer.
 * `publicOut` scrubs only `detail`; these answers' `signals[].payload` is whatever the Supervisor STORED. So the trust
 * boundary is the persistence masking, and it is tested here on the real path: fixture CLI -> Supervisor -> DB -> handler.
 * This file also PINS the one asymmetry found (see FINDING) so a change to it has to touch a test. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });
const GH = `ghp_${'A1b2C3d4E5f6G7h8I9j0'.repeat(2)}`;
const CORE = 'A1b2C3d4E5f6G7h8I9j0';

async function runWork({ task }) {
  const dir = tempDir('juqode-ob-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '.'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '-A', '.'); g('commit', '-qm', 'b');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const store = tempDir('juqode-ob-store-');
  const home = tempDir('juqode-ob-cli-');
  const bin = fake.scriptBin(home, 'say-secret', `init();
emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(`token is ${GH} ok`)} }] } });
result({ result: ${JSON.stringify(`done ${GH}`)} }); process.exit(0);`);
  const t = task ? repo.createTask(db, project.id, { goal: 'g' }) : null;
  const run = await supervisor.start(db, project, 'say it', { evidenceStore: store, bin, detect: AVAILABLE, taskId: t?.id ?? null, idempotencyKey: task ? 'k1' : null });
  assert.strictEqual(run.ok, true);
  await run.done;
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => store, push() {}, pushQc() {} });
  return { h, workId: run.workId };
}

test('Task Run: the stored stream the renderer can read holds no synthetic token', async () => {
  const { h, workId } = await runWork({ task: true });
  const s = h['juqode:work-signals'](null, workId);
  assert.strictEqual(s.ok, true);
  assert.ok(s.signals.length > 0);
  assert.ok(!JSON.stringify(s).includes(CORE), 'work-signals carried the token');
  assert.ok(!JSON.stringify(h['juqode:work-get'](null, workId)).includes(CORE), 'work-get carried the token');
  assert.ok(!JSON.stringify(h['juqode:work-reader'](null, workId)).includes(CORE), 'work-reader carried the token');
});

test('FINDING (pinned): a Work started WITHOUT a Task stores its stream unmasked, and work-signals returns it as stored', async () => {
  const { h, workId } = await runWork({ task: false });
  const s = h['juqode:work-signals'](null, workId);
  /* writeSignal masks only `if (work.task_id)`. The renderer does not draw these payloads (visual E2E asserts no raw
   * provider key is visible), but the channel itself hands them over. If this starts failing, the asymmetry was closed -
   * update docs/evidence V1-409 IPC-OUTPUT-BOUNDARY and delete this test. */
  assert.ok(JSON.stringify(s).includes(CORE), 'asymmetry gone: a non-Task stream is now masked');
});
