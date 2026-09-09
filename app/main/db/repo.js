'use strict';
/* WBS-21 · repositories. One function per thing the product actually does today.
 * `20` / `docs/data/schema.sql` own the shape; nothing here re-declares it. */
const { randomUUID } = require('node:crypto');

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

module.exports = {
  openProject, recentProjects,
  saveInterpretation, currentInterpretation,
  activeWork, beginWork,
};
