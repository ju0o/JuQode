# DG-06 — Task ↔ Work/Run QA

Date: 2026-10-05
Status: PASS for Task linkage and migration-5 schema
Repo: JuQode on `dev/mvp-autonomous-v01`
Boundary: JuQode only. Dios and the active userData database were not modified.

## Migration result

- Migration 5 adds nullable `work.task_id`, `app_session`, and `runner_session_id`, `runner_pid`, `runner_started_at` to Work and Quick Command rows.
- Existing Work and Quick Command data survives. Legacy Work rows stay taskless; no Task is fabricated.
- The optional `taskId` passed through `workStart` is checked against the selected Project, Task status, and dependency verdict before the Claude path begins.
- `beginWork` repeats the Task check at insertion, and the existing unique active-Work-per-Project index remains authoritative.
- Read-only recheck of `/home/skkse12/.config/juqode/juqode.db`: ledger `[1,2]`, highest 2, only `work` among `task`/`app_session`/`work`; this builder run did not open the app against or migrate that database.

## Fresh verification

| Command | Result |
|---|---|
| `npm run test:unit` | PASS, exit 0; 609/609; TAP 20.658s; ERD 50 tables / 50 relations / MVP 28 |
| `node --test tests/task.test.js tests/store.test.js tests/loop.test.js` | PASS, 103/103 |
| `node --test tests/explain.test.js` | PASS, 43/43 |
| `npm run test:e2e` | PASS: boot, visual/behavior, offline/reduced-motion/shutdown; CDP 9225–9227; golden unchanged; external requests 0; 6 app processes while running → 0 after shutdown |
| `git diff --check` | PASS at final checkpoint |

## Adversarial and migration evidence

- A synthetic v3 database upgrades through v5, preserves its running Work unchanged, leaves it unlinked, and does not create a Task.
- A synthetic v4 database with Work and Quick Command rows upgrades through v5 with nullable fields; its existing values remain unchanged.
- Task-linked Work rows are queryable by Task. A second active Work in the same Project is refused by the pre-existing safety guard.
- Cross-Project, missing, and malformed Task IDs are refused at IPC; refusal creates no Work row.
- The existing Claude supervisor path was exercised with the repository's disposable CLI fixture and carried the selected Task ID into Work history. This is compatibility evidence only; it is not the real-Claude proof required in DG-08.
- The full suite first measured 608/609 because an old test fixture started from a v5 database and removed schema ledger rows while leaving v5 objects behind. The fixture now constructs a true v1 database from `schema.sql`; the fresh full suite is green.

## Remaining boundary

This report is a DG-06 checkpoint snapshot. DG-08 moved Task Run creation before spawn, and DG-13 added restart reconciliation; see [the overnight dogfood ledger](../dogfood/OVERNIGHT-CHECKPOINTS.md) for the current status.
