/* V1-410 / V1-307 · provenance, PASS guard, truth invariants. Fixture-driven + seeded properties. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.resolve(__dirname, '..');
const prov = require(path.join(R, 'app/main/work/provenance.js'));
const { adaptChangedFilesEvidence } = prov;
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

const RUN = { id: 'w1', outcome: 'complete' };
const inRun = (e, at = 't1', over = {}) => ({ ...e, work_id: 'w1', observed_at: at, ...over });
const tconf = (ev) => taskPassVerdict(UNIT, { run: RUN, ...ev }).criteria[0];

test('PASS guard: confirmed tests are SUPPORTING only (status tests_confirmed), never a Task pass', () => {
  const cmd = 'node --test tests/unit.test.js';
  const ok = taskPassVerdict(UNIT, { run: RUN, tests: [inRun(passing(cmd))] });
  assert.deepStrictEqual([ok.pass, ok.criteria[0].status, ok.criteria[0].provenance], [false, 'tests_confirmed', P.TEST_CONFIRMED]);
  const st = (tests) => tconf({ tests }).status;
  assert.strictEqual(st([inRun(passing('node --test tests/e2e/x.test.js'))]), 'unverified');
  assert.strictEqual(st([inRun(passing(cmd, { exit_code: 1 }))]), 'unverified');
  assert.strictEqual(st([inRun(passing(cmd, { tests_passed_count: 0 }))]), 'unverified');
  assert.strictEqual(st([inRun(passing(cmd, { result_state: 'error' }))]), 'unverified');
  assert.strictEqual(st([inRun(passing(cmd), 't1'), inRun(passing(cmd, { exit_code: 1 }), 't2')]), 'unverified');
  assert.strictEqual(st([inRun(passing(cmd, { exit_code: 1 }), 't1'), inRun(passing(cmd), 't2')]), 'tests_confirmed');
  /* order comes from observed_at, not array position: newest-first input must not pass */
  assert.strictEqual(st([inRun(passing(cmd, { exit_code: 1 }), 't2'), inRun(passing(cmd), 't1')]), 'unverified');
  /* same Run only: other Run's test, or a failed/cancelled Run, supports nothing */
  assert.strictEqual(st([passing(cmd, {}) && { ...passing(cmd), work_id: 'w2', observed_at: 't1' }]), 'unverified');
  assert.strictEqual(taskPassVerdict(UNIT, { run: { id: 'w1', outcome: 'failed' }, tests: [inRun(passing(cmd))] }).criteria[0].status, 'unverified');
  assert.strictEqual(taskPassVerdict(UNIT, { tests: [inRun(passing(cmd))] }).criteria[0].status, 'unverified', 'no Run context');
});

test('multi-scope criterion needs EVERY scope confirmed (every, not some)', () => {
  const both = [{ id: 'm', text: 'unit and integration tests pass' }];
  const u = inRun(passing('node --test tests/unit.test.js')); const i = inRun(passing('node --test tests/integration/a.test.js'), 't2');
  const one = taskPassVerdict(both, { run: RUN, tests: [u] }).criteria[0].status;
  const two = taskPassVerdict(both, { run: RUN, tests: [u, i] }).criteria[0].status;
  assert.deepStrictEqual([one, two], ['unverified', 'tests_confirmed']);
});

test('isConfirmedTestRun: each field of the bar matters', () => {
  const ok = passing('node --test');
  assert.strictEqual(prov.isConfirmedTestRun(ok), true);
  for (const over of [{ exit_code: 1 }, { exit_code: 2 }, { exit_code: null }, { exit_code: '0' }, { result_state: 'unknown' },
    { result_state: 'error' }, { tests_passed_count: '3' }, { tests_passed_count: 2.5 }, { tests_passed_count: null }, { tests_passed_count: 0 }]) {
    assert.strictEqual(prov.isConfirmedTestRun(passing('node --test', over)), false, JSON.stringify(over));
  }
  assert.strictEqual(prov.isConfirmedTestRun({ ...ok, kind: 'changed_files' }), false);
  assert.strictEqual(prov.isConfirmedTestRun(null), false);
});

test('PASS guard: Agent text, observed changes, no criteria, and unsupported checks never pass', () => {
  const ev = { agentSaid: 'all tests pass, 12 passed', observed: { files: ['a'] } };
  assert.strictEqual(taskPassVerdict(UNIT, ev).pass, false);
  assert.strictEqual(taskPassVerdict([], {}).pass, false);
  assert.strictEqual(taskPassVerdict(UNIT, undefined).pass, false);
  assert.strictEqual(taskPassVerdict([{ id: 'l', text: 'lint is clean' }], { tests: [passing('node --test tests/unit.test.js')] }).pass, false);
  assert.strictEqual(taskPassVerdict([{ id: 'x', text: 'the page looks good' }], { tests: [passing('node --test')] }).pass, false);
});

const sha256 = (x) => require('node:crypto').createHash('sha256').update(x).digest('hex');
const SPEC = 'spec1';
const HC = [{ id: 'h', text: 'looks right' }];
let seq = 0;
const rv = (verdict, over = {}) => ({ criterion_id: 'h', verdict, criterion_digest: sha256('looks right'), task_spec_digest: SPEC,
  work_id: 'w1', work_outcome: 'complete', reviewed_at: `2026-01-01T00:00:${String(10 + seq++).padStart(2, '0')}`, rowid: seq, ...over });
const hv = (reviews, extra = {}) => taskPassVerdict(HC, { taskSpecDigest: SPEC, reviews, ...extra });

test('PASS guard: human verdicts - repo bar (latest first, digests, one complete Run)', () => {
  const p = hv([rv('pass')]);
  assert.deepStrictEqual([p.pass, p.criteria[0].status, p.criteria[0].provenance, p.runId], [true, 'passed', P.HUMAN_CONFIRMED, 'w1']);
  assert.strictEqual(hv([rv('pass'), rv('fail')]).pass, false);
  assert.strictEqual(hv([rv('fail')]).criteria[0].status, 'failed');
  assert.strictEqual(hv([rv('fail'), rv('pass')]).pass, true);
  /* newest-first array order: sorted by reviewed_at, so [fail(newer), pass(older)] is a fail */
  const older = rv('pass'); const newer = rv('fail');
  assert.strictEqual(hv([newer, older]).pass, false);
  assert.strictEqual(hv([older, newer]).pass, false);
  /* stale latest review is unverified, with NO fallback to an older pass or fail */
  assert.strictEqual(hv([rv('pass'), rv('fail', { criterion_digest: sha256('other') })]).pass, false);
  assert.strictEqual(hv([rv('pass'), rv('fail', { criterion_digest: sha256('other') })]).criteria[0].status, 'unverified');
  assert.strictEqual(hv([rv('fail'), rv('pass', { criterion_digest: sha256('other') })]).criteria[0].status, 'unverified');
  assert.strictEqual(hv([rv('pass', { task_spec_digest: 'old' })]).pass, false);
  assert.strictEqual(taskPassVerdict(HC, { reviews: [rv('pass')] }).pass, false, 'no current taskSpecDigest');
  assert.strictEqual(hv([rv('pass', { work_outcome: 'ended_unknown' })]).pass, false);
  assert.strictEqual(hv([rv('pass', { criterion_id: 'other' })]).pass, false);
  /* a human FAIL beats a confirmed test run */
  const u = [{ id: 'u', text: 'unit tests pass' }];
  const fail = rv('fail', { criterion_id: 'u', criterion_digest: sha256('unit tests pass') });
  const failed = taskPassVerdict(u, { taskSpecDigest: SPEC, run: RUN, tests: [inRun(passing('node --test tests/unit.test.js'))], reviews: [fail] });
  assert.deepStrictEqual([failed.pass, failed.criteria[0].status], [false, 'failed']);
});

test('PASS guard fails closed on missing fields (callers must JOIN work.outcome and pass taskSpecDigest)', () => {
  for (const drop of ['criterion_digest', 'task_spec_digest', 'work_id', 'work_outcome', 'reviewed_at']) {
    const r = rv('pass'); delete r[drop];
    assert.strictEqual(hv([r]).pass, false, drop);
  }
  /* an undated FAIL cannot be ordered, so it poisons the criterion instead of being dropped */
  const undated = rv('fail'); delete undated.reviewed_at;
  assert.strictEqual(hv([rv('pass'), undated]).pass, false);
});

test('PASS guard needs ONE Run across all criteria and every criterion reviewed', () => {
  const two = [{ id: 'a', text: 'looks right' }, { id: 'b', text: 'is fine' }];
  const mk = (id, text, wid) => rv('pass', { criterion_id: id, criterion_digest: sha256(text), work_id: wid });
  const g = (reviews) => taskPassVerdict(two, { taskSpecDigest: SPEC, reviews }).pass;
  assert.strictEqual(g([mk('a', 'looks right', 'w1'), mk('b', 'is fine', 'w1')]), true);
  assert.strictEqual(g([mk('a', 'looks right', 'w1'), mk('b', 'is fine', 'w2')]), false);
  assert.strictEqual(g([mk('a', 'looks right', 'w1')]), false);
});

test('never throws: malformed input fails closed', () => {
  const evil = new Proxy({}, { get() { throw new Error('boom'); } });
  const cyc = {}; cyc.self = cyc;
  for (const bad of [null, undefined, 1, 'x', [], [null], evil]) {
    assert.strictEqual(taskPassVerdict(bad, evil).pass, false);
    assert.strictEqual(taskPassVerdict(bad, { reviews: [null, 1, evil], tests: [null, evil] }).pass, false);
    assert.ok(Array.isArray(checkTruthInvariants(bad)));
  }
  assert.strictEqual(taskPassVerdict([null], { reviews: [null] }).pass, false);
  assert.deepStrictEqual(codes(checkTruthInvariants(null)), ['malformed_input']);
  assert.deepStrictEqual(codes(checkTruthInvariants(evil)), ['malformed_input']);
  assert.deepStrictEqual(codes(checkTruthInvariants({ ...good(), claims: [null] })), ['malformed_input']);
  assert.ok(Array.isArray(checkTruthInvariants({ ...good(), changes: { known: true, files: [null] } })));
  assert.strictEqual(summarizeChanges({ known: true, files: [null] }).changesKnown, true);
  assert.strictEqual(summarizeChanges(evil).changesKnown, false);
  const row = { work: { status: 'ended', outcome: 'complete' }, evidence: [cyc] };
  assert.deepStrictEqual(codes(checkImmutableRun(row, row)), ['malformed_input']);
  assert.deepStrictEqual(codes(checkImmutableRun({ work: { status: 'ended' }, evidence: 'x' }, { work: { status: 'ended' } })), ['malformed_input']);
  assert.deepStrictEqual(codes(checkImmutableRun(evil, evil)), ['malformed_input']);
});

/* ── summarizeChanges / limitClaim ── */
test('summarizeChanges: 0 changes is a measurement; unavailable/unknown/unrecognised is not', () => {
  const z = summarizeChanges({ known: true, files: [] });
  assert.deepStrictEqual([z.changesKnown, z.count, z.patchComplete, z.lowerBound], [true, 0, true, false]);
  assert.strictEqual(summarizeChanges({ known: true, files: [{ path: 'a', patch_state: 'unchanged' }] }).count, 0);
  for (const s of ['unavailable', 'mystery']) {
    const r = summarizeChanges({ known: true, files: [{ path: 'a', patch_state: s }] });
    assert.deepStrictEqual([r.changesKnown, r.count], [false, null], String(s));
  }
  assert.strictEqual(summarizeChanges({ known: false, files: [] }).changesKnown, false);
  assert.strictEqual(summarizeChanges({ known: true }).changesKnown, false);
  for (const s of ['binary', 'too_large']) {
    const r = summarizeChanges({ known: true, files: [{ path: 'a', patch_state: s }] });
    assert.deepStrictEqual([r.changesKnown, r.count, r.patchComplete], [true, 1, false], s);
  }
  assert.strictEqual(summarizeChanges({ known: true, files: [{ path: 'a', patch_state: 'stored' }] }).patchComplete, true);
});

test('summarizeChanges: today\'s changed_files evidence has NO patch_state -> files known, patch availability unknown', () => {
  const real = adaptChangedFilesEvidence({ kind: 'changed_files', details: { known: true, files: [{ path: 'a', change: 'modified' }, 'b.txt'] } });
  const r = summarizeChanges(real);
  assert.deepStrictEqual([r.changesKnown, r.patchStateKnown, r.count, r.patchComplete], [true, false, 2, false]);
  assert.deepStrictEqual(adaptChangedFilesEvidence({ details: { known: true } }), { known: false, files: [] });
  assert.deepStrictEqual(adaptChangedFilesEvidence(null), { known: false, files: [] });
  assert.strictEqual(summarizeChanges(adaptChangedFilesEvidence({ details: { known: false, files: [] } })).changesKnown, false);
});

test('summarizeChanges: sensitive_excluded is a LOWER BOUND, not counted as changed', () => {
  const r = summarizeChanges({ known: true, files: [{ path: 'a', patch_state: 'stored' }, { path: '.env', patch_state: 'sensitive_excluded' }] });
  assert.deepStrictEqual([r.changesKnown, r.count, r.lowerBound, r.patchComplete], [true, 1, true, false]);
  const only = summarizeChanges({ known: true, files: [{ path: '.env', patch_state: 'sensitive_excluded' }] });
  assert.deepStrictEqual([only.count, only.lowerBound], [0, true]);
});

test('normFile accepts snake_case and camelCase digests', () => {
  const a = prov.normFile({ path: 'p', before_digest: 'x', after_digest: 'y', patch_state: 'stored' });
  const b = prov.normFile({ path: 'p', beforeDigest: 'x', afterDigest: 'y', patchState: 'stored' });
  assert.deepStrictEqual(a, b);
});

test('limitClaim: exact boundary, marker, full text kept', () => {
  const at = 'a'.repeat(CLAIM_LIMIT); const over = 'b'.repeat(CLAIM_LIMIT + 1);
  assert.deepStrictEqual(limitClaim(at), { shown: at, truncated: false, full: at });
  const l = limitClaim(over);
  assert.strictEqual(l.truncated, true); assert.strictEqual(l.full, over);
  assert.strictEqual(l.shown, 'b'.repeat(CLAIM_LIMIT) + '…');
  assert.strictEqual(limitClaim(null).shown, '');
});

test('limitClaim: never splits a surrogate pair or a ZWJ sequence; invalid limit -> default', () => {
  const emoji = 'a' + '\u{1F600}'.repeat(200);
  const e = limitClaim(emoji, 100);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(e.shown) && !/[\uD800-\uDBFF]$/.test(e.shown.slice(0, -1)), 'lone high surrogate');
  assert.strictEqual(e.full, emoji);
  const fam = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'; // one grapheme
  const f = limitClaim(fam.repeat(10), 3);
  assert.strictEqual(f.shown, fam.repeat(3) + '…');
  for (const bad of [0, -1, NaN, 2.5, '5', null, Infinity]) assert.strictEqual(limitClaim('x'.repeat(300), bad).shown.length, CLAIM_LIMIT + 1, String(bad));
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
  changes_unknown_shown_zero: [(s) => { s.changes = { known: false, files: [] }; s.display.changes = { changesKnown: false, count: 0 }; }, ['fabricated_count', 'unknown_rendered_as_zero']],
  too_large_shown_zero: [(s) => { s.changes.files[0].patch_state = 'too_large'; s.display.changes = { changesKnown: true, count: 0 }; }, ['unknown_rendered_as_zero']],
  dirty_baseline_attributed: [(s) => { s.baseline = { dirtyFiles: [{ path: 'a.txt', digest: 'd1' }] }; s.changes.files[0].afterDigest = 'd1'; }, ['dirty_baseline_attributed']],
  sensitive_lower_bound_shown_zero: [(s) => { s.changes.files = [{ path: '.env', patch_state: 'sensitive_excluded' }]; s.display.changes = { changesKnown: true, count: '0' }; }, ['changes_known_overclaim', 'unknown_rendered_as_zero']],
  sensitive_lower_bound_exact: [(s) => { s.changes.files.push({ path: '.env', patch_state: 'sensitive_excluded' }); s.display.changes = { changesKnown: true, count: 1 }; }, ['changes_known_overclaim']],
  identical_digests_attributed: [(s) => { s.changes.files[0].before_digest = 'q'; s.changes.files[0].after_digest = 'q'; }, ['dirty_baseline_attributed']],
  identical_digests_camel: [(s) => { s.changes.files[0].beforeDigest = 'q'; s.changes.files[0].afterDigest = 'q'; }, ['dirty_baseline_attributed']],
  patch_state_claimed_without_state: [(s) => { s.changes.files = [{ path: 'a' }]; s.display.changes = { changesKnown: true, count: 1, patchStateKnown: true }; }, ['changes_known_overclaim']],
  status_success_variant: [(s) => { s.work.outcome = 'failed'; s.display = { status: 'SUCCESS' }; }, ['non_success_shown_success']],
  success_flag_variant: [(s) => { s.work.outcome = 'failed'; s.display = { success: true }; }, ['non_success_shown_success']],
  copy_key_label_variant: [(s) => { s.work.outcome = 'ended_unknown'; s.display = { label: ' \uc644\ub8cc ' }; }, ['non_success_shown_success']],
  tone_case_variant: [(s) => { s.work.outcome = 'cancelled_partial'; s.display.tone = 'Completed'; }, ['non_success_shown_success']],
  unknown_tone_on_failed: [(s) => { s.work.outcome = 'failed'; s.display.tone = 'celebrate'; }, ['unknown_display_tone']],
  count_numeric_string_zero: [(s) => { s.changes = { known: false, files: [] }; s.display.changes = { changesKnown: false, count: '0' }; }, ['fabricated_count', 'unknown_rendered_as_zero']],
  fabricated_count_unknown: [(s) => { s.changes = { known: false, files: [] }; s.display.changes = { changesKnown: false, count: 3 }; }, ['fabricated_count']],
  long_claim_data_text_only: [(s) => { s.claims = [{ kind: 'agent-report', confidence: 'expected', data: { text: 'z'.repeat(400) } }]; }, ['claim_not_truncated']],
  long_claim_shown_too_long: [(s) => { const t = 'z'.repeat(400); s.claims[0] = { kind: 'agent-report', confidence: 'expected', text: t, full: t, truncated: true, shown: t }; }, ['claim_not_truncated']],
  long_claim_flag_missing: [(s) => { const t = 'z'.repeat(400); s.claims[0] = { kind: 'agent-report', confidence: 'expected', text: t, full: t, shown: t.slice(0, 280) + '…' }; }, ['claim_not_truncated']],
  confidence_case_variant: [(s) => { s.claims[0].confidence = 'Confirmed'; }, ['agent_said_confirmed']],
  task_status_passed_variant: [(s) => { s.task = { ...GOOD_TASK, status: 'passed' }; }, ['task_pass_unconfirmed']],
  task_verdict_PASS_variant: [(s) => { s.task = { ...GOOD_TASK, verdict: 'PASS' }; }, ['task_pass_unconfirmed']],
  tests_passed_truthy_string: [(s) => { s.display.testsPassed = 'yes'; }, ['tests_passed_without_test_run']],
  task_pass_on_tests_alone: [(s) => { s.task = { ...GOOD_TASK, status: 'complete', evidence: { run: RUN, tests: [inRun(passing('node --test tests/unit.test.js'))] } }; }, ['task_pass_unconfirmed']],
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

test('positives: moved dirty file, truncated long claim, human-confirmed Task are all clean', () => {
  const s = good();
  s.baseline = { dirtyFiles: [{ path: 'a.txt', digest: 'd1' }] }; s.changes.files[0].afterDigest = 'd2';
  s.changes.files[0].before_digest = 'd1';
  const t = 'y'.repeat(900); s.claims[0] = { kind: 'agent-report', confidence: 'expected', ...limitClaim(t), text: t };
  s.task = { status: 'complete', verdict: 'pass', criteria: UNIT, evidence: { taskSpecDigest: SPEC, run: RUN,
    tests: [inRun(passing('node --test tests/unit.test.js'))], reviews: [rv('pass', { criterion_id: 'u', criterion_digest: sha256('unit tests pass') })] } };
  s.display.testsPassed = true;
  assert.deepStrictEqual(checkTruthInvariants(s), []);
});

test('today\'s changed_files evidence (no patch_state) is consistent when reported as known-files / unknown-patch', () => {
  const s = good();
  s.changes = adaptChangedFilesEvidence({ details: { known: true, files: [{ path: 'a.txt', change: 'modified' }] } });
  s.display.changes = { changesKnown: true, count: 1, patchStateKnown: false };
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

test('checkImmutableRun: key order does not matter; id-less rows are compared by position; duplicate ids do not collide', () => {
  const mk = (evidence) => ({ work: { status: 'ended', outcome: 'complete' }, evidence });
  assert.deepStrictEqual(checkImmutableRun(mk([{ id: 'e', a: 1, b: { x: 1, y: 2 } }]), mk([{ b: { y: 2, x: 1 }, id: 'e', a: 1 }])), []);
  assert.deepStrictEqual(codes(checkImmutableRun(mk([{ a: 1 }, { a: 2 }]), mk([{ a: 1 }, { a: 3 }]))), ['ended_run_row_altered']);
  assert.deepStrictEqual(codes(checkImmutableRun(mk([{ a: 1 }, { a: 2 }]), mk([{ a: 1 }]))), ['ended_run_row_removed']);
  assert.deepStrictEqual(codes(checkImmutableRun(mk([{ id: 'd', v: 1 }, { id: 'd', v: 2 }]), mk([{ id: 'd', v: 1 }, { id: 'd', v: 9 }]))), ['ended_run_row_altered']);
});

/* ── seeded properties: guard vs an INDEPENDENT oracle written from repo.currentTaskVerdict ── */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CRIT = ['All tests pass', 'unit tests pass', 'integration tests pass', 'e2e screen renders', 'lint is clean', 'looks good', 'tests pass after restart'];
const CMDS = ['node --test', 'node --test tests/unit.test.js', 'node --test tests/integration/x.test.js', 'node --test tests/e2e/a.test.js', 'npm test', 'pytest -k a', 'echo node --test'];
const DIG = Object.fromEntries(CRIT.map((c) => [c, sha256(c)]));

/** repo.currentTaskVerdict, restated: latest row per criterion by (reviewed_at, rowid); relevant = same spec + same text digest. */
function oracle(criteria, spec, reviews) {
  const latest = new Map();
  [...reviews].sort((x, y) => (x.reviewed_at < y.reviewed_at ? -1 : x.reviewed_at > y.reviewed_at ? 1 : x.rowid - y.rowid))
    .forEach((r) => latest.set(r.criterion_id, r));
  const rel = criteria.map((c) => { const r = latest.get(c.id); return r && r.task_spec_digest === spec && r.criterion_digest === DIG[c.text] ? r : null; });
  if (rel.some((r) => r && r.verdict === 'fail')) return false;
  if (!criteria.length || !rel.every((r) => r && r.verdict === 'pass')) return false;
  const runs = new Set(rel.map((r) => r.work_id));
  return runs.size === 1 && rel[0].work_outcome === 'complete';
}

test('property (120000 seeded cases): guard === repo-bar oracle; tests/Agent text never change pass', () => {
  let passes = 0;
  for (let seed = 1; seed <= 120000; seed++) {
    const r = rng(seed); const pick = (a) => a[Math.floor(r() * a.length)];
    const criteria = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({ id: `c${i}`, text: pick(CRIT) }));
    const outcomeOf = { w1: r() < 0.85 ? 'complete' : pick(['failed', 'ended_unknown']), w2: r() < 0.5 ? 'complete' : 'failed' }; // one Run has one outcome
    const nrev = Math.floor(r() * (criteria.length * 2 + 1));
    const reviews = Array.from({ length: nrev }, (_, i) => {
      const c = criteria.length ? pick(criteria) : { id: 'zz', text: CRIT[0] };
      return { criterion_id: c.id, verdict: pick(['pass', 'pass', 'fail']), criterion_digest: r() < 0.85 ? DIG[c.text] : DIG[CRIT[6]],
        task_spec_digest: r() < 0.9 ? 'S' : 'old', work_id: 'W', work_outcome: null,
        reviewed_at: `t${String(Math.floor(r() * 6)).padStart(2, '0')}`, rowid: i + 1 };
    });
    for (const x of reviews) { x.work_id = r() < 0.9 ? 'w1' : 'w2'; x.work_outcome = outcomeOf[x.work_id]; }
    for (let i = reviews.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [reviews[i], reviews[j]] = [reviews[j], reviews[i]]; }
    /* equal reviewed_at ties must be broken by rowid, same as the oracle */
    const tests = Array.from({ length: Math.floor(r() * 4) }, () => ({ ...passing(pick(CMDS), { exit_code: pick([0, 0, 1, null]),
      tests_passed_count: pick([0, 3, null]), result_state: pick(['returned', 'returned', 'error', 'unknown']) }), work_id: pick(['w1', 'w2']), observed_at: `o${Math.floor(r() * 4)}` }));
    const base = { taskSpecDigest: 'S', reviews };
    const want = oracle(criteria, 'S', reviews);
    const got = taskPassVerdict(criteria, { ...base, tests, agentSaid: 'all tests pass', observed: { files: ['x'] }, run: pick([undefined, RUN]) });
    assert.strictEqual(got.pass, want, `seed ${seed}`);
    assert.strictEqual(taskPassVerdict(criteria, base).pass, want, `seed ${seed} (no tests)`);
    assert.strictEqual(taskPassVerdict(criteria, { taskSpecDigest: 'S', tests, agentSaid: 'x', run: RUN }).pass, false, `seed ${seed} (no reviews)`);
    if (want) { passes++; for (const c of got.criteria) assert.strictEqual(c.provenance, P.HUMAN_CONFIRMED); }
  }
  assert.ok(passes > 500, `property must exercise real passes (got ${passes})`);
});

test('property (seed 1..300): the checker flags exactly the Task-pass claims the guard denies, and non-complete success tones', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 7); const pick = (a) => a[Math.floor(r() * a.length)];
    const criteria = Array.from({ length: 1 + Math.floor(r() * 2) }, (_, i) => ({ id: `c${i}`, text: pick(CRIT) }));
    const tests = r() < 0.5 ? [inRun(passing(pick(CMDS), { exit_code: pick([0, 1]) }))] : [];
    const task = { status: pick(['open', 'complete']), verdict: pick(['unverified', 'pass', 'fail']), criteria, evidence: { run: RUN, tests, agentSaid: 'all tests pass' } };
    const claimsPass = task.status === 'complete' || task.verdict === 'pass';
    const has = checkTruthInvariants({ ...good(), task }).some((v) => v.code === 'task_pass_unconfirmed');
    assert.strictEqual(has, claimsPass, `seed ${seed}`);
    const o = pick(['complete', 'partial', 'failed', 'cancelled_partial', 'cancelled_nochange', 'ended_unknown']); const tone = pick(['success', 'neutral', 'failure', 'unknown']);
    const hit = checkTruthInvariants({ work: { outcome: o, finishObserved: true }, display: { tone } }).length > 0;
    assert.strictEqual(hit, o !== 'complete' && tone === 'success', `seed ${seed}`);
  }
});
