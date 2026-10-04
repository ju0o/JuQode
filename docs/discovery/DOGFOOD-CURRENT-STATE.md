# JuQode Dogfood — 현행 상태

Discovery baseline: 2026-10-04, read-only. Builder update through 2026-10-05 is appended below. JuQode product files changed only for approved DG-04/DG-05; Dios and Git history remain untouched; no remote/GitHub operation.

## A. 환경과 fresh 검증

| Repo | Host/path | Branch / HEAD | 시작 시 관찰 |
|---|---|---|---|
| JuQode | ju0o / /home/skkse12/Desktop/Projects/Team/JuQode | dev/mvp-autonomous-v01 / 0d2762f | clean, tracking ref보다 12 ahead |
| Dios | ju0o / /home/skkse12/Desktop/Projects/Core/Dios | feature/project-key-candidates / eed0c7a | 4 existing dirty files |

Dios dirty: tests/api-key-store.test.ts, tests/execution-boundary.test.ts, tests/project-key-e2e.test.ts, vitest.config.ts. 조사 전후 불변. Host Linux x86_64. Windows Founder host와 협업자 Mac은 미확인.

| Command | Exit / 결과 | 측정 |
|---|---|---|
| npm run test:unit | 1 / FAIL | 597 tests: 593 pass, 4 fail; TAP 20.616s, shell 21.124s. ERD 49 tables/49 relations 및 MVP 26-table 비교 통과 |
| node tests/e2e/boot.test.mjs | 0 / PASS | 3 runs, 각 1 window, 외부 요청 0; load 374/397/454ms |
| node tests/e2e/visual.mjs (9223) | 1 / FAIL | 약 61s. 기존 SSH PID 84228 포트 사용, CDP 실패. 프로세스는 종료하지 않음 |
| JUQODE_E2E_PORT=19223 node tests/e2e/visual.mjs | 1 / FAIL | 2m46.862s. UI 시나리오 뒤 preload API 선언 목록 불일치: openExternal 추가 |
| node tests/e2e/offline-shutdown.mjs | 0 / PASS | 9.352s, 외부 요청 0, reduced-motion boot exit 0, 실행 중 6 processes → 종료 뒤 0 |

Unit 실패:
1. tests/store.test.js:610 open-external 응답 누락.
2. tests/unit.test.js:139 Claude 전송 확인 문구가 Canon 18에 없고 승인된 gap도 아님.
3. tests/unit.test.js:235 app/main/ipc.js의 openExternal은 금지 capability.
4. tests/unit.test.js:415 미사용 copy key.

globalignorefile 경고는 실패 원인 아님. golden 갱신 없이 visual 실행. tmp-visual은 테스트 산출물. README의 과거 500/597 및 WBS-LEDGER의 542와 fresh 597은 시점이 달라 CONFLICTING_REPORTS; fresh run이 현재 근거다. 이전 mutation report는 historical. Dios tests/build/mutation sweep 미실행.

## B. 기능 분류

A IMPLEMENTED_AND_VERIFIED; B IMPLEMENTED_BUT_NOT_VERIFIED; C PARTIAL; D SPEC_ONLY; E NOT_IMPLEMENTED; F DEPRECATED / SHOULD_NOT_REUSE.

| 영역 / 분류 | 실제 동작, 증거, 부족한 점 | 재사용 |
|---|---|---|
| Project open/identity A | app/main/project.js와 IPC가 폴더 프로젝트와 identity 제공. 로그인 owner 없음. | Project 기반 |
| Brief/interpretation C | renderer/sc01.js, sc02.js와 router/intent.js, rules.js. Brief가 Claude context에 안 들어감. | UI 적응 |
| Intent routing A | router/rules와 IPC 요청 분류. WBS 선택 미연결. | 유지 |
| Work/Task C + A | Work는 실행 attempt에 가까움; DG-05가 별도 Task migration/repository를 추가했으나 Task↔Work link와 UI는 없음. | Work→Run 적응; 기존 Work는 taskless 보존 |
| History A | history/get/list, SC-04가 Work 열람. Task attempt grouping 없음. | 조회 재사용 |
| Claude 감지 A/B | claude-detect.js; CLI 감지와 Windows PATHEXT 경로. Windows 실측 없음. | 첫 Agent로 |
| Process/session B | claude/session.js가 project cwd에서 headless CLI 시작, prompt stdin. 대상 OS 및 spawn 전 실패 기록 미검증. | 실행기 재사용 |
| Events A | NDJSON을 work_signal 저장 후 reducer/UI 전달. Task 의미 없음. | pipeline 재사용 |
| Steps/NEXT A | Agent가 선언한 단계/다음 표시. acceptance 증거 아님. | 활동 표시 |
| Permission A/B | work-allow/work-answer가 동일 Work/session continuation. Windows 미검증. | same Run 대기/재개 |
| Cancel B | supervisor/session 종료; Windows taskkill /T와 POSIX group 경로. Windows 미검증. | 적응 후 검증 |
| Restart C | marker/PID로 dead Work를 ended_unknown 처리. start time/executable identity 미확인; 결과/evidence 완전 복구 없음. | 보강 |
| Before/after evidence C | evidence/git.js, manifest.js, exclude.js; hash/exclusion. non-Git manifest 목록은 restart 후 미보존. | 일부 재사용 |
| Diff A | Git/non-Git 변경을 Work에 표시. 비-Git 재기동 제약, acceptance 연결 없음. | 재사용 |
| Result C | work/result.js가 Agent report/관측 변경/tool result 분리. Agent complete는 Task PASS가 아님. | 수집 유지, verdict 신규 |
| Quick Command A | qc/*가 확인 후 지정 검증 실행/저장. Task/Run 연결 없음. | evidence producer로 적응 |
| Terminal C | term/session.js 별도 shell. Windows cmd marker placeholder; Run history와 분리. | 첫 범위 제외 |
| SQLite/schema A/C | db/schema.sql, db.js, repo.js, Work/event/evidence와 새 Task 저장. Migration 4와 Task API는 temp DB에서 검증. Active userData DB는 read-only로 v1/v2 확인 후 건드리지 않음. `schema.sql`/private Canon 미수정. | 패턴 재사용; DG-06 Task↔Work link 필요 |
| Theme/hierarchy A | SC01-SC04와 D-138 hierarchy. DG-04 후 fresh visual+behaviour E2E 통과. | 점진적 공개 원칙 유지 |
| Existing WBS ledger D | docs/dev-evidence/mvp-run/WBS-LEDGER.md의 engineering rows 39개. 제품 Task 아님. | 참조만 |
| Run-like entities C | Work, work_signal, step, result/diff/evidence가 attempt 일부 표현. DG-05 Task는 별도 테이블/API지만 아직 Work link/idempotency 없음. | Work→Run, DG-06 link |
| Test harness A | unit 605/605, boot, visual+behaviour, offline shutdown 모두 fresh PASS (2026-10-05). | 확장 |
| Windows scripts B | verify-windows.ps1, windows-spikes.mjs. 기본 npm ci가 node_modules 정리 가능. | disposable checkout |
| Packaging B/C | electron-builder Win NSIS/zip x64, Linux AppImage/dir. Win 산출물 미검증, Mac target 없음. | Win 보강 |
| Archived implementation F | README는 pre-reset architecture를 archive-only로 규정. | 기준으로 재사용 금지 |

## C. 실행 경로와 모델

요청 → SC-02 renderer → preload/workStart IPC → router/intent → supervisor(Claude 감지, project active-Work guard, evidence preflight/before basis) → claude/session.js가 project cwd에서 CLI 실행 및 prompt stdin → NDJSON → raw signal DB 저장 → reducer가 Work/step/status 투영하고 work-update → terminal outcome의 after basis/diff/result 저장 → SC-03 result, SC-04/History. QC는 별도다.

Agent에 명시하는 것은 prompt이며, cwd로 인한 project 파일 접근 및 inherited environment도 노출된다. Brief, 선택 파일, frozen context version은 보내거나 기록하지 않는다. Task는 UI submission에서 선택되어야 한다. Current Supervisor는 Claude를 먼저 spawn하고 첫 NDJSON 이벤트가 온 뒤 Work row/ID를 저장한다. Run ID는 아직 spawn 이전에 durable하지 않다; DG-08이 이를 보강해야 한다. Work는 Run에 가장 가깝고 Task는 아니다. Step은 Agent 계획이지 WBS Task가 아니다.

Allow/answer는 같은 Work/session continuation. 실패 재전송은 이전 prompt를 채워 SC-02에서 다시 보내는 새 Work로, 같은 Task retry 관계가 없다. Session UUID는 live map, PID/start marker는 signal, Claude session id는 raw event에 있을 수 있음. Restart는 processFor + kill(pid,0) 수준으로 PID identity 약하다; dead Work는 ended_unknown. Active child 유실을 즉시 검출 못 하면 terminal signal 전까지 active처럼 남을 수 있다.

## D. JuQode 재사용 결정

| KEEP AS-IS | KEEP BUT ADAPT | REPLACE | NEW |
|---|---|---|---|
| project picker/identity, router 진입, raw NDJSON 저장 순서, SC-03/04 탐색, QC confirm UX, exclusion 원칙 | Work→Run, supervisor/session, Claude detect, reducer/events, result/diff/evidence, permission, cancel, SQLite migration, D-138. Run ID spawn 전 생성, Task parent/verdict, reconciliation 보강 | 실패 prompt 재전송을 retry로 보는 UX(same Task 보장 없음); Agent complete=Task PASS(acceptance evidence 아님); PID 존재=process identity(PID 재사용 취약) | WBS Task/deps/acceptance/status; Task↔Run; durable idempotency; immutable ContextBundle; EvidenceSet/verdict; task history grouping; reliability E2E |

기존 Claude→stream→Work→diff/result/evidence→History를 유지하고 Work 의미를 Run으로 좁히는 것이 최저위험. 현재 unit 네 실패와 visual API assertion을 먼저 정리한다.

## DG-04 completion update — 2026-10-04

DG-04 is PASS. Its 599/599 baseline, 3 boot runs, 9225-9227 port choice, zero golden changes and three mutation rejections remain documented in ../dev-evidence/mvp-run/DG-04-QA.md.

## DG-05 completion update — 2026-10-05

Read-only source inspection found implemented migrations 2 and 3. The normal Linux userData ledger was `[1,2]`, highest 2, with no Task table; JuQode-specific `JUQODE_DB`/`JUQODE_USER_DATA` overrides were absent. No version 4 or 5 had been implemented/applied in the current local development DB. Under the Founder/PM ruling, v4 is Task, v5 is process tracking (and DG-06 Work link), v6 is future `owner_id`.

DG-05 added the v4 `task` table and repository APIs. Existing Works remain unlinked; no Tasks are fabricated. New Tasks store goal, same-Project dependency IDs, criterion `{id,text}` records, workflow status, independent `unverified|pass|fail` verdict, and timestamps. The API does not accept a verdict or `complete` status; DG-10 must add the evidence evaluator before Task PASS is writable. Migration tests upgraded a synthetic v3 store and preserved its old Work row; another disk-backed test survived close/reopen. The actual userData DB remained v1/v2 after unit/E2E runs.

Fresh at that checkpoint: `npm run test:unit` PASS 605/605; ERD 50 tables/50 relationships/MVP 27-table compare. Current follow-up results are recorded under DG-06. Task adversarial tests reject empty goals, bad criteria, unknown/duplicate/self/cyclic dependencies, direct API PASS/complete, and current-version DB missing `task`. Full historical DG-05 details: ../dev-evidence/mvp-run/DG-05-QA.md.

## DG-06 completion update — 2026-10-05

Migration 5 adds nullable `work.task_id`, process identity fields on Work and Quick Command, and `app_session`. New Task-linked Work requests validate the Task/Project match, completion state, and dependency verdict; the existing project-wide active-Work index remains the safety arbiter. Historical Work rows remain unlinked. A disposable CLI fixture exercised the existing Claude supervisor path and confirmed the Task ID reaches Work history; this does not count as the real-Claude acceptance required by DG-08.

The current Supervisor still creates the Work row after spawning the child, when the first NDJSON event arrives. Any earlier note saying the row was durable before spawn was inaccurate. DG-08 must move Run creation before spawn while representing start failures explicitly.

Fresh: `npm run test:unit` PASS 609/609 (TAP 20.658s); ERD 50 tables/50 relations/MVP 28. `npm run test:e2e` PASS for boot, visual/behavior and offline/reduced-motion/shutdown; CDP ports 9225–9227, golden unchanged, external requests 0, processes 6→0. One earlier 608/609 run exposed an invalid fixture that started at current v5 then rewound only its ledger; it now builds a true v1 schema and passes. Detailed evidence: ../dev-evidence/mvp-run/DG-06-QA.md.
