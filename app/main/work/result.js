'use strict';
/* WBS-18 · the Work's result, and what each part of it is worth (D-114).
 *
 * The whole point of this file is the CONFIDENCE rule, which is a rule about evidence and not
 * about wording:
 *
 *   확인됨  a deterministic fact backs it — a file the evidence layer measured as changed, or
 *           a tool result JuQode itself observed. It carries the source it rests on.
 *   예상됨  Claude Code reported it and nothing measured it. Its own prose lives here.
 *   확인 못함 nobody established it either way. Silence is this, never 확인됨.
 *
 * `19` §C3-L and `07` §8.1 both apply: the exit code proves nothing, and a run whose tool was
 * denied still reports success. Every judgement below comes from signals and from the evidence
 * pair, never from how the process ended.
 */
const { KIND } = require('./reducer');

/** `20` `work_outcome`. Five reach the screen; `ended_unknown` is the sixth (D-124, A-15). */
const OUTCOMES = ['complete', 'partial', 'failed', 'cancelled_partial', 'cancelled_nochange', 'ended_unknown'];

/**
 * Build the result from what was observed. Nothing here reads a clock or an exit code.
 *
 * @param {object} o
 * @param {object} o.state         the reducer's final state
 * @param {{known:boolean, files:string[]}} o.changes  the evidence pair's answer
 * @param {object[]} o.signals     every persisted signal, in order
 * Neither a claim nor an item carries a SENTENCE — they carry a `kind` and a structured
 * `data`, and the renderer composes the Korean so `18` stays the single copy source (CF-6).
 *
 * @returns {{summary:string|null, whatFailed:object|null,
 *            claims:{kind:string, data:object|null,
 *                    confidence:'confirmed'|'expected'|'unconfirmed', sourceRef:string|null}[],
 *            items:{kind:'done'|'not_done', data:object|null, confidence:string}[]}}
 */
function build({ state, changes, signals = [] }) {
  const claims = [];
  const items = [];

  /* ① What the evidence measured. This is the only kind of claim that can be 확인됨, and it
   * names the files it rests on — a chip without its source is a chip that cannot be checked. */
  if (changes?.known) {
    claims.push({
      kind: 'changed-files',
      data: { files: changes.files },
      confidence: 'confirmed',
      sourceRef: 'evidence:before→after',
    });
  } else {
    /* `15` 남은 변경 확인 불가. Not "nothing changed" — we could not tell, and saying so is the
     * difference between a measurement and an assumption. */
    claims.push({ kind: 'changes-unknown', data: null, confidence: 'unconfirmed', sourceRef: null });
  }

  /* ② What Claude Code said it did. Nothing verified it, so it is 예상됨 (D-114) — and it is
   * carried as the model's own words rather than paraphrased into JuQode's voice. */
  const text = state?.finish?.text ?? null;
  if (text) claims.push({ kind: 'agent-report', data: { text }, confidence: 'expected', sourceRef: 'claude:result' });

  /* ③ Tools JuQode watched run and finish. An observed tool_result is a fact about what
   * happened, independent of what the report says about it. */
  const toolResults = signals.filter((s) => s.kind === KIND.TOOL_RESULT).length;
  if (toolResults > 0) {
    claims.push({ kind: 'tools-observed', data: { count: toolResults }, confidence: 'confirmed', sourceRef: 'signals:tool_result' });
  }

  /* ④ Refusals the user never resolved. `15` 부분 완료 needs 된 것 / 안 된 것 as two lists, and
   * an unanswered refusal is the clearest thing there is for the second one. */
  const openDenials = (state?.denials ?? []).filter((d) => !d.resolved);
  for (const d of openDenials) {
    items.push({ kind: 'not_done', data: { tool: d.tool, target: targetOf(d) }, confidence: 'confirmed' });
  }
  if (changes?.known && changes.files.length) {
    items.push({ kind: 'done', data: { files: changes.files }, confidence: 'confirmed' });
  }

  /* `15` 실패: 무엇이 실패했는지 · 어디까지 갔는지 · 무엇이 남았는지. Only the first is
   * knowable here without inventing; the other two are the two lists above. */
  const whatFailed = state?.outcome === 'failed'
    ? { subtype: state.finish?.subtype ?? null, terminalReason: state.finish?.terminalReason ?? null }
    : null;

  return {
    summary: text,
    whatFailed,
    claims,
    /* A partial result MUST have both lists (`21` WBS-18 acceptance). If one of them would be
     * empty the outcome was not partial, and the outcome is what the reducer decided. */
    items,
    outcome: state?.outcome ?? null,
  };
}

const targetOf = (d) => d?.input?.file_path ?? d?.input?.path ?? d?.input?.command ?? d?.input?.url ?? null;

/**
 * `21` WBS-18's acceptance, checked. Each condition is separate so a single failure is named
 * on its own — a check that only reports when everything is wrong at once cannot tell you
 * which rule broke.
 */
function verify(result) {
  const problems = [];
  for (const c of result.claims) {
    if (c.confidence === 'confirmed' && !c.sourceRef) problems.push(`claim ${c.kind} is 확인됨 with no source`);
  }
  /* `cancelled_partial` is a 부분 card too — `15` gives it the same two lists. Naming only
   * 'partial' here let the cancel path ship a 부분 완료 card with neither list, which is the
   * one thing WBS-18's acceptance row rules out. */
  if (result.outcome === 'partial' || result.outcome === 'cancelled_partial') {
    if (!result.items.some((i) => i.kind === 'done')) problems.push('partial result has no 된 것 list');
    if (!result.items.some((i) => i.kind === 'not_done')) problems.push('partial result has no 안 된 것 list');
  }
  return problems;
}

/**
 * Build, then ENFORCE. `verify` used to be called only by the tests, which made it a guard
 * that guarded nothing: a 확인됨 claim with no source would have reached the screen, and the
 * chip is a promise the user is invited to check.
 *
 * A claim that cannot name its evidence is not refused — it is DOWNGRADED to 확인 못함, which
 * is what it always was. Refusing the whole result would hide the rest of what was measured.
 *
 * @returns {{result:object, problems:string[]}}
 */
function buildChecked(input) {
  const result = build(input);
  const problems = verify(result);
  if (!problems.length) return { result, problems };

  result.claims = result.claims.map((c) =>
    (c.confidence === 'confirmed' && !c.sourceRef) ? { ...c, confidence: 'unconfirmed' } : c);
  return { result, problems };
}

module.exports = { build, buildChecked, verify, OUTCOMES };
