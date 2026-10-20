'use strict';
/* V1-410 / V1-307 · result-truthfulness provenance. Pure; reads nothing, writes nothing.
 *
 * Every fact shown about a Work carries exactly ONE provenance, and only two of them may ever
 * make a Task "passed": a test JuQode watched return (TEST_CONFIRMED) or a human verdict
 * (HUMAN_CONFIRMED). What the Agent said (AGENT_SAID) and what was merely seen happen (OBSERVED)
 * never do. Provider-neutral: built on result.js claim kinds, run-evidence rows and
 * task_criterion_review rows only. Wired into nothing yet (see the slice report).
 */
const { createHash } = require('node:crypto');
const { testScopesForCriterion, testCommandMatchesScope } = require('./run-evidence.js');

const PROVENANCE = Object.freeze({
  AGENT_SAID: 'AGENT_SAID', OBSERVED: 'OBSERVED', TEST_CONFIRMED: 'TEST_CONFIRMED',
  HUMAN_CONFIRMED: 'HUMAN_CONFIRMED', UNKNOWN: 'UNKNOWN',
});
const P = PROVENANCE;

/** V1-307 long-paragraph limit: characters of ONE Agent claim shown before truncation. */
const CLAIM_LIMIT = 280;
const TRUNCATION_MARK = '…';
/** Input vocabulary of the (V1-412) patch core. Anything else is treated as unknown. */
const PATCH_STATES = Object.freeze(['stored', 'unchanged', 'binary', 'too_large', 'sensitive_excluded', 'unavailable']);

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

/* ── (1) classification ─────────────────────────────────────────────────────────────────── */

/** A recorded test_command row that really shows a passing run (same bar as repo.reviewTaskCriterion). */
function isConfirmedTestRun(ev) {
  const d = ev?.details;
  return ev?.kind === 'test_command' && d?.result_state === 'returned' && d.exit_code === 0 &&
    Number.isInteger(d.tests_passed_count) && d.tests_passed_count >= 1;
}

/**
 * Data source -> provenance. `fact.source` is one of:
 *   agent_summary | agent_claim | agent_report   (finish.text, result.js 'agent-report')  -> AGENT_SAID
 *   tool_use | tool_result | tool_observed | changed_files | file_change | step           -> OBSERVED
 *   test_command (run-evidence row)  TEST_CONFIRMED only if it returned, exit 0, >=1 pass; else OBSERVED
 *   criterion_review (verdict pass|fail)                                                 -> HUMAN_CONFIRMED
 * `changed_files` with known !== true is UNKNOWN; anything unrecognised is UNKNOWN.
 */
function classifyFact(fact) {
  switch (fact?.source) {
    case 'agent_summary': case 'agent_claim': case 'agent_report': return P.AGENT_SAID;
    case 'tool_use': case 'tool_result': case 'tool_observed': case 'file_change': case 'step': return P.OBSERVED;
    case 'changed_files': return fact.known === true ? P.OBSERVED : P.UNKNOWN;
    case 'test_command': return isConfirmedTestRun(fact.evidence ?? fact) ? P.TEST_CONFIRMED : P.OBSERVED;
    case 'criterion_review': return fact.verdict === 'pass' || fact.verdict === 'fail' ? P.HUMAN_CONFIRMED : P.UNKNOWN;
    default: return P.UNKNOWN;
  }
}

/** result.js claim kinds -> provenance (the shapes the screen is built from). */
function classifyClaim(claim) {
  switch (claim?.kind) {
    case 'agent-report': return P.AGENT_SAID;
    case 'changed-files': case 'tools-observed': return P.OBSERVED;
    default: return P.UNKNOWN;           // 'changes-unknown' and anything new: never promoted
  }
}

/* ── (2) PASS guard ─────────────────────────────────────────────────────────────────────── */

/**
 * @param {{id:string,text:string}[]} criteria
 * @param {{tests?:object[], reviews?:object[], agentSaid?:any, observed?:any}} evidence
 *   tests   run_evidence rows (kind test_command), oldest first
 *   reviews task_criterion_review rows, oldest first; a later row for a criterion supersedes
 *           an earlier one. A review counts only if its criterion_digest matches the criterion
 *           text (when present) and, for a pass, its Run ended `complete` (work_outcome, when present).
 *   agentSaid / observed are accepted and IGNORED on purpose: they can never pass anything.
 * @returns {{pass:boolean, criteria:{id:string,status:'passed'|'failed'|'unverified',
 *            provenance:string|null}[]}}
 */
function taskPassVerdict(criteria, evidence = {}) {
  const tests = Array.isArray(evidence?.tests) ? evidence.tests : [];
  const reviews = Array.isArray(evidence?.reviews) ? evidence.reviews : [];
  const rows = (Array.isArray(criteria) ? criteria : []).map((c) => {
    const latest = reviews.filter((r) => r?.criterion_id === c?.id &&
      (r.criterion_digest === undefined || r.criterion_digest === sha(c.text))).at(-1);
    if (latest?.verdict === 'fail') return { id: c.id, status: 'failed', provenance: P.HUMAN_CONFIRMED };
    if (latest?.verdict === 'pass' && (latest.work_outcome === undefined || latest.work_outcome === 'complete')) {
      return { id: c.id, status: 'passed', provenance: P.HUMAN_CONFIRMED };
    }
    const scopes = testScopesForCriterion(c?.text);
    /* every required scope needs its LATEST matching run to be a confirmed one; a criterion
     * with no test scope (or only an unsupported static check) cannot be test-confirmed. */
    const ok = scopes.length > 0 && scopes.every((scope) => {
      const last = tests.filter((e) => e?.kind === 'test_command' && testCommandMatchesScope(scope, e)).at(-1);
      return Boolean(last) && isConfirmedTestRun(last);
    });
    return ok ? { id: c.id, status: 'passed', provenance: P.TEST_CONFIRMED }
      : { id: c?.id, status: 'unverified', provenance: null };
  });
  return { pass: rows.length > 0 && rows.every((r) => r.status === 'passed'), criteria: rows };
}

/* ── changes summary: "0 changes" is a measurement, "unavailable" is not ───────────────── */

/**
 * @param {{known:boolean, files?:{path:string, patch_state?:string}[]}} changes
 * @returns {{changesKnown:boolean, count:number|null, patchComplete:boolean, reason:string|null}}
 * unknown/unavailable/unrecognised patch_state -> changesKnown:false, count:null (never 0).
 * binary/too_large/sensitive_excluded -> the file IS changed (counted), its patch is not complete.
 */
function summarizeChanges(changes) {
  const files = Array.isArray(changes?.files) ? changes.files : [];
  if (changes?.known !== true) return { changesKnown: false, count: null, patchComplete: false, reason: 'unknown' };
  const states = files.map((f) => f?.patch_state);
  if (states.some((s) => s === undefined || s === 'unavailable' || !PATCH_STATES.includes(s))) {
    return { changesKnown: false, count: null, patchComplete: false, reason: 'patch_unavailable' };
  }
  const changed = files.filter((f) => f.patch_state !== 'unchanged');
  const partial = changed.some((f) => ['binary', 'too_large', 'sensitive_excluded'].includes(f.patch_state));
  return { changesKnown: true, count: changed.length, patchComplete: !partial, reason: partial ? 'patch_partial' : null };
}

/* ── (V1-307) long claims ───────────────────────────────────────────────────────────────── */

/** Shown text is at most `limit` chars + the mark; the full text always stays retrievable. */
function limitClaim(text, limit = CLAIM_LIMIT) {
  const full = typeof text === 'string' ? text : '';
  if (full.length <= limit) return { shown: full, truncated: false, full };
  return { shown: full.slice(0, limit) + TRUNCATION_MARK, truncated: true, full };
}

/* ── (3) truth invariants ───────────────────────────────────────────────────────────────── */

const NOT_SUCCESS = new Set(['ended_unknown', 'interrupted', 'cancelled_partial', 'cancelled_nochange', 'failed', 'partial']);

/**
 * @param {object} s snapshot (every part optional):
 *  work      {status, outcome, finishObserved:boolean}
 *  display   {tone:'success'|'neutral'|'failure'|'unknown', changes:{changesKnown,count}, testsPassed:boolean}
 *  changes   {known, files:[{path, patch_state, beforeDigest?, afterDigest?}]}
 *  baseline  {dirtyFiles:[{path, digest}]}      attributed = changes.files
 *  claims    [{kind, confidence, text?, shown?, truncated?, full?}]
 *  task      {status, verdict, criteria, evidence}
 * @returns {{code:string, detail:string}[]} empty = no violation
 */
function checkTruthInvariants(s = {}) {
  const v = [];
  const add = (code, detail) => v.push({ code, detail });
  const w = s.work ?? {}; const d = s.display ?? {};

  if (w.outcome === 'complete' && w.finishObserved !== true) add('complete_without_finish', 'outcome complete but no observed finish');
  if (NOT_SUCCESS.has(w.outcome) && d.tone === 'success') add('non_success_shown_success', `${w.outcome} rendered as success`);
  if (w.status === 'interrupted' && d.tone === 'success') add('non_success_shown_success', 'interrupted rendered as success');

  /* changes 0 vs unknown */
  if (s.changes) {
    const real = summarizeChanges(s.changes);
    const rep = d.changes;
    if (rep) {
      if (!real.changesKnown && rep.changesKnown !== false) add('changes_known_overclaim', `reported changesKnown ${rep.changesKnown}, really ${real.reason}`);
      if (!real.changesKnown && rep.count === 0) add('unknown_rendered_as_zero', `${real.reason} shown as 0 changes`);
      if (real.changesKnown && rep.count === 0 && real.count > 0) add('unknown_rendered_as_zero', `${real.count} changed shown as 0`);
    }
    /* dirty baseline: a file already dirty before the Run is the Run's only if its content moved */
    const dirty = new Map((s.baseline?.dirtyFiles ?? []).map((f) => [f.path, f.digest]));
    for (const f of s.changes.files ?? []) {
      if (!dirty.has(f.path)) continue;
      const moved = f.afterDigest !== undefined && f.afterDigest !== dirty.get(f.path);
      if (!moved) add('dirty_baseline_attributed', `${f.path} was already dirty before the Run`);
    }
  }

  /* Agent words never wear a fact chip; long ones are cut with a mark and keep the full text */
  for (const c of s.claims ?? []) {
    if (classifyClaim(c) === P.AGENT_SAID && c.confidence === 'confirmed') add('agent_said_confirmed', `${c.kind} carries a confirmed chip`);
    if (classifyClaim(c) === P.UNKNOWN && c.confidence === 'confirmed') add('unknown_confirmed', `${c.kind} confirmed with no known provenance`);
    const text = c.full ?? c.text;
    if (typeof text === 'string' && text.length > CLAIM_LIMIT) {
      if (c.truncated !== true || typeof c.shown !== 'string' || c.shown.length > CLAIM_LIMIT + TRUNCATION_MARK.length ||
          c.full !== text) add('claim_not_truncated', `${c.kind} of ${text.length} chars shown without limit/marker/full text`);
    }
  }

  /* tests: "tests pass" on screen needs a confirmed run; Task PASS needs the guard */
  const t = s.task;
  if (d.testsPassed === true && !(t?.evidence?.tests ?? []).some(isConfirmedTestRun)) {
    add('tests_passed_without_test_run', 'tests shown as passed with no confirmed test run');
  }
  if (t && (t.status === 'complete' || t.verdict === 'pass') && !taskPassVerdict(t.criteria, t.evidence).pass) {
    add('task_pass_unconfirmed', 'Task passed without TEST_CONFIRMED/HUMAN_CONFIRMED evidence for every criterion');
  }
  return v;
}

/**
 * Past Run rows are immutable: given a snapshot of an ended Run and a LATER snapshot of it,
 * its outcome and every recorded evidence/patch row (matched by id) must be unchanged.
 * Rows ADDED later are not flagged (evidence is append-only).
 * snapshot = {work:{id,status,outcome}, evidence:[{id,...}], patches:[{id,...}]}
 */
function checkImmutableRun(before, after) {
  const v = [];
  if (before?.work?.status !== 'ended') return v;
  if (after?.work?.status !== 'ended' || after.work.outcome !== before.work.outcome) {
    v.push({ code: 'ended_run_changed', detail: `${before.work.outcome} -> ${after?.work?.outcome}` });
  }
  for (const key of ['evidence', 'patches']) {
    const now = new Map((after?.[key] ?? []).map((r) => [r.id, JSON.stringify(r)]));
    for (const r of before[key] ?? []) {
      if (!now.has(r.id)) v.push({ code: 'ended_run_row_removed', detail: `${key}:${r.id}` });
      else if (now.get(r.id) !== JSON.stringify(r)) v.push({ code: 'ended_run_row_altered', detail: `${key}:${r.id}` });
    }
  }
  return v;
}

module.exports = { PROVENANCE, CLAIM_LIMIT, TRUNCATION_MARK, PATCH_STATES, classifyFact, classifyClaim,
  isConfirmedTestRun, taskPassVerdict, summarizeChanges, limitClaim, checkTruthInvariants, checkImmutableRun };
