'use strict';
/* WBS-21 · repositories. One function per thing the product actually does today.
 * `20` / `docs/data/schema.sql` own the shape; nothing here re-declares it. */
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const now = () => new Date().toISOString();

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
function recentProjects(db, limit = 8) {
  return db.prepare('select * from project order by last_opened_at desc limit ?').all(limit);
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

function beginWork(db, projectId, intent) {
  const at = now();
  const id = randomUUID();
  try {
    db.prepare(`insert into work (id, project_id, intent, status, requested_at, started_at)
                values (?, ?, ?, 'running', ?, ?)`).run(id, projectId, intent, at, at);
  } catch (e) {
    /* An active Work EXISTING is not evidence that it is what refused this insert — a NOT NULL
     * violation on `intent` would also land here and used to be reported as the D-117 guard.
     * The error has to name the uniqueness the guard index creates, AND the blocking row has
     * to be readable, before this is called a guard. */
    const wasGuard = /UNIQUE constraint failed: work\.project_id/.test(String(e?.message ?? ''));
    const active = wasGuard ? activeWork(db, projectId) : null;
    if (active) return { ok: false, reason: 'active-work', active };
    throw e;                                    // a different constraint — do not dress it up
  }
  return { ok: true, work: db.prepare('select * from work where id = ?').get(id) };
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

/* ── WBS-08 · the basis a Work's diffs are computed against (D-121) ── */
function saveBasis(db, workId, phase, { kind, ref, excluded, files }) {
  db.prepare(`insert into evidence_basis (id, work_id, phase, kind, ref, excluded, created_at)
              values (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), workId, phase, kind, ref,
         excluded && excluded.length ? JSON.stringify(excluded) : null, now());
  /* A git basis IS its tree object, so the ref alone is enough to compare it later. A manifest
   * basis is only comparable against the list it was made from, and `20` has no column for
   * that list — so it lives in the in-process map below and **does not survive a restart**.
   * A non-Git Work that outlives the app therefore cannot report its change count. Filed as
   * CANON_FINDINGS CF-9; the fix is a column, not more memory. */
  if (kind === 'hash_manifest' && files) manifests.set(`${workId}:${phase}`, files);
}

/* ponytail: in-process only — see the note above. `20` needs a column (CF-9) to fix it. */
const manifests = new Map();

const basisFor = (db, workId, phase) => {
  const row = db.prepare('select * from evidence_basis where work_id = ? and phase = ?').get(workId, phase);
  if (!row) return null;
  const files = manifests.get(`${workId}:${phase}`);
  return files ? { ...row, files: JSON.stringify(files) } : row;
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
function pruneDiffs(db, workId, keepFiles) {
  const keep = new Set(keepFiles);
  const stale = db.prepare('select id, file, unified_ref from raw_diff where work_id = ?').all(workId)
    .filter((d) => !keep.has(d.file));
  if (!stale.length) return [];
  const del = db.prepare('delete from raw_diff where id = ?');
  for (const d of stale) del.run(d.id);
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
    groups.forEach((grp, i) => {
      const id = randomUUID();
      /* D-114, enforced where the CHECK cannot be: a 확인됨 group must name its evidence. It is
       * DOWNGRADED rather than refused — the rest of what the pass said is still worth keeping,
       * and 예상됨 is what an unsourced claim always was. */
      const sourced = grp.confidence === 'confirmed' && !grp.sourceRef ? 'expected' : grp.confidence;
      g.run(id, workId, i, grp.title, grp.what ?? null, grp.why ?? null, grp.affects ?? null,
            sourced ?? null, grp.sourceRef ?? null, grp.explainable === false ? 0 : 1);
      for (const rawDiffId of grp.files ?? []) link.run(id, rawDiffId);
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
  for (const s of db.prepare("select payload from work_signal where work_id = ? and source = 'juqode' order by seq").all(workId)) {
    try {
      const p = JSON.parse(s.payload ?? '')?.juqodeProcess;
      if (p?.pid) return p;
    } catch { /* not the process marker */ }
  }
  return null;
}

function reconcileLostWorks(db, isAlive = () => false) {
  const stranded = db.prepare("select * from work where status <> 'ended'").all()
    .filter((w) => !isAlive(w, processFor(db, w.id)));
  for (const w of stranded) {
    setWorkState(db, w.id, { status: 'ended', outcome: 'ended_unknown' });
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
  openProject, recentProjects,
  saveInterpretation, currentInterpretation,
  activeWork, beginWork, getWork, worksFor, setWorkState,
  addSignal, signalsFor, nextSeq,
  saveBasis, basisFor,
  upsertStep, stepsFor,
  saveResult, resultFor,
  saveDiff, diffsFor, pruneDiffs,
  beginQcRun, endQcRun, qcRunsFor, qcRun, qcRunning, reconcileQcRuns,
  saveChangeGroups, changeGroupsFor,
  reconcileLostWorks, reconcileInterpretations, processFor,
};
