# BASELINE_REPORT — 기존 Unit/ERD 회귀 기준선 (V1-501)

**WBS:** V1-501
**상태:** `SNAPSHOT / RESULT_RECEIVED / NOT_A_GATE_PASS`
**측정 소스:** `ju0o/JuQode` `dev/v1-wbs` `5baf8e6fd01a26b67bab39bec90c0185a3bba30e`
**선행:** V1-101 ACCEPT. 기획 산출물 이름은 `BASELINE_REPORT`.
**이 커밋의 동작:** 제품 코드, CSS, 테스트 단언을 바꾸지 않는다. 테스트를 끄거나 느슨하게 만들지 않는다.

이 파일은 한 번의 실행 기록이다. 살아있는 제품 설명은 아니다. 실행 경로 지도는 `docs/v1/as-is/ARCH_AS_IS.md` 6절이다. 그 절의 숫자는 이전 실행이고, 이 파일의 숫자가 이번 기준선이다.

G1, G2, G4, G5, G7 PASS가 아니다. live CLI 검증이 아니다. H1, H2, H3 판정이 아니다.

## 1. 명령

호스트: `node v22.22.1`, `Linux 7.0.0-38-generic x86_64`. 이 작업 머신의 기록이다.

시작: `2026-10-15T04:47:21Z`

```
npm test
```

`package.json`에서 `test`는 `test:unit` 다음 `test:e2e`다.

- `test:unit` = `test:erd` 다음 `node --test --test-timeout=60000 "tests/*.test.js"`
- `test:erd` = `node docs/design/check-dbml.mjs`
- `test:e2e` = `tests/e2e/boot.test.mjs`, `visual.mjs`, `offline-shutdown.mjs`

명령에 `JUQODE_DB`를 주지 않았다. 단위 테스트가 여는 저장소는 코드상 `:memory:`와 임시 파일이다. 사용자 `juqode.db`를 이 커밋에서 마이그레이션하거나 지우지 않았다.

같은 SHA에서 먼저 시작한 `npm test`는 `visual.mjs`가 큰 JSON을 출력하는 도중에 끊겼다. 그 로그에는 제품 단언 실패가 없다. 아래 숫자는 같은 명령을 출력 파일로 다시 실행해 끝까지 끝난 런이다.

## 2. 결과

프로세스 종료 코드 0.

### Unit / ERD

`test:erd`:

`검증 통과 · 표 53개 · 관계 54개 · MVP 31표를 schema.sql 과 대조`

`node --test`:

| 항목 | 값 |
|---|---|
| tests | 674 |
| pass | 674 |
| fail | 0 |
| cancelled | 0 |
| skipped | 0 |
| todo | 0 |
| duration_ms | 28820.548654 |

단위 파일은 `tests/*.test.js` 29개다. `board-column`, `brief`, `change-qa`, `change`, `context`, `draft`, `explain`, `harness`, `human-read`, `interpret`, `loop`, `narrate`, `nextaction`, `presence`, `qc`, `reader`, `result-qa`, `revert`, `run-evidence`, `security`, `signing`, `store`, `task`, `term`, `theme`, `transition`, `unit`, `visual-ports`, `work`.

### E2E

`boot.test.mjs`: `boot smoke: PASS`

- `runs` 3, `windows` 1, `externalRequests` 0
- 재시작 재조정 `outcome` `ended_unknown`, `runCount` 1, `endedAppSessions` 3
- `agentInvocationsOnRestart` 0
- `didFinishLoadMs` min 861, median 989, max 1132
- note: `Linux measurement only. The target OS is Windows 10/11 (D-125) and is NOT TESTED.`

`visual.mjs`: `visual+behaviour: PASS`

스크린샷은 `tmp-visual/`에 새로 생겼고 `.gitignore`에 있다. 이 커밋에 넣지 않는다. 추적 중인 골든을 교체하지 않았다. 출력의 Claude 버전은 `9.9.9-fixture`다.

`offline-shutdown.mjs`: `offline + reduced-motion + shutdown: PASS`

- offline boot `externalRequests` 0, `exit` 0
- reduced-motion boot `exit` 0
- shutdown `processesWhileRunning` 6, `afterGracefulTerminate` 0

e2e의 Claude는 `tests/e2e/boot.test.mjs`가 만드는 fixture다. live Claude, Codex, OpenCode가 아니다.

## 3. 불합리한 녹색

이번 기준선에서 단언을 고친 테스트는 없다. 녹색을 만들기 위해 끈 테스트도 없다.

확인한 범위:

- `tests` 아래 `assert.ok(true)`, `test.skip`이 없다.
- Canon 18 문구 대조(`tests/unit.test.js`)는 Canon 파일을 읽지 못하면 `assert.fail`로 끝난다. 이번 통과는 그 파일이 이 머신에서 읽혔다는 뜻이다. 경로는 `JUQODE_CANON` 또는 로컬 `JuQode-Private`의 `docs/current/18_KOREAN_UX_COPY.md`다.
- 소스 스캔은 `tests/src.js`의 `code()`가 주석을 렉서로 벗긴 뒤에 한다. `unit.test.js`는 같은 줄의 `readFileSync(... app/ ...)`로 그 헬퍼를 우회하는 테스트를 거절한다.

알려진 한계. 이번 커밋에서 스위트를 다시 쓰지 않는다.

- `tests/presence.test.js`의 `no clock in this file can reach a mode`와 `tests/transition.test.js`의 `.animate(` 검사는 실행 중인 시계가 아니라 소스 모양을 잠근다. 해당 호출이 사라지면 실패한다. 주석에 적힌 단어를 본문으로 오인하지 않도록 `code()`를 탄다.
- 같은 줄만 보는 `readFileSync` 가드는 여러 줄로 나눈 호출을 놓칠 수 있다. 이번 검토에서 그 모양으로 `app/`를 읽는 테스트는 없었다. 가드를 넓히면 테스트 변경이 되므로 이 기록 커밋에서는 그대로 둔다.
- 단위 테스트의 상당수는 모듈을 직접 부르거나 소스를 읽는다. Electron을 띄우는 경로는 e2e 세 파일이다. e2e도 fixture Claude다.

## 4. 이 기록 다음에 남는 것

- 화면을 바꾸는 작업은 이 커밋 다음에 한다. 5열 보드와 사용자 프로젝트 데이터는 이 커밋에서 건드리지 않았다.
- G1은 HOLD다. Codex, OpenCode 어댑터를 이 기록으로 시작하지 않는다.
- H2 부재는 BLOCKED다.
- `main` 병합과 공개 릴리즈는 이 산출물의 범위가 아니다.
