# DG-05 — Task persistence QA

Date: 2026-10-05
Status: PASS for Task persistence scope
Repo: JuQode on `dev/mvp-autonomous-v01`
Boundary: JuQode only. Dios, JuQode-Private, Git history, GitHub and the active userData DB were not modified.

## Migration-order verification before code changes

- Source `app/main/db/db.js` implemented migrations 2 and 3 only; highest source version was 3.
- Read-only SQLite inspection of the normal Linux app userData DB returned ledger `[1,2]`, highest applied version 2, and no `task` table.
- The process environment had no `JUQODE_DB` or `JUQODE_USER_DATA` override. No JuQode DB file existed under the repository.
- Therefore neither migration 4 nor 5 was implemented or applied in the current local development DB. Founder/PM ruling safely assigns v4=Task, v5=process tracking, v6=future project ownership.
- The active userData DB remained at `[1,2]` after all verification; tests used temporary databases. It will run forward migrations on its next normal app startup.

## Implementation

- Added migration 4 `task` table with project FK, goal, JSON-text dependencies and acceptance criteria, workflow status, independent initial `unverified` verdict, and timestamps.
- Added repository operations `createTask`, `getTask`, `tasksForProject`, and `updateTask`. Dependency references must exist in the same Project, be unique, non-self, and acyclic. Acceptance criteria have stable IDs and nonempty text.
- Before DG-10, the Task API rejects direct verdict writes and `complete` status writes. Task creation never creates Work. Historical Work rows remain unlinked; no synthetic Task is invented.
- Added post-migration required-table validation, so a DB claiming the latest version but missing the `task` table is refused.
- Extended the DBML checker to read the actual `MIGRATIONS` array, then updated local ERD and version planning. `schema.sql`, private SSOT, and Dios were untouched.

## Fresh verification

| Command | Result |
|---|---|
| `npm run test:unit` | PASS, exit 0; 605/605; TAP 20.523s; ERD 50 tables / 50 relations / MVP 27 tables |
| `npm run test:e2e` | PASS, exit 0; boot + visual/behaviour + offline/reduced-motion/shutdown; CDP 9225–9227; no golden updates |
| `git diff --check` | PASS |
| Active userData ledger, read-only after tests | `[1,2]`, highest 2; unchanged |
| Electron process count after E2E teardown | 0 |

Boot measured 3 runs and 1 window each (369/396/406 ms; external requests 0). Offline shutdown ended with 0 processes (6 while the app was running). Screenshots were written only to ignored `tmp-visual`.

## Adversarial and migration evidence

- `tests/task.test.js` rejects empty goals, malformed criteria, unknown/duplicate/self/cyclic dependencies, API attempts to set verdict or `complete`, and a current-version DB missing the migrated Task table.
- A synthetic v3 file was upgraded to v4. Its existing running Work retained the same identifiers, intent, state and timestamps; no Task was fabricated and DG-06 `work.task_id` is absent.
- A disk-backed Task survived close/reopen with acceptance IDs and `unverified` verdict intact.
- An old `explain.test.js` migration fixture was corrected to remove v4 `task` when it deliberately rewinds its synthetic DB to version 1; applied production history is never renumbered.

## Files changed for DG-05

- `app/main/db/db.js`
- `app/main/db/repo.js`
- `docs/design/check-dbml.mjs`
- `docs/design/erd.dbml`
- `docs/design/ERD.md`
- `docs/design/SPEC_RECONCILE.md`
- `docs/design/WBS_REMAINING.md`
- `docs/design/WBS_IMPLEMENTATION.md`
- `docs/design/DBDIAGRAM.md`
- `README.md`
- `tests/task.test.js`
- `tests/store.test.js`
- `tests/explain.test.js`
- `docs/discovery/DOGFOOD-CURRENT-STATE.md`
- `docs/discovery/DOGFOOD-INTEGRATION-PLAN.md`
- `docs/discovery/DOGFOOD-WBS.md`

This report is a DG-05 checkpoint snapshot. DG-06 and later package status is recorded in [the overnight dogfood ledger](../dogfood/OVERNIGHT-CHECKPOINTS.md).
