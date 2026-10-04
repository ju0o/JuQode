# JuQode Dogfood — 제안 dependency WBS

PM 승인 완료. DG-04 구현/검증 완료; 이후 critical path는 승인에 따라 계속 진행 중. 목표: Project 1 → Task 1 → Agent 1 → Run #1 → evidence/verdict → 실패 시 같은 Task의 Run #2 → restart 뒤 연속성. Agent의 완료 주장은 Task PASS 근거가 될 수 없다.

모든 항목의 필드는 Goal/Why, Dep, Reuse, Files, In/Out, Accept, Test/Evidence, Fail, Gate, Size, Parallel 순서다.

### DG-00 Current-state baseline — 완료
Goal/Why: 로컬 checkout과 fresh baseline 고정. Dep: 없음. Reuse: local git/status, test scripts. Files: 보고서만. In/Out: 두 checkout → branch/HEAD/dirty 및 test matrix. Accept: 명령/exit/count/time 포함. Test/Evidence: current-state 보고서의 597 unit, boot, visual, shutdown. Fail: 포트 충돌/역사 수치 혼용. Gate: 없음. Size S. Parallel: 읽기 전용 병렬 가능.

### DG-01 Existing execution-path trace — 완료
Goal/Why: renderer부터 Agent, DB, evidence, UI까지 실제 경로 추적. Dep: DG-00. Reuse: SC-02, IPC/router/supervisor/session/reducer/repo/SC-03/04. Files: 보고서만. In/Out: source → sequence, Work overlap, retry/process/restart gaps. Accept: Run ID 시점/input/process/retry 명시. Test/Evidence: current-state report. Fail: 문서를 코드로 오인. Gate: 없음. Size S. Parallel: DG-02와 가능.

### DG-02 JuQode/Dios ownership — 완료
Goal/Why: 제품 경계와 단일 owner 제안. Dep: DG-00. Reuse: 두 제품의 project/skill/task/execution 개념. Files: 보고서만. In/Out: 읽기 전용 코드 → 분류와 owner map. Accept: Project/Task/Skill/Context/Agent/Run/Result/Evidence 각각 한 owner. Test/Evidence: integration report. Fail: DB 공유/dual write 유도. Gate: WBS 승인. Size S. Parallel: 가능.

### DG-03 Versioned contracts v1
Goal/Why: 별도 DB를 유지하는 local JSON interchange. Dep: DG-02. Reuse: existing UUIDs, Dios skill ID/digest. Files: JuQode contract/schema docs/types/fixtures. In/Out: owner+field rules → ProjectRef, TaskSpec, SkillRef/SkillSpec, ContextBundle, RunRequest, RunResult, EvidenceSet. Accept: 각 계약 id/version/owner/required/optional/producer/consumer/compat 포함. Test/Evidence: schema 및 compatibility fixtures. Fail: breaking optional semantics/secret leak. Gate: PM/Founder contract 승인. Size M. Parallel: DG-04 root cause 조사와 가능.

### DG-04 Fresh red baseline triage — 완료 (2026-10-04)
Goal/Why: 4 unit 실패와 visual preload API 불일치 정리. Dep: WBS 승인, DG-00. Reuse: IPC/preload allowlist, Canon tests. Files: app/main/ipc.js, preload, renderer/copy.js, named tests (owner 승인 범위). In/Out: failure trace+policy → 최소 fix 또는 승인된 disposition. Accept: PASS. Unit 599/599; visual assertion pass on auto-selected ports 9225-9227; boot/offline shutdown pass; golden 미변경. Test/Evidence: docs/dev-evidence/mvp-run/DG-04-QA.md 및 3 mutation rejection. Fail: capability 우회, 승인 없는 copy 수정, golden으로 실패 숨김. Gate: Canon/capability owner 필요 시. Size S-M. Parallel: 조사 가능, same-file edits 직렬.

### DG-05 Task persistence — 완료 (2026-10-05)
Goal/Why: Project 아래의 별도 durable Task 엔티티. Dep: DG-04 및 PM migration-order ruling. Reuse: SQLite forward migrations, Project repository. Files: app/main/db/db.js, repo.js, docs/design ERD/checker, tests/task.test.js, store/explain tests. Output: migration 4 `task` plus create/get/list/update API; existing Work rows remain untouched and taskless. Accept: goal/dependencies/acceptance/status/verdict/timestamps persist; initial verdict is unverified; complete/verdict writes unavailable before DG-10; invalid/cyclic/cross-project dependencies rejected; no fabricated Tasks. Test/Evidence: 605/605 unit; `test:e2e` PASS; synthetic v3→4 upgrade retained old Work; close/reopen retained Task; current DB ledger rechecked read-only and remained v1/v2. `docs/dev-evidence/mvp-run/DG-05-QA.md`. Fail: data loss, false PASS, history relabel. Gate: none after PM ruling. Size M. Parallel: migration work serialized.

### DG-06 Task ↔ existing Work/Run
Goal/Why: Link new execution attempts to one Task without mass-renaming Work or rewriting History. Dep: DG-05. Reuse: work table, project active-work index, existing beginWork and History. Files: migration 5 (with approved process-tracking fields), repo, supervisor, IPC, DB tests. Output: nullable `work.task_id` for new linked attempts; old Work stays null. Accept: one Task→many Runs; existing active-work guard still holds; cannot link across projects; no fake Tasks. Test/Evidence: old-row preservation, multi-attempt queries and active-work conflict fixture. Fail: history backfill or cross-project links. Gate: none. Size M. Parallel: schema/repo serialized.

DG-06 completion checkpoint (2026-10-05): PASS. `npm run test:unit` 609/609; `npm run test:e2e` boot, visual/behavior and offline/reduced-motion/shutdown PASS; golden evidence unchanged; six app processes while running and zero afterward. Migration 5 adds nullable `work.task_id`, `app_session`, and runner identity columns to Work/QC; the new IPC path validates Project ownership/dependencies and retains the project-wide active-Work guard. Existing Work history remains unlinked. Current userData DB is still v1/v2 and was read-only. Detailed evidence: `docs/dev-evidence/mvp-run/DG-06-QA.md`.

### DG-07 ContextBundle snapshot/versioning
Goal/Why: Freeze and identify exactly the declared context handed to a Run while exposing the broader cwd capability. Dep: DG-06. Reuse: Brief, exclusions, file manifest/hash. Files: context builder, Run store, tests. Output: immutable per-Run bundle, IDs, hashes/safe snapshot refs, exclusions, builder version. Accept: retries get a new bundle; secrets are not persisted; cwd-wide access is not misrepresented as file isolation. Test/Evidence: changed-source, excluded-secret, restart fixtures. Fail: replacing old context or persisting secret contents. Gate: none. Size M-L. Parallel: contract tests possible.

### DG-08 One-Agent Claude execution
Goal/Why: Use the working Claude Code path for a Run. Dep: DG-06/07. Reuse: claude-detect.js, claude/session.js, supervisor/reducer/NDJSON. Files: session/supervisor/repo/IPC tests. Output: Run ID before spawn, Claude process/session tied to it, durable signals and terminal result. Accept: success/failure/start-error/permission continuation; continuation remains same Run; no duplicate spawn. Test/Evidence: real disposable project plus existing CLI fixture suite. Fail: orphan child or wrong Run correlation. Gate: no Agent swap to Codex. Size L. Parallel: no runtime parallelism.

### DG-09 RunResult and EvidenceSet
Goal/Why: Keep agent report, observed outcome, changed files and test evidence separate. Dep: DG-08. Reuse: work/result.js, diff/evidence/QC. Files: result/evidence repo and tests. Output: immutable result/evidence linked to Run. Accept: missing evidence remains explicit; no report-only PASS. Test/Evidence: success, failure, absent/stale test output fixtures. Fail: agent claim promoted to observed evidence. Gate: none. Size M. Parallel: pure normalization possible.

### DG-10 Criterion-level Task verdict
Goal/Why: Decide Task PASS/FAIL from each acceptance criterion's evidence. Dep: DG-05/07/09. Reuse: evidence and QC records. Files: evaluator, task/repo, migrations, tests. Output: per-criterion verdict plus Task verdict/status. Accept: PASS only when every required criterion has current evidence; report-only “completed successfully” remains UNVERIFIED. Test/Evidence: all-pass, fail, missing, stale, and agent-claim-only adversarial tests. Fail: false PASS. Gate: none. Size M. Parallel: evaluator tests can start once evidence shape is stable.

### DG-11 Project → Task → Run UI
Goal/Why: Let Founder select a Task, inspect latest Run and progressively open history/evidence. Dep: DG-05–DG-10. Reuse: project picker, SC-03/04, D-138. Files: renderer, preload/IPC, styles, visual tests. Output: project Task list/detail and Run history. Accept: prompt, context version, result, changed files, tests/evidence, failure reason; no card wall. Test/Evidence: visual screenshots and API surface. Fail: verdict conflated with Agent report or evidence hidden. Gate: dogfood acceptance at DG-14. Size L. Parallel: UI after read API is fixed.

### DG-12 Retry same Task
Goal/Why: Preserve failed Run #1 and create Run #2 under the same Task. Dep: DG-10/11. Reuse: prompt resend and History. Files: repo/supervisor/IPC/UI. Output: new Run ID, attempt number and retry reason. Accept: previous Run unchanged, same task_id, new prompt/context snapshot, active Task cannot duplicate-run. Test/Evidence: failure→retry DB and UI assertions. Fail: overwrite or new Task on retry. Gate: none. Size M. Parallel: no with lifecycle integration.

### DG-13 Duplicate/cancel/loss/restart
Goal/Why: Make lifecycle durable and idempotent. Dep: DG-06/08/12. Reuse: active Work constraint, cancellation, process reconciliation. Files: migration 5, session/supervisor/recovery/repo, tests. Output: explicit terminal states and process/session identity. Accept: duplicate send yields one live Run; cancel is not rollback; lost identity becomes ended_unknown; restart never auto-runs unknown; permission continuation stays same Run. Test/Evidence: child-process harness, crash windows, duplicate IPC, cancel, restart and process-count checks. Fail: two live Runs, mistaken recovery, false success. Gate: safe process review. Size L. Parallel: tests can be authored independently.

### DG-14 Founder real-project dogfood
Goal/Why: Prove the requested real local loop. Dep: DG-13. Reuse: approved UI and Claude path. Files: no planned files; failures go back to Builder. Output: Founder-selected Project/Task, Run #1 and optional Run #2 evidence. Accept: review Result/Context/changed files/tests/verdict, retry failed Task, restart and inspect history. Test/Evidence: real Founder actions only; never simulated. Fail: secrets or private notes included. Gate: Founder action. Size M. Parallel: no.

### DG-15 Windows stabilization
Goal/Why: Validate the Founder target platform after Linux flow works. Dep: DG-14. Reuse: Win NSIS/zip x64, verify scripts. Files: paths/process/build scripts/tests. Accept: install/open/run/fail/retry/cancel/restart and package checks on Windows 10/11 as required. Evidence: sanitized logs, hashes and process counts. Gate: Founder Windows runtime. Size L. Parallel: code review only.

### DG-16 Mac readiness
Goal/Why: Prepare collaborator validation without guessing the chip. Dep: DG-13. Reuse: Electron/node:sqlite and E2E. Targets: darwin-x64 and darwin-arm64, no packaging this run. Accept: architecture identified later; portability blockers split into CODE/BUILD/RUNTIME/TEST_INFRA. Gate: collaborator supplies host/architecture. Size M. Parallel: planning only.

### DG-17 Dios contract adapter preparation
Goal/Why: Prepare explicit user-selected JSON boundary after local loop proves itself. Dep: DG-14. Reuse: sanitized synthetic v0 contract only. Files: JuQode contract fixtures/validator; never Dios. Accept: item types skill/project_context/runbook only; no shared DB, MCP, HTTP, auto-sharing, arbitrary docs, secrets or folder transfer. Gate: separate PM approval before runtime import/export. Size S-M. Parallel: contract design only.

## Builder checkpoint

DG-04–DG-06 are complete. DG-05 uses migration 4 for Task persistence; DG-06 uses migration 5 for Task↔Work linkage and process-tracking schema. Migration 6 remains reserved for optional `project.owner_id`; it must not introduce login or delay local dogfood. DG-07 ContextBundle needs a later sequential migration if it cannot use an existing durable Run field.

## Remaining blockers / PM-Founder decisions

1. DG-04 rulings resolved the openExternal and Canon copy decisions.
2. JuQode migration order is v4 Task, v5 Work link/process tracking, v6 optional future `owner_id`; v6 is nullable/no-auth and cannot gate dogfood. No private Canon, Dios, or userData DB was modified.
3. Provide a safe disposable Windows checkout and actual verification setup before DG-15.
4. Identify Mac architecture when Mac work starts.
5. Keep Context snapshots to hashes/safe refs unless explicit safe-content policy is approved.

PM approval is recorded through the Founder Gate. Product work now proceeds on the approved local critical path.
