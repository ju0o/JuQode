# ARCH_AS_IS — f905858 실행·IPC·DB·UI·권한·테스트 지도

**WBS:** V1-101
**상태:** `SNAPSHOT / RESULT_RECEIVED / NOT_A_GATE_PASS`
**소스:** `ju0o/JuQode` `f905858d3f0dc403155f1fa6082efbca207558b6` (`design: keep routine work inside the board inspector`)
**기획 기준:** `ju0o/JuQode-Private` `1ea0a7d` 의 V1-002 `CANON_DELTA`. 이 파일은 그 문서를 고치지 않는다.
**판정 경계:** G0 PASS 아님. G1 PASS 아님. G2 ARCH_LOCK 아님. 코드에 있는 사실과, 이 커밋에서 다시 실행한 테스트만 적는다. 새 live CLI 실측은 없다.

읽는 법: `코드에 있음`은 이 SHA의 소스다. `테스트가 잠금`은 아래 테스트 절의 명령이 그 파일을 실행했다는 뜻이다. `NOT_PROVEN`은 이 배치에서 다시 측정하지 않았다.

## 1. 실행 흐름

한 프로젝트의 작업 행은 `work`다. 화면의 Run은 그 행이다. 제품을 켜면 `app/main/main.js`가 SQLite를 열고, `app_session` 행을 만든 뒤, 끝나지 않은 작업을 재조정하고, 창을 연다.

```text
SC-02 보내기 / 새 일로 맡기기
  → preload juqode.workStart
  → ipc juqode:work-start
  → supervisor.start → preflight → (Task면) beginWork
  → claude/session.run
  → stdout JSON 한 줄 → reducer.toSignal → work_signal + reduce
  → juqode:work-update
```

### 1.1 Run을 만드는 유일한 동작

`juqode:task-create` (`app/main/ipc.js`, `repo.createTask`)는 `task` 행만 넣는다. 상태 `open`, 판정 `unverified`. `work` 행은 없다.

`juqode:work-start`만 `supervisor.start`로 간다. 렌더러에서 그 채널을 호출하는 곳은 `app/renderer/screens/sc02.js`의 `startWork`다. `보내기`와 `새 일로 맡기기`가 여기로 모인다.

`repo.beginWork`는 Task Run일 때만 `agent_code = 'claude_code'`를 쓴다. Task가 아닌 기존 Work는 `agent_code`가 null이다. 보드는 그 값이 `claude_code`일 때 Claude로 보여 준다 (`sc02.js`). Run을 만드는 Agent 선택이나 모델 선택은 없다. Codex CLI와 OpenCode를 띄우는 코드는 `app/`에 없다.

### 1.2 시작 전 거절과, 행이 생긴 뒤의 실패

`supervisor.preflight` (`app/main/work/supervisor.js`) 순서:

1. 같은 프로젝트에 러너가 살아 있을 수 있는 `ended_unknown` Task Run이 있으면 `prior-process-may-still-live`.
2. `repo.taskRunRefusal`: 없는 Task, 다른 프로젝트, 이미 완료, 열린 의존, 끝난 최신 Run을 재시도 없이 다시 시작.
3. `claude.detect()`가 없으면 `claude-unavailable`. 다른 CLI로 바꾸지 않는다.
4. `repo.activeWork`가 있으면 `active-work`.
5. Task가 아닌 Work이고 폴더가 git이면 `gitEvidence.refusal`. Task Run은 git diff를 저장하지 않고 경로·해시 매니페스트를 쓴다.

이 거절은 `beginWork` 전에 반환된다. `work` 행이 없다. 화면은 `sc02.js`의 `refusalCard`이고, 입력한 문장은 필드에 남는다.

Task Run은 그 다음 `beginWork(..., status: 'starting')`으로 **프로세스를 띄우기 전에** 행을 예약한다. 첫 이벤트가 없으면 그 행을 `ended` / `failed`로 닫고 `failure_reason = agent-start-failed-before-first-event`를 남긴다. 시작 실패를 완료로 바꾸지 않는다.

Task가 아닌 Work는 첫 이벤트가 오기 전에는 행이 없다. 이벤트가 없으면 `start-failed`만 반환한다 (`session.run`의 `startFailed: !sawEvent`).

### 1.3 한 프로젝트에 활성 Run 하나

`schema.sql`의 부분 유니크 인덱스:

`work_one_active_per_project on work(project_id) where status <> 'ended'`

`repo.activeWork`는 그 조건을 읽는다. `beginWork`가 유니크 위반을 만나면 `active-work`로 돌린다. 앱 안의 `starting` Set은 같은 프로젝트의 겹친 `start`를 한 번 더 막는다. 인덱스가 최종 판정이다.

### 1.4 Claude 자식 프로세스

`app/main/claude/session.js`

- 첫 턴 argv: `-p --output-format stream-json --verbose --session-id <uuid>`
- 재개 argv: `--resume <uuid> -p --output-format stream-json --verbose`
- 프롬프트는 stdin. `--allowedTools` 뒤에 위치 인자로 붙이지 않는다.
- `detached: true`. 종료는 소유한 `ChildProcess.kill`만 쓴다. 숫자 PID나 프로세스 그룹으로 신호를 보내지 않는다.
- 종료가 확인되지 않으면 `ended_unknown`. 취소됨으로 단정하지 않는다.
- 거절은 `permission_denied` 이벤트다. 주석과 reducer가 적는다. exit 0과 `is_error: false`는 거절이 아니다.
- `--tools ""`는 내장 도구를 끈다. 빈 `--allowedTools`는 플래그를 생략해서 기본 도구가 남는다.
- 환경에서 `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`만 지운다. 전역 Claude 설정 파일은 수정하지 않는다.

줄 단위 JSON은 `reducer.toSignal`로 바뀌고, 원문 줄은 `work_signal.payload`에 남는다. 파싱 실패도 `raw`로 남는다.

### 1.5 상태 기계

`app/main/work/reducer.js`는 순수 함수다. 신호가 없는 시간을 진행으로 읽지 않는다. 아래 표는 그 메모리 상태다. DB의 Task Run은 자식이 생기기 전 `starting`이고, `onChild`가 `running`으로 바꾼다.

| 신호 | 상태 | outcome |
|---|---|---|
| 첫 행의 기본 | `running` | null |
| `permission_denied` | `permission_waiting` | 유지 |
| `input_request` | `input_waiting` | 유지 |
| `cancel_request` | `cancel_requested` | 유지 |
| `cancel_confirmed` 또는 취소 후 `finish` | `ended` | 도구를 썼으면 `cancelled_partial`, 아니면 `cancelled_nochange` |
| `finish` 성공 | `ended` | 미해결 거절이 있으면 `partial`, 아니면 `complete` |
| `finish` 의 `is_error`, `error*` subtype, API 오류, `end_turn`이 아닌 terminal reason | `ended` | `failed` |
| `reconciled` | `ended` | `ended_unknown` |
| 이미 `ended`인 행의 다른 신호 | 변경 없음 | 변경 없음 |

미해결 거절이 있으면 `finish`가 와도 `permission_waiting`으로 남는다. 사용자가 `work-allow`를 누를 때만 같은 `work` id, 같은 session id로 `--resume`한다.

`supervisor.allow`는 지정한 `toolUseId`의 거절만 고른다. `allowSpec`이 한 도구·한 입력으로 좁히지 못하면 `cannot-scope`이고 권한을 넓히지 않는다. `Write`는 Claude 규칙 이름 `Edit`으로 바꾸고 경로는 그 파일만 남긴다. 프로젝트 안이면 상대 경로, 밖이면 `//`로 시작하는 절대 경로다. `Edit(/abs/path)` 한 슬래시는 cwd 상대 글롭이라 쓰지 않는다. `(),*?[]{}!`와 공백-only 대상은 `UNSAFE_TARGET`으로 거절한다.

부팅 때 `repo.reconcileLostWorks`가 프로세스를 확인하지 못한 미종료 작업을 `ended_unknown`으로 닫는다. Task Run은 앱 세션이 바뀌면 스트림에 다시 붙지 않는다. `main.js` 주석이 그 경계를 적는다.

### 1.6 해석·설명·Quick Command·터미널은 별도 자식이다

- `juqode:interpret`는 결정적 `scan` 뒤에, 활성 Work가 없고 다른 해석이 없을 때만 `interpret/narrate.js`의 `narrate()`를 호출한다. `narrate()`는 `session.run`으로 Claude를 띄우고 `--tools ""`를 준다. 실패해도 결정적 답은 유지한다. 이 자동 호출은 f905858에 그대로 있다. 빼는 작업은 V1-314이며 이 커밋은 동작을 바꾸지 않는다.
- `juqode:work-explain`은 사용자가 누를 때만 Claude 자식을 띄운다. 작업이 `ended`가 아니거나 프로젝트에 활성 Work가 있으면 `still-running` / `work-running`.
- `juqode:qc-run`은 고정 규칙만 실행한다: `qc.dev.start`, `qc.dev.stop`, `qc.build`, `qc.test`, `qc.git.status`, `qc.git.commit`, `qc.deploy`, `qc.terminal.open`. 활성 Work를 조회하지 않는다. 파일을 바꾸는 QC가 활성 Run과 겹칠 수 있다. 그 거절은 V1-310의 완료 조건이고, 이 지도는 그 간극을 사실로만 남긴다.
- `juqode:term-write`는 검사 없이 사용자 셸에 줄을 넘긴다. `ipc.js`는 이것을 빠뜨린 검사가 아니라 계약으로 적는다. 제품 터미널을 샌드박스라고 부르지 않는다.

## 2. IPC

경계는 `app/preload/preload.js`다. `contextBridge`가 `window.juqode`에 이름 있는 함수만 연다. 범용 `invoke`와 `ipcRenderer`는 렌더러에 없다.

`app/main/main.js`의 `handle`은 예외를 `{ ok:false, reason:'internal' }`로 바꾼다. 보낸 프레임에 부모가 있으면 `{ ok:false, reason:'bad-sender' }`다. 이 검사는 경계 전체가 아니다. 경계는 preload와 `security.lockNavigation`이다.

핸들러 본문은 `app/main/ipc.js`의 `makeHandlers`다. 채널과 preload 함수는 한 쌍이다.

| 채널 | 하는 일 | work 행 |
|---|---|---|
| `juqode:versions` | 앱·런타임 버전 | 없음 |
| `juqode:boot` | DB 상태와 서명 사실 | 없음 |
| `juqode:open-project` / `open-path` | 폴더를 연다. 경로는 이번 선택 또는 최근 목록만 | 없음 |
| `juqode:interpret` / `brief` | 프로젝트 읽기. interpret는 조건부로 Claude | 없음 |
| `juqode:qc-route` / `qc-list` / `qc-run` / `qc-stop` / `qc-runs` | 고정 Quick Command | QC 행. Work 행 아님 |
| `juqode:term-open` / `term-write` / `term-stop` | 사용자 셸 | 없음 |
| `juqode:claude-detect` | Claude 설치 탐지. 한 번에 하나 | 없음 |
| `juqode:route-intent` | `work` / `terminal` / `ambiguous` / `unrecognized` | 없음 |
| `juqode:task-list` / `task-create` / `task-update` / `task-detail` | Task CRUD | 없음 |
| `juqode:task-review-criterion` | 끝난 Run의 조건 판정 | 없음 |
| `juqode:legacy-unknown-ack` | 이전 unknown 프로세스 확인 | 없음 |
| `juqode:task-retry` | 끝난 Run의 다음 시도 | 새 work 행 |
| `juqode:work-start` | 실행 | 위 1.2 |
| `juqode:work-get` / `work-changes` / `work-signals` / `work-reader` / `history` | 읽기 | 없음 |
| `juqode:work-allow` | 한 거절을 좁은 권한으로 재개 | 같은 행 |
| `juqode:work-answer` | 같은 세션에 답을 보낸다 | 같은 행 |
| `juqode:work-cancel` | 취소 요청. 확인 전엔 완료가 아님 | 같은 행 |
| `juqode:work-revert` | 끝난 작업의 작업 트리를 되돌린다 | 없음 |
| `juqode:work-explain` | 사용자가 요청한 설명 패스 | 없음 |

메인 → 렌더러 push는 세 채널뿐이다. `juqode:work-update`, `juqode:qc-update`, `juqode:term-update`. QC와 터미널을 Work 갱신에 섞지 않는다.

`__stopAllQc`와 `__stopAllTerm`은 enumerable이 아니다. 렌더러 채널이 아니다. `before-quit`에서만 호출한다.

## 3. DB

엔진은 Electron에 들어 있는 `node:sqlite`다. 파일은 `JUQODE_DB` 또는 `userData/juqode.db`다. 증거 파일은 `userData/evidence/<projectId>`다. `JUQODE_USER_DATA`가 userData 전체를 옮긴다.

`schema.sql`은 `create table` 26개와 버전 1을 시드한다. `app/main/db/db.js`의 `MIGRATIONS`가 2부터 14까지다. `latest()`는 `1 + MIGRATIONS.length`라서 **14**다. migration이 더하는 표는 `task`, `app_session`, `run_context_bundle`, `run_evidence`, `task_criterion_review` 다섯 개다. 기준 26과 합하면 31이다. `docs/design/VNEXT.md`의 15는 이 빌드의 기준이 아니다. 다음 번호는 15이고, 이 커밋은 migration을 추가하지 않는다.

적용 규칙 (`db.js` `migrate`):

- `pragma quick_check`가 ok가 아니면 `db-corrupt`. 파일을 지우지 않는다.
- 기준 테이블이 없으면 `db-corrupt`.
- 저장된 버전이 `latest()`보다 크면 `db-newer`. 다운그레이드하지 않는다.
- 각 migration은 자신의 트랜잭션이다. 실패하면 그 트랜잭션을 rollback하고 `db-corrupt`를 던진다.
- 그 전에 커밋된 migration은 파일에 남는다. 크래시가 트랜잭션 밖에서 났을 때의 바이트 동일성은 `NOT_PROVEN`이다.
- 채택 뒤에만 `journal_mode = wal`을 켠다.

추가된 스키마의 의미:

| 버전 | 추가 |
|---|---|
| 2 | `change_group.source_ref` |
| 3 | `qc.git.commit`, `qc.deploy` 규칙 id |
| 4 | `task` |
| 5 | `app_session`, work/QC의 runner pid·세션 |
| 6 | `project.owner_id` (로그인 없음) |
| 7 | `run_context_bundle` + 수정/삭제 금지 트리거 |
| 8 | `work_status.starting`, idempotency, attempt, `retry_of_work_id`, `failure_reason` |
| 9 | `run_evidence` + 불변 트리거. kind는 `changed_files`, `test_command` |
| 10 | `task_criterion_review` + 불변 트리거 |
| 11 | `work.agent_code` |
| 12 | `retry_reason`, 소스 Run당 후속 하나 |
| 13 | `work.app_session_id` |
| 14 | `evidence_basis.manifest_json` |

`schema.sql`이 시드하는 work 상태: `running`, `input_waiting`, `permission_waiting`, `cancel_requested`, `ended`. `starting`은 migration 8에만 있다.

outcome: `complete`, `partial`, `failed`, `cancelled_nochange`, `cancelled_partial`, `ended_unknown`.

`work` 체크: `ended`일 때만 outcome과 `ended_at`이 있다. 시드 주석은 "시작 전 상태는 행이 아니다"라고 적는다. Task Run의 `starting` 행은 그 주석보다 나중 마이그레이션이다. 두 문장을 같은 규칙으로 읽지 않는다.

패치 원문을 저장하는 테이블은 없다. `run_evidence`는 요약, 해시, `details_json`이다. V1-412의 패치 캡은 아직 없다.

## 4. UI

화면 파일: `app/renderer/screens/sc01.js` (프로젝트), `sc02.js` (보드·입력), `sc03.js` (Run 상세), `sc04.js` (변경 읽기), `td01.js` (Quick Command·셸).

보드는 다섯 칸이다. 순서는 `sc02.js`의 `columns`이고, 배치는 `board-column.mjs`의 `columnFor`다.

| 키 | 화면 문구 | 조건 |
|---|---|---|
| `queued` | 시작 전 | 아래 어디에도 안 들어갈 때. Run이 없는 Task가 여기 있다 |
| `doing` | 진행 중 | status가 있고 `ended`가 아니며, 확인 필요 조건이 아닐 때. `starting`과 `running`이 여기 있다 |
| `needs` | 확인 필요 | `permission_waiting`, `input_waiting`, `cancel_requested`, outcome `ended_unknown`, task status `blocked` |
| `review` | 검토 | outcome `failed`, verdict `fail`, 그 밖의 outcome, 또는 status `ended` |
| `done` | 완료 | task verdict `pass` 또는 task status `complete`. 에이전트 `finish`의 `complete`만으로 이 칸에 넣지 않는다 |

`ended_unknown`은 완료도 확정 실패도 아니다. `tileTone`은 그때 `unknown`을 반환한다. 실패만 `fail`이다.

시작 전 거절(행 없음)은 보드 칸을 만들지 않는다. Task는 Run이 없으므로 `queued`에 남는다.

Task Run이 첫 이벤트 없이 `failed`로 닫히면 `columnFor`는 `review`다. 완료로 올리지 않는다.

보조 Run 화면으로 가는 문구는 `copy.js`의 `deepRun`: `시도 자세히 보기`. SC-03은 그 보조 화면이다.

`oneRun` 문구 `한 번에 하나의 시도만 실행돼요`는 진행 중 칸에만 붙는다.

## 5. 권한과 신뢰 경계

`app/main/security.js`가 말하는 경계:

- 렌더러: `contextIsolation`, `sandbox: true`, `nodeIntegration: false`, 탐색과 새 창 거부.
- 세션 `webRequest`가 `file:`, `devtools:`, `data:`, `blob:`, `about:` 이외를 취소한다.
- 같은 파일은 OS 격리라고 말하지 않는다. Electron `sandbox: true`는 렌더러 설정이다. 터미널이나 에이전트 자식의 샌드박스가 아니다.

권한 승인은 사람 동작이다. `work-allow`가 아니면 `permission_granted` 신호를 쓰지 않는다. 기록 source는 `juqode`다.

이 SHA가 하지 않는 것:

- Codex 승인 대기, Codex 좁은 allow, OpenCode `--auto` 차단, OpenCode 질문 이벤트. 구현 코드가 없다. G1은 HOLD이고 이 지도가 그 판정을 바꾸지 않는다.
- 화면에 보인 permission scope와 CLI 유효 scope를 시작 전에 비교하는 관문. Claude 경로는 거절이 난 뒤에 한 입력을 재개한다.
- QC와 활성 Run의 상호 배제.
- H2 Ubuntu 24.04 네이티브. 이 파일은 호스트를 새로 찾지 않는다. C4–C6은 BLOCKED로 남는다.

## 6. 테스트 흐름

`package.json`:

- `test:unit` = `node docs/design/check-dbml.mjs` 다음 `node --test --test-timeout=60000 "tests/*.test.js"`
- `test:e2e` = `tests/e2e/boot.test.mjs`, `visual.mjs`, `offline-shutdown.mjs`
- `test` = unit 다음에 e2e
- `pack:linux` = `electron-builder --linux dir`
- `pack:win` = `electron-builder --win dir zip --x64`

단위 테스트는 Electron을 띄우지 않는다. `tests/src.js`가 메인 모듈을 직접 부른다. 저장소는 `:memory:` 또는 임시 파일이다. 사용자 `juqode.db`를 열지 않는다.

이 지도와 직접 맞는 잠금:

| 파일 | 잠그는 흐름 |
|---|---|
| `tests/board-column.test.js` | 5열. 권한·질문·unknown은 확인 필요. 에이전트 완료는 완료 칸이 아님. 실패는 검토 |
| `tests/work.test.js` | 시작, 신호, 허용, 취소, 단일 활성 |
| `tests/store.test.js` | 마이그레이션, 손상 파일 거절, 다운그레이드 거절 |
| `tests/security.test.js` | 렌더러 경계와 로컬 이외 요청 취소 |
| `tests/qc.test.js` | 고정 규칙과 가용성 |
| `tests/term.test.js` | 셸 세션 |
| `tests/narrate.test.js` | 해석 보조 호출의 실패가 사실을 지우지 않음 |
| `tests/interpret.test.js` | 결정적 스캔과 의도 라우팅 |
| `tests/fixtures/stream-permission-denied.ndjson` | reducer가 읽는 거절 스트림. live CLI가 아님 |

e2e는 실제 Electron을 Xvfb에서 띄운다. `boot.test.mjs`는 임시 userData와 fixture Claude를 쓰고, 주석은 이 호스트의 Chromium 샌드박스 때문에 테스트 프로세스에 `--no-sandbox`를 붙인다고 적는다. `webPreferences.sandbox`는 true로 남는다. fixture Claude는 live CLI가 아니다.

### 6.1 이 커밋에서 실행한 명령

호스트: 이 작업 머신. 제품 코드의 H1/H2/H3 판정이 아니다. live CLI는 호출하지 않았다.

`npm run test:unit`
exit 0.
`test:erd`: `검증 통과 · 표 53개 · 관계 54개 · MVP 31표를 schema.sql 과 대조`
`node --test`: tests 674, pass 674, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 20979.
저장소는 테스트 임시 파일과 `:memory:`다. 실사용 `juqode.db`를 열지 않았다. fixture 스트림이지 live CLI가 아니다.

`npm run test:e2e`
exit 0. 약 206초.
`boot.test.mjs`: `boot smoke: PASS`. 그 출력의 note는 `Linux measurement only. The target OS is Windows 10/11 (D-125) and is NOT TESTED.`다. 재시작 재조정 outcome은 `ended_unknown`, 재시작 때 agent 호출 0.
`visual.mjs`: `visual+behaviour: PASS`. 스크린샷은 저장소의 `tmp-visual`에 새로 생겼고, 이 커밋에 넣지 않는다. 추적 중인 골든을 교체하지 않았다.
`offline-shutdown.mjs`: `offline + reduced-motion + shutdown: PASS`. externalRequests 0. 정상 종료 뒤 프로세스 0.
e2e의 Claude는 `tests/e2e/boot.test.mjs`가 만드는 fixture다. live Claude, Codex, OpenCode가 아니다. H1·H2·H3 판정이 아니다.

## 7. 이 지도 다음에 열리거나 막히는 작업

선행 V1-002는 기획 브랜치 `1ea0a7d`의 Canon delta로 존재한다. 이 파일이 그 산출물이다.

이 파일만으로 충족되지 않는 선행:

- V1-102 Agent 계약은 V1-101과 V1-005가 필요하다. V1-005 문서는 기획 쪽에 있다. 계약 초안은 다음 배치다. G1 실측을 FULL로 올리지 않는다.
- V1-111 호스트 토폴로지는 V1-005와 V1-101이 필요하다. H2 부재는 BLOCKED다.
- V1-201 이후의 어댑터, V1-204, V1-208, V1-209는 G1이 HOLD인 동안 실측 통과를 주장할 수 없다.
- V1-301 시각 기준은 V1-003·V1-004에만 의존한다. 이 커밋의 선행이 아니다.

남은 G1 차단 (해결 대상, 이 커밋에서 미해결):

1. H2 Ubuntu 24.04 LTS x64 네이티브 없음. C4–C6 BLOCKED.
2. C1 Windows Claude OAuth 만료. 자격 증명을 읽거나 로그인하지 않는다.
3. Codex 승인 대기와 좁은 allow는 이 제품 코드에 없고, G1에서 좁은 정책 통과로 측정되지 않았다.
4. OpenCode headless 질문 이벤트는 관측되지 않았다. 전역 권한을 바꾸지 않는다.
5. Claude `Edit(hello.txt)` 허용과 관측된 Write, cwd 이동은 재확인이 필요하다.

공개 릴리즈, main merge, Gate PASS는 이 문서의 권한이 아니다.
