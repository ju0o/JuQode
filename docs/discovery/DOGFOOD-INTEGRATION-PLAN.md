# JuQode Dogfood — JuQode ↔ Dios 통합안

조사일 2026-10-04. 설계안이며 구현 아님. Local-first, separate products/databases, no dual write.

## 1. Dios 개념 분류

| Concept | 현재 관찰 | 결정 |
|---|---|---|
| Project | electron/db/schema.ts projects identity; 실행 root 및 JuQode Project와 다른 의미 | KEEP_IN_DIOS; future ref only |
| task_requests | goal/scope/references/acceptance/forbidden/content/time 기록, Project/Run 연결 없음; 실제 Agent 실행은 Dios 밖 | NOT_RELEVANT_TO_FIRST_DOGFOOD |
| roadmap_phases/tasks | Dios app roadmap; 현재 schema의 acceptance는 제품 문서보다 불완전 | NOT_RELEVANT_TO_FIRST_DOGFOOD |
| Skills | .agents/skills canonical files, digest/history/Agent attachment | KEEP_IN_DIOS |
| project_connections/Memory/runbooks | 프로젝트 재료 연결, 실행 Context snapshot 아님 | KEEP_IN_DIOS |
| Agent catalog | skill 위치/readiness, process runner 아님 | NOT_RELEVANT_TO_FIRST_DOGFOOD |
| Execution/Run/Result/Evidence | tutorial/execution-boundary에서 실행은 외부; decision/audit는 coding Run evidence 아님 | NOT_RELEVANT_TO_FIRST_DOGFOOD |
| Project/Skill stable reference | 별도 identity 존재 | SHARE_AS_CONTRACT; JSON ref only |

JuQode가 Task, Context, Agent execution, Run, result/evidence/verdict를 소유. Dios는 Skill definition/history와 자체 프로젝트·작업관리 의미를 보유. REIMPLEMENT_IN_JUQODE는 Dios task_requests 복제가 아니라 dogfood용 Task lifecycle을 JuQode가 별도 정의함을 뜻한다. DB 공유, 코드 전체 복사, Dios 수정 범위 밖.

## 2. Canonical owner

| Concept | Owner |
|---|---|
| Project identity/root | JuQode |
| Task/deps/acceptance/status | JuQode |
| Skill definition/version | Dios |
| ContextBundle selection/snapshot metadata | JuQode |
| Agent process execution | JuQode |
| Run history | JuQode |
| Agent report/result | JuQode Run |
| Evidence/final Task verdict | JuQode |
| user_id/entitlement | 지금 미도입; 실제 auth 요구 시 결정 |

SkillRef만 기록. Dios Skill row/content 편집/복사 금지. 별도 DB이므로 dual write 없음.

## 3. Versioned local JSON contracts v1

모든 object에 contract와 major.minor version. v1 consumer는 unknown optional key 허용, unknown major 거부. ID 의미/required/enum 변경은 major; 호환 가능한 optional 추가는 minor. Local JSON 교환이며 distributed system 보장은 없음.

| Contract / ID / owner | Required; optional fields | Producer → consumer / compatibility |
|---|---|---|
| ProjectRef / project_id / JuQode | required: project_id,name,root_locator,locator_kind,created_at; optional: description,dios_project_ref,user_id (future only) | JuQode → Run/adapter; stable ID, path update는 ref update |
| TaskSpec / task_id / JuQode | required: task_id,project_id,goal,dependencies[],acceptance[],status,created_at,updated_at; optional: description,priority,labels,dios_task_ref | editor → repo/RunRequest; acceptance 변경은 과거 Run 불변 |
| SkillRef/SkillSpec / skill_id / Dios | Ref: skill_id,version_ref; Spec adds name,digest; optional uri,description,allowed_tools summary | Dios → JuQode; first dogfood ref only, contents not copied |
| ContextBundle / bundle_id / JuQode | required: bundle_id,project_id,built_at,selected_at,builder_version,items[],exclusions[]; optional human_notes,skill_refs[],snapshot_storage_ref | builder → Run/adapter; immutable per Run |
| RunRequest / run_id / JuQode | required: run_id,task_id,project_id,attempt,prompt,context_bundle_id,requested_at,idempotency_key; optional agent_id,skill_refs[],retry_of_run_id,resource_limits | UI/supervisor → Claude adapter; same key returns same Run |
| RunResult / run_id / JuQode | required: run_id,state,started_at,ended_at,agent_report; optional observed_summary,process_ref,agent_session_ref,failure_reason,retryable,exit_code | adapter → repo/UI; terminal immutable except append-only reconciliation |
| EvidenceSet / evidence_set_id / JuQode | required: evidence_set_id,run_id,captured_at,items[],acceptance_evaluation[]; optional git_before_ref,git_after_ref,changed_files[],test_commands[],redactions[] | collectors → evaluator; verdict pins evaluated evidence IDs |

Evidence item requires evidence_id, kind, source, observed_at, status, summary; optional locator, digest, command, exit_code, duration_ms, redacted, acceptance_ids. Never store tokens or arbitrary environment output. v1 fixes digest and canonical path representation before implementation.

## 4. ContextBundle exactness and secret safety

Current explicit Agent input is prompt; project cwd grants potentially broad file access and inherited environment is exposed. There is no selected-resource list or frozen Brief/context. Current history cannot claim an exact read set.

v1 bundle: UUID/schema/project; built_at, selected_at, builder/version; ordered items with stable resource ID, source type (project_file, project_brief, task_spec, skill_ref, human_note, generated_summary), canonical relative path or opaque ID, safe display name, SHA-256 digest and immutable snapshot ref only if policy allows. Include exclusions by rule/reason/count only, optional human note, redaction summary and SkillRefs. Never persist .env, credentials, tokens, cookies or private user data for reproducibility. Default to digest/reference; missing snapshot is NOT_REPRODUCIBLE. Changed retry gets a new bundle ID; old Run bundle never changes.

Declare access scope: current Claude CLI receives project cwd and can read more than selected items. Do not claim listed resources were its only context. Record environment policy without storing values.

## 5. One-Agent path and lifecycle

Keep current Claude detect, supervisor, session, reducer. Narrow adapter only for current needs:
- detect(): availability/version evidence for Claude CLI.
- startRun(request): spawn one process tied to pre-created Run and return process ref.
- sendInput(run_id,input): same-Run permission continuation, never duplicate start.
- cancel(run_id): request and observed outcome.
- recover(run_id): identity-correlated reconnect or unknown; PID alone insufficient.
- normalizeEvent(raw): map current NDJSON and persist safe raw evidence.
Adapter owns no Task verdict. Builder Codex is not the product Agent.

States: created → starting → running ↔ waiting → cancel_requested → ended_success | ended_failed | ended_cancelled | ended_unknown. Terminal states never reopen. Run success is not Task PASS. Task verdict is open/pass/fail/blocked and requires evidence for every acceptance criterion.

Before spawn, transactionally create Run and active lock. Unique persisted idempotency key makes duplicate delivery return same Run. Retry only after terminal state and explicit action: same Task, new run_id, attempt+1, retry_of link. Keep project-wide active guard while Claude is project-exclusive. Cancel idempotent; permission continuation stays in same Run. On restart correlate PID + start marker + executable/cwd/session when available. Proven live process reconnects; missing/ambiguous process becomes ended_unknown, never auto-respawn. Crash between row and spawn resolves not-started/unknown absent handshake proof. Store AGENT_REPORT, OBSERVED_RESULT, TEST_EVIDENCE, FINAL_TASK_VERDICT separately.

## 6. UI and platform findings

UI: project identity/context, compact WBS task list, selected Task goal/deps/acceptance/status/latest Run, expandable history with attempt/agent/state/time/prompt/Context version/result/changed files/tests/failure/retry reason. Reuse SC01-SC04 and D-138: main column current Task/result, narrow Brief/History rail, progressive disclosure; no wall of cards. D-138 is historical QA and new flow still needs visual verification.

Windows:
- CODE_PORTABILITY: use platform-neutral Node paths; Windows PATHEXT/cmd resolution exists.
- BUILD_PORTABILITY: NSIS/zip x64 configured; real package/install/launch unproven.
- RUNTIME_PORTABILITY: taskkill /T exists; process identity, terminal marker, cancel/restart need Windows proof.
- TEST_INFRA: verify-windows.ps1 default npm ci may clean dependencies; use approved disposable checkout.
Linux tests do not prove Windows readiness.

Mac (chip UNKNOWN):
- CODE_PORTABILITY: validate path case/separators, signals, Electron lifecycle.
- BUILD_PORTABILITY: no darwin target; plan darwin-x64 and darwin-arm64 separately.
- RUNTIME_PORTABILITY: Electron node:sqlite, activation and child termination require each architecture test.
- TEST_INFRA: current non-Windows E2E assumes xvfb-run; native Mac runner absent/unproven.
Do not guess chip; ask collaborator when Mac work begins.

Auth/paid: no login/billing/checkout/cloud/sync. Keep UUIDs stable. Defer user_id until actual auth migration.

## 7. Schema governance boundary

DG-05 was explicitly authorized as a JuQode-owned additive migration. `app/main/db/schema.sql` remains byte-for-byte untouched as the local Canon copy; only `app/main/db/db.js` adds version 4. JuQode-Private and Dios were not inspected or changed. The active userData DB was not migrated by this run. Future SSOT synchronization, if required, needs its own scope and owner decision.
