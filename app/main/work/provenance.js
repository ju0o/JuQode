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
 *            reviewed_at, and a rowid (SELECT rowid AS rowid_, * - plain `select *` has none and rows that
 *            tie on reviewed_at with different content then cannot be ordered: unverified). A row missing any of these does not count
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
/* case/space/trailing-punctuation insensitive: 'Done!' and ' done ' are one word */
const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[!.\u3002]+$/, '') : x);
const present = (x) => x !== undefined && x !== null && x !== '';
/* Built-in FALLBACK label sets (real Canon 18 values, kept as code points so no Korean literal lives here).
 * copy.js is a renderer ES module and not require()-able from main: the wiring passes the real set
 * as opts.successLabels / failureLabels / neutralLabels, and a test derives it from copy.js. */
const hx = (...words) => words.map((w) => String.fromCodePoint(...w.split(' ').map((c) => parseInt(c, 16))));
const SUCCESS_LABELS = hx('b05d b0ac c5b4 c694', 'c791 c5c5 c774 20 b05d b0ac c5b4 c694',
  'b05d b09c 20 ac83 c73c b85c 20 bcfc 20 c218 20 c788 c5b4 c694', 'c644 b8cc', 'c644 b8cc b428',
  'b9c8 c9c0 b9c9 20 c791 c5c5 c774 20 b05d b0ac c5b4 c694');
const FAILURE_LABELS = hx('c2e4 d328', 'b05d b0b4 c9c0 20 babb d588 c5b4 c694',
  'c544 c9c1 20 b05d b09c 20 ac83 c73c b85c 20 bcf4 ae30 20 c5b4 b824 c6cc c694', 'c2e4 d589 c774 20 c2e4 d328 d588 c5b4 c694');
const NEUTRAL_LABELS = hx('c77c bd80 b9cc 20 b05d b0ac c5b4 c694', 'cde8 c18c d588 c5b4 c694', 'c544 c9c1 20 d655 c778 b418 c9c0 20 c54a c558 c5b4 c694',
  'c9c0 ae08 c740 20 c0c1 d0dc b97c 20 d655 c778 d560 20 c218 20 c5c6 c5b4 c694', 'b05d b0ac b294 c9c0 20 d655 c778 d560 20 c218 20 c5c6 c5b4 c694');

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
const seqOf = (row) => [row?.rowid, row?.rowid_, row?.seq].find((x) => Number.isFinite(x));
const orderKey = (row, i, tkey) => ({ row, i, t: String(row?.[tkey] ?? ''), r: seqOf(row) ?? 0 });

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
    /* real rows have no rowid unless the caller selects it; rows tied on reviewed_at with no distinct
     * sequence cannot be ordered, and guessing could disagree with the repo -> unverified */
    const tied = latest ? mine.filter((r) => r.reviewed_at === latest.reviewed_at) : [];
    const sig = (r) => [r.verdict, r.criterion_digest, r.task_spec_digest, r.work_id, r.work_outcome].join('\u0001');
    if (tied.length > 1 && new Set(tied.map(sig)).size > 1 && new Set(tied.map(seqOf)).size < tied.length) {
      return { ...base, status: 'unverified', reason: 'ambiguous_order' };
    }
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
function summarizeChanges(changes) {   // + unavailableCount: how many files had patch_state 'unavailable'
  try {
    const unknown = (reason, unavailableCount = 0) => ({ changesKnown: false, patchStateKnown: false, count: null, lowerBound: false, patchComplete: false, reason, unavailableCount });
    if (changes?.known !== true || !Array.isArray(changes.files)) return unknown('unknown');
    const files = changes.files.map(normFile);
    if (files.some((f) => f.patchState === 'unavailable' || (f.patchState !== undefined && !PATCH_STATES.includes(f.patchState)))) return unknown('patch_unavailable', files.filter((f) => f.patchState === 'unavailable').length);
    const stateKnown = files.every((f) => f.patchState !== undefined);
    const sensitive = files.filter((f) => f.patchState === 'sensitive_excluded').length;
    const count = files.filter((f) => f.patchState !== 'unchanged' && f.patchState !== 'sensitive_excluded').length;
    const partial = files.some((f) => ['binary', 'too_large'].includes(f.patchState));
    return { changesKnown: true, patchStateKnown: stateKnown, count, lowerBound: sensitive > 0,
      patchComplete: stateKnown && !partial && sensitive === 0,
      unavailableCount: 0,
      reason: !stateKnown ? 'patch_state_unknown' : sensitive ? 'sensitive_lower_bound' : partial ? 'patch_partial' : null };
  } catch { return { changesKnown: false, patchStateKnown: false, count: null, lowerBound: false, patchComplete: false, reason: 'malformed_input', unavailableCount: 0 }; }
}

/* ── (V1-307) long claims: grapheme/code-point safe ─────────────────────────────────────── */

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const units = (text) => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text));

/* O(max), not O(length): only a bounded prefix is ever segmented.
 *  length <= max code units  -> never over (graphemes <= code units): exact, no segmentation.
 *  otherwise segment the first max*8+16 code units: more than `max` graphemes there -> over: exact.
 *  If that prefix holds <= max graphemes (a pathological >8-code-unit-per-grapheme run, e.g. combining
 *  marks) the text is treated as over by CODE-UNIT length - documented, conservative, still bounded. */
const PREFIX_FACTOR = 8;
function cut(text, max) {
  if (text.length <= max) return { over: false, head: null };
  const head = units(text.length > max * PREFIX_FACTOR + 16 ? text.slice(0, max * PREFIX_FACTOR + 16) : text);
  return { over: head.length > max || text.length > max * PREFIX_FACTOR + 16, head };
}
const isOver = (text, max) => cut(text, max).over;

/** Shown text is at most `limit` graphemes + the mark and is a prefix of `full`; `full` stays retrievable.
 * A lone surrogate already INSIDE the input is kept as is; a limit that is not a positive integer
 * means the default; a limit beyond the text length simply never truncates. */
function limitClaim(text, limit = CLAIM_LIMIT) {
  const full = typeof text === 'string' ? text : '';
  const max = Number.isInteger(limit) && limit > 0 ? limit : CLAIM_LIMIT;
  const { over, head } = cut(full, max);
  if (!over) return { shown: full, truncated: false, full };
  return { shown: head.slice(0, max).join('') + TRUNCATION_MARK, truncated: true, full };
}

/* ── (3) truth invariants ───────────────────────────────────────────────────────────────── */

const SUCCESS_WORDS = ['success', 'succeeded', 'complete', 'completed', 'done', 'ok', 'passed', 'pass', 'task complete', 'task completed', ...SUCCESS_LABELS];
const OTHER_WORDS = ['neutral', 'failure', 'failed', 'fail', 'error', 'unknown', 'warning', 'partial', 'cancelled', 'canceled', 'pending', 'info', ...FAILURE_LABELS, ...NEUTRAL_LABELS];
const wordSet = (...lists) => new Set(lists.flat().filter((x) => typeof x === 'string').map(norm));
const NO_WORDS = new Set(['', 'false', 'no', 'n', '0', 'null', 'undefined']);
const truthy = (x) => (typeof x === 'string' ? !NO_WORDS.has(norm(x)) : Boolean(x));
const asCount = (x) => (typeof x === 'string' && x.trim() !== '' ? Number(x) : x);
const hasCount = (x) => x !== undefined && x !== null && x !== '';

function claimText(c) {   // the longest string the claim carries (no allocation per claim)
  let best;
  for (const x of [c.full, c.text, c.data?.text]) if (typeof x === 'string' && (best === undefined || x.length > best.length)) best = x;
  return best;
}

/**
 * Snapshot (every part optional):
 *  work      {status, outcome, finishObserved}
 *  display   {tone|status|label|success, changes:{changesKnown,count,lowerBound}, testsPassed}
 *  changes   {known, files:[{path, change, patch_state|patchState, before_digest|beforeDigest, after_digest|afterDigest}]}
 *  baseline  {dirtyFiles:[{path,digest}]}  (legacy; a dirty list is not persisted today)
 *  claims    [{kind, confidence, text|data.text, shown, truncated, full}]
 *  task      {status, verdict, criteria, evidence}   evidence per taskPassVerdict's contract
 * @param opts {successLabels, failureLabels, neutralLabels}: copy-derived label values (see the label note above)
 * @returns {{code, detail}[]}  never throws (malformed -> malformed_input)
 */
function checkTruthInvariants(s, opts = {}) {
  try { return invariants(s, opts ?? {}); } catch { return [{ code: 'malformed_input', detail: 'snapshot could not be read' }]; }
}

function invariants(s, opts) {
  const success = wordSet(SUCCESS_WORDS, opts.successLabels ?? []);
  const known = wordSet(SUCCESS_WORDS, OTHER_WORDS, opts.successLabels ?? [], opts.failureLabels ?? [], opts.neutralLabels ?? []);
  if (!s || typeof s !== 'object') return [{ code: 'malformed_input', detail: 'snapshot is not an object' }];
  const v = []; const add = (code, detail) => v.push({ code, detail });
  const w = s.work ?? {}; const d = s.display ?? {};

  if (w.outcome === 'complete' && w.finishObserved !== true) add('complete_without_finish', 'outcome complete but no observed finish');

  const words = [d.tone, d.status, d.label, d.outcome].filter((x) => typeof x === 'string').map(norm);
  const shownSuccess = words.some((x) => success.has(x)) || truthy(d.success) && d.success !== undefined;
  if (shownSuccess && w.outcome !== 'complete') add('non_success_shown_success', `${w.outcome ?? w.status} rendered as success`);
  if (!shownSuccess && w.outcome !== 'complete' && words.some((x) => x !== '' && !known.has(x))) add('unknown_display_tone', 'unrecognised tone on a non-complete Work');

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
      if (hasCount(rep.count) && (typeof cnt !== 'number' || !Number.isFinite(cnt) || cnt < 0 || !Number.isInteger(cnt))) add('count_malformed', 'the shown count is not a non-negative integer');
      else if (hasCount(rep.count) && real.changesKnown && rep.changesKnown !== false && !(cnt === 0 && (real.count > 0 || real.lowerBound))) {
        const total = s.changes.files.length;     // a lower bound may be anything between the known count and all files
        if (real.lowerBound ? (cnt < real.count || cnt > total) : cnt !== real.count) add('count_mismatch', `shown ${cnt}, measured ${real.count}${real.lowerBound ? ' (lower bound)' : ''}`);
      }
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
    if (typeof text === 'string' && isOver(text, CLAIM_LIMIT)) {
      if (c.truncated !== true || typeof c.shown !== 'string' || isOver(c.shown, CLAIM_LIMIT + TRUNCATION_MARK.length) ||
          c.full !== text) add('claim_not_truncated', `${c.kind} of ${text.length} chars shown without limit/marker/full text`);
      else if (!text.startsWith(c.shown.endsWith(TRUNCATION_MARK) ? c.shown.slice(0, -TRUNCATION_MARK.length) : c.shown)) add('shown_not_prefix', `${c.kind} shown text is not the start of the full text`);
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

/** Canonical JSON: sorted keys; NaN, undefined, null stay distinct; throws on cycles. */
function canon(x, seen = new Set()) {
  if (x === null) return 'null';
  if (typeof x !== 'object') return typeof x === 'string' ? JSON.stringify(x) : `${typeof x}:${String(x)}`;
  if (seen.has(x)) throw new TypeError('cycle');
  seen.add(x);
  const out = Array.isArray(x) ? `[${x.map((y) => canon(y, seen)).join(',')}]`
    : `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k], seen)}`).join(',')}}`;
  seen.delete(x);
  return out;
}

/** Same content? Native JSON text first (fast); only a difference, or a 'null' (NaN also prints as null),
 * pays for the canonical comparison. Throws on cycles. */
function sameRow(a, b) {
  const x = JSON.stringify(a); const y = JSON.stringify(b);
  if (x === y && x !== undefined && !x.includes('null')) return true;
  return canon(a) === canon(b);
}

/** Rows keyed by id (duplicates get an occurrence suffix); an id-less row is keyed by position. */
function indexRows(rows) {
  const seen = new Map(); const m = new Map();
  rows.forEach((r, i) => {
    const id = r && typeof r === 'object' && present(r.id) ? String(r.id) : null;
    const n = seen.get(id ?? '') ?? 0; seen.set(id ?? '', n + 1);
    m.set(id === null ? `~pos${i}` : n ? `${id}#${n}` : id, r);
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
      const was = before[key] ?? []; const later = after?.[key] ?? [];
      /* fast path (the usual append-only shape): same ids at the same positions -> compare in place */
      if (later.length >= was.length && was.every((r, i) => r && later[i] && typeof r === 'object' && present(r.id) && r.id === later[i].id)) {
        was.forEach((r, i) => { if (!sameRow(later[i], r)) v.push({ code: 'ended_run_row_altered', detail: `${key}:${r.id}` }); });
        continue;
      }
      const now = indexRows(later);
      for (const [k, val] of indexRows(before[key] ?? [])) {
        if (!now.has(k)) v.push({ code: 'ended_run_row_removed', detail: `${key}:${k}` });
        else if (!sameRow(now.get(k), val)) v.push({ code: 'ended_run_row_altered', detail: `${key}:${k}` });
      }
    }
    return v;
  } catch { return [{ code: 'malformed_input', detail: 'snapshots could not be compared' }]; }
}

module.exports = { PROVENANCE, CLAIM_LIMIT, TRUNCATION_MARK, PATCH_STATES, classifyFact, classifyClaim,
  isConfirmedTestRun, taskPassVerdict, summarizeChanges, adaptChangedFilesEvidence, normFile, limitClaim,
  checkTruthInvariants, checkImmutableRun };
