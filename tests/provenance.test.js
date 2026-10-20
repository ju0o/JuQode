/* V1-410 / V1-307 · provenance, PASS guard, truth invariants. Fixture-driven + seeded properties. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const prov = require(path.join(R, 'app/main/work/provenance.js'));
const { toSignal, replay } = require(path.join(R, 'app/main/work/reducer.js'));
const result = require(path.join(R, 'app/main/work/result.js'));
const { testEvidenceFromSignals } = require(path.join(R, 'app/main/work/run-evidence.js'));
const { PROVENANCE: P, taskPassVerdict, checkTruthInvariants, checkImmutableRun, summarizeChanges, limitClaim, classifyFact, classifyClaim, CLAIM_LIMIT } = prov;

const FX = path.join(R, 'tests/fixtures');
const lines = (f) => fs.readFileSync(path.join(FX, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const RECORDED = ['stream-permission-denied.ndjson', ...[1, 2, 3, 4].map((n) => `claude-h3-live/call${n}.jsonl`)];
const codes = (v) => v.map((x) => x.code).sort();

/** An honest snapshot of a replayed stream: tone follows the outcome, changes are not measured. */
function snapshotOf(file, changes = { known: false, files: [] }) {
  const events = lines(file);
  const signals = events.map((e) => ({ ...toSignal(e), payload: toSignal(e).payload }));
  const state = replay(signals);
  const res = result.buildChecked({ state, changes, toolResults: null }).result;
  const tone = state.outcome === 'complete' ? 'success' : state.outcome === 'failed' ? 'failure' : 'neutral';
  const real = summarizeChanges(changes);
  return { events, state, res, snap: {
    work: { status: state.status, outcome: state.outcome, finishObserved: Boolean(state.finish) },
    display: { tone, changes: real, testsPassed: false },
    changes, claims: res.claims.map((c) => ({ ...c, ...(c.kind === 'agent-report' ? { ...limitClaim(c.data.text), text: c.data.text } : {}) })),
  } };
}

/* ── recorded real streams: zero violations ── */
for (const f of RECORDED) {
  test(`recorded stream ${f}: replay + result + classifier -> zero violations`, () => {
    for (const changes of [{ known: false, files: [] }, { known: true, files: [{ path: 'hello.txt', patch_state: 'stored' }] }]) {
      const { snap, res, state } = snapshotOf(f, changes);
      assert.deepStrictEqual(prov.checkTruthInvariants(snap), []);
      assert.ok(state.finish, 'recorded stream has an observed finish');
      for (const c of res.claims) {
        const p = classifyClaim(c);
        assert.notStrictEqual(c.kind === 'changes-unknown' ? null : p, P.UNKNOWN, c.kind);
        if (c.kind === 'agent-report') { assert.strictEqual(p, P.AGENT_SAID); assert.strictEqual(c.confidence, 'expected'); }
      }
    }
  });
}

test('recorded streams contain no test run, so the PASS guard cannot pass on their text', () => {
  for (const f of RECORDED) {
    const events = lines(f);
    const signals = events.map((e) => ({ payload: JSON.stringify(e), observed_at: 't' }));
    const tests = testEvidenceFromSignals(signals);
    assert.deepStrictEqual(tests, []);
    const said = replay(events.map(toSignal)).finish?.text ?? '';
    assert.strictEqual(taskPassVerdict([{ id: 'c1', text: 'All tests pass' }], { tests, agentSaid: said }).pass, false);
  }
});

test('the denied stream: an unresolved denial is not shown as success', () => {
  const { state, snap } = snapshotOf('stream-permission-denied.ndjson');
  assert.notStrictEqual(state.outcome, 'complete');
  assert.deepStrictEqual(checkTruthInvariants(snap), []);
  assert.deepStrictEqual(codes(checkTruthInvariants({ ...snap, display: { ...snap.display, tone: 'success' } })), ['non_success_shown_success']);
});

/* ── classifier table ── */
test('classifyFact: one provenance per source', () => {
  const ok = { kind: 'test_command', details: { result_state: 'returned', exit_code: 0, tests_passed_count: 3 } };
  const bad = { kind: 'test_command', details: { result_state: 'returned', exit_code: 1, tests_passed_count: 0 } };
  const table = [
    [{ source: 'agent_summary' }, P.AGENT_SAID], [{ source: 'agent_claim' }, P.AGENT_SAID], [{ source: 'agent_report' }, P.AGENT_SAID],
    [{ source: 'tool_use' }, P.OBSERVED], [{ source: 'tool_result' }, P.OBSERVED], [{ source: 'file_change' }, P.OBSERVED],
    [{ source: 'changed_files', known: true }, P.OBSERVED], [{ source: 'changed_files', known: false }, P.UNKNOWN],
    [{ source: 'test_command', evidence: ok }, P.TEST_CONFIRMED], [{ source: 'test_command', evidence: bad }, P.OBSERVED],
    [{ source: 'criterion_review', verdict: 'pass' }, P.HUMAN_CONFIRMED], [{ source: 'criterion_review', verdict: 'fail' }, P.HUMAN_CONFIRMED],
    [{ source: 'criterion_review', verdict: 'maybe' }, P.UNKNOWN], [{ source: 'novel' }, P.UNKNOWN], [null, P.UNKNOWN],
  ];
  for (const [fact, want] of table) assert.strictEqual(classifyFact(fact), want, JSON.stringify(fact));
  assert.strictEqual(classifyClaim({ kind: 'agent-report' }), P.AGENT_SAID);
  assert.strictEqual(classifyClaim({ kind: 'changed-files' }), P.OBSERVED);
  assert.strictEqual(classifyClaim({ kind: 'tools-observed' }), P.OBSERVED);
  assert.strictEqual(classifyClaim({ kind: 'changes-unknown' }), P.UNKNOWN);
});

/* ── PASS guard ── */
const passing = (cmd, over = {}) => ({ kind: 'test_command', summary: cmd,
  details: { command: cmd, result_state: 'returned', exit_code: 0, tests_passed_count: 5, ...over } });
const UNIT = [{ id: 'u', text: 'unit tests pass' }];

test('PASS guard: test evidence in scope passes; wrong scope, failure, zero count, or a later failure does not', () => {
  const cmd = 'node --test tests/unit.test.js';
  assert.deepStrictEqual(taskPassVerdict(UNIT, { tests: [passing(cmd)] }).criteria[0], { id: 'u', status: 'passed', provenance: P.TEST_CONFIRMED });
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [passing('node --test tests/e2e/x.test.js')] }).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [passing(cmd, { exit_code: 1 })] }).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [passing(cmd, { tests_passed_count: 0 })] }).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [passing(cmd, { result_state: 'error' })] }).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [passing(cmd), passing(cmd, { exit_code: 1 })] }).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [passing(cmd, { exit_code: 1 }), passing(cmd)] }).pass, true);
});

test('PASS guard: Agent text, observed changes, no criteria, and unsupported checks never pass', () => {
  const ev = { agentSaid: 'all tests pass, 12 passed', observed: { files: ['a'] } };
  assert.strictEqual(taskPassVerdict(UNIT, ev).pass, false);
  assert.strictEqual(taskPassVerdict([], {}).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, undefined).pass, false);
  assert.strictEqual(taskPassVerdict([{ id: 'l', text: 'lint is clean' }], { tests: [passing('node --test tests/unit.test.js')] }).pass, false);
  assert.strictEqual(taskPassVerdict([{ id: 'x', text: 'the page looks good' }], { tests: [passing('node --test')] }).pass, false);
});

test('PASS guard: human verdicts - latest wins, stale digest and non-complete Run do not count', () => {
  const c = [{ id: 'h', text: 'looks right' }];
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update('looks right').digest('hex');
  const rv = (verdict, over = {}) => ({ criterion_id: 'h', verdict, criterion_digest: digest, work_outcome: 'complete', ...over });
  assert.deepStrictEqual(taskPassVerdict(c, { reviews: [rv('pass')] }).criteria[0].provenance, P.HUMAN_CONFIRMED);
  assert.strictEqual(taskPassVerdict(c, { reviews: [rv('pass'), rv('fail')] }).pass, false);
  assert.strictEqual(taskPassVerdict(c, { reviews: [rv('fail'), rv('pass')] }).pass, true);
  assert.strictEqual(taskPassVerdict(c, { reviews: [rv('pass', { criterion_digest: 'stale' })] }).pass, false);
  assert.strictEqual(taskPassVerdict(c, { reviews: [rv('pass', { work_outcome: 'ended_unknown' })] }).pass, false);
  assert.strictEqual(taskPassVerdict(c, { reviews: [rv('pass', { criterion_id: 'other' })] }).pass, false);
});

/* ── summarizeChanges / limitClaim ── */
test('summarizeChanges: 0 changes is a measurement; unavailable/unknown/unrecognised is not', () => {
  assert.deepStrictEqual(summarizeChanges({ known: true, files: [] }), { changesKnown: true, count: 0, patchComplete: true, reason: null });
  assert.deepStrictEqual(summarizeChanges({ known: true, files: [{ path: 'a', patch_state: 'unchanged' }] }).count, 0);
  for (const s of ['unavailable', undefined, 'mystery']) {
    const r = summarizeChanges({ known: true, files: [{ path: 'a', patch_state: s }] });
    assert.deepStrictEqual([r.changesKnown, r.count], [false, null], String(s));
  }
  assert.strictEqual(summarizeChanges({ known: false, files: [] }).changesKnown, false);
  for (const s of ['binary', 'too_large', 'sensitive_excluded']) {
    const r = summarizeChanges({ known: true, files: [{ path: 'a', patch_state: s }] });
    assert.deepStrictEqual([r.changesKnown, r.count, r.patchComplete], [true, 1, false], s);
  }
  assert.strictEqual(summarizeChanges({ known: true, files: [{ path: 'a', patch_state: 'stored' }] }).patchComplete, true);
});

test('limitClaim: exact boundary, marker, full text kept', () => {
  const at = 'a'.repeat(CLAIM_LIMIT); const over = 'b'.repeat(CLAIM_LIMIT + 1);
  assert.deepStrictEqual(limitClaim(at), { shown: at, truncated: false, full: at });
  const l = limitClaim(over);
  assert.strictEqual(l.truncated, true); assert.strictEqual(l.full, over);
  assert.strictEqual(l.shown, 'b'.repeat(CLAIM_LIMIT) + '…');
  assert.strictEqual(limitClaim(null).shown, '');
});

/* ── crafted negatives: each MUST produce its violation ── */
const GOOD_TASK = { status: 'open', verdict: 'unverified', criteria: UNIT, evidence: {} };
const good = () => ({
  work: { status: 'ended', outcome: 'complete', finishObserved: true },
  display: { tone: 'success', changes: { changesKnown: true, count: 1 }, testsPassed: false },
  changes: { known: true, files: [{ path: 'a.txt', patch_state: 'stored' }] },
  claims: [{ kind: 'agent-report', confidence: 'expected', text: 'done' }],
  task: GOOD_TASK,
});
test('crafted baseline snapshot has no violations', () => assert.deepStrictEqual(checkTruthInvariants(good()), []));

const NEG = {
  agent_says_tests_pass_no_run: [(s) => { s.display.testsPassed = true; s.task = { ...GOOD_TASK, evidence: { agentSaid: 'all tests pass' } }; }, ['tests_passed_without_test_run']],
  task_marked_passed_on_agent_text: [(s) => { s.task = { ...GOOD_TASK, status: 'complete', verdict: 'pass', evidence: { agentSaid: 'tests pass' } }; }, ['task_pass_unconfirmed']],
  human_verdict_missing_task_passed: [(s) => { s.task = { ...GOOD_TASK, verdict: 'pass', evidence: { reviews: [] } }; }, ['task_pass_unconfirmed']],
  cancelled_with_success_text: [(s) => { s.work.outcome = 'cancelled_partial'; s.claims[0].text = 'All done!'; }, ['non_success_shown_success']],
  ended_unknown_rendered_complete: [(s) => { s.work.outcome = 'ended_unknown'; }, ['non_success_shown_success']],
  complete_without_finish: [(s) => { s.work.finishObserved = false; }, ['complete_without_finish']],
  interrupted_as_success: [(s) => { s.work = { status: 'interrupted', outcome: null, finishObserved: false }; }, ['non_success_shown_success']],
  patch_unavailable_shown_as_zero: [(s) => { s.changes.files[0].patch_state = 'unavailable'; s.display.changes = { changesKnown: true, count: 0 }; }, ['changes_known_overclaim', 'unknown_rendered_as_zero']],
  patch_unavailable_known_true: [(s) => { s.changes.files[0].patch_state = 'unavailable'; s.display.changes = { changesKnown: true, count: null }; }, ['changes_known_overclaim']],
  changes_unknown_shown_zero: [(s) => { s.changes = { known: false, files: [] }; s.display.changes = { changesKnown: false, count: 0 }; }, ['unknown_rendered_as_zero']],
  too_large_shown_zero: [(s) => { s.changes.files[0].patch_state = 'too_large'; s.display.changes = { changesKnown: true, count: 0 }; }, ['unknown_rendered_as_zero']],
  dirty_baseline_attributed: [(s) => { s.baseline = { dirtyFiles: [{ path: 'a.txt', digest: 'd1' }] }; s.changes.files[0].afterDigest = 'd1'; }, ['dirty_baseline_attributed']],
  dirty_baseline_no_digest: [(s) => { s.baseline = { dirtyFiles: [{ path: 'a.txt', digest: 'd1' }] }; }, ['dirty_baseline_attributed']],
  agent_claim_wears_confirmed: [(s) => { s.claims[0].confidence = 'confirmed'; }, ['agent_said_confirmed']],
  unknown_claim_confirmed: [(s) => { s.claims.push({ kind: 'novel', confidence: 'confirmed' }); }, ['unknown_confirmed']],
  long_claim_not_truncated: [(s) => { s.claims[0].text = 'x'.repeat(CLAIM_LIMIT + 1); }, ['claim_not_truncated']],
  long_claim_truncated_but_full_lost: [(s) => { const t = 'x'.repeat(500); Object.assign(s.claims[0], limitClaim(t), { text: t, full: undefined }); }, ['claim_not_truncated']],
};
for (const [name, [mutate, want]] of Object.entries(NEG)) {
  test(`negative: ${name}`, () => {
    const s = good(); mutate(s);
    assert.deepStrictEqual(codes(checkTruthInvariants(s)), want);
  });
}

test('positives: dirty file the Run actually moved, truncated long claim, test-confirmed Task are all clean', () => {
  const s = good();
  s.baseline = { dirtyFiles: [{ path: 'a.txt', digest: 'd1' }] }; s.changes.files[0].afterDigest = 'd2';
  const t = 'y'.repeat(900); s.claims[0] = { kind: 'agent-report', confidence: 'expected', ...limitClaim(t), text: t };
  s.task = { status: 'complete', verdict: 'pass', criteria: UNIT, evidence: { tests: [passing('node --test tests/unit.test.js')] } };
  s.display.testsPassed = true;
  assert.deepStrictEqual(checkTruthInvariants(s), []);
});

/* ── immutability ── */
test('checkImmutableRun: altered/removed rows and a rewritten outcome are flagged; appends are not', () => {
  const before = { work: { id: 'w', status: 'ended', outcome: 'complete' }, evidence: [{ id: 'e1', v: 1 }], patches: [{ id: 'p1', patch_state: 'stored' }] };
  const clone = () => JSON.parse(JSON.stringify(before));
  assert.deepStrictEqual(checkImmutableRun(before, clone()), []);
  const add = clone(); add.evidence.push({ id: 'e2' }); assert.deepStrictEqual(checkImmutableRun(before, add), []);
  const alt = clone(); alt.patches[0].patch_state = 'unchanged'; assert.deepStrictEqual(codes(checkImmutableRun(before, alt)), ['ended_run_row_altered']);
  const rm = clone(); rm.evidence = []; assert.deepStrictEqual(codes(checkImmutableRun(before, rm)), ['ended_run_row_removed']);
  const oc = clone(); oc.work.outcome = 'ended_unknown'; assert.deepStrictEqual(codes(checkImmutableRun(before, oc)), ['ended_run_changed']);
  const reopened = clone(); reopened.work.status = 'running'; assert.deepStrictEqual(codes(checkImmutableRun(before, reopened)), ['ended_run_changed']);
  const live = { ...before, work: { id: 'w', status: 'running' } };
  assert.deepStrictEqual(checkImmutableRun(live, alt), []);
});

test('FINDING: reducer lets a RECONCILED signal overwrite the outcome of an ended Work (checker flags it)', () => {
  const { toSignal: ts } = require(path.join(R, 'app/main/work/reducer.js'));
  const { reduce, initial, KIND } = require(path.join(R, 'app/main/work/reducer.js'));
  let s = reduce(initial(), { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, terminalReason: 'end_turn', denials: [], text: 'ok' } });
  assert.strictEqual(s.outcome, 'complete');
  const later = reduce(s, { kind: KIND.RECONCILED, payload: null });
  void ts;
  const v = checkImmutableRun({ work: { status: 'ended', outcome: s.outcome } }, { work: { status: later.status, outcome: later.outcome } });
  assert.deepStrictEqual(codes(v), ['ended_run_changed'], 'documents current reducer behaviour; supervisor must not feed RECONCILED to an ended Work');
});

/* ── seeded properties ── */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CRIT = ['All tests pass', 'All unit tests pass', 'integration tests pass', 'e2e screen renders', 'lint is clean', 'looks good', 'tests pass after restart'];
const CMDS = ['node --test', 'node --test tests/unit.test.js', 'node --test tests/integration/x.test.js', 'node --test tests/e2e/a.test.js', 'npm test', 'pytest -k a', 'echo node --test'];

test('property (seed 1..300): the guard never passes without TEST_CONFIRMED/HUMAN_CONFIRMED per criterion', () => {
  const sha = (x) => require('node:crypto').createHash('sha256').update(x).digest('hex');
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed); const pick = (a) => a[Math.floor(r() * a.length)];
    const criteria = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({ id: `c${i}`, text: pick(CRIT) }));
    const tests = Array.from({ length: Math.floor(r() * 5) }, () => passing(pick(CMDS), {
      exit_code: pick([0, 0, 1, null]), tests_passed_count: pick([0, 3, null]), result_state: pick(['returned', 'returned', 'error', 'unknown']) }));
    const reviews = Array.from({ length: Math.floor(r() * 4) }, () => {
      const c = pick(criteria.length ? criteria : [{ id: 'zz', text: '' }]);
      return { criterion_id: c.id, verdict: pick(['pass', 'fail']), criterion_digest: r() < 0.7 ? sha(c.text) : 'stale', work_outcome: pick(['complete', 'complete', 'failed']) };
    });
    const evidence = { tests, reviews, agentSaid: 'all tests pass', observed: { files: ['x'] } };
    const out = taskPassVerdict(criteria, evidence);
    if (!out.pass) continue;
    assert.ok(criteria.length > 0, `seed ${seed}: empty criteria passed`);
    for (const c of out.criteria) {
      assert.ok([P.TEST_CONFIRMED, P.HUMAN_CONFIRMED].includes(c.provenance), `seed ${seed}`);
      if (c.provenance === P.TEST_CONFIRMED) assert.ok(tests.some(prov.isConfirmedTestRun), `seed ${seed}: pass with no confirmed run`);
      else assert.ok(reviews.some((x) => x.criterion_id === c.id && x.verdict === 'pass'), `seed ${seed}: pass with no human pass`);
    }
    assert.deepStrictEqual(taskPassVerdict(criteria, { agentSaid: 'x', observed: 'y' }).pass, false);
  }
});

test('property (seed 1..300): random snapshots - checker flags every Task-passed claim the guard denies, nothing else breaks', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 7); const pick = (a) => a[Math.floor(r() * a.length)];
    const criteria = Array.from({ length: 1 + Math.floor(r() * 2) }, (_, i) => ({ id: `c${i}`, text: pick(CRIT) }));
    const tests = r() < 0.5 ? [passing(pick(CMDS), { exit_code: pick([0, 1]) })] : [];
    const task = { status: pick(['open', 'complete']), verdict: pick(['unverified', 'pass', 'fail']), criteria, evidence: { tests, agentSaid: 'all tests pass' } };
    const s = { ...good(), task };
    const claimsPass = task.status === 'complete' || task.verdict === 'pass';
    const has = checkTruthInvariants(s).some((v) => v.code === 'task_pass_unconfirmed');
    assert.strictEqual(has, claimsPass && !taskPassVerdict(criteria, task.evidence).pass, `seed ${seed}`);
    const out = ['complete', 'partial', 'failed', 'cancelled_partial', 'cancelled_nochange', 'ended_unknown'];
    const o = pick(out); const tone = pick(['success', 'neutral', 'failure', 'unknown']);
    const hit = checkTruthInvariants({ work: { outcome: o, finishObserved: true }, display: { tone } }).length > 0;
    assert.strictEqual(hit, o !== 'complete' && tone === 'success', `seed ${seed}`);
  }
});
