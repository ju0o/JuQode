# JuQode Dogfood Overnight Checkpoints

Date: 2026-10-05 (KST)

Repository: `/home/skkse12/Desktop/Projects/Team/JuQode`

Branch: `dev/mvp-autonomous-v01`

Starting HEAD: `d09a067` (`docs: record Claude login gate and file inventory`)
Scope: JuQode only. No GitHub operations. Dios was not modified.

## Resume truth

- The existing dirty worktree was continued without discarding or overwriting it. At resume it contained the Task/Run domain, lifecycle, tests, and `runner-liveness.js` changes.
- The read-only JuQode DB at `/home/skkse12/.config/juqode/juqode.db` has `schema_version` rows `[1,2]`, highest applied version 2. The DB was not opened by the app during this verification.
- Before the new slice, v4 and v5 were not applied. Migration order is v4 Task, v5 process tracking plus nullable `work.task_id`, v6 nullable `project.owner_id`. Source now implements v4–v14 with no gaps; temporary test DBs exercise migrations. No applied history was rewritten.
- No app/browser processes remained after the final E2E run. The offline-shutdown harness measured 6 processes while running and 0 after graceful termination.

## WBS state

| WBS | State | Checkpoint | Tests / adversarial counterexample | Limit / next eligible |
|---|---|---|---|---|
| DG-04 | PASS | `5521bf4` | Fresh unit, boot, visual, and offline shutdown. Negative coverage rejects `openExternal`; visual port test binds the default port before requiring free-port selection. | Linux only · next DG-05 |
| DG-05 | PASS | `5521bf4` | `tests/task.test.js`: CRUD, FK rejection, round-trip, close/reopen, and migration preservation of historical Work. | User DB remains v2 until normal app start · next DG-06 |
| DG-06 | PASS | `5521bf4` | `tests/task.test.js` and `tests/loop.test.js`: historical Work remains unattached; concurrent submissions reserve only one active Run. | Task-linked Work remains the compatibility Run entity · next DG-07 |
| DG-07 | PASS | `5521bf4` | `tests/context.test.js`: immutable insert, update/delete rejection, secret-like content redaction, and honest cwd-wide capability; retry tests use a new bundle. | No selected-file isolation · next DG-08 |
| DG-08 | PARTIAL | `5521bf4` + `7963c19` | `tests/loop.test.js` and Electron visual E2E exercise pre-spawn reservation, signals, session identity, timestamps, and result with a safe fixture. | **No real Claude Run:** CLI is logged out · next real Run after existing login gate |
| DG-09 | PASS | `5521bf4` + `7963c19` | `tests/run-evidence.test.js`, `tests/loop.test.js`, and E2E cover separate report/outcome/change/test evidence; retry fixture omits exit code and asserts UI wording. | Evidence is observed, not inferred from Agent prose · next DG-10 |
| DG-10 | PASS | `5521bf4` + `7963c19` | `tests/task.test.js`: `completed successfully` without Evidence cannot pass; one of three criteria left unreviewed stays UNVERIFIED; stale/foreign Evidence and failed Runs are rejected. | Criterion PASS still needs actual Run Evidence · next DG-11 |
| DG-11 | PASS (Linux automated) | `5521bf4` + `7963c19` | `npm run test:e2e`: Project/Task/Run view, history/retry text, 880px no-overflow check, and visual pixel review. | No Founder usability acceptance · next DG-12 |
| DG-12 | PASS (fixture) | `5521bf4` + `7963c19` | `tests/task.test.js`, `tests/loop.test.js`, E2E: same Task/new Run and Context; Run #1 deep-equals its pre-retry snapshot; duplicate retry replay returns one successor. | Real Claude retry not run · next DG-13 |
| DG-13 | PARTIAL (fail-closed) | `7963c19`, test wording `ddb27ba` | Restart E2E: one `ended_unknown` Run, zero Agent invocations. Tests cover duplicate start, cancel racing a success signal, detached-child loss, and explicit unknown acknowledgement. | Cannot prove detached descendants stopped, so cancel is `ended_unknown`; multi-Task acknowledgement is coupled to retry · next real Claude verification, then DG-14 |

## Fresh verification

| Command | Result |
|---|---|
| `npm run test:unit` | PASS, exit 0, 657/657; TAP duration 20.91s. ERD check: 53 tables, 54 relations, 31 MVP tables. |
| `npm run test:e2e` | PASS, exit 0. Boot smoke: 3 launches, 0 external requests; restart reconciliation: 1 Run `ended_unknown`, 0 Agent invocations after restart. Visual/behavior E2E passed without updating tracked goldens. Offline boot, reduced-motion boot, and shutdown passed; 6 processes while running, 0 after termination. |
| `node --test --test-timeout=60000 tests/loop.test.js` | PASS after the final cancellation-test wording correction; 53/53; TAP duration 18.72s. |
| `git diff --check` | PASS, exit 0 before the implementation checkpoint. |
| E2E-owned process count after shutdown | 0 by the offline-shutdown harness; it observed 6 while running and 0 after graceful termination. |
| User DB schema, read-only | `[1,2]`, highest 2; unchanged. |

E2E has three sequential stages (boot, visual/behavior, offline-shutdown); it does not emit one aggregate assertion count or duration. No golden files were overwritten.

## Counterexamples and adversarial evidence

- `"completed successfully" without evidence cannot pass a Task`; a separate three-criterion case remains UNVERIFIED while one criterion lacks review/evidence.
- Unknown/failed test results cannot verify PASS; current criterion reviews reject foreign Run Evidence, stale Context, a failed Run, unsupported static checks, and missing latest scoped tests.
- Concurrent submissions for one Project reserve only one live Run; duplicate IPC keys cannot alias another Task; each retry source has at most one successor.
- Failed Run retry is a new Claude session and does not rewrite Run #1. E2E compares Run #1 Work, Context, result, and Evidence before/after Run #2.
- ContextBundle SQLite update/delete is rejected. Retry receives a new bundle while the earlier snapshot digest and content stay unchanged.
- Restart fixture records the prior Run as unknown and does not invoke the Agent again.
- A success signal racing after cancel cannot change the Run to success. Lost root/process cases remain unknown when outcome cannot be proven.
- The visual retry fixture includes a returned tool result with no exit code. SC-02 and SC-03 must say that no exit code was observed; E2E asserts this case and its pixels were refreshed.
- No broad mutation sweep was run. These are bounded contract counterexamples in the existing suite; QA reviewers separately inspected the live checks.

## Pixel evidence

- `sc02-task-run-history-light.png`: desktop Project/Task/Run view; Run #2, retry reason, redaction notices, and its evidence are visible. Run #1 detail is below the viewport fold.
- `sc02-task-run-history-880.png`: 880px stacked layout; E2E measured 0 horizontal overflow. Lower Run details continue below the fold.
- `sc02-legacy-unknown-confirmation.png`: prior unknown Work requires an explicit stopped-process confirmation.
- `sc03-cancel-light.png`: cancel is shown as requested and still being checked, not as confirmed cancellation.
- `sc03-task-run-evidence-no-exit-light.png`: returned test-like command with no exit code is labelled accordingly.

Visual QA found no blocking overlap, clipping, or hierarchy issue. Context detail is collapsed in these captures; the stored Run ContextBundle is verified by E2E/API assertions rather than a Context-expanded pixel capture.

## Checkpoint commits

- Base Task/Run feature: `5521bf4` (`feat: add Project Task Run dogfood path`).
- Lifecycle/evidence hardening: `7963c19` (`fix: harden Task Run recovery and evidence`).
- Test title correction: `ddb27ba` (`test: clarify unknown cancellation outcome`).
- Evidence docs, updated Founder steps, migration planning note, and refreshed captures are the follow-up local checkpoint. No push is authorized or performed.

## Known limits and stop boundary

- **Real Claude execution is NOT_PROVEN.** The sanitized detector returned `logged-out` for installed Claude Code 2.1.289. Existing Founder Gate `HG-20261005-4b0a87` is the pending login step; no credentials or authentication output were requested or exposed.
- Product QA found one MEDIUM multi-Task limitation: project-wide unknown-Run acknowledgement is coupled to retrying that same Task. The approved one-Task dogfood path is covered; a standalone acknowledgement for another Task is not implemented.
- Cancellation remains unknown if full descendant shutdown cannot be established. It does not imply rollback. This is fail-closed behavior and leaves DG-13 partial for confirmed-cancel acceptance.
- **CODE_PORTABILITY:** Windows process-tree query uses PowerShell/CIM and child signaling has platform paths, but no Windows target run validated them; Mac signal behavior is also untested.
- **BUILD_PORTABILITY:** Windows and Mac packaging/signing were not run; Linux build evidence does not establish either target build.
- **RUNTIME_PORTABILITY:** No Windows or Mac app launch was run. Windows is the required Founder target; Mac architecture is unknown.
- **TEST_INFRA:** This overnight E2E ran on Linux only. No Windows or Mac test runner was available; neither `darwin-x64` nor `darwin-arm64` was tested.
- A separate system Chrome tree (12 `chrome` processes) is present under `gnome-shell`; it is not an E2E-owned child by observed parent metadata. It was not touched. The offline-shutdown harness's own process count remained 0 after termination.
- **DG-14 real Founder dogfood was not started.** Founder acceptance remains pending. Use [FOUNDER-DOGFOOD.md](./FOUNDER-DOGFOOD.md) after Claude sign-in and target-machine readiness.


## Pre-Founder closure continuation — 2026-10-05 (ASUS `ju0o`)

- Auth root cause is `SHELL_ALIAS_OR_FUNCTION`: interactive `claude` function exports the existing `CLAUDE_CONFIG_DIR`; both shell modes resolve the same `/home/skkse12/.local/bin/claude`. Noninteractive default config is logged out, explicit existing selector is logged in. Product detector/session preserve the inherited selector; no product absolute profile path or credential copy was added.
- Fixture regression `node --test --test-name-pattern='selected Claude config profile' tests/store.test.js`: 1 matching test passed; it distinguishes fixture-authenticated alternate profile from unauthenticated default without credentials.
- Real Product Run PASS: Project `e34fbb11-c775-4c1f-b8ad-e35d4fb4f112`, Task `13e07762-85d8-47e8-a0a8-44b238fc550c`, Run `9004d147-edd0-484e-8c13-a6c8b1c7f702`; Claude Code 2.1.289, session `1670efd7-c731-4745-bc45-83a206aa2e32`, PID 2427902; 40 stream events (37 Claude). It wrote only `dogfood-proof.txt`; exact-content test returned exit 0 / 1 pass / 0 fail.
- Task criterion review: empty evidence was rejected and kept the Task unverified; after exact output verification the Product accepted measured changed-file evidence `32d70700-f7e2-429b-913d-f7bfc0de6526`; Task verdict PASS. Claude-stream test row retained `exit_code=null` and was not selected as exit-code proof.
- Restart PASS through Product IPC: same Project, Task, Run, ContextBundle, Result, three Evidence rows, and PASS verdict returned; clean shutdown observed before and after. Context ID `0bf660c0-e308-4ae6-96a8-a55093ae042c` unchanged.
- Pending: real cancellation, retry/duplicate proof, and fresh final full regression. Current safe profile launch script is `~/Desktop/JuQode_10.05/RUN_JUQODE.sh`; no manual GUI preview was opened.

## Pre-Founder closure completed — 2026-10-05 (ASUS `ju0o`)

- Auth diagnosis confirmed `SHELL_ALIAS_OR_FUNCTION`: the interactive shell function selects the existing `CLAUDE_CONFIG_DIR`; interactive and noninteractive forms resolve the same Claude binary. The configured profile is logged in. Product detector returned `available=true`, version `2.1.289`; no product-wide absolute profile path or credential copy was introduced.
- Real Run A PASS: Task `13e07762-85d8-47e8-a0a8-44b238fc550c`, Run `9004d147-edd0-484e-8c13-a6c8b1c7f702`; exact file content and independent test evidence supported criterion PASS. Agent report alone was insufficient.
- Real cancel Task `49302ea9-7c78-41f0-a30d-58a59afa578b`, Run #3 `ec32dbc4-e83f-4b6b-b29f-67d8065b79d0`: Product recorded `cancel_requested`; actual Claude was alive before request; final outcome remained `ended_unknown`, Task stayed unverified, no rollback was claimed, recorded process group was empty after cancellation.
- Explicit retry created new Run #4 `e8c80ad3-17fc-4f43-8621-1caa3fa24fda`; it satisfied Acceptance with observed file Evidence. Duplicate same-key submission returned the existing Run; a distinct key was rejected while active. Earlier Run IDs, contexts, results, and evidence remained in history.
- Product restart reads preserved both Tasks, all five Runs, ContextBundles, Results, Evidence, and verdicts; no automatic duplicate Agent execution. Owned app process count after clean shutdown: 0.
- Fresh `npm run test:unit`: 658/658, exit 0, 31.104 s. Fresh `npm run test:e2e`: boot, visual/behavior, offline/reduced-motion/shutdown PASS, exit 0; shutdown count 6 → 0. Windows/macOS and DG-14 remain untested.
- Handoff files are in `~/Desktop/JuQode_10.05`. DG-14 is ready for Founder and was not performed by the Builder.

## Final closure refresh — 2026-10-05 (ASUS `ju0o`)

- Restart check was freshly repeated through the Product renderer: Task A PASS/1 Run; Task B PASS/4 Runs; Project, Task list, Context, Results, Evidence, and verdicts were stable. Cancelled Run #3 remained `ended_unknown`; no automatic Run was created. Both app closes were clean; owned process count after close was 0.
- Fresh `npm run test:unit`: 658/658, exit 0, 20.928 s. Fresh `npm run test:e2e`: boot, visual/behavior, offline/reduced-motion/shutdown PASS, exit 0; shutdown observed 6 → 0.
- Existing actual cancellation proof remains Run #3 → explicit retry Run #4. Separate later cancellation rehearsals ended normally without Cancel and are excluded; they stayed unverified.
- DG-14 was not performed. Result handoff: `~/Desktop/JuQode_10.05`.
