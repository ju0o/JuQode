'use strict';
/* V1-104 slice A · provider-neutral reducer probes. Fixed-seed fuzz over the NORMALIZED signal vocabulary
 * (no provider event shape is invented here; toSignal is probed only with malformed input). */
const test = require('node:test');
const assert = require('node:assert');
const { toSignal, reduce, replay, initial, openPermissions, KIND } = require('../app/main/work/reducer');

let seed = 104;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
const pick = (a) => a[rnd(a.length)];
const ids = ['t1', 't2', 't3', null];
const tools = ['Bash', 'Edit'];
const mkFinish = () => ({ kind: KIND.FINISH, payload: {
  subtype: pick(['success', 'error_max_turns', null]), terminalReason: pick(['end_turn', 'max_turns', null]),
  apiErrorStatus: pick([null, null, 500]), isError: pick([true, false]),
  denials: rnd(2) ? [{ tool: pick(tools), toolUseId: pick(ids.slice(0, 3)), input: {} }] : [] } });
const gens = [
  () => ({ kind: KIND.SESSION_START, payload: {} }),
  () => ({ kind: KIND.TOOL_USE, payload: { tool: 'Edit', toolUseId: pick(ids), all: [{}] } }),
  () => ({ kind: KIND.TOOL_RESULT, payload: null }),
  /* id-less denials are not deduplicated by design (reducer.js mergeDenials comment): OPEN, so not generated */
  () => ({ kind: KIND.PERMISSION_DENIED, payload: { tool: pick(tools), toolUseId: pick(ids.slice(0, 3)) } }),
  () => ({ kind: KIND.PERMISSION_GRANTED, payload: pick([{ tool: pick(tools) }, { toolUseId: pick(ids) }, null]) }),
  () => ({ kind: KIND.INPUT_REQUEST, payload: { text: 'q' } }),
  () => ({ kind: KIND.ANSWER, payload: null }),
  () => ({ kind: KIND.CANCEL_REQUEST, payload: null }),
  () => ({ kind: KIND.CANCEL_CONFIRMED, payload: null }),
  mkFinish,
  () => ({ kind: KIND.RECONCILED, payload: null }),
  () => ({ kind: KIND.RAW, payload: { type: 'weird' } }),
  () => ({ kind: 'never-heard-of-it', payload: 1 }),
];
const seqOf = (n) => Array.from({ length: n }, () => pick(gens)());
const OUT = ['complete', 'partial', 'failed', 'cancelled_nochange', 'cancelled_partial', 'ended_unknown'];
const STAT = ['running', 'input_waiting', 'permission_waiting', 'cancel_requested', 'ended'];
/* the part of a state a persisted row / the UI can show; ids (global counter) and clocks excluded */
const view = (s) => JSON.stringify({ st: s.status, o: s.outcome, open: openPermissions(s).map((d) => [d.tool, d.toolUseId]) });
const rank = { running: 0, input_waiting: 0, permission_waiting: 0, cancel_requested: 1, ended: 2 };

test('fuzz: no impossible state, ended is terminal, success needs an observed finish', () => {
  for (let i = 0; i < 3000; i++) {
    const sigs = seqOf(1 + rnd(14));
    let s = initial(); let endedAs = null; let sawFinish = false; let cancelSeen = false;
    sigs.forEach((sig, k) => {
      if (sig.kind === KIND.FINISH) sawFinish = true;
      if (sig.kind === KIND.CANCEL_REQUEST && !endedAs) cancelSeen = true;
      const frozen = JSON.stringify(s);
      const prev = s;
      s = reduce(s, sig, k);
      assert.strictEqual(JSON.stringify(prev), frozen, 'reduce mutated its input');
      const ctx = JSON.stringify(sigs.slice(0, k + 1).map((x) => x.kind));
      assert.ok(STAT.includes(s.status), ctx);
      assert.strictEqual(s.status === 'ended', s.outcome !== null, `outcome iff ended ${ctx}`);
      if (s.outcome) assert.ok(OUT.includes(s.outcome), ctx);
      if (endedAs) assert.deepStrictEqual([s.status, s.outcome], endedAs, `ended regressed/rewritten ${ctx}`);
      else if (s.status === 'ended') endedAs = [s.status, s.outcome];
      if (s.status === 'ended' || prev.status === 'cancel_requested' || prev.cancelRequested) {
        assert.ok(rank[s.status] >= rank[prev.status], `cancel_requested left without ending ${ctx}`);
      }
      if (s.status !== 'ended' && s.status !== 'cancel_requested' && openPermissions(s).length) assert.strictEqual(s.status, 'permission_waiting', `open denial but ${s.status} ${ctx}`);
      if (s.outcome === 'complete' || s.outcome === 'partial') assert.ok(sawFinish, 'success without finish');
      if (s.outcome === 'complete') assert.ok(!cancelSeen, 'cancelled work reported complete');
    });
  }
});

test('fuzz: delivering every event twice, ends in the same view (a whole-stream second pass is NOT asserted: a later grant then re-denial is a legitimate new event)', () => {
  for (let i = 0; i < 3000; i++) {
    /* a grant with no tool_use_id resolves 'the oldest open denial for that tool' BY DESIGN, so delivering it twice
     * legitimately resolves two denials: OPEN (needs an event id from the Provider contract), not generated here */
    const sigs = seqOf(1 + rnd(12)).filter((x) => x.kind !== KIND.PERMISSION_GRANTED || x.payload?.toolUseId);
    const once = view(replay(sigs));
    const dup = view(replay(sigs.flatMap((x) => [x, x])));
    assert.strictEqual(dup, once, `duplicated events changed the result: ${JSON.stringify(sigs)}`);
  }
});

test('an ended Work keeps its outcome when reconciliation speaks about it later', () => {
  const done = reduce(initial(), { kind: KIND.FINISH, payload: { subtype: 'success', isError: false, denials: [] } });
  const after = reduce(done, { kind: KIND.RECONCILED, payload: null });
  assert.deepStrictEqual([after.status, after.outcome], ['ended', 'complete']);
});

test('cancel_requested is left only by ending; a late question or denial does not reopen the status', () => {
  let s = reduce(initial(), { kind: KIND.CANCEL_REQUEST, payload: null });
  for (const k of [{ kind: KIND.INPUT_REQUEST, payload: { text: 'q' } }, { kind: KIND.SESSION_START, payload: {} },
                   { kind: KIND.PERMISSION_GRANTED, payload: { tool: 'Bash' } }, { kind: KIND.ANSWER, payload: null }]) {
    assert.strictEqual(reduce(s, k).status, 'cancel_requested', k.kind);
  }
});

test('a question answered while a refusal is still open does not report running', () => {
  let s = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'a' } });
  s = reduce(s, { kind: KIND.INPUT_REQUEST, payload: { text: 'q' } });
  s = reduce(s, { kind: KIND.ANSWER, payload: null });
  assert.strictEqual(s.status, 'permission_waiting');
});

test('a stray grant does not clear a pending question', () => {
  let s = reduce(initial(), { kind: KIND.INPUT_REQUEST, payload: { text: 'q' } });
  s = reduce(s, { kind: KIND.PERMISSION_GRANTED, payload: { tool: 'Bash' } });
  assert.strictEqual(s.status, 'input_waiting');
});

test('the same denial delivered twice is one card', () => {
  const d = { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'x' } };
  assert.strictEqual(openPermissions(reduce(reduce(initial(), d), d)).length, 1);
});

test('malformed provider events never throw and never invent a state', () => {
  const bad = [null, undefined, 5, 'x', [], {}, { type: 'result', permission_denials: 'x' }, { type: 'result', permission_denials: [null, 3] },
    { type: 'result', permission_denials: {} }, { type: 'assistant', message: { content: [null, 7, { type: 'tool_use' }] } },
    { type: 'user', message: { content: [null, { type: 'tool_result' }] } }, { type: 'system', subtype: 'init' },
    { type: 'result', result: { a: 1 }, is_error: 'true' }, { type: 'x'.repeat(2e6) }];
  for (const e of bad) {
    const sig = toSignal(e);
    assert.ok(Object.values(KIND).includes(sig.kind));
    const s = reduce(initial(), sig);
    assert.ok(STAT.includes(s.status));
  }
  for (const sig of [null, undefined, {}, { kind: null }, 'finish', 7]) {
    assert.deepStrictEqual(reduce(initial(), sig).status, 'running');
  }
});

test('a result event with no success evidence is not reported as complete', () => {
  /* UNKNOWN-safe: only the explicit failure markers we can already read; a non-boolean is_error is not "false". */
  const s = replay([toSignal({ type: 'result', subtype: 'success', is_error: 'true' })]);
  assert.notStrictEqual(s.outcome, 'complete');
});

/* ───────────── QA test-power additions (mutation-driven) ───────────── */
const FIN_OK = { subtype: 'success', terminalReason: 'end_turn', denials: [] };

test('a result with is_error absent or null is a finished, complete Work (absent is success; only a non-false value fails)', () => {
  for (const ev of [{ type: 'result', subtype: 'success' }, { type: 'result', subtype: 'success', is_error: null }, { type: 'result', subtype: 'success', is_error: false }]) {
    const s = replay([toSignal(ev)]);
    assert.deepStrictEqual([s.status, s.outcome], ['ended', 'complete'], JSON.stringify(ev));
  }
  for (const bad of [true, 'true', 0, 1]) {
    assert.strictEqual(replay([toSignal({ type: 'result', subtype: 'success', is_error: bad })]).outcome, 'failed', String(bad));
  }
});

test('a question only moves running to input_waiting; it never overrides permission_waiting or cancel_requested', () => {
  const q = { kind: KIND.INPUT_REQUEST, payload: { text: 'q' } };
  const perm = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'a' } });
  const canc = reduce(initial(), { kind: KIND.CANCEL_REQUEST, payload: null });
  assert.strictEqual(reduce(perm, q).status, 'permission_waiting');
  assert.strictEqual(reduce(canc, q).status, 'cancel_requested');
  assert.strictEqual(reduce(initial(), q).status, 'input_waiting');
  /* a state that is already input_waiting and gets a second signal keeps waiting */
  assert.strictEqual(reduce(reduce(initial(), q), { kind: KIND.TOOL_USE, payload: { all: [{}] } }).status, 'input_waiting');
});

test('hydrated cancel_requested (row status only, cancelRequested=false) stays cancel_requested; a finish there ends cancelled_*', () => {
  const hyd = { ...initial(), status: 'cancel_requested', outcome: null };
  assert.strictEqual(hyd.cancelRequested, false);
  for (const sig of [{ kind: KIND.INPUT_REQUEST, payload: { text: 'q' } }, { kind: KIND.SESSION_START, payload: {} },
                     { kind: KIND.ANSWER, payload: null }, { kind: KIND.PERMISSION_GRANTED, payload: { tool: 'Bash' } },
                     { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'z' } }]) {
    assert.strictEqual(reduce(hyd, sig).status, 'cancel_requested', sig.kind);
  }
  assert.deepStrictEqual(['ended', 'ended_unknown'], (({ status, outcome }) => [status, outcome])(reduce(hyd, { kind: KIND.RECONCILED, payload: null })));
  assert.deepStrictEqual(['ended', 'cancelled_nochange'], (({ status, outcome }) => [status, outcome])(reduce(hyd, { kind: KIND.CANCEL_CONFIRMED, payload: null })));
  /* cancel is sticky: a finish on a hydrated cancel_requested Work never reads as complete (cancelled_* per toolsUsed) */
  assert.deepStrictEqual([reduce(hyd, { kind: KIND.FINISH, payload: FIN_OK }).status, reduce(hyd, { kind: KIND.FINISH, payload: FIN_OK }).outcome], ['ended', 'cancelled_nochange']);
  const used = { ...hyd, toolsUsed: 2 };
  assert.strictEqual(reduce(used, { kind: KIND.FINISH, payload: FIN_OK }).outcome, 'cancelled_partial');
});

test('known limitation (OPEN): a finish that re-reports an already-resolved denial id does not reopen it', () => {
  let s = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'Bash', toolUseId: 'a' } });
  s = reduce(s, { kind: KIND.PERMISSION_GRANTED, payload: { toolUseId: 'a' } });
  assert.strictEqual(s.status, 'running');
  s = reduce(s, { kind: KIND.FINISH, payload: { ...FIN_OK, denials: [{ tool: 'Bash', toolUseId: 'a', input: { c: 1 } }] } });
  assert.deepStrictEqual([s.status, s.outcome, openPermissions(s).length], ['ended', 'complete', 0]);
  assert.strictEqual(s.denials[0].resolved, true);
  assert.deepStrictEqual(s.denials[0].input, { c: 1 }, 'the re-report only enriches');
});

test('known limitation (OPEN): the same tool_use delivered twice is counted twice in toolsUsed', () => {
  const tu = { kind: KIND.TOOL_USE, payload: { tool: 'Edit', toolUseId: 't1', all: [{ tool: 'Edit', toolUseId: 't1' }] } };
  assert.strictEqual(reduce(reduce(initial(), tu), tu).toolsUsed, 2, 'known limitation: not deduplicated');
});

/* ───────────── FINISH under cancel with an unresolved refusal (QA gap) ───────────── */
const fin = (denials) => toSignal({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'end_turn', permission_denials: denials });
const outcomeOf = (s) => [s.status, s.outcome];

test('finish with a refusal on a hydrated cancel_requested Work ends cancelled_*, never permission_waiting', () => {
  const hyd = { ...initial(), status: 'cancel_requested' };
  const sig = fin([{ tool_name: 'B', tool_use_id: 'x' }]);
  assert.deepStrictEqual(outcomeOf(reduce(hyd, sig)), ['ended', 'cancelled_nochange']);
  assert.deepStrictEqual(outcomeOf(reduce({ ...hyd, toolsUsed: 3 }, sig)), ['ended', 'cancelled_partial']);
});

test('finish on a live cancelRequested Work with an already-open refusal ends cancelled_*', () => {
  let s = reduce(initial(), { kind: KIND.PERMISSION_DENIED, payload: { tool: 'B', toolUseId: 'x' } });
  s = reduce(s, { kind: KIND.CANCEL_REQUEST, payload: null });
  assert.strictEqual(s.status, 'cancel_requested');
  assert.deepStrictEqual(outcomeOf(reduce(s, fin([{ tool_name: 'B', tool_use_id: 'x' }]))), ['ended', 'cancelled_nochange']);
  assert.deepStrictEqual(outcomeOf(reduce({ ...s, toolsUsed: 1 }, fin([]))), ['ended', 'cancelled_partial']);
});

test('once a stop is requested no signal sequence reaches permission_waiting, resolved refusal or not', () => {
  let s = reduce(initial(), { kind: KIND.CANCEL_REQUEST, payload: null });
  for (const sig of [{ kind: KIND.PERMISSION_DENIED, payload: { tool: 'B', toolUseId: 'y' } },
                     { kind: KIND.PERMISSION_GRANTED, payload: { toolUseId: 'y' } },
                     { kind: KIND.PERMISSION_DENIED, payload: { tool: 'B', toolUseId: 'z' } }]) {
    s = reduce(s, sig);
    assert.strictEqual(s.status, 'cancel_requested', sig.kind);
  }
  assert.deepStrictEqual(outcomeOf(reduce(s, fin([]))), ['ended', 'cancelled_nochange']);
});

test('known limitation: a raw finish signal whose denials contain null throws in mergeDenials (unreachable via toSignal, which filters them)', () => {
  assert.throws(() => reduce(initial(), { kind: KIND.FINISH, payload: { subtype: 'success', denials: [null] } }), TypeError);
  assert.deepStrictEqual(outcomeOf(reduce(initial(), fin([null]))), ['ended', 'complete']);
});
