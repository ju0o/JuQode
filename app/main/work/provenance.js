'use strict';
/* V1-410 / V1-307 · result-truthfulness provenance. Pure; reads nothing, writes nothing.
 *
 * Every fact shown about a Work carries exactly ONE provenance. A Task may be reported PASSED
 * only by the repo's own bar (repo.currentTaskVerdict): EVERY criterion has a human 'pass'
 * review (HUMAN_CONFIRMED), all from ONE Run, with the current task_spec_digest and the
 * criterion's current digest, and that Run's outcome is 'complete'. A confirmed test run
 * (TEST_CONFIRMED) is SUPPORTING evidence only and never passes a Task by itself; AGENT_SAID and
 * OBSERVED never count. Provider-neutral, wired into nothing yet.
 *
 * INPUT-SHAPE CONTRACT for the future wiring (the DB rows alone are NOT enough):
 *   reviews  task_criterion_review rows JOINED with `work.outcome AS work_outcome`; needs
 *            criterion_id, criterion_digest, task_spec_digest, work_id, verdict, work_outcome,
 *            reviewed_at (and rowid when available). A row missing any of these does not count
 *            (fail closed). Order is by (reviewed_at, rowid), never by array position.
 *   taskSpecDigest  the CURRENT repo.taskSpecDigest(task); required.
 *   tests    run_evidence rows (kind test_command) with work_id, observed_at, rowid.
 *   run      {id, outcome} optional; defaults to the single Run of the human reviews.
 * Nothing in here throws: malformed input fails closed.
 */
const { createHash } = require('node:crypto');
const { testScopesForCriterion, testCommandMatchesScope } = require('./run-evidence.js');

const PROVENANCE = Object.freeze({
  AGENT_SAID: 'AGENT_SAID', OBSERVED: 'OBSERVED', TEST_CONFIRMED: 'TEST_CONFIRMED',
  HUMAN_CONFIRMED: 'HUMAN_CONFIRMED', UNKNOWN: 'UNKNOWN',
});
const P = PROVENANCE;

/** V1-307 long-paragraph limit: graphemes of ONE Agent claim shown before truncation. */
const CLAIM_LIMIT = 280;
const TRUNCATION_MARK = '…';
/** Input vocabulary of the (V1-412) patch core. */
const PATCH_STATES = Object.freeze(['stored', 'unchanged', 'binary', 'too_large', 'sensitive_excluded', 'unavailable']);

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : x);
const present = (x) => x !== undefined && x !== null && x !== '';
const ko = (...cp) => String.fromCharCode(...cp); // Korean words by code point: copy stays in Canon 18, not here
const DONE_WORD = ko(0xc644, 0xb8cc); // the Canon 18 "complete" label value, compared as a key

/* ── (1) classification ─────────────────────────────────────────────────────────────────── */

/** A recorded test_command row that really shows a passing run (the repo's bar, strictly). */
function isConfirmedTestRun(ev) {
  const d = ev?.details;
  return ev?.kind === 'test_command' && d?.result_state === 'returned' && d.exit_code === 0 &&
    Number.isInteger(d.tests_passed_count) && d.tests_passed_count >= 1;
}

/** Data source -> provenance. See the slice report for the table. */
function classifyFact(fact) {
  try {
    switch (fact?.source) {
      case 'agent_summary': case 'agent_claim': case 'agent_report': return P.AGENT_SAID;
      case 'tool_use': case 'tool_result': case 'tool_observed': case 'file_change': case 'step': return P.OBSERVED;
      case 'changed_files': return fact.known === true ? P.OBSERVED : P.UNKNOWN;
      case 'test_command': return isConfirmedTestRun(fact.evidence ?? fact) ? P.TEST_CONFIRMED : P.OBSERVED;
      case 'criterion_review': return fact.verdict === 'pass' || fact.verdict === 'fail' ? P.HUMAN_CONFIRMED : P.UNKNOWN;
      default: return P.UNKNOWN;
    }
  } catch { return P.UNKNOWN; }
}

/** result.js claim kinds -> provenance. */
function classifyClaim(claim) {
  try {
    switch (claim?.kind) {
      case 'agent-report': return P.AGENT_SAID;
      case 'changed-files': case 'tools-observed': return P.OBSERVED;
      default: return P.UNKNOWN;
    }
  } catch { return P.UNKNOWN; }
}

/* ── (2) PASS guard ─────────────────────────────────────────────────────────────────────── */

const byTime = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : (a.r - b.r) || (a.i - b.i));
const orderKey = (row, i, tkey) => ({ row, i, t: String(row?.[tkey] ?? ''), r: Number.isFinite(row?.rowid) ? row.rowid : 0 });

/**
 * @returns {{pass:boolean, runId:string|null, criteria:{id,status:'passed'|'failed'|'tests_confirmed'|'unverified',
 *   provenance:string|null, reason:string|null, testsConfirmed:boolean}[]}}
 * status 'passed' = HUMAN_CONFIRMED and the whole-Task bar holds; 'tests_confirmed' = supporting
 * only (pass stays false); 'failed' = the latest current human review says fail.
 */
function taskPassVerdict(criteria, evidence = {}) {
  try { return passVerdict(criteria, evidence ?? {}); }
  catch { return { pass: false, runId: null, criteria: [], error: 'malformed_input' }; }
}

function passVerdict(criteria, evidence) {
  const list = Array.isArray(criteria) ? criteria : [];
  const reviews = (Array.isArray(evidence.reviews) ? evidence.reviews : []).filter((r) => r && typeof r === 'object');
  const spec = evidence.taskSpecDigest;
  const ordered = reviews.map((r, i) => orderKey(r, i, 'reviewed_at')).sort(byTime).map((k) => k.row);

  const rows = list.map((c) => {
    const base = { id: c?.id ?? null, provenance: null, reason: null, testsConfirmed: false };
    if (!c || typeof c !== 'object' || !present(c.id) || typeof c.text !== 'string') return { ...base, status: 'unverified', reason: 'malformed_criterion' };
    const mine = ordered.filter((r) => r.criterion_id === c.id);
    /* ordering is only knowable with reviewed_at; an undated row poisons the criterion */
    if (mine.some((r) => !present(r.reviewed_at))) return { ...base, status: 'unverified', reason: 'unordered_review' };
    const latest = mine.at(-1);              // the LATEST row first - a stale one is not a fallback
    let out = { ...base, status: 'unverified', reason: latest ? null : 'no_review' };
    if (latest) {
      const current = present(spec) && latest.task_spec_digest === spec &&
        latest.criterion_digest === sha(c.text); // a missing digest never equals a sha
      if (!current) out = { ...out, reason: 'stale_or_missing_digest' };
      else if (latest.verdict === 'fail') out = { ...out, status: 'failed', provenance: P.HUMAN_CONFIRMED };
      else if (latest.verdict === 'pass') out = { ...out, status: 'human_pass', provenance: P.HUMAN_CONFIRMED, work_id: latest.work_id, work_outcome: latest.work_outcome };
      else out = { ...out, reason: 'unknown_verdict' };
    }
    return { ...out, c };
  });

  /* whole-Task bar (repo.currentTaskVerdict): one Run, outcome complete */
  const humanRows = rows.filter((r) => r.status === 'human_pass');
  const runs = new Set(humanRows.map((r) => r.work_id));
  const runOk = humanRows.length === rows.length && rows.length > 0 && runs.size === 1 && present(humanRows[0].work_id) &&
    humanRows.every((r) => r.work_outcome === 'complete');
  const pass = runOk; // a current fail is never a human_pass row, so runOk already excludes it
  const runId = pass ? humanRows[0].work_id : null;

  /* supporting test evidence: the SAME Run only, repo order (observed_at, rowid) */
  const run = evidence.run && present(evidence.run.id) ? evidence.run
    : humanRows.length && runs.size === 1 ? { id: humanRows[0].work_id, outcome: humanRows[0].work_outcome } : null;
  const tests = (Array.isArray(evidence.tests) ? evidence.tests : []).filter((e) => e && typeof e === 'object')
    .map((e, i) => orderKey(e, i, 'observed_at')).sort(byTime).map((k) => k.row)
    .filter((e) => run && run.outcome === 'complete' && e.work_id === run.id);

  const result = rows.map((r) => {
    const { c, work_id, work_outcome, ...rest } = r; void work_id; void work_outcome;
    let testsConfirmed = false;
    if (c) {
      const scopes = testScopesForCriterion(c.text);
      testsConfirmed = scopes.length > 0 && scopes.every((scope) => {
        const last = tests.filter((e) => e.kind === 'test_command' && testCommandMatchesScope(scope, e)).at(-1);
        return Boolean(last) && isConfirmedTestRun(last);
      });
    }
    if (rest.status === 'human_pass') return { ...rest, status: pass ? 'passed' : 'unverified', reason: pass ? null : 'run_bar', testsConfirmed };
    if (rest.status === 'unverified' && testsConfirmed) return { ...rest, status: 'tests_confirmed', provenance: P.TEST_CONFIRMED, testsConfirmed };
    return { ...rest, testsConfirmed };
  });
  return { pass, runId, criteria: result };
}

/* ── adapters + changes summary ─────────────────────────────────────────────────────────── */

/** One file row from any real shape: path string, {path,change}, snake_case or camelCase digests. */
function normFile(f) {
  if (typeof f === 'string') return { path: f, change: null, patchState: undefined, before: undefined, after: undefined };
  const o = f && typeof f === 'object' ? f : {};
  const pick = (a, b) => (present(o[a]) ? o[a] : present(o[b]) ? o[b] : undefined);
  return { path: o.path ?? null, change: o.change ?? null, patchState: pick('patch_state', 'patchState'),
    before: pick('before_digest', 'beforeDigest'), after: pick('after_digest', 'afterDigest') };
}

/** run_evidence row (kind changed_files, details {known, files}) or the details object itself -> {known, files}. */
function adaptChangedFilesEvidence(rowOrDetails) {
  const d = rowOrDetails?.details ?? rowOrDetails;
  const files = Array.isArray(d?.files) ? d.files : null;
  return { known: d?.known === true && files !== null, files: files ?? [] };
}

/**
 * Which files changed (measured) is separate from whether their PATCH is available.
 * @returns {{changesKnown:boolean, patchStateKnown:boolean, count:number|null, lowerBound:boolean,
 *            patchComplete:boolean, reason:string|null}}
 *  known:false / unavailable / unrecognised state -> changesKnown:false, count:null.
 *  no patch_state at all (today's changed_files evidence) -> changesKnown:true, patchStateKnown:false, count = files.
 *  sensitive_excluded may mean "withheld", not "changed" (V1-412 labels it before comparing digests):
 *    it is NOT counted and makes the count a LOWER BOUND (changesKnown:true, lowerBound:true).
 *  binary / too_large (assigned only after digests differ) are counted, patchComplete:false.
 */
function summarizeChanges(changes) {
  try {
    const unknown = (reason) => ({ changesKnown: false, patchStateKnown: false, count: null, lowerBound: false, patchComplete: false, reason });
    if (changes?.known !== true || !Array.isArray(changes.files)) return unknown('unknown');
    const files = changes.files.map(normFile);
    if (files.some((f) => f.patchState === 'unavailable' || (f.patchState !== undefined && !PATCH_STATES.includes(f.patchState)))) return unknown('patch_unavailable');
    const stateKnown = files.every((f) => f.patchState !== undefined);
    const sensitive = files.filter((f) => f.patchState === 'sensitive_excluded').length;
    const count = files.filter((f) => f.patchState !== 'unchanged' && f.patchState !== 'sensitive_excluded').length;
    const partial = files.some((f) => ['binary', 'too_large'].includes(f.patchState));
    return { changesKnown: true, patchStateKnown: stateKnown, count, lowerBound: sensitive > 0,
      patchComplete: stateKnown && !partial && sensitive === 0,
      reason: !stateKnown ? 'patch_state_unknown' : sensitive ? 'sensitive_lower_bound' : partial ? 'patch_partial' : null };
  } catch { return { changesKnown: false, patchStateKnown: false, count: null, lowerBound: false, patchComplete: false, reason: 'malformed_input' }; }
}

/* ── (V1-307) long claims: grapheme/code-point safe ─────────────────────────────────────── */

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const units = (text) => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text));
const unitCount = (text) => units(text).length;

/** Shown text is at most `limit` graphemes + the mark; never ends in a lone surrogate; full stays retrievable. */
function limitClaim(text, limit = CLAIM_LIMIT) {
  const full = typeof text === 'string' ? text : '';
  const max = Number.isInteger(limit) && limit > 0 ? limit : CLAIM_LIMIT;
  const u = units(full);
  if (u.length <= max) return { shown: full, truncated: false, full };
  return { shown: u.slice(0, max).join('') + TRUNCATION_MARK, truncated: true, full };
}

/* ── (3) truth invariants ───────────────────────────────────────────────────────────────── */

const SUCCESS_WORDS = new Set(['success', 'succeeded', 'complete', 'completed', 'done', 'ok', 'passed', 'pass', DONE_WORD]);
const KNOWN_TONES = new Set([...SUCCESS_WORDS, 'neutral', 'failure', 'failed', 'fail', 'error', 'unknown', 'warning', 'partial', 'cancelled', 'pending', 'info']);
const NO_WORDS = new Set(['', 'false', 'no', 'n', '0', 'null', 'undefined']);
const truthy = (x) => (typeof x === 'string' ? !NO_WORDS.has(norm(x)) : Boolean(x));
const asCount = (x) => (typeof x === 'string' && x.trim() !== '' ? Number(x) : x);
const hasCount = (x) => x !== undefined && x !== null && x !== '';

function claimText(c) {
  const cands = [c?.full, c?.text, c?.data?.text].filter((x) => typeof x === 'string');
  return cands.sort((a, b) => b.length - a.length)[0];
}

/**
 * Snapshot (every part optional):
 *  work      {status, outcome, finishObserved}
 *  display   {tone|status|label|success, changes:{changesKnown,count,lowerBound}, testsPassed}
 *  changes   {known, files:[{path, change, patch_state|patchState, before_digest|beforeDigest, after_digest|afterDigest}]}
 *  baseline  {dirtyFiles:[{path,digest}]}  (legacy; a dirty list is not persisted today)
 *  claims    [{kind, confidence, text|data.text, shown, truncated, full}]
 *  task      {status, verdict, criteria, evidence}   evidence per taskPassVerdict's contract
 * @returns {{code, detail}[]}  never throws (malformed -> malformed_input)
 */
function checkTruthInvariants(s) {
  try { return invariants(s); } catch { return [{ code: 'malformed_input', detail: 'snapshot could not be read' }]; }
}

function invariants(s) {
  if (!s || typeof s !== 'object') return [{ code: 'malformed_input', detail: 'snapshot is not an object' }];
  const v = []; const add = (code, detail) => v.push({ code, detail });
  const w = s.work ?? {}; const d = s.display ?? {};

  if (w.outcome === 'complete' && w.finishObserved !== true) add('complete_without_finish', 'outcome complete but no observed finish');

  const words = [d.tone, d.status, d.label, d.outcome].filter((x) => typeof x === 'string').map(norm);
  const shownSuccess = words.some((x) => SUCCESS_WORDS.has(x)) || truthy(d.success) && d.success !== undefined;
  if (shownSuccess && w.outcome !== 'complete') add('non_success_shown_success', `${w.outcome ?? w.status} rendered as success`);
  if (!shownSuccess && w.outcome !== 'complete' && words.some((x) => x !== '' && !KNOWN_TONES.has(x))) add('unknown_display_tone', 'unrecognised tone on a non-complete Work');

  if (s.changes) {
    const real = summarizeChanges(s.changes);
    const rep = d.changes;
    if (rep) {
      const cnt = asCount(rep.count);
      if (!real.changesKnown && rep.changesKnown !== false) add('changes_known_overclaim', `reported changesKnown ${rep.changesKnown}, really ${real.reason}`);
      if (!real.changesKnown && cnt === 0) add('unknown_rendered_as_zero', `${real.reason} shown as 0 changes`);
      if (real.changesKnown && cnt === 0 && (real.count > 0 || real.lowerBound)) add('unknown_rendered_as_zero', `${real.count} changed${real.lowerBound ? ' (lower bound)' : ''} shown as 0`);
      if (real.changesKnown && real.lowerBound && rep.changesKnown !== false && rep.lowerBound !== true) add('changes_known_overclaim', 'a lower bound shown as an exact count');
      if (real.changesKnown && !real.patchStateKnown && rep.patchStateKnown === true) add('changes_known_overclaim', 'patch availability claimed with no patch_state');
      if (rep.changesKnown === false && hasCount(rep.count)) add('fabricated_count', 'a count shown for changes that are not known');
    }
    /* dirty baseline, realistic form: a changed row whose before and after digest are the same
     * content was already there before the Run (sensitive_excluded is labelled before digests). */
    const dirty = new Map((s.baseline?.dirtyFiles ?? []).map((f) => [f?.path, f?.digest]));
    for (const f of (Array.isArray(s.changes.files) ? s.changes.files : []).map(normFile)) {
      if (f.patchState !== 'unchanged' && f.patchState !== 'sensitive_excluded' && present(f.before) && f.before === f.after) {
        add('dirty_baseline_attributed', `${f.path} has identical before/after content`);
      } else if (dirty.has(f.path) && !(present(f.after) && present(dirty.get(f.path)) && f.after !== dirty.get(f.path))) {
        add('dirty_baseline_attributed', `${f.path} was already dirty before the Run`);
      }
    }
  }

  for (const c of Array.isArray(s.claims) ? s.claims : []) {
    if (!c || typeof c !== 'object') { add('malformed_input', 'claim is not an object'); continue; }
    const conf = norm(c.confidence);
    if (classifyClaim(c) === P.AGENT_SAID && conf === 'confirmed') add('agent_said_confirmed', `${c.kind} carries a confirmed chip`);
    if (classifyClaim(c) === P.UNKNOWN && conf === 'confirmed') add('unknown_confirmed', `${c.kind} confirmed with no known provenance`);
    const text = claimText(c);
    if (typeof text === 'string' && unitCount(text) > CLAIM_LIMIT) {
      if (c.truncated !== true || typeof c.shown !== 'string' || unitCount(c.shown) > CLAIM_LIMIT + unitCount(TRUNCATION_MARK) ||
          c.full !== text) add('claim_not_truncated', `${c.kind} of ${text.length} chars shown without limit/marker/full text`);
    }
  }

  const t = s.task;
  const confirmedRun = (Array.isArray(t?.evidence?.tests) ? t.evidence.tests : []).some(isConfirmedTestRun);
  if (truthy(d.testsPassed) && !confirmedRun) add('tests_passed_without_test_run', 'tests shown as passed with no confirmed test run');
  if (t && (['complete', 'completed', 'passed', 'pass'].includes(norm(t.status)) || ['pass', 'passed'].includes(norm(t.verdict))) &&
      !taskPassVerdict(t.criteria, t.evidence).pass) {
    add('task_pass_unconfirmed', 'Task passed without a human pass on every criterion from one complete Run');
  }
  return v;
}

/* ── immutability ───────────────────────────────────────────────────────────────────────── */

/** Canonical JSON: sorted keys; throws on cycles (caught by callers -> malformed_input). */
function canon(x, seen = new Set()) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (seen.has(x)) throw new TypeError('cycle');
  seen.add(x);
  const out = Array.isArray(x) ? `[${x.map((y) => canon(y, seen)).join(',')}]`
    : `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k], seen)}`).join(',')}}`;
  seen.delete(x);
  return out;
}

/** Rows keyed by id (duplicates get an occurrence suffix); an id-less row is keyed by position. */
function indexRows(rows) {
  const seen = new Map(); const m = new Map();
  rows.forEach((r, i) => {
    const id = r && typeof r === 'object' && present(r.id) ? String(r.id) : null;
    const n = seen.get(id ?? '') ?? 0; seen.set(id ?? '', n + 1);
    m.set(id === null ? `~pos${i}` : n ? `${id}#${n}` : id, canon(r));
  });
  return m;
}

/** Past Run rows are immutable. Rows ADDED later are not flagged (evidence is append-only). */
function checkImmutableRun(before, after) {
  try {
    const v = [];
    if (before?.work?.status !== 'ended') return v;
    if (after?.work?.status !== 'ended' || after.work.outcome !== before.work.outcome) {
      v.push({ code: 'ended_run_changed', detail: `${before.work.outcome} -> ${after?.work?.outcome}` });
    }
    for (const key of ['evidence', 'patches']) {
      if ((before[key] !== undefined && !Array.isArray(before[key])) || (after?.[key] !== undefined && !Array.isArray(after[key]))) {
        v.push({ code: 'malformed_input', detail: `${key} is not a list` }); continue;
      }
      const now = indexRows(after?.[key] ?? []);
      for (const [k, val] of indexRows(before[key] ?? [])) {
        if (!now.has(k)) v.push({ code: 'ended_run_row_removed', detail: `${key}:${k}` });
        else if (now.get(k) !== val) v.push({ code: 'ended_run_row_altered', detail: `${key}:${k}` });
      }
    }
    return v;
  } catch { return [{ code: 'malformed_input', detail: 'snapshots could not be compared' }]; }
}

module.exports = { PROVENANCE, CLAIM_LIMIT, TRUNCATION_MARK, PATCH_STATES, classifyFact, classifyClaim,
  isConfirmedTestRun, taskPassVerdict, summarizeChanges, adaptChangedFilesEvidence, normFile, limitClaim,
  checkTruthInvariants, checkImmutableRun };
