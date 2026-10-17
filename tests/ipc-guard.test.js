/* V1-409 · the renderer is untrusted input.
 *
 * Real handlers (`makeHandlers`) over a real in-memory store: the size and type of every
 * free-text argument is checked BEFORE the classifier, the DB, a Work or the shell sees it, and an
 * over-limit value is refused whole - never truncated and run. Internal error text never reaches
 * the renderer's `detail`.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const { openDb } = require(path.join(R, 'app/main/db/db.js'));
const repo = require(path.join(R, 'app/main/db/repo.js'));
const guard = require(path.join(R, 'app/main/ipc-guard.js'));
const { makeHandlers } = require(path.join(R, 'app/main/ipc.js'));
const { tempDir } = require(path.join(__dirname, 'tmp.js'));
const { code } = require(path.join(__dirname, 'src.js'));

const L = guard.LIMITS;
const TOO_LONG = (limit, unit) => ({ ok: false, reason: 'input-too-long', limit, unit });
const counts = (db) => ({
  task: db.prepare('select count(*) n from task').get().n,
  work: db.prepare('select count(*) n from work').get().n,
});

function rig() {
  const db = openDb(':memory:');
  const root = tempDir('juqode-v409-');
  const p = repo.openProject(db, root, 'v409');
  const h = makeHandlers({ db: () => db, dbFault: () => null, evidenceStore: () => path.join(root, 'ev'), push: () => {} });
  return { db, p, h, root };
}
const call = (h, ch, ...a) => h[`juqode:${ch}`](null, ...a);

/* the two units: Unicode code points, and UTF-8 bytes */
const MIXED = ['a', '한', '😀', 'é', '👨‍👩‍👧'];     // 1, 1, 1 (astral), 1, ZWJ family = 5 code points

test('limit table is the PM baseline', () => {
  assert.deepStrictEqual([L.text, L.qcPhrase, L.shellBytes], [20000, 4096, 65536]);
});

for (const ch of MIXED.slice(0, 4)) {
  test(`route-intent: limit-1 / limit / limit+1 code points of ${JSON.stringify(ch)}`, () => {
    const { h } = rig();
    assert.strictEqual(call(h, 'route-intent', ch.repeat(L.text - 1)).ok, true);
    assert.strictEqual(call(h, 'route-intent', ch.repeat(L.text)).ok, true);
    assert.deepStrictEqual(call(h, 'route-intent', ch.repeat(L.text + 1)), TOO_LONG(L.text, 'chars'));
  });
  test(`qc-route: limit-1 / limit / limit+1 code points of ${JSON.stringify(ch)}`, () => {
    const { h, p } = rig();
    assert.strictEqual(call(h, 'qc-route', p.id, ch.repeat(L.qcPhrase)).ok, true);
    assert.deepStrictEqual(call(h, 'qc-route', p.id, ch.repeat(L.qcPhrase + 1)), TOO_LONG(L.qcPhrase, 'chars'));
  });
}

test('a ZWJ family emoji counts by code point (5), not by what it looks like (1)', () => {
  const { h } = rig();
  const fam = MIXED[4];
  assert.strictEqual([...fam].length, 5);
  assert.strictEqual(call(h, 'route-intent', fam.repeat(L.text / 5)).ok, true);
  assert.strictEqual(call(h, 'route-intent', fam.repeat(L.text / 5 + 1)).reason, 'input-too-long');
});

test('mixed Unicode right at the limit (UTF-16 length is ABOVE it, code points are not)', () => {
  const { h } = rig();
  const s = '😀'.repeat(L.text);                 // 40,000 UTF-16 units, 20,000 code points
  assert.strictEqual(s.length, L.text * 2);
  assert.strictEqual(call(h, 'route-intent', s).ok, true);
  assert.strictEqual(call(h, 'route-intent', `${s}a`).reason, 'input-too-long');
});

test('empty strings and wrong types: refused, with a code, and nothing runs', () => {
  const { h, p, db } = rig();
  assert.strictEqual(call(h, 'route-intent', '').ok, true, 'an empty request is classified, not an error');
  for (const bad of [null, undefined, 7, true, {}, [], ['x'], [['x']], { toString: () => 'x' }]) {
    assert.strictEqual(call(h, 'route-intent', bad).reason, 'bad-input', String(typeof bad));
    assert.strictEqual(call(h, 'qc-route', p.id, bad).reason, 'bad-input');
  }
  assert.deepStrictEqual(counts(db), { task: 0, work: 0 });
});

test('an array can not smuggle a huge string past the check (String([x]) === x)', async () => {
  const { h, p, db } = rig();
  const big = ['x'.repeat(5_000_000)];
  const t0 = process.hrtime.bigint();
  assert.strictEqual(call(h, 'route-intent', big).reason, 'bad-input');
  assert.strictEqual(call(h, 'qc-route', p.id, big).reason, 'bad-input');
  assert.strictEqual((await call(h, 'work-start', p.id, big)).reason, 'empty-intent');
  assert.strictEqual(call(h, 'term-write', p.id, big).reason, 'not-open');           // no session; type is checked next
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200, 'refusal must not scan the payload');
  assert.deepStrictEqual(counts(db), { task: 0, work: 0 });
});

test('5M characters are refused in well under the 0.9-2.1 s the classifier and matcher need', () => {
  const { h, p } = rig();
  const big = 'x'.repeat(5_000_000);
  for (const [ch, args] of [['route-intent', [big]], ['qc-route', [p.id, big]]]) {
    const t0 = process.hrtime.bigint();
    const r = call(h, ch, ...args);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.strictEqual(r.reason, 'input-too-long');
    assert.ok(ms < 100, `${ch} took ${ms} ms`);
  }
});

test('work-start / work-answer / task-retry: over-limit is refused before any Work, Task or write', async () => {
  const { h, p, db } = rig();
  const task = repo.createTask(db, p.id, { goal: 'g' });
  const before = counts(db);
  const long = 'x'.repeat(L.text + 1);
  assert.deepStrictEqual(await call(h, 'work-start', p.id, long), TOO_LONG(L.text, 'chars'));
  assert.deepStrictEqual(await call(h, 'work-start', p.id, long, task.id, 'k1'), TOO_LONG(L.text, 'chars'));
  assert.strictEqual((await call(h, 'work-start', p.id, 'ok', 'x'.repeat(L.id + 1), 'k')).reason, 'bad-input');
  assert.strictEqual((await call(h, 'work-start', p.id, 'ok', task.id, 'k'.repeat(L.id + 1))).reason, 'bad-input');
  assert.strictEqual((await call(h, 'work-start', p.id, 'ok', null, ['k'])).reason, 'bad-input');
  assert.deepStrictEqual(await call(h, 'task-retry', task.id, 'w', long, 'k'), TOO_LONG(L.text, 'chars'));
  assert.strictEqual((await call(h, 'task-retry', task.id, 'w', ['x'], 'k')).reason, 'bad-retry-request');
  assert.deepStrictEqual(counts(db), before);
  // work-answer: a Work must exist for the id check, the size check comes next and nothing is sent
  assert.strictEqual((await call(h, 'work-answer', 'nope', long)).reason, 'no-work');
});

test('work-answer: over-limit and wrong type are refused for a REAL Work and nothing is sent to it', async () => {
  const { h, p, db } = rig();
  const begun = repo.beginWork(db, p.id, 'asked');
  assert.strictEqual(begun.ok, true);
  const w = begun.work;
  assert.deepStrictEqual(await call(h, 'work-answer', w.id, 'x'.repeat(L.text + 1)), TOO_LONG(L.text, 'chars'));
  for (const bad of [null, 5, ['a'], { a: 1 }]) assert.strictEqual((await call(h, 'work-answer', w.id, bad)).reason, 'bad-input');
});

test('task-create / task-update: goal, criteria, dependencies - size, count, nesting and array bypass', () => {
  const { h, p, db } = rig();
  const t = repo.createTask(db, p.id, { goal: 'base' });
  const n0 = counts(db).task;
  const ok = call(h, 'task-create', p.id, { goal: 'g'.repeat(L.text), acceptanceCriteria: ['c'.repeat(L.text)] });
  assert.strictEqual(ok.ok, true, 'exactly at the limit is accepted');
  assert.strictEqual(counts(db).task, n0 + 1);
  const refused = [
    { goal: 'g'.repeat(L.text + 1), acceptanceCriteria: ['c'] },
    { goal: 'g', acceptanceCriteria: ['c'.repeat(L.text + 1)] },
    { goal: 'g', acceptanceCriteria: [{ text: 'c'.repeat(L.text + 1) }] },
    { goal: 'g', acceptanceCriteria: Array.from({ length: L.criteria + 1 }, () => 'c') },
    { goal: 'g', dependencies: Array.from({ length: L.dependencies + 1 }, () => 'd') },
    { goal: 'g', dependencies: ['d'.repeat(L.id + 1)] },
  ];
  for (const input of refused) {
    const r = call(h, 'task-create', p.id, input);
    assert.strictEqual(r.ok, false);
    assert.ok(['input-too-long', 'bad-input'].includes(r.reason), r.reason);
  }
  const bypass = [
    { goal: ['g'.repeat(5_000_000)] },
    { goal: { toString: () => 'x' } },
    { goal: 'g', acceptanceCriteria: [['c'.repeat(5_000_000)]] },
    { goal: 'g', acceptanceCriteria: [{ text: ['c'.repeat(5_000_000)] }] },
    { goal: 'g', acceptanceCriteria: 'not-a-list' },
    { goal: 'g', acceptanceCriteria: [{ text: 'c', id: ['i'] }] },
    { goal: 'g', acceptanceCriteria: [{ text: 'c', id: 'i'.repeat(L.id + 1) }] },
    { goal: 'g', dependencies: [['d']] },
    { goal: 'g', dependencies: 'd' },
    [], 'string', 7,
  ];
  const t0 = process.hrtime.bigint();
  for (const input of bypass) assert.strictEqual(call(h, 'task-create', p.id, input).reason, 'bad-input', JSON.stringify(input).slice(0, 60));
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 300);
  assert.strictEqual(counts(db).task, n0 + 1, 'no refused create wrote a Task');
  // update: same shape rules, nothing written
  const before = JSON.stringify(repo.getTask(db, t.id));
  for (const patch of [{ goal: 'g'.repeat(L.text + 1) }, { acceptanceCriteria: [['x']] }, { dependencies: [['x']] }, [], 'str']) {
    const r = call(h, 'task-update', t.id, patch);
    assert.ok(['input-too-long', 'bad-input'].includes(r.reason), JSON.stringify(r));
  }
  assert.strictEqual(call(h, 'task-update', ['x'], { goal: 'g' }).reason, 'no-task');
  assert.strictEqual(JSON.stringify(repo.getTask(db, t.id)), before);
});

/* ── the shell line: bytes, and a resource limit - not a command filter ── */
test('term-write: 64 KiB of UTF-8 bytes - limit-1, limit, limit+1, in ASCII, Hangul (3 B) and emoji (4 B)', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX shell protocol; Windows is a separate H1 case (not run)');
  const { h, p } = rig();
  assert.strictEqual((await call(h, 'term-open', p.id)).ok, true);
  try {
    const cases = [['a', 1], ['한', 3], ['😀', 4]];
    for (const [ch, bytes] of cases) {
      const fit = Math.floor(L.shellBytes / bytes);
      const mk = (n) => `#${ch.repeat(n)}`;                                  // a shell comment: runs nothing
      const fitBytes = Buffer.byteLength(mk(fit - 1));
      assert.ok(fitBytes <= L.shellBytes);
      const r = await call(h, 'term-write', p.id, mk(fit - 1));
      assert.notStrictEqual(r.reason, 'input-too-long', `${ch}: ${fitBytes} bytes must be accepted`);
      await new Promise((res) => setTimeout(res, 300));                        // let the comment line finish
      const over = Buffer.byteLength(mk(fit + 1)) > L.shellBytes ? mk(fit + 1) : mk(fit + 2);
      assert.deepStrictEqual(await call(h, 'term-write', p.id, over), TOO_LONG(L.shellBytes, 'bytes'), ch);
    }
    // exactly the limit, in ASCII
    const exact = `#${'a'.repeat(L.shellBytes - 1)}`;
    assert.strictEqual(Buffer.byteLength(exact), L.shellBytes);
    assert.notStrictEqual((await call(h, 'term-write', p.id, exact)).reason, 'input-too-long');
    await new Promise((res) => setTimeout(res, 300));
    assert.strictEqual((await call(h, 'term-write', p.id, `${exact}a`)).reason, 'input-too-long');
    for (const bad of [null, 5, ['echo hi'], { a: 1 }]) assert.strictEqual((await call(h, 'term-write', p.id, bad)).reason, 'bad-input');
    // the refusals ran nothing: the session is free (not 'busy') and still answers
    const fine = await call(h, 'term-write', p.id, 'echo still-here');
    assert.strictEqual(fine.ok, true, JSON.stringify(fine));
  } finally { h.__stopAllTerm(); }
});

test('term-write does NOT filter dangerous commands (a limit is not a filter): `rm -rf` text is accepted as typed', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX only');
  const { h, p } = rig();
  await call(h, 'term-open', p.id);
  try {
    const r = await call(h, 'term-write', p.id, '# rm -rf / (a comment: shown to prove the line is not inspected)');
    assert.strictEqual(r.ok, true);
  } finally { h.__stopAllTerm(); }
});

/* ── internal error text never leaves ── */
const LEAK = /no such table|SQLITE|\/home\/|\/Users\/|C:\\|\bat \S+ \(|ghp_|select |insert |token/i;

test('task channels answer a CODE from a closed set, never an exception message', () => {
  const { h, p, db } = rig();
  const t = repo.createTask(db, p.id, { goal: 'x' });
  const answers = [
    call(h, 'task-create', p.id, { goal: '   ' }),
    call(h, 'task-create', p.id, { goal: 'g', acceptanceCriteria: [{ text: ' ' }] }),
    call(h, 'task-create', p.id, { goal: 'g', dependencies: ['nope'] }),
    call(h, 'task-create', p.id, { goal: 'g', acceptanceCriteria: [{ text: 'a', id: 'x' }, { text: 'b', id: 'x' }] }),
    call(h, 'task-update', t.id, { goal: ' ' }),
    call(h, 'task-update', t.id, { dependencies: [t.id] }),
    call(h, 'task-update', t.id, { status: 'bogus' }),
    call(h, 'task-update', t.id, { 'secret-field-/home/me/.ssh': 1 }),
    call(h, 'task-update', 'missing', { goal: 'x' }),
    call(h, 'task-review-criterion', t.id, 'w', 'c', 'maybe', ['e']),
    call(h, 'task-review-criterion', 'missing', 'w', 'c', 'pass', ['e']),
  ];
  for (const r of answers) {
    assert.strictEqual(r.ok, false);
    assert.ok(guard.TASK_CODES.has(r.detail) || r.reason === 'bad-input', JSON.stringify(r));
    assert.ok(!LEAK.test(JSON.stringify(r)), `leaked: ${JSON.stringify(r)}`);
  }
  // specific, distinct codes keep the recovery UX (not one generic sentence)
  assert.strictEqual(answers[0].detail, 'goal-empty');
  assert.strictEqual(answers[1].detail, 'criterion-empty');
  assert.strictEqual(answers[2].detail, 'dependencies-invalid');
  assert.strictEqual(answers[4].detail, 'goal-empty');
  assert.strictEqual(answers[6].detail, 'status-invalid');
});

test('a synthetic SQL / path / token / multi-line exception becomes `internal` and says nothing', () => {
  const { h, p, db } = rig();
  const t = repo.createTask(db, p.id, { goal: 'x' });
  // 1) a real engine error: the SQL text, table and a path-bearing message are in the Error
  db.exec('drop table task');
  const created = call(h, 'task-create', p.id, { goal: 'g' });
  assert.deepStrictEqual(created, { ok: false, reason: 'invalid-task', detail: 'internal' });
  // 2) every message shape the guard might ever be handed
  const nasty = [
    'SQLITE_ERROR: near "select": syntax error in /home/skkse12/.juqode/store.db',
    'ENOENT /Users/bob/secret.pem\n    at Object.openSync (node:fs:601:3)\n    at ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    'C:\\Users\\bob\\AppData\\token=abcd1234efgh5678',
  ];
  for (const m of nasty) {
    for (const cls of [TypeError, Error, RangeError]) {
      assert.strictEqual(guard.taskErrorCode(new cls(m)), 'internal');
      assert.strictEqual(guard.taskErrorCode(new cls(m), guard.REVIEW_ERRORS), 'internal');
    }
  }
  assert.strictEqual(guard.taskErrorCode('a string'), 'internal');
  assert.strictEqual(guard.taskErrorCode(null), 'internal');
  void t;
});

test('every message the Task code throws for a renderer mistake has a code (a new message fails here, not in production)', () => {
  const src = code('app/main/db/repo.js');
  const thrown = [...src.matchAll(/throw new TypeError\('([^'`]+)'\)/g)].map((m) => m[1]);
  const known = new Set([...guard.TASK_ERRORS.keys(), ...guard.REVIEW_ERRORS.keys()]);
  // messages from paths no Task/review channel reaches (Run ContextBundle / evidence / app session)
  const elsewhere = /ContextBundle|Run evidence|App session|Work not found/;
  const missing = thrown.filter((m) => !known.has(m) && !elsewhere.test(m));
  assert.deepStrictEqual(missing, [], `repo throws a message with no public code: ${missing.join(' | ')}`);
});

test('scrubDetail: stack frames, home directories, secrets and size - for text a CHILD process wrote', () => {
  const raw = 'boom in /home/skkse12/proj/a.js\n    at foo (/home/skkse12/x.js:1:1)\nAPI_TOKEN=abcd1234efgh ghp_' + 'a1B2'.repeat(6) + ' C:\\Users\\bob\\x';
  const out = guard.scrubString(raw);
  assert.ok(!/\/home\/skkse12|\bat foo|abcd1234|ghp_|bob/.test(out), out);
  assert.ok(out.length <= 501);
  assert.ok(guard.scrubString('x'.repeat(10_000)).length <= 501);
  const d = guard.scrubDetail({ code: 1, stderr: raw, nested: { deep: { deeper: { deepest: 'x' } } }, list: [raw] });
  assert.ok(!/ghp_|\/home\/skkse12/.test(JSON.stringify(d)));
  assert.strictEqual(d.code, 1);
});

test('every handler answer leaves through the same scrub of `detail`, except the user\'s own folder echo', async () => {
  const leak = 'stderr /home/skkse12/x ghp_' + 'a1B2'.repeat(6);
  const out = guard.publicOut('juqode:work-start', { ok: false, reason: 'start-failed', detail: { code: 1, stderr: leak } });
  assert.ok(!/ghp_|\/home\/skkse12/.test(JSON.stringify(out)));
  assert.strictEqual(guard.publicOut('juqode:open-path', { ok: false, detail: 'ENOENT /home/skkse12/mine' }).detail, 'ENOENT /home/skkse12/mine');
  // and it is really wired in: a real handler whose answer carries a leaking detail is scrubbed on the way out
  const refused = makeHandlers({ db: () => null, dbFault: () => leak, evidenceStore: () => '/x', push: () => {} });
  const r = call(refused, 'task-list', 'p');
  assert.strictEqual(r.reason, 'no-store');
  assert.ok(typeof r.detail === 'string' && !/ghp_|\/home\/skkse12/.test(r.detail), r.detail);
  assert.strictEqual(guard.safeCode('ENOENT'), 'ENOENT');
  assert.strictEqual(guard.safeCode('has space /home/x'), null);
  assert.strictEqual(guard.safeCode({ toString: () => 'x' }), null);
});

test('qc-ack: an unexpected write error is a short code, not the exception message', () => {
  const src = code('app/main/qc/ack.js');
  assert.ok(!/detail: String\(e\?\.code \?\? e\?\.message/.test(src));
});
