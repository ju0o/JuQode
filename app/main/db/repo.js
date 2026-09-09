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

module.exports = { openProject, recentProjects };
