# WBS 대장 — 39개 패키지 전부, 상태와 증거의 위치

`21_WBS.md` §1 의 39행을 그대로 따른다. 이 문서는 **주장이 아니라 색인**이다 — 각 행의
`code` 와 `tests` 열은 저장소에서 `WBS-NN` 태그로 기계 검색해 얻은 것이고, 그 태그가 없던
파일에는 배치 16 에서 태그를 넣었다(그 전에는 WBS-23 · 24 · 25 · 29 · 30 의 구현을 번호로
찾을 수 없었다 — `22` 가 요구하는 추적 가능성의 구멍이었다).

**상태 어휘**

- `IMPLEMENTED` — 수락 조건이 코드에 있고, 그것을 실제로 실패시킬 수 있는 테스트가 있다
- `PARTIAL` — 일부가 남았고, 무엇이 왜 남았는지 아래에 적혀 있다
- `NOT STARTED` — 사람이나 Windows 가 필요해서 이 런에서 할 수 없다
- `SPIKE` — 제품 기능이 아니라 판정 재료를 만드는 패키지

542 unit tests · e2e 3종(`boot.test.mjs` · `visual.mjs` · `offline-shutdown.mjs`).

**돌연변이 검증.** 배치 25~30 이 `app/main` 17개 파일과 렌더러 일부에 대해 돌연변이를 **기계적으로**
생성해 돌렸다(비교·논리 연산자와 반환 상수를, 주석을 벗긴 코드에서만). 제품 결함 19개를 찾았고,
살아남은 것 각각에 이유가 붙어 있다 — 결산은 `BATCH-29-QA.md`, 렌더러는 `BATCH-30-QA.md`.

| WBS | 이름 | 상태 | 코드 | 테스트 |
|---|---|---|---|---|
| 00 | First-week technical spikes | SPIKE · 부분 | `main/security.js` · `evidence/exclude.js` · `scripts/spikes` | — (스파이크는 제품 테스트를 만들지 않는다) |
| 01 | Repository & desktop foundation | IMPLEMENTED | `main/main.js` · `main/window.js` · `renderer/design/base.css` | `unit` · `e2e/boot` · `e2e/visual` |
| 02 | Project open | IMPLEMENTED | `main/project.js` · `renderer/screens/sc01.js` · `preload` | `store` · `e2e/visual` |
| 03 | Interpretation — deterministic facts | IMPLEMENTED | `main/interpret/scan.js` · `answers.js` · `renderer/screens/brief.js` | `interpret` · `e2e/visual` |
| 04 | Interpretation — narrative | IMPLEMENTED | `main/interpret/narrate.js` | `narrate` · `interpret` · `security` · `e2e/visual` |
| 05 | Brief · fold · stale · refresh | IMPLEMENTED | `renderer/screens/brief.js` · `main/ipc.js` | `brief` · `interpret` · `e2e/visual` |
| 06 | Intent input & route classification | IMPLEMENTED | `main/router/intent.js` · `rules.js` | `interpret` |
| 07 | Single active Work guard | IMPLEMENTED | `main/work/supervisor.js` · `db/repo.js` | `interpret` |
| 08 | Evidence prerequisite (before) | IMPLEMENTED | `main/evidence/git.js` · `manifest.js` | `work` · `security` |
| 09 | Claude Code detection & unavailability | IMPLEMENTED | `main/claude-detect.js` | `store` · `e2e/visual` |
| 10 | Claude session launch | IMPLEMENTED | `main/claude/session.js` · `work/supervisor.js` | `work` |
| 11 | Activity stream → state reducer | IMPLEMENTED | `main/work/reducer.js` | `work` · `harness` |
| 12 | Step tracking & NEXT (declared only) | IMPLEMENTED | `main/db/repo.js` · `renderer/screens/sc03.js` | `loop` · `nextaction` · `e2e/visual` |
| 13 | Input request & answer | IMPLEMENTED | `main/work/supervisor.js` · `sc03.js` | `loop` |
| 14 | Permission pass-through (D-133 계약 B) | IMPLEMENTED | `main/work/supervisor.js` | `loop` · `e2e/visual` |
| 15 | Liveness · no-signal · runtime-unknown | IMPLEMENTED | `main/work/supervisor.js` (`livenessOf`) · `sc03.js` | `loop` · `presence` |
| 16 | Cancel · confirmation · partial detection | IMPLEMENTED | `main/work/supervisor.js` · `sc03.js` | `loop` |
| 17 | Evidence after-snapshot & diff capture | IMPLEMENTED | `main/work/supervisor.js` · `evidence/git.js` | `unit` · `loop` |
| 18 | Work finish & result (D-114) | IMPLEMENTED | `main/work/result.js` · `reducer.js` · `sc03.js` | `result-qa` · `change` |
| 19 | Unwanted result → correction Work | IMPLEMENTED | `sc03.js` (`unwantedPanel`) · `sc04.js` | `e2e/visual` |
| 20 | History & re-entry orientation | IMPLEMENTED | `main/ipc.js` (`orientationOf`) · `sc02.js` | `store` · `e2e/visual` |
| 21 | Persistence (`node:sqlite`, schema.sql) | IMPLEMENTED | `main/db/db.js` · `schema.sql` · `repo.js` | `store` · `e2e/visual` |
| 22 | Quick Command rules & explanation | IMPLEMENTED | `main/qc/rules.js` · `availability.js` | `qc` · `unit` |
| 23 | Quick Command execution & result | IMPLEMENTED | `main/qc/run.js` · `renderer/screens/td01.js` | `qc` · `e2e/visual` |
| 24 | Long-running Quick Command | IMPLEMENTED | `main/qc/run.js` · `td01.js` | `qc` · `e2e/visual` |
| 25 | Terminal drawer (pty) | **PARTIAL — DV-11** | `renderer/screens/td01.js` · `td01.css` | `e2e/visual` |
| 26 | Change Groups (explanation layer) | IMPLEMENTED | `main/change/explain.js` | `explain` · `narrate` · `security` · `e2e/visual` |
| 27 | Code Blocks (segmentation) | IMPLEMENTED | `main/change/blocks.js` | `change` |
| 28 | Raw Diff view & change-scoped reader | IMPLEMENTED | `renderer/screens/sc04.js` | `e2e/visual` |
| 29 | Error model & state colour grammar | IMPLEMENTED | `design/tokens.css` · `base.css` | `e2e/visual` (`stateGrammar`, 두 테마) · `theme` |
| 30 | Security boundaries | IMPLEMENTED | `main/security.js` · `evidence/exclude.js` | `security` |
| 31 | Testing harness | IMPLEMENTED | `tests/fixtures/*.ndjson` | `harness` |
| 32 | Dogfood on real projects | **NOT STARTED — 사람이 필요하다** | — | — |
| 33 | Packaging & release readiness | **NOT STARTED — Windows 가 필요하다** | `package.json` (`pack:win`) · `scripts/verify-windows.ps1` | — |
| 34 | Startup reconciliation of lost processes | IMPLEMENTED | `main/ipc.js` · `db/repo.js` | `interpret` · `store` · `qc` |
| 35 | Agent Presence component | IMPLEMENTED | `renderer/presence.js` | `presence` · `e2e/visual` |
| 36 | Light / Dark theme | IMPLEMENTED | `design/tokens.css` · `theme.js` | `theme` · `e2e/visual` |
| 37 | 화면 구성 차별화 · 전환 모션 | IMPLEMENTED | `renderer/transition.js` · `renderer.js` | `transition` · `e2e/visual` |
| 38 | 다음 행동 강조 (≠ NEXT) | IMPLEMENTED | `renderer/nextaction.js` | `nextaction` · `e2e/visual` |

## 끝나지 않은 것, 셋

### WBS-25 — 셸 명령줄 (DV-11 **판정됨 · 파이프 셸 GO** · PM · 2026-09-10)

서랍은 있다. 상시 배너 · Quick Command 칸 · 카드 열 가지 상태 · 실행기 전부 있다. 없는 것은
**사용자가 직접 명령을 치는 줄** 하나이고, 그것은 pty 결정을 필요로 한다.

`19` §C6 REC-010 이 스스로 미검증이라고 적어 두었고(`Real T1 must validate: pty libraries per
runtime; Windows ConPTY`), 이 저장소의 능력 격리 검사가 `node-pty` 를 금지 목록에 두었고,
대상 OS 인 Windows 가 이 런에서 DEFERRED_VALIDATION 이다. **검증할 수 없는 OS 에서 네이티브
모듈을 새로 들이는 것은 검증된 진척이 아니다.**

REC-010 자신이 긴 Quick Command 는 서랍 pty 가 **아니라** 자기 자식 프로세스에서 돈다고 적어
두었으므로 WBS-23 · 24 는 이 결정과 무관하게 온전하다.

**판정 (PM · 2026-09-10): 파이프 셸 GO**, `DV-11-DECISION.md` §4 의 동반 조건 네 개와 함께.
node-pty 는 능력 격리 검사와 미검증 OS 때문에 배제, mock 은 Primary Action 을 미구현으로
남기므로 배제. 위 두 문단은 판정 이전의 근거로 그대로 둔다 — 무엇을 알고 결정했는지가
결정만큼 중요하다. 남은 것은 구현이고, 조건 네 개는 구현의 일부지 후속 과제가 아니다.

### WBS-32 — 실제 프로젝트 도그푸드

`13` §11 DoD 와 `09` §14 의 시나리오는 **비개발자가 이해하는지**를 묻는다. 사람이 앉아서 써 봐야
답이 나오는 질문이고, 에이전트가 대신 답하면 그 답은 증거가 아니라 추정이다. G-1~G-11 전부가
여기 걸려 있다.

### WBS-33 — 패키징 · 서명 · 첫 실행

`electron-builder` 설정과 `pack:win` 스크립트는 있고 Linux `dir` 빌드는 돈다. 남은 것은 서명
인증서와 Windows 첫 실행이다. `13` §8 의 절대 규칙 — **서명 인증서가 없으면 서명되지 않은
빌드임을 표시한다** — 은 표시할 빌드가 있어야 검증된다.

## 이 대장이 말하지 않는 것

**상태 열은 "수락 조건이 코드에 있고 테스트가 그것을 실패시킬 수 있다" 만 뜻한다.** Windows
동작, 실제 사용자의 이해, 서명된 빌드의 첫 실행은 `DEFERRED_VALIDATION.md` 에 있고 이 표는
그것을 대신하지 않는다. 배치별 QA 결과와 그때 고친 것은 `BATCH-*.md` 와 `CHECKPOINTS.md` 에
있고, Canon 자체의 문제는 `CANON_FINDINGS.md` (CF-1 ~ CF-20) 에 있다.
