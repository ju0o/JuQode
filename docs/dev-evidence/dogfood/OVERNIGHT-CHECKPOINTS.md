# JuQode Dogfood Overnight Checkpoints

Date: 2026-10-05 (KST)
Repository: JuQode · branch `dev/mvp-autonomous-v01`
Starting HEAD: `0d2762f` (`docs: Phase A R-0 + P0-1 close`)
Scope: local JuQode only. No GitHub operation and no Dios change.

## Resume and migration truth

- Resumed the existing dirty worktree; no changes were discarded or overwritten.
- The normal local DB was read through SQLite `mode=ro`: `schema_version` rows were versions 1 and 2, highest applied version 2. No product DB under this repository was found. The local DB was not opened by the app during verification.
- Source migration 4 was not present before this batch; v4 is Task persistence, v5 is process tracking and Task↔Work linkage, and v6 reserves `project.owner_id`. No applied migration history was renumbered.
- Current source implements migrations through v13. E2E and unit tests use isolated temporary stores.

## Package checkpoints

| WBS | Result | Implementation / evidence | Limit |
|---|---|---|---|
| DG-04 | PASS | `docs/dev-evidence/mvp-run/DG-04-QA.md`; fresh full unit and E2E passes below. Removed the disallowed `openExternal` capability, restored Canon routing for unrecognized requests, removed unused copy, and isolated visual-test ports. | Linux only |
| DG-05 | PASS | Migration 4 Task table; Project FK; CRUD, validation, close/reopen and historical-Work preservation in `tests/task.test.js`. | Normal user DB remains v2 until next normal app launch |
| DG-06 | PASS | Migration 5 nullable Work linkage and process identity; legacy Works stay unattached; active Project Work invariant retained. | Real process tracking is separately extended in DG-13 |
| DG-07 | PASS | Migration 7 immutable ContextBundle; prompt/task digests, safe snapshots and exclusions; `tests/context.test.js`. | Claude still receives cwd-wide filesystem access; selected-file isolation is false |
| DG-08 | PARTIAL | Existing Claude supervisor path reserves a Task Run and Context before spawn; fixture signal stream, Work association, timestamps, result and prompt receipt are tested in `tests/loop.test.js`. | **No real Claude Run:** sanitized JuQode detector returned `logged-out` for installed CLI 2.1.289 |
| DG-09 | PASS | Migration 9 immutable observed change/test evidence; Agent report remains separate; `tests/run-evidence.test.js` and loop tests. | Test evidence records observed command/result; it does not infer a passing suite |
| DG-10 | PASS | Migration 10 append-only criterion reviews; every current criterion requires evidence from one successful Run; no-evidence and 1-of-3-unreviewed counterexamples in `tests/task.test.js`. | Product-level PASS still needs a real Run and criterion review |
| DG-11 | PASS | Project Task selector, selected Task details, acceptance, latest verdict and progressive Run history in SC-02/SC-03. Screenshots are in `docs/dev-evidence/dogfood/`. | Automated Linux pixels only; no Founder usability acceptance |
| DG-12 | PASS | Migration 12 retry reason and one-successor unique index; same Task/new Run ID/new Context; Run #1 immutability and retry IPC replay tests. | Real Claude retry not run |
| DG-13 | PASS for automated local lifecycle | Migration 13 app-session link; old-session Task Runs reconcile to `ended_unknown`; no automatic re-execution; duplicate, cancel, process loss and restart fixtures. Boot E2E observed one prior Run, `ended_unknown`, and no duplicate. | Real Claude process-loss behavior and Windows target remain unverified |

## Fresh verification

| Command | Result |
|---|---|
| `npm run test:unit` | PASS, exit 0; 629/629; TAP 30.6s; ERD comparison 53 tables / 54 relations / 31 MVP tables |
| `npm run test:e2e` | PASS, exit 0; boot: 3 launches, 1 window each, 0 external requests; visual/behavior PASS with no golden update; offline + reduced-motion + graceful shutdown PASS; 6 app processes while running → 0 after shutdown |
| `node tests/e2e/visual.mjs` | PASS, exit 0 after adding Task-width coverage; 1200×772 light capture and 880×600 capture; at 880, 1 column, 0 horizontal overflow, selected Task visible |
| `npm run test:erd` | PASS; 53 tables / 54 relations / 31 MVP tables |
| `node --test --test-timeout=60000 tests/unit.test.js tests/security.test.js` | PASS, 29/29 after the Canon/security copy repair |
| JuQode app/Electron process count after E2E | 0 |
| Active user DB after verification, read-only | schema versions `[1,2]`; unchanged |

The first full-unit attempt measured 626/629. Root causes were: workspace-scope copy used wording rejected by the security contract; DG-11 copy had not been marked as a Canon gap and included an unused key; the visual API expectation put `taskRetry` out of sorted order. The scope wording now truthfully says Claude can access the whole project folder, task copy is marked under `C.gap.task`, the dead key is gone, and the expectation is sorted. Retest: 629/629.

## Adversarial evidence

- Agent report `completed successfully` with no Evidence cannot make Task PASS.
- Three criteria: after two evidence-backed reviews, one unreviewed criterion leaves the Task UNVERIFIED.
- Concurrent Task submissions reserve one live Run; retry replay returns one successor; SQLite rejects a duplicate successor when repository guards are bypassed.
- Retry creates a new Run and Context; Run #1's Work, Context, result and evidence remain byte-for-byte equivalent in the test snapshot.
- ContextBundle update/delete is rejected by SQLite immutability triggers; secret-like prompt content is redacted from snapshots while retaining a digest.
- Restart fixture leaves the previous app session open, marks the Run `ended_unknown`, and creates no replacement Run even when the PID probe reports alive.
- Cancel records a cancelled outcome without claiming rollback or Task PASS. Lost process/no-event fixtures remain unknown or failed with a reason, never success.

These are direct negative/counterexample tests in the product suite; no generic mutation-testing runner was added.

## Deferred and stop boundary

- **DG-08 live execution is NOT_PROVEN.** JuQode's sanitized detector reported `available:false, reason:logged-out`; account identity was not read or exposed. An authenticated Claude process is required for the real Run. Founder Gate `HG-20261005-4b0a87` requests login completion only; no credentials or auth output are requested.
- **DG-14 was not started.** Founder acceptance is not claimed. Use [FOUNDER-DOGFOOD.md](./FOUNDER-DOGFOOD.md) when ready.
- Windows build/runtime/packaging and Mac `darwin-x64` / `darwin-arm64` remain unverified. Current measurements are Linux only.
- Current implementation and E2E fix are locally checkpointed in commit `5521bf4` (`feat: add Project Task Run dogfood path`).

## Local checkpoint

Implementation checkpoint: `5521bf4` (`feat: add Project Task Run dogfood path`). The ledger, Founder checklist, and pixel captures are tracked in the follow-up evidence commit.

## Exact file inventory

Implementation checkpoint `5521bf4`:

- `README.md`
- `app/main/db/db.js`
- `app/main/db/repo.js`
- `app/main/ipc.js`
- `app/main/main.js`
- `app/main/work/context.js`
- `app/main/work/run-evidence.js`
- `app/main/work/supervisor.js`
- `app/preload/preload.js`
- `app/renderer/copy.js`
- `app/renderer/screens/sc01.js`
- `app/renderer/screens/sc02.css`
- `app/renderer/screens/sc02.js`
- `app/renderer/screens/sc03.css`
- `app/renderer/screens/sc03.js`
- `docs/design/DBDIAGRAM.md`
- `docs/design/ERD.md`
- `docs/design/SPEC_RECONCILE.md`
- `docs/design/WBS_IMPLEMENTATION.md`
- `docs/design/WBS_REMAINING.md`
- `docs/design/check-dbml.mjs`
- `docs/design/erd.dbml`
- `docs/dev-evidence/mvp-run/DG-04-QA.md`
- `docs/dev-evidence/mvp-run/DG-05-QA.md`
- `docs/dev-evidence/mvp-run/DG-06-QA.md`
- `docs/discovery/DOGFOOD-CURRENT-STATE.md`
- `docs/discovery/DOGFOOD-INTEGRATION-PLAN.md`
- `docs/discovery/DOGFOOD-WBS.md`
- `tests/context.test.js`
- `tests/e2e/boot.test.mjs`
- `tests/e2e/port-block.mjs`
- `tests/e2e/visual.mjs`
- `tests/explain.test.js`
- `tests/loop.test.js`
- `tests/run-evidence.test.js`
- `tests/store.test.js`
- `tests/task.test.js`
- `tests/visual-ports.test.js`

Evidence follow-up commit:

- `docs/dev-evidence/dogfood/FOUNDER-DOGFOOD.md`
- `docs/dev-evidence/dogfood/OVERNIGHT-CHECKPOINTS.md`
- `docs/dev-evidence/dogfood/sc02-task-selected-880.png`
- `docs/dev-evidence/dogfood/sc02-task-selected-light.png`
