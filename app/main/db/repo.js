'use strict';
/* WBS-21 · repositories. One function per thing the product actually does today.
 * `20` / `docs/data/schema.sql` own the shape; nothing here re-declares it. */
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { safeSnapshot } = require('../work/context');
const { testCommandMatchesScope, testScopesForCriterion } = require('../work/run-evidence');

const now = () => new Date().toISOString();

function startAppSession(db, { appVersion, platform }) {
  if (typeof appVersion !== 'string' || !appVersion || typeof platform !== 'string' || !platform) {
    throw new TypeError('App session requires an app version and platform');
  }
  const id = randomUUID(), startedAt = now();
  db.prepare('insert into app_session (id, started_at, app_version, platform) values (?, ?, ?, ?)')
    .run(id, startedAt, appVersion, platform);
  return { id, startedAt, appVersion, platform };
}

function endAppSession(db, id) {
  if (!id) return false;
  return db.prepare('update app_session set ended_at = coalesce(ended_at, ?) where id = ?')
    .run(now(), id).changes === 1;
}

/* ── DG-05 · Task persistence ──────────────────────────────────────────────────── */
const TASK_STATUSES = new Set(['open', 'in_progress', 'blocked', 'complete']);

function taskFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    dependencies: JSON.parse(row.dependencies),
    acceptance_criteria: JSON.parse(row.acceptance_criteria),
  };
}

function normalizeCriteria(criteria) {
  if (!Array.isArray(criteria)) throw new TypeError('acceptanceCriteria must be an array');
  const ids = new Set();
  return criteria.map((item) => {
    const object = typeof item === 'string' ? { text: item } : item;
    if (!object || typeof object !== 'object' || Array.isArray(object) ||
        typeof object.text !== 'string' || !object.text.trim()) {
      throw new TypeError('each acceptance criterion must have non-empty text');
    }
    const id = typeof object.id === 'string' ? object.id.trim() : object.id ?? randomUUID();
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) {
      throw new TypeError('acceptance criterion ids must be non-empty and unique');
    }
    ids.add(id);
    return { id, text: safeSnapshot(object.text.trim()).safe };
  });
}

function normalizeDependencies(db, projectId, taskId, dependencies) {
  if (!Array.isArray(dependencies) || dependencies.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new TypeError('dependencies must be an array of Task ids');
  }
  const ids = dependencies.map((id) => id.trim());
  if (new Set(ids).size !== ids.length) throw new TypeError('dependencies must not contain duplicates');
  if (ids.includes(taskId)) throw new TypeError('a Task cannot depend on itself');
  if (ids.length) {
    const rows = db.prepare(`select id, dependencies from task where project_id = ?`).all(projectId);
    const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.dependencies)]));
    const found = ids.filter((id) => byId.has(id));
    if (found.length !== ids.length) {
      throw new TypeError('every dependency must be an existing Task in the same Project');
    }
    const reachesTask = (from, seen = new Set()) => {
      if (from === taskId) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (byId.get(from) ?? []).some((next) => reachesTask(next, seen));
    };
    if (ids.some((id) => reachesTask(id))) throw new TypeError('Task dependencies must not create a cycle');
  }
  return ids;
}

const taskStatus = (value) => {
  /* `complete` is persisted for the future evaluator but is not writable through this API.
   * DG-10 will expose completion only alongside criterion-level evidence. */
  if (!TASK_STATUSES.has(value) || value === 'complete') throw new TypeError('invalid Task status');
  return value;
};

function taskRunRefusal(db, projectId, taskId, { retryOfWorkId = null } = {}) {
  if (taskId == null) return null;
  if (typeof taskId !== 'string' || !taskId.trim()) return 'bad-task-id';
  const task = db.prepare('select project_id, status, verdict, dependencies from task where id = ?').get(taskId);
  if (!task) return 'no-task';
  if (task.project_id !== projectId) return 'task-project-mismatch';
  if (task.status === 'complete' || task.verdict === 'pass') return 'task-complete';
  for (const dependencyId of JSON.parse(task.dependencies)) {
    const dependency = db.prepare('select status, verdict from task where id = ? and project_id = ?')
      .get(dependencyId, projectId);
    if (!dependency || dependency.status !== 'complete' || dependency.verdict !== 'pass') {
      return 'task-dependencies-open';
    }
  }
  const latest = db.prepare(`select id, status from work where task_id = ?
    order by started_at desc, rowid desc limit 1`).get(taskId);
  if (latest?.status === 'ended') {
    if (retryOfWorkId !== latest.id) return retryOfWorkId ? 'retry-source-not-latest' : 'task-run-retry-required';
  } else if (retryOfWorkId) {
    return 'retry-run-not-ended';
  }
  return null;
}

function createTask(db, projectId, { goal, dependencies = [], acceptanceCriteria = [] }) {
  if (typeof goal !== 'string' || !goal.trim()) throw new TypeError('Task goal must not be empty');
  if (!db.prepare('select id from project where id = ?').get(projectId)) throw new TypeError('Project not found');
  const id = randomUUID(), at = now();
  db.exec('begin');
  try {
    const deps = normalizeDependencies(db, projectId, id, dependencies);
    const criteria = normalizeCriteria(acceptanceCriteria);
    db.prepare(`insert into task
      (id, project_id, goal, dependencies, acceptance_criteria, status, verdict, created_at, updated_at)
      values (?, ?, ?, ?, ?, 'open', 'unverified', ?, ?)`)
      .run(id, projectId, safeSnapshot(goal.trim()).safe, JSON.stringify(deps), JSON.stringify(criteria), at, at);
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
  return getTask(db, id);
}

const getTask = (db, id) => taskFromRow(db.prepare('select * from task where id = ?').get(id));

const tasksForProject = (db, projectId) => db.prepare(
  'select * from task where project_id = ? order by created_at, rowid'
).all(projectId).map(taskFromRow);

function updateTask(db, id, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Task patch must be an object');
  const allowed = new Set(['goal', 'dependencies', 'acceptanceCriteria', 'status']);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new TypeError(`unsupported Task field: ${key}`);
  db.exec('begin');
  try {
    const current = db.prepare('select * from task where id = ?').get(id);
    if (!current) throw new TypeError('Task not found');
    if (!Object.keys(patch).length) {
      db.exec('commit');
      return taskFromRow(current);
    }
    const fields = [], values = [];
    if (Object.hasOwn(patch, 'goal')) {
      if (typeof patch.goal !== 'string' || !patch.goal.trim()) throw new TypeError('Task goal must not be empty');
      fields.push('goal = ?'); values.push(safeSnapshot(patch.goal.trim()).safe);
    }
    if (Object.hasOwn(patch, 'dependencies')) {
      const deps = normalizeDependencies(db, current.project_id, id, patch.dependencies);
      fields.push('dependencies = ?'); values.push(JSON.stringify(deps));
    }
    if (Object.hasOwn(patch, 'acceptanceCriteria')) {
      fields.push('acceptance_criteria = ?'); values.push(JSON.stringify(normalizeCriteria(patch.acceptanceCriteria)));
    }
    if (['goal', 'dependencies', 'acceptanceCriteria'].some((key) => Object.hasOwn(patch, key))) {
      fields.push("verdict = 'unverified'");
      if (!Object.hasOwn(patch, 'status') && current.status === 'complete') fields.push("status = 'open'");
    }
    if (Object.hasOwn(patch, 'status')) {
      fields.push('status = ?'); values.push(taskStatus(patch.status));
    }
    fields.push('updated_at = ?'); values.push(now(), id);
    db.prepare(`update task set ${fields.join(', ')} where id = ?`).run(...values);
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
  return getTask(db, id);
}

function saveRunContextBundle(db, workId, built) {
  if (!built?.bundle?.bundle_id || !Number.isInteger(built.bundle.bundle_schema_version) ||
      typeof built.contentDigest !== 'string' || typeof built.agentPrompt !== 'string') {
    throw new TypeError('invalid Run ContextBundle');
  }
  if (!db.prepare('select id from work where id = ?').get(workId)) throw new TypeError('Work not found');
  const prior = db.prepare('select * from run_context_bundle where work_id = ?').get(workId);
  if (prior) {
    if (prior.id === built.bundle.bundle_id && prior.content_digest === built.contentDigest) return contextBundleFor(db, workId);
    throw new TypeError('Run ContextBundle is already frozen');
  }
  db.prepare(`insert into run_context_bundle
    (id, work_id, bundle_schema_version, created_at, builder_version, content_digest, bundle_json)
    values (?, ?, ?, ?, ?, ?, ?)`)
    .run(built.bundle.bundle_id, workId, built.bundle.bundle_schema_version, built.bundle.created_at,
      built.bundle.builder_version, built.contentDigest, JSON.stringify(built.bundle));
  return contextBundleFor(db, workId);
}

function contextBundleFor(db, workId) {
  const row = db.prepare('select * from run_context_bundle where work_id = ?').get(workId);
  if (!row) return null;
  return { ...row, bundle: JSON.parse(row.bundle_json) };
}

function saveRunEvidence(db, workId, evidence) {
  if (!evidence || !['changed_files', 'test_command'].includes(evidence.kind) ||
      typeof evidence.source_ref !== 'string' || !evidence.source_ref ||
      typeof evidence.content_digest !== 'string' || typeof evidence.summary !== 'string' ||
      !evidence.observed_at || !evidence.details || typeof evidence.details !== 'object') {
    throw new TypeError('invalid Run evidence');
  }
  const prior = db.prepare('select * from run_evidence where work_id = ? and kind = ? and source_ref = ?')
    .get(workId, evidence.kind, evidence.source_ref);
  if (prior) {
    if (prior.content_digest === evidence.content_digest) return runEvidenceFor(db, workId);
    throw new TypeError('Run evidence is immutable');
  }
  db.prepare(`insert into run_evidence
    (id, work_id, kind, source_ref, observed_at, summary, content_digest, details_json)
    values (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), workId, evidence.kind, evidence.source_ref, evidence.observed_at,
      evidence.summary, evidence.content_digest, JSON.stringify(evidence.details));
  return runEvidenceFor(db, workId);
}

const runEvidenceFor = (db, workId) => db.prepare(
  'select * from run_evidence where work_id = ? order by observed_at, rowid'
).all(workId).map((row) => ({ ...row, details: JSON.parse(row.details_json) }));

function taskCriterionReviewsFor(db, taskId) {
  return db.prepare('select * from task_criterion_review where task_id = ? order by reviewed_at, rowid')
    .all(taskId).map((row) => ({ ...row, evidence_ids: JSON.parse(row.evidence_ids) }));
}

const taskSpecDigest = (task) => createHash('sha256').update(JSON.stringify({
  goal: task.goal,
  dependencies: task.dependencies ?? [],
  acceptanceCriteria: task.acceptance_criteria,
}), 'utf8').digest('hex');

function runMatchesTaskSpec(db, task, workId) {
  const bundle = contextBundleFor(db, workId)?.bundle;
  return Boolean(bundle && bundle.task_spec_digest === taskSpecDigest(task));
}

function currentTaskVerdict(db, task, workId, criterionId, criterionDigest, specDigest, nextVerdict) {
  const criteria = task.acceptance_criteria;
  const rows = taskCriterionReviewsFor(db, task.id);
  const latest = new Map();
  for (const row of rows) latest.set(row.criterion_id, row);
  latest.set(criterionId, { task_id: task.id, work_id: workId, criterion_id: criterionId,
    criterion_digest: criterionDigest, task_spec_digest: specDigest, verdict: nextVerdict });
  const relevant = criteria.map((criterion) => {
    const review = latest.get(criterion.id);
    return review && review.task_spec_digest === specDigest &&
      review.criterion_digest === createHash('sha256').update(criterion.text, 'utf8').digest('hex')
      ? review : null;
  });
  if (relevant.some((review) => review?.verdict === 'fail')) return { verdict: 'fail', status: 'in_progress' };
  if (criteria.length && relevant.every((review) => review?.verdict === 'pass')) {
    const runs = new Set(relevant.map((review) => review.work_id));
    if (runs.size === 1) {
      const run = db.prepare('select outcome from work where id = ? and task_id = ?').get([...runs][0], task.id);
      if (run?.outcome === 'complete') return { verdict: 'pass', status: 'complete' };
    }
  }
  const hasReview = relevant.some(Boolean);
  return { verdict: 'unverified', status: hasReview ? 'in_progress' : 'open' };
}

function reviewTaskCriterion(db, taskId, workId, criterionId, verdict, evidenceIds) {
  if (!['pass', 'fail'].includes(verdict)) throw new TypeError('criterion verdict must be pass or fail');
  if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(evidenceIds).size !== evidenceIds.length) {
    throw new TypeError('criterion review requires distinct Run evidence ids');
  }
  const task = getTask(db, taskId);
  if (!task) throw new TypeError('Task not found');
  const criterion = task.acceptance_criteria.find((item) => item.id === criterionId);
  if (!criterion) throw new TypeError('acceptance criterion not found');
  const work = getWork(db, workId);
  if (!work || work.task_id !== taskId || work.project_id !== task.project_id || work.status !== 'ended') {
    throw new TypeError('review Run must be an ended Run of this Task');
  }
  if (verdict === 'pass' && work.outcome !== 'complete') {
    throw new TypeError('a PASS review requires a successful Run outcome');
  }
  const bundle = contextBundleFor(db, workId)?.bundle;
  const contextCriterion = bundle?.items?.find((item) =>
    item.source_ref === `task:${taskId}:acceptance:${criterionId}`);
  const criterionDigest = createHash('sha256').update(criterion.text, 'utf8').digest('hex');
  const specDigest = taskSpecDigest(task);
  if (!bundle || bundle.task_spec_digest !== specDigest || !contextCriterion ||
      contextCriterion.content_digest !== criterionDigest) {
    throw new TypeError('Run Context does not contain this current acceptance criterion');
  }
  const evidence = runEvidenceFor(db, workId);
  const selectedEvidence = evidence.filter((item) => evidenceIds.includes(item.id));
  if (selectedEvidence.length !== evidenceIds.length) {
    throw new TypeError('criterion review evidence must belong to the selected Run');
  }
  if (verdict === 'pass' && selectedEvidence.some((item) => item.kind === 'test_command' &&
      (item.details.result_state !== 'returned' || item.details.exit_code !== 0 ||
       !Number.isInteger(item.details.tests_passed_count) || item.details.tests_passed_count < 1))) {
    throw new TypeError('test evidence for PASS must show a returned command with exit code 0 and at least one passing test');
  }
  if (verdict === 'pass' && selectedEvidence.some((item) => item.kind === 'changed_files' &&
      item.details.known !== true)) {
    throw new TypeError('changed-file evidence for PASS must be measured');
  }
  if (verdict === 'pass') {
    const requiredScopes = testScopesForCriterion(criterion.text);
    if (requiredScopes.includes('unsupported-check')) {
      const error = new TypeError('This acceptance criterion requires a static-check evidence source that JuQode does not capture yet.');
      error.code = 'unsupported-verification';
      throw error;
    }
    for (const scope of requiredScopes) {
      const scoped = evidence.filter((item) => item.kind === 'test_command' && testCommandMatchesScope(scope, item));
      const latestTest = scoped.at(-1);
      if (!latestTest || !evidenceIds.includes(latestTest.id) ||
          latestTest.details.result_state !== 'returned' || latestTest.details.exit_code !== 0 ||
          !Number.isInteger(latestTest.details.tests_passed_count) || latestTest.details.tests_passed_count < 1) {
        throw new TypeError('this criterion requires its latest scoped test command(s) to return with exit code 0');
      }
    }
  }
  const at = now();
  db.exec('begin');
  try {
    db.prepare(`insert into task_criterion_review
      (id, task_id, work_id, criterion_id, criterion_digest, task_spec_digest, verdict, evidence_ids, reviewed_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), taskId, workId, criterionId, criterionDigest, specDigest, verdict, JSON.stringify(evidenceIds), at);
    const next = currentTaskVerdict(db, task, workId, criterionId, criterionDigest, specDigest, verdict);
    db.prepare('update task set verdict = ?, status = ?, updated_at = ? where id = ?')
      .run(next.verdict, next.status, at, taskId);
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
  return { task: getTask(db, taskId), reviews: taskCriterionReviewsFor(db, taskId) };
}

/** Make this folder the project context. Idempotent: the same path is one row forever. */
function openProject(db, absPath, name) {
  const at = now();
  /* One statement, so there is no window between "is it there?" and "write it". `path` is the
   * natural key (schema.sql), and `first_opened_at` is never touched again — the conflict
   * branch updates only what a reopen actually changes. */
  db.prepare(`insert into project (id, path, name, first_opened_at, last_opened_at)
              values (?, ?, ?, ?, ?)
              on conflict(path) do update set last_opened_at = excluded.last_opened_at,
                                              name = excluded.name`)
    .run(randomUUID(), absPath, name, at, at);
  return db.prepare('select * from project where path = ?').get(absPath);
}

/** SC-01 recent list (A-8 — Founder-pending, and SC-01 is complete without it). */
/**
 * `15` SC-01 · UF-RETURN: each recent row carries its LAST Work — the intent as the user typed
 * it, and the outcome.
 *
 * A left join to the newest `work` per project, and nothing more: a row whose project has never
 * had a Work carries `null`, which the screen renders as nothing rather than as an empty
 * summary. `20` orders Works by `started_at`, so "last" means last STARTED — a Work that is
 * still running is the last one, which is exactly what a returning user needs to see.
 */
function recentProjects(db, limit = 8) {
  return db.prepare(`
    select p.*,
           w.intent  as last_work_intent,
           w.status  as last_work_status,
           w.outcome as last_work_outcome
      from project p
      left join work w
        on w.id = (select id from work where project_id = p.id
                    order by started_at desc, rowid desc limit 1)
     order by p.last_opened_at desc
     limit ?`).all(limit);
}

/* ── WBS-03 · interpretation ──────────────────────────────────────────────────────
 * `interpretation_one_current` is a partial unique index (`unique … where is_current`), so
 * the old row must stop being current in the SAME transaction that inserts the new one —
 * otherwise the engine refuses the insert, which is the index doing its job.
 *
 * `interpretation_answer.text` holds the facts-layer payload as JSON, not a sentence. `20`
 * assumed the answer would be prose, but the facts layer produces facts and the Korean is
 * composed at display time so `18` stays the single copy source. Filed as CANON_FINDINGS CF-6.
 */
function saveInterpretation(db, projectId, { status, sourceHash, skippedNote, answers, readFiles }) {
  const id = randomUUID();
  const at = now();
  db.exec('begin');
  try {
    db.prepare('update interpretation set is_current = 0 where project_id = ? and is_current')
      .run(projectId);
    db.prepare(`insert into interpretation (id, project_id, status, source_hash, is_current, skipped_note, created_at, ended_at)
                values (?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(id, projectId, status, sourceHash, skippedNote ?? null, at, at);

    const ans = db.prepare(`insert into interpretation_answer (interpretation_id, q, text, confidence, source_ref)
                            values (?, ?, ?, ?, ?)`);
    for (const a of answers) {
      /* The KIND is always stored, even when there is no data. It is the reason an answer is
       * missing — `no-manifest` is a different sentence from `needs-narrative` — and storing
       * null for a null `data` erased it, so every unanswered row came back reading as the
       * narrative excuse. `saveInterpretation` returns the read-back row, so that was the
       * FIRST render, not just a reload. */
      ans.run(id, a.q, JSON.stringify({ kind: a.kind, data: a.data ?? null }), a.confidence, a.sourceRef);
    }
    const rf = db.prepare('insert into interpretation_read_file (interpretation_id, path) values (?, ?)');
    for (const p of new Set(readFiles)) rf.run(id, p);
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
  return currentInterpretation(db, projectId);
}

function currentInterpretation(db, projectId) {
  const row = db.prepare('select * from interpretation where project_id = ? and is_current').get(projectId);
  if (!row) return null;
  const answers = db.prepare('select q, text, confidence, source_ref from interpretation_answer where interpretation_id = ? order by q')
    .all(row.id)
    .map((a) => ({ q: a.q, confidence: a.confidence, sourceRef: a.source_ref, ...parseAnswer(a.text) }));
  const readFiles = db.prepare('select path from interpretation_read_file where interpretation_id = ? order by path')
    .all(row.id).map((r) => r.path);
  return { ...row, answers, readFiles };
}

function parseAnswer(text) {
  if (!text) return { kind: null, data: null };
  try { const j = JSON.parse(text); return { kind: j.kind ?? null, data: j.data ?? null }; }
  catch { return { kind: null, data: null }; }
}

/* ── WBS-07 · single active Work guard (D-117) ────────────────────────────────────
 * The rule is the engine's: `work_one_active_per_project` is a partial unique index. This
 * function's only job is to turn the engine's refusal into a GUARD — a state the screen can
 * render — instead of an exception. `15` SC-02: the submitted text is kept, never queued.
 */
const ACTIVE = "status <> 'ended'";

const activeWork = (db, projectId) =>
  db.prepare(`select * from work where project_id = ? and ${ACTIVE}`).get(projectId) ?? null;

function beginWork(db, projectId, intent, {
  taskId = null, status = 'running', idempotencyKey = null, attempt = 1, retryOfWorkId = null,
  retryReason = null, appSessionId = null,
} = {}) {
  if (!['running', 'starting'].includes(status)) return { ok: false, reason: 'bad-run-state' };
  if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim())) {
    return { ok: false, reason: 'bad-idempotency-key' };
  }
  if (!Number.isInteger(attempt) || attempt < 1) return { ok: false, reason: 'bad-attempt' };
  if (retryOfWorkId != null) {
    const prior = db.prepare('select task_id, project_id, status, attempt from work where id = ?').get(retryOfWorkId);
    if (!prior || prior.project_id !== projectId || prior.task_id !== taskId || prior.status !== 'ended') {
      return { ok: false, reason: 'bad-retry-source' };
    }
    const successor = workForRetrySource(db, retryOfWorkId);
    if (successor) return { ok: true, existing: true, work: successor, retryReplay: true };
    if (attempt !== (prior.attempt ?? 1) + 1) return { ok: false, reason: 'bad-attempt-sequence' };
    if (typeof retryReason !== 'string' || !retryReason.trim()) return { ok: false, reason: 'retry-reason-required' };
    retryReason = retryReason.trim();
  } else if (retryReason != null) {
    return { ok: false, reason: 'retry-source-required' };
  }
  if (idempotencyKey) {
    const existing = workForIdempotency(db, projectId, idempotencyKey);
    if (existing) return existing.task_id === taskId
      ? { ok: true, existing: true, work: existing }
      : { ok: false, reason: 'idempotency-key-conflict' };
  }
  const persistedIdempotencyKey = taskId && idempotencyKey
    ? `sha256:${createHash('sha256').update(idempotencyKey, 'utf8').digest('hex')}`
    : idempotencyKey;
  const taskRefusal = taskRunRefusal(db, projectId, taskId, { retryOfWorkId });
  if (taskRefusal) return { ok: false, reason: taskRefusal };
  const at = now();
  const id = randomUUID();
  try {
    db.exec('begin');
    db.prepare(`insert into work
      (id, project_id, task_id, intent, status, requested_at, started_at,
       idempotency_key, attempt, retry_of_work_id, retry_reason, agent_code, app_session_id)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, projectId, taskId, intent, status, at, at, persistedIdempotencyKey, attempt, retryOfWorkId,
        retryReason, taskId ? 'claude_code' : null, appSessionId);
    if (taskId) db.prepare("update task set status = 'in_progress', verdict = 'unverified', updated_at = ? where id = ?")
      .run(at, taskId);
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    /* An active Work EXISTING is not evidence that it is what refused this insert — a NOT NULL
     * violation on `intent` would also land here and used to be reported as the D-117 guard.
     * The error has to name the uniqueness the guard index creates, AND the blocking row has
     * to be readable, before this is called a guard. */
    const wasGuard = /UNIQUE constraint failed: work\.project_id/.test(String(e?.message ?? ''));
    const active = wasGuard ? activeWork(db, projectId) : null;
    if (active) return { ok: false, reason: 'active-work', active };
    if (/UNIQUE constraint failed: work\.retry_of_work_id/.test(String(e?.message ?? '')) && retryOfWorkId) {
      const successor = workForRetrySource(db, retryOfWorkId);
      if (successor) return { ok: true, existing: true, work: successor, retryReplay: true };
    }
    throw e;                                    // a different constraint — do not dress it up
  }
  return { ok: true, work: db.prepare('select * from work where id = ?').get(id) };
}

const workForIdempotency = (db, projectId, key) => {
  const hashed = `sha256:${createHash('sha256').update(String(key), 'utf8').digest('hex')}`;
  return db.prepare('select * from work where project_id = ? and idempotency_key in (?, ?) limit 1')
    .get(projectId, key, hashed) ?? null;
};

const workForRetrySource = (db, priorWorkId) => db.prepare(
  'select * from work where retry_of_work_id = ?'
).get(priorWorkId) ?? null;

function setRunnerIdentity(db, workId, sessionId, pid, startedAt = now()) {
  db.prepare(`update work set runner_session_id = ?, runner_pid = ?, runner_started_at = ? where id = ?`)
    .run(sessionId, Number.isInteger(pid) ? pid : null, startedAt, workId);
  return getWork(db, workId);
}

function setRunFailureReason(db, workId, reason) {
  db.prepare('update work set failure_reason = ? where id = ?').run(reason, workId);
  return getWork(db, workId);
}

/* ── WBS-10 · the observed stream, persisted before anything interprets it ──────────
 * `20`: every raw event is a `work_signal`. That is what `기술 출력 보기` reads, and it is why
 * a stream shape we do not understand still leaves a record.
 */
function addSignal(db, workId, { seq, source = 'claude', kind, payload, observedAt }) {
  db.prepare(`insert into work_signal (id, work_id, seq, source, kind, payload, observed_at)
              values (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), workId, seq, source, kind,
         payload == null ? null : (typeof payload === 'string' ? payload : JSON.stringify(payload)),
         observedAt ?? now());
}

const signalsFor = (db, workId, limit = 500) =>
  db.prepare('select * from work_signal where work_id = ? order by seq limit ?').all(workId, limit);

function hasStoppedProcessAcknowledgement(db, workId) {
  const rows = db.prepare(`select payload from work_signal where work_id = ? and source = 'user' and kind = 'raw'`)
    .all(workId);
  return rows.some((row) => {
    try {
      const process = JSON.parse(row.payload ?? '')?.juqodeProcess;
      return process?.stoppedConfirmedByUser === true && process?.workId === workId;
    } catch { return false; }
  });
}

function acknowledgeUnknownProcessStopped(db, projectId, workId) {
  const work = db.prepare(`select id, project_id, task_id, status, outcome from work where id = ?`).get(workId);
  if (!work || work.project_id !== projectId || work.status !== 'ended' || work.outcome !== 'ended_unknown') {
    return { ok: false, reason: 'not-unknown-work' };
  }
  if (hasStoppedProcessAcknowledgement(db, workId)) return { ok: true, existing: true };
  addSignal(db, workId, { seq: nextSeq(db, workId), source: 'user', kind: 'raw',
    payload: { juqodeProcess: { workId, stoppedConfirmedByUser: true } } });
  return { ok: true, existing: false };
}

/**
 * How many `tool_result` blocks one persisted signal carries.
 *
 * TWO SHAPES, and this is the whole reason the function exists rather than one `?.all`:
 * the supervisor persists the RAW CLI LINE (`payload: line`), so the blocks are in
 * `message.content[]`; the reducer's own signal payload carries them in `all`. A version of
 * this that read only `all` counted every raw row as one — which is the bug it was written to
 * fix, still present, and the e2e's cross-check against the app's own signals is what caught it.
 *
 * A row nobody can parse is ONE observed block, not zero: we saw a tool_result signal.
 */
function blocksIn(payload) {
  let p = null;
  try { p = JSON.parse(payload ?? 'null'); } catch { return 1; }
  if (Array.isArray(p?.message?.content)) {
    const n = p.message.content.filter((b) => b?.type === 'tool_result').length;
    return n || 1;
  }
  return Array.isArray(p?.all) && p.all.length ? p.all.length : 1;
}

/**
 * How many `tool_result` BLOCKS this Work produced, over its whole history.
 *
 * Not `signalsFor(...).filter(...)`: that read is capped at 500 rows, and one signal can carry
 * several blocks (parallel tool calls — see the reducer's `payload.all`). WBS-18 puts this
 * number on the screen with a 확인됨 chip, so it has to be the real one.
 */
function countToolResults(db, workId) {
  const rows = db.prepare("select payload from work_signal where work_id = ? and kind = 'tool_result'")
    .all(workId);
  let n = 0;
  for (const r of rows) {
    n += blocksIn(r.payload);
  }
  return n;
}

const nextSeq = (db, workId) =>
  (db.prepare('select max(seq) m from work_signal where work_id = ?').get(workId).m ?? -1) + 1;

/** `20`: outcome and ended_at are set together with status='ended', or not at all. */
function setWorkState(db, workId, { status, outcome = null }) {
  if (status === 'ended') {
    db.prepare("update work set status = 'ended', outcome = ?, ended_at = ? where id = ?")
      .run(outcome ?? 'ended_unknown', now(), workId);
  } else {
    /* `20`'s check is `(status='ended') = (outcome is not null)`, so a non-ended status and an
     * outcome cannot coexist. Writing the status alone left the pair contradictory and the
     * engine rejected it — which is the check doing its job, and the write being wrong. */
    db.prepare('update work set status = ?, outcome = null, ended_at = null where id = ?').run(status, workId);
  }
  return db.prepare('select * from work where id = ?').get(workId);
}

const getWork = (db, id) => db.prepare('select * from work where id = ?').get(id) ?? null;

/**
 * `15` History: past Works NEWEST FIRST. `started_at` is an ISO string at millisecond
 * resolution, so two Works begun in the same millisecond tie — and a tie leaves SQLite free to
 * return them in any order, which made History's order and SC-02's orientation sentence
 * (`orientationOf` reads `works[0]`) both non-deterministic. `rowid` is the insertion order and
 * breaks the tie the same way every time.
 */
const worksFor = (db, projectId, limit = 20) =>
  db.prepare('select * from work where project_id = ? order by started_at desc, rowid desc limit ?')
    .all(projectId, limit);

const worksForTask = (db, taskId, limit = 50) =>
  db.prepare('select * from work where task_id = ? order by started_at desc, rowid desc limit ?')
    .all(taskId, limit);

/* ── WBS-08 · the basis a Work's diffs are computed against (D-121) ── */
function saveBasis(db, workId, phase, { kind, ref, excluded, files }) {
  const manifestJson = kind === 'hash_manifest' && Array.isArray(files) ? JSON.stringify(files) : null;
  if (manifestJson && Buffer.byteLength(manifestJson, 'utf8') > 16 * 1024 * 1024) {
    throw Object.assign(new Error('manifest snapshot is too large to persist'), { code: 'manifest-too-large' });
  }
  db.prepare(`insert into evidence_basis (id, work_id, phase, kind, ref, excluded, created_at, manifest_json)
              values (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), workId, phase, kind, ref,
         excluded && excluded.length ? JSON.stringify(excluded) : null, now(), manifestJson);
  /* A git basis IS its tree object, so the ref alone is enough to compare it later. A manifest
   * stores only paths, sizes, and hashes in migration 14's `manifest_json`; source contents are
   * never copied here. The in-process map remains a compatibility fallback for old rows that
   * predate the durable column. */
  if (kind === 'hash_manifest' && files) manifests.set(`${workId}:${phase}`, files);
}

/* Compatibility cache for old manifest bases that have no `manifest_json` snapshot. */
const manifests = new Map();

const basisFor = (db, workId, phase) => {
  const row = db.prepare('select * from evidence_basis where work_id = ? and phase = ?').get(workId, phase);
  if (!row) return null;
  const files = manifests.get(`${workId}:${phase}`);
  if (files) return { ...row, files: JSON.stringify(files) };
  if (typeof row.manifest_json === 'string') return { ...row, files: row.manifest_json };
  return row;
};

/* ── WBS-27 · the diff, and the units it was split into ────────────────────────────
 * `raw_diff` is the patch as the app generated it, at the fixed `-U3` D-127 requires.
 *
 * The BLOCKS are computed but not stored yet: `20` makes `code_block.change_group_id` NOT NULL,
 * so a block cannot exist without a change group — and groups are WBS-26. `21` gives WBS-27
 * `Deps: 17`, which does not say that. Filed as CANON_FINDINGS CF-10; until WBS-26 lands the
 * blocks are derived on demand from the stored patch, which is deterministic and costs nothing.
 */
const HEAD_LIMIT = 256 * 1024;              // `20`: the bounded head that goes on screen, in BYTES

/**
 * D-129 · the head goes on screen, the WHOLE patch goes to a blob file. Writing only the head
 * and the word `truncated` destroyed the tail: the raw view Canon promises for a large change
 * had nothing to fall back to, and the change could never be read in full again.
 *
 * @param {string|null} blobDir the JuQode-owned evidence store; without one the tail is lost
 *   and `unified_ref` says so rather than pretending a reference exists.
 */
function saveDiff(db, workId, { file, patch, displayable = true }, blobDir = null) {
  const over = Buffer.byteLength(patch, 'utf8') > HEAD_LIMIT;
  /* BYTES on both sides. `over` was measured in bytes and the cut was made in UTF-16 code
   * units, so a 600 KB Korean patch stored 600 KB — 2.3x the declared bound — and SC-04 then
   * showed "앞부분만 실었어요" over a patch that was in fact complete. The cut is made on the
   * buffer and decoded back, dropping the partial character at the boundary rather than
   * emitting a replacement one. */
  const head = over
    ? Buffer.from(patch, 'utf8').subarray(0, HEAD_LIMIT).toString('utf8').replace(/\uFFFD$/, '')
    : patch;
  let ref = null;
  if (over) {
    ref = 'truncated';
    if (blobDir) {
      try {
        const dir = path.join(blobDir, 'diffs');
        fs.mkdirSync(dir, { recursive: true });
        const name = `${createHash('sha256').update(patch).digest('hex')}.patch`;
        fs.writeFileSync(path.join(dir, name), patch);
        ref = `diffs/${name}`;
      } catch { /* the head is still true; `truncated` stays the honest answer */ }
    }
  }
  db.prepare(`insert into raw_diff (id, work_id, file, displayable, unified_head, unified_ref, before_hash, after_hash)
              values (?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(work_id, file) do update set displayable = excluded.displayable,
                                                       unified_head = excluded.unified_head,
                                                       unified_ref  = excluded.unified_ref`)
    .run(randomUUID(), workId, file, displayable ? 1 : 0, head, ref, null, null);
}

/**
 * Drop the rows for files this Work no longer changes.
 *
 * `saveDiffs` only ever upserted, so a retry that reverted a file left its old row behind for
 * good: SC-04 showed a change that no longer exists, and disagreed with `changes()`, which
 * reads git. The stored diffs are a snapshot of one answer, not an accumulation of every answer.
 */
function pruneDiffs(db, workId, keepFiles, blobDir = null) {
  const keep = new Set(keepFiles);
  const stale = db.prepare('select id, file, unified_ref from raw_diff where work_id = ?').all(workId)
    .filter((d) => !keep.has(d.file));
  if (!stale.length) return [];
  const del = db.prepare('delete from raw_diff where id = ?');
  for (const d of stale) del.run(d.id);

  /* …and the blob the row pointed at.
   *
   * MEASURED: the `unified_ref` column was already being SELECTed here and then never used, so
   * every retry that reverted a large file left its `diffs/<sha256>.patch` behind for good —
   * unreachable, because the only row naming it had just been deleted. The store grew with one
   * orphan per pruned large diff and nothing could ever find them again.
   *
   * The name is the sha256 of the CONTENT, so two rows can legitimately name the same blob;
   * a file still referenced by a surviving row is left alone. `truncated` is a sentinel, not a
   * path — it means the blob was never written. */
  if (!blobDir) return stale.map((d) => d.file);
  const live = new Set(
    db.prepare('select unified_ref from raw_diff where unified_ref is not null').all()
      .map((r) => r.unified_ref)
  );
  for (const d of stale) {
    const ref = d.unified_ref;
    if (!ref || ref === 'truncated' || live.has(ref)) continue;
    /* The ref is ours: it was composed here as `diffs/<hex>.patch`. Anything else is not a
     * path this function wrote and is not a path this function deletes. */
    if (!/^diffs\/[0-9a-f]{64}\.patch$/.test(ref)) continue;
    try { fs.rmSync(path.join(blobDir, ref), { force: true }); } catch { /* already gone */ }
  }
  return stale.map((d) => d.file);
}

const diffsFor = (db, workId) =>
  db.prepare('select * from raw_diff where work_id = ? order by file').all(workId).map((d) => ({
    /* The row id, because `change_group_file` is a FK to it — a group cites a diff row, not a
     * path, so nothing downstream has to trust a filename it was handed. */
    id: d.id,
    file: d.file,
    displayable: Boolean(d.displayable),
    patch: d.unified_head ?? '',
    truncated: d.unified_ref != null,
    /* The blob holding the whole patch, relative to the evidence store — null when it was not
     * written, which is a different fact from "not truncated". */
    ref: d.unified_ref && d.unified_ref !== 'truncated' ? d.unified_ref : null,
  }));

/* ── WBS-18 · the result, and what each part of it is worth (D-114) ────────────────
 * Claims and items carry a structured payload, not a sentence, for the same reason the Brief's
 * answers do: the Korean is composed in the renderer so `18` stays the single copy source.
 * See CANON_FINDINGS CF-6.
 */
function saveResult(db, workId, result) {
  db.exec('begin');
  try {
    db.prepare('delete from work_result where work_id = ?').run(workId);
    db.prepare('insert into work_result (work_id, summary, what_failed, created_at) values (?, ?, ?, ?)')
      .run(workId, result.summary ?? '', result.whatFailed ? JSON.stringify(result.whatFailed) : null, now());

    const claim = db.prepare('insert into result_claim (id, work_id, ord, text, confidence) values (?, ?, ?, ?, ?)');
    result.claims.forEach((c, i) => claim.run(randomUUID(), workId, i,
      JSON.stringify({ kind: c.kind, data: c.data ?? null, sourceRef: c.sourceRef ?? null }), c.confidence));

    const item = db.prepare('insert into result_item (id, work_id, kind, ord, text) values (?, ?, ?, ?, ?)');
    const seen = { done: 0, not_done: 0 };
    for (const it of result.items) {
      /* `confidence` too: `20` has no column for it on an item, so it rides in `text` with the
       * data. Dropping it on write made every item come back unmarked, and `18` §0.9 says the
       * mark is what the reader checks — an unmarked item reads as a bare assertion. */
      item.run(randomUUID(), workId, it.kind, seen[it.kind]++,
               JSON.stringify({ data: it.data ?? null, confidence: it.confidence ?? null }));
    }
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
  return resultFor(db, workId);
}

function resultFor(db, workId) {
  const row = db.prepare('select * from work_result where work_id = ?').get(workId);
  if (!row) return null;
  const parse = (t) => { try { return JSON.parse(t); } catch { return {}; } };
  /* The outcome lives on `work`, not on `work_result` — but `verify()`'s both-lists rule reads
   * `result.outcome`, so a result read back from the DB was checked against `undefined` and
   * the rule never ran on a persisted result at all. */
  const work = db.prepare('select outcome from work where id = ?').get(workId);
  return {
    outcome: work?.outcome ?? null,
    summary: row.summary || null,
    whatFailed: row.what_failed ? parse(row.what_failed) : null,
    claims: db.prepare('select * from result_claim where work_id = ? order by ord').all(workId)
      .map((c) => ({ confidence: c.confidence, ...parse(c.text) })),
    items: db.prepare("select * from result_item where work_id = ? order by kind, ord").all(workId)
      .map((i) => ({ kind: i.kind, ...parse(i.text) })),   // confidence comes back out of `text`
  };
}

/* ── WBS-26 · Change Groups — the explanation layer's only writer ────────────────
 * `20` gives a raw_diff exactly one owning group (D-121: `code_block.raw_diff_id` is
 * `on delete restrict`). The write is one transaction and it REPLACES: re-running the
 * explanation pass must not leave a file owned by two groups.
 */
function saveChangeGroups(db, workId, groups) {
  db.exec('begin');
  try {
    /* `change_group_file` cascades from the group, so deleting the groups clears the links. */
    db.prepare('delete from change_group where work_id = ?').run(workId);
    const g = db.prepare(`insert into change_group (id, work_id, ord, title, what, why, affects, confidence, source_ref, explainable)
                          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const link = db.prepare('insert into change_group_file (change_group_id, raw_diff_id) values (?, ?)');
    /* `change_group_file` 의 두 외래키는 각각 독립이다 — 둘이 같은 Work 에 속하는지 DB 가
     * 보지 않으므로, 작업 A 의 그룹에 작업 B 의 diff 를 이을 수 있다. 정식 해법은
     * (id, work_id) UNIQUE + 복합 외래키이고 `schema.sql` 은 Canon 축자 사본이라 판정
     * 대상이다. 그때까지 저장 계층이 같은 모양을 거부한다 — 마이그레이션 2가 CHECK 를
     * 붙일 수 없어 택한 것과 같은 방법이다.
     *
     * 버리고 지나간다, 던지지 않는다: `files` 는 모델 출력에서 온 id 목록이고, 그중 하나가
     * 이 Work 의 것이 아니라고 해서 나머지 설명까지 잃을 이유가 없다. D-114 의 근거 없는
     * 확인됨을 거부하지 않고 예상됨으로 내리는 것과 같은 판단이다. */
    const mine = new Set(
      db.prepare('select id from raw_diff where work_id = ?').all(workId).map((r) => r.id)
    );
    groups.forEach((grp, i) => {
      const id = randomUUID();
      /* D-114, enforced where the CHECK cannot be: a 확인됨 group must name its evidence. It is
       * DOWNGRADED rather than refused — the rest of what the pass said is still worth keeping,
       * and 예상됨 is what an unsourced claim always was. */
      const sourced = grp.confidence === 'confirmed' && !grp.sourceRef ? 'expected' : grp.confidence;
      g.run(id, workId, i, grp.title, grp.what ?? null, grp.why ?? null, grp.affects ?? null,
            sourced ?? null, grp.sourceRef ?? null, grp.explainable === false ? 0 : 1);
      for (const rawDiffId of grp.files ?? []) { if (mine.has(rawDiffId)) link.run(id, rawDiffId); }
    });
    db.exec('commit');
  } catch (e) {
    try { db.exec('rollback'); } catch { /* already rolled back */ }
    throw e;
  }
  return changeGroupsFor(db, workId);
}

const changeGroupsFor = (db, workId) =>
  db.prepare('select * from change_group where work_id = ? order by ord').all(workId).map((g) => ({
    id: g.id, ord: g.ord, title: g.title, what: g.what, why: g.why, affects: g.affects,
    confidence: g.confidence,
    sourceRef: g.source_ref,
    explainable: Boolean(g.explainable),
    files: db.prepare(`select r.file from change_group_file f join raw_diff r on r.id = f.raw_diff_id
                       where f.change_group_id = ? order by r.file`).all(g.id).map((r) => r.file),
  }));

/* ── WBS-22 · Quick Command runs ──────────────────────────────────────────────────
 * `20` F-12: a Quick Command that was only EXPLAINED does not become a row — the same rule a
 * Work that never started obeys. 미인식 and 지금 안 됨 are cards, not history. A row exists
 * exactly when something was actually spawned.
 */
function beginQcRun(db, projectId, { phrase, ruleId, command, status, startedAt }) {
  const id = randomUUID();
  db.prepare(`insert into quick_command_run
                (id, project_id, phrase, rule_id, command, status, started_at, created_at)
              values (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, projectId, phrase, ruleId, command, status, startedAt ?? now(), now());
  return id;
}

/**
 * The run, once it ended. `19` §C4: 종료 코드·stderr 숨기지 않음 — the code is written as the
 * code, including when it is null because the program never started.
 */
function endQcRun(db, id, { status, exitCode = null, outputHead = null, outputRef = null,
                            endedAt = null, stoppedAt = null }) {
  db.prepare(`update quick_command_run
                 set status = ?, exit_code = ?, output_head = ?, output_ref = ?,
                     ended_at = ?, stopped_at = ?
               where id = ?`)
    .run(status, exitCode, outputHead, outputRef, endedAt ?? now(), stoppedAt, id);
}

const qcRunsFor = (db, projectId, limit = 20) =>
  db.prepare(`select * from quick_command_run where project_id = ?
              order by created_at desc, rowid desc limit ?`).all(projectId, limit);

const qcRun = (db, id) => db.prepare('select * from quick_command_run where id = ?').get(id) ?? null;

/** The one still going, if any. `19` §C4: only a server JuQode itself started can be stopped. */
const qcRunning = (db, projectId) =>
  db.prepare(`select * from quick_command_run
              where project_id = ? and status in ('running','long_running')
              order by created_at desc, rowid desc limit 1`).get(projectId) ?? null;

/**
 * WBS-34 · a run whose process is gone. `20` says it plainly: it becomes `unknown`, and the
 * exit code STAYS NULL — nobody observed one. Whatever output was captured is kept.
 */
function reconcileQcRuns(db, isAlive = () => false) {
  const stranded = db.prepare("select * from quick_command_run where status in ('running','long_running')").all()
    .filter((r) => !isAlive(r));
  const stmt = db.prepare("update quick_command_run set status = 'unknown', ended_at = ? where id = ?");
  const at = now();
  for (const r of stranded) stmt.run(at, r.id);
  return stranded.map((r) => r.id);
}

/* ── WBS-12 · Steps — only what Claude Code actually declared (D-107) ── */
function upsertStep(db, workId, { ord, title, state }) {
  const at = now();
  const found = db.prepare('select * from step where work_id = ? and ord = ?').get(workId, ord);
  if (found) {
    db.prepare('update step set title = ?, state = ?, updated_at = ? where id = ?').run(title, state, at, found.id);
    return;
  }
  db.prepare(`insert into step (id, work_id, ord, title, state, declared_at, updated_at)
              values (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), workId, ord, title, state, at, at);
}

const stepsFor = (db, workId) =>
  db.prepare('select * from step where work_id = ? order by ord').all(workId);

/** `20` D-124 startup reconciliation: a Work whose process is gone cannot be judged. */
/**
 * D-124: a Work whose process is GONE is closed as 확인 불가. The caller supplies the liveness
 * test; the default assumes nothing is alive, which is only safe when the caller has already
 * established that. A JuQode child is spawned detached and CAN outlive its parent — measured —
 * so "nothing this process started survived it" is not a fact anyone may assume.
 *
 * `07` §8.5: a pid is reusable, so identity is `{pid, startedAt}` and both are compared.
 */
function processFor(db, workId) {
  const row = db.prepare('select runner_pid, runner_started_at, runner_session_id from work where id = ?').get(workId);
  for (const s of db.prepare("select payload from work_signal where work_id = ? and source = 'juqode' order by seq").all(workId)) {
    try {
      const p = JSON.parse(s.payload ?? '')?.juqodeProcess;
      if (p?.pid) return { pid: p.pid, startedAt: p.startedAt ?? row?.runner_started_at ?? null,
        sessionId: row?.runner_session_id ?? null };
    } catch { /* not the process marker */ }
  }
  return row?.runner_pid ? { pid: row.runner_pid, startedAt: row.runner_started_at ?? null,
    sessionId: row.runner_session_id ?? null } : null;
}

function reconcileLostWorks(db, isAlive = () => false) {
  const stranded = db.prepare("select * from work where status <> 'ended'").all()
    /* A Task Run belongs to the app process that opened its Claude stream. That stream cannot
     * be reattached after a restart, even if the PID still answers; an uncertain old process is
     * therefore ended_unknown. Legacy Work retains the pre-existing process-liveness behavior. */
    .filter((w) => w.task_id != null || !isAlive(w, processFor(db, w.id)));
  for (const w of stranded) {
    setWorkState(db, w.id, { status: 'ended', outcome: 'ended_unknown' });
    if (w.task_id) setRunFailureReason(db, w.id, 'app-restarted-before-run-completion');
    addSignal(db, w.id, { seq: nextSeq(db, w.id), source: 'juqode', kind: 'reconciled', payload: 'ended_unknown' });
    db.prepare("update step set state = 'not_executed', updated_at = ? where work_id = ? and state in ('running','declared_next')")
      .run(now(), w.id);
  }
  return stranded.map((w) => w.id);
}

/**
 * WBS-34 · an interpretation the app was in the middle of when it died.
 *
 * `20` says it plainly: an interpretation still `interpreting` whose process is gone becomes
 * `failed`, `ended_at = now()`. It does NOT become `interpreted` with invented answers, and it
 * does not stay `interpreting` forever — a Brief that says 읽는 중 about a read that stopped
 * days ago is the same lie as a Work stuck at 진행 중.
 *
 * The six answers are left exactly as they were. Whatever was confirmed before the app died is
 * still confirmed; what was not is still 확인 못함. Nothing is filled in.
 *
 * The whole app runs in one process, so a row in this state means THAT process is gone — there
 * is no handle to ask about, unlike a Work, which owns a child.
 */
function reconcileInterpretations(db) {
  const stranded = db.prepare("select id from interpretation where status = 'interpreting'").all();
  if (!stranded.length) return [];
  const at = now();
  const stmt = db.prepare("update interpretation set status = 'failed', ended_at = ? where id = ?");
  for (const r of stranded) stmt.run(at, r.id);
  return stranded.map((r) => r.id);
}

module.exports = {
  startAppSession, endAppSession,
  openProject, recentProjects,
  createTask, getTask, tasksForProject, updateTask, taskRunRefusal,
  saveRunContextBundle, contextBundleFor, saveRunEvidence, runEvidenceFor,
  taskCriterionReviewsFor, reviewTaskCriterion, runMatchesTaskSpec,
  saveInterpretation, currentInterpretation,
  activeWork, beginWork, getWork, worksFor, worksForTask, workForIdempotency, workForRetrySource,
  setRunnerIdentity, setRunFailureReason, setWorkState,
  addSignal, signalsFor, countToolResults, nextSeq, hasStoppedProcessAcknowledgement,
  acknowledgeUnknownProcessStopped,
  saveBasis, basisFor,
  upsertStep, stepsFor,
  saveResult, resultFor,
  saveDiff, diffsFor, pruneDiffs,
  beginQcRun, endQcRun, qcRunsFor, qcRun, qcRunning, reconcileQcRuns,
  saveChangeGroups, changeGroupsFor,
  reconcileLostWorks, reconcileInterpretations, processFor,
};
