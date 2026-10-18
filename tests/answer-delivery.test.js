'use strict';
/* §8.3 · an answer the user typed is RECORDED locally; whether the provider RECEIVED it is a different fact. Fixture CLIs only (no model, no login).
 * `delivered_observed` is reserved for a real receipt signal that has no evidence definition yet (G1): it must never be produced. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const supervisor = require(path.join(R, 'app/main/work/supervisor.js'));
const session = require(path.join(R, 'app/main/claude/session.js'));
const { reduce, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
const fake = require(path.join(__dirname, 'fakecli.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));

const AVAILABLE = async () => ({ available: true, version: '9.9.9-fixture' });
const ALLOWED = new Set([null, 'answer_submitted_locally', 'delivery_pending', 'delivery_failed_unknown']);

async function waitingForAnswer() {
  const dir = tempDir('juqode-ad-');
  const db = openDb(':memory:');
  const project = repo.openProject(db, dir, 'p');
  const home = tempDir('juqode-ad-cli-');
  /* a first turn that ends on a refusal keeps the Work LIVE and waiting (the same way the permission tests do) */
  const denial = { type: 'result', subtype: 'success', is_error: false, result: 'x', permission_denials: [{ tool_name: 'Edit', tool_use_id: 'tu_1', tool_input: { file_path: 'a.txt' } }] };
  const bin = fake.scriptBin(home, 'first', `init(); emit({ type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'tu_1', message: 'no' }); result(${JSON.stringify(denial)}); process.exit(0);`);
  const r = await supervisor.start(db, project, 'x', { evidenceStore: tempDir('juqode-ad-store-'), bin, detect: AVAILABLE });
  assert.strictEqual(r.ok, true);
  await r.done;
  const e = supervisor.live.get(r.workId);
  assert.ok(e, 'the Work is not live');
  e.state = reduce(e.state, { kind: KIND.INPUT_REQUEST, payload: { text: 'which?' } }, new Date().toISOString());
  repo.setWorkState(db, r.workId, { status: 'input_waiting' });
  const resume = (script) => {
    e.bin = fake.scriptBin(home, `resume-${Math.random().toString(36).slice(2, 7)}`, script);
    e.binding = session.bindSession({ cwd: e.cwd, sessionId: e.sessionId, reportedSessionId: e.sessionId, bin: e.bin });
    e.launchIdentity = null;
  };
  return { db, id: r.workId, e, resume, dir };
}
const state = (w) => supervisor.snapshot(w.db, w.id).answerDelivery;
const rows = (db) => JSON.stringify(['work', 'work_signal'].map((t) => db.prepare(`select * from ${t} order by rowid`).all()));

test('before any answer there is no delivery state', async () => {
  const w = await waitingForAnswer();
  assert.strictEqual(state(w), null);
});

test('a resume that runs and exits 0 leaves the answer SUBMITTED LOCALLY - init, events and exit 0 are not receipt; it is pending while it runs', async () => {
  const w = await waitingForAnswer();
  w.resume(`init(); setTimeout(() => { result(); process.exit(0); }, 700);`);
  const p = supervisor.answer(w.db, w.id, 'use the second one');
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(state(w), 'delivery_pending', 'while the resume runs');
  const out = await p;
  assert.strictEqual(out.ok, true);
  assert.strictEqual(state(w), 'answer_submitted_locally', 'must NOT claim delivery on a started process / init / exit 0');
  assert.ok(ALLOWED.has(state(w)));
  assert.strictEqual(supervisor.snapshot(w.db, w.id).answerDelivery === 'delivered_observed', false);
});

test('a resume that never starts or says nothing is delivery_failed_unknown, recorded as a juqode marker, with the answer kept', async () => {
  const w = await waitingForAnswer();
  w.resume(`process.exit(3);`);                                           // no events at all
  const out = await supervisor.answer(w.db, w.id, 'hello');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(state(w), 'delivery_failed_unknown');
  const sigs = repo.signalsFor(w.db, w.id);
  assert.ok(sigs.some((s) => s.source === 'user' && s.kind === 'answer'), 'the recorded answer is kept');
  assert.ok(sigs.some((s) => s.source === 'juqode' && /juqodeAnswerDelivery/.test(String(s.payload)) && /delivery_failed_unknown/.test(String(s.payload))));
});

test('a refused resume records NO answer and invents no state (the screen gets the refusal reason)', async () => {
  const w = await waitingForAnswer();
  fs.rmSync(w.dir, { recursive: true, force: true });                      // the project folder is gone -> resume binding unverifiable
  const before = rows(w.db);
  const out = await supervisor.answer(w.db, w.id, 'hello');
  assert.strictEqual(out.ok, false);
  assert.strictEqual(rows(w.db), before, 'a refusal wrote something');
  assert.strictEqual(state(w), null);
});

test('an answer an OLDER build stored (no marker) reads as submitted-locally; the stored rows are not rewritten', async () => {
  const w = await waitingForAnswer();
  repo.addSignal(w.db, w.id, { seq: repo.nextSeq(w.db, w.id), source: 'user', kind: 'answer', payload: 'an old answer' });
  const before = rows(w.db);
  assert.strictEqual(state(w), 'answer_submitted_locally');
  assert.strictEqual(rows(w.db), before);
});

test('delivered_observed is reserved: no code path returns it, and no copy says "delivered"', () => {
  const src = require(path.join(__dirname, 'src.js'));
  const sup = src.code('app/main/work/supervisor.js');
  assert.strictEqual((sup.match(/ANSWER_DELIVERY\.OBSERVED/g) ?? []).length, 0, 'something produces delivered_observed');
  const copy = src.text('app/renderer/copy.js');
  for (const key of ['answerSubmitted', 'answerPending', 'answerFailed']) {
    const line = copy.split('\n').find((l) => l.includes(`${key}:`));
    assert.ok(line, key);
    assert.ok(!/전달했어요|전달됐어요|전해졌어요|받았어요/.test(line), `${key} claims delivery: ${line}`);
    assert.ok(/아직 확인하지 못했어요|확인하지 못했어요/.test(line), `${key} must say delivery is not confirmed`);
  }
});

test('source pin: both the work screen and the Task Inspector show the delivery line from the one helper', () => {
  const src = require(path.join(__dirname, 'src.js'));
  assert.ok(/export function answerLine/.test(src.code('app/renderer/screens/sc03.js')));
  assert.ok(/card\.appendChild\(al\)/.test(src.code('app/renderer/screens/sc03.js')));
  assert.ok(/answerLine\(latest\)/.test(src.code('app/renderer/screens/sc02.js')));
});

test('AFTER the Work ended (and after a restart: no live entry) the delivery state is still read from rows - failed-unknown is not lost, stored rows are untouched', async () => {
  const w = await waitingForAnswer();
  w.resume(`process.exit(3);`);
  await supervisor.answer(w.db, w.id, 'hello');
  assert.strictEqual(state(w), 'delivery_failed_unknown');
  repo.setWorkState(w.db, w.id, { status: 'ended', outcome: 'ended_unknown' });
  supervisor.live.delete(w.id);                                            // as after an app restart
  const before = rows(w.db);
  const snap = supervisor.snapshot(w.db, w.id);
  assert.strictEqual(snap.status, 'ended');
  assert.strictEqual(snap.answerDelivery, 'delivery_failed_unknown');
  assert.strictEqual(rows(w.db), before, 'reading rewrote a row');
});

test('an ended Work whose answer ran fine still says submitted-locally (never delivered); one with no answer says nothing', async () => {
  const a = await waitingForAnswer();
  a.resume(`init(); result(); process.exit(0);`);
  await supervisor.answer(a.db, a.id, 'ok');
  repo.setWorkState(a.db, a.id, { status: 'ended', outcome: 'complete' });
  supervisor.live.delete(a.id);
  assert.strictEqual(supervisor.snapshot(a.db, a.id).answerDelivery, 'answer_submitted_locally');
  const b = await waitingForAnswer();
  repo.setWorkState(b.db, b.id, { status: 'ended', outcome: 'complete' });
  supervisor.live.delete(b.id);
  assert.strictEqual(supervisor.snapshot(b.db, b.id).answerDelivery, null);
});

test('source pin: the renderer line is no longer hidden for an ended Work (only a stale pending is)', () => {
  const sc03 = require(path.join(__dirname, 'src.js')).code('app/renderer/screens/sc03.js');
  const f = sc03.slice(sc03.indexOf('export function answerLine'), sc03.indexOf('export function stateChip'));
  assert.ok(!/snap\.status === 'ended'\) return null/.test(f), 'an ended Work still hides the line');
  assert.ok(/ended' && snap\.answerDelivery === 'delivery_pending'/.test(f));
});
