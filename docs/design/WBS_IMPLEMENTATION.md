# 구현 WBS — 로그인 · 계정별 권한 · 배포까지

> 🛑 **이 문서는 `WBS_REMAINING.md` 로 대체됐다** (Owner/PM 판정 2026-09-13).
> R · P0~P4 의 **ID 와 정의는 그대로 살아 있고** 거기서 이어진다. 바뀐 것:
> ① **실행 단계가 Phase A → MVP 인증 → V1 로 나뉘었다** — P1~P4 는 MVP 인증 전까지 **보류**
> ② **P1-2 의 「서버 테이블 3개」는 낡았다** (X-1a: ERD 21표 모델). 이 텍스트에서 시작하지 않는다
> ③ P1-5 의 마이그레이션 번호가 **4 → 5** (4 는 X-6 프로세스 추적)
> ④ **M-3 도그푸드가 R 트랙보다 먼저**다
> ⑤ P4-1·P4-2 의 Windows 검증은 **Windows 10 1809+ 와 11 둘 다**여야 인증이다
>
> 아래 본문은 판정 이전 상태로 남겨 둔다 — 대조해 읽기 위한 것이다.

> 작성 2026-09-12 · 대상 v0.2 (A안 백엔드 + 비개발자 사이클 보완)
> 순서: **가독성 보완 → 화면 확인 → DB 구성 → CRUD 연결 → 테스트 → 배포**
> (2026-09-12 변경: 프론트엔드 피드백을 먼저 받기로 하여 **R 단계를 맨 앞으로** 옮겼다.
>  ERD 와 WBS 는 이미 나갔으므로, 다음에 사람 눈에 걸리는 것은 화면이다.)
> 우선순위: **필수** = 없으면 배포 못 함 · **보완** = 없으면 사용자가 이탈 · **확장** = 나중

## 먼저: 이 WBS 가 근거로 삼은 것

| 근거 | 실제로 무엇인가 | 상태 |
|---|---|---|
| 확정 화면 | Canon `15`(화면) · `16`(디자인 시스템) · `18`(문구) + 구현된 SC-01~04 · TD-01 | ✅ 있음 |
| Figma | 파일 `wZc5x0SlCm8aqAiPTeXvnA` — **비어 있음.** Starter 플랜 MCP 호출 제한으로 실사용 불가 | ❌ 없음 |
| 시각 프로토타입 | Claude Design 캔버스 "JuQode MVP Visual Design v2" (아트보드 19장) | ✅ 있음 |
| ERD · 테이블 정의 | `docs/design/ERD.md` (로컬 26테이블 + 마이그레이션 3 + 서버 3테이블) | ✅ 갱신됨 |
| MVP 필수 기능 | `README.md` 여섯 능력 | ✅ 있음 |

> **P0-1 이 첫 작업인 이유가 이것이다.** Figma 가 비어 있으므로 "확정된 화면"은 Canon 문서와 구현된 화면이고, 둘이 실제로 일치하는지부터 눈으로 확인해야 그 뒤 작업이 근거를 갖는다.

---

## 완료됨 — 2026-09-12 (이 WBS 이전)

| ID | 내용 | 증거 |
|---|---|---|
| W-19b | 작업 단위 되돌리기 (before-basis 에서 파일 복원) | `tests/revert.test.js` 6/6 |
| W-22b | `qc.git.commit` — 저장점 남기기 (제외목록 적용) | `tests/qc.test.js` |
| W-22c | `qc.deploy` — package.json `deploy` 스크립트 실행 | `tests/qc.test.js` |
| W-23b | 실패한 Quick Command 출력 → 다음 요청 초안 | `app/renderer/screens/td01.js` |
| W-25b | TTY 없는 명령 사전 경고 (차단 아님) | `tests/term.test.js` 2건 |
| W-02b/c | 빈 폴더 상태 + 첫 실행 안내 3줄 | `app/main/project.js` · `sc01.js` |
| W-23c | `no_script` 막다른 길 탈출구 — 4개 규칙 전부 | `tests/qc.test.js` (규칙 목록에서 유도) |
| W-19b-2 | 되돌리지 못한 제외 파일을 **이름으로** 보고 | `tests/revert.test.js` 2건 추가 |
| W-22d | TD-01 입력칸 고정 · 목록에서 골라 실행 · 최소 창 반응형 | `tests/e2e/visual.mjs` 880×600 검사 |
| W-27b | 가지치기한 diff 의 blob 파일 누수 수정 | `tests/revert.test.js` 2건 |
| W-26b | 한 작업의 그룹이 다른 작업의 diff 를 인용하지 못하게 | `tests/explain.test.js` |
| D-ERD | ERD 재작성 (MVP/V1/제안 구분) · dbdiagram 제출 | `docs/design/erd.dbml` · `check-dbml.mjs` |
| D-SPEC | ScreenSpec 캔버스 25장 + 공유용 단일 HTML·PDF | `docs/design/canvas/` |

단위 597/597 · e2e 4개 스위트 통과. **미결: Canon 갱신 3건** (ERD.md §5).

---

# R · 프론트엔드 가독성  ⟵ **지금 최우선**

> **왜 앞으로 왔나.** 실제 화면(`tmp-visual/`)을 열어 보고 코드를 센 결과, 이 제품은 Cursor·Codex
> 대비 **읽을 것이 많고 볼 것이 적습니다.** 비개발자가 쓰기 어려운 이유가 기능이 아니라 화면에
> 있습니다. 측정된 사실 넷:
>
> | 측정 | 값 | 어디 |
> |---|---|---|
> | SC-02 에서 **빈 공간** | 화면 아래 **약 40%** | `sc02-running-light.png` |
> | SC-04 에서 **내용이 0인 열** | 3열 중 **1열 통째로** (Raw Diff) | `sc04-explained-light.png` |
> | SC-03 의 **주 행동(pri) 버튼 수** | **7개** — 전부 주 행동이면 주 행동이 없다 | `sc03.js` |
> | 화면당 **ghost 버튼** | SC-02 11 · SC-03 9 · SC-04 10 | 소스 계수 |
>
> 그리고 「어떤 코드가 바뀌었나요」 열에 **코드가 한 줄도 없습니다.**

### R-1 · 기준선 측정
- **세부** 화면별로 (a) 글자 수 (b) 컨트롤 수 (c) 빈 픽셀 비율 (d) 첫 화면에 보이는 카드 수를 잰다. 고친 뒤 같은 숫자를 다시 재기 위한 것이다 — **느낌으로 판단하지 않는다.**
- **우선순위** 필수 · **선행** 없음
- **도구** `tests/e2e/visual.mjs` 에 계측 추가 · 기존 스크린샷
- **소요** 60분
- **완료 기준** `docs/dev-evidence/readability-before.json` 에 5화면 × 4지표가 숫자로 있다.
- **오류 시** `tests/e2e/visual.mjs` 의 `evalJs` 반환값

### R-2 · 버튼 위계 — 화면당 주 행동은 하나
- **세부** SC-03 의 `pri` 7개를 **1개로** 줄인다. 나머지는 보통 버튼, 부차적인 것은 텍스트 링크. 어떤 버튼이 주 행동인지는 그 화면에서 사용자가 **다음에 할 일** 하나로 정한다.
- **우선순위** 필수 · **선행** R-1
- **도구** `app/renderer/screens/*.js` · `base.css`
- **소요** 90분
- **완료 기준** 5화면 각각에서 채운 버튼이 **정확히 1개**. e2e 가 그것을 센다 (`primaryActions` 검사가 SC-01 에 이미 있다 — 나머지 화면으로 넓힌다).
- **오류 시** `tests/e2e/visual.mjs` `results.primaryActions`

### R-3 · 반복 라벨 없애기
- **세부** SC-04 카드마다 「무엇 / 왜 / 어떤 동작에」가 세로로 반복된다. 카드 3개면 9번이다. 첫 카드에만 두거나, 라벨을 없애고 문장 순서로 뜻을 세운다.
- **우선순위** 필수 · **선행** R-1
- **도구** `app/renderer/screens/sc04.js` · `sc04.css`
- **소요** 60분
- **완료 기준** 카드 하나의 높이가 **30% 이상** 줄고, 첫 화면에 그룹 카드가 **2개 이상** 들어온다 (지금은 1.5개).
- **오류 시** `sc04-explained-light.png` 를 다시 찍어 비교

### R-4 · 빈 열 없애기
- **세부** SC-04 는 3열 고정이라 Raw Diff 를 열지 않으면 1/3 이 빈다. **내용이 있는 열만** 그리고, Raw Diff 는 열이 아니라 블록 카드 안에서 펼친다.
- **우선순위** 필수 · **선행** R-3
- **도구** `app/renderer/screens/sc04.css`
- **소요** 60분
- **완료 기준** Raw Diff 를 열지 않은 상태에서 **빈 열이 없다.** 열었을 때 3열이 된다.
- **오류 시** `sc04.css` 의 `grid-template-columns`

### R-5 · 「어떤 코드가 바뀌었나요」에 코드 넣기
- **세부** 이 열에 지금 코드가 한 줄도 없다 — 블록 이름과 설명만 있다. **바뀐 줄 몇 줄을 색과 함께** 보여준다. Raw Diff 전체가 아니라 그 블록에 해당하는 조각만.
- **우선순위** 필수 · **선행** R-4
- **도구** `app/main/change/blocks.js` (`hunk_ord` · `line_start` · `line_end` 가 이미 있다) · `sc04.js`
- **소요** 90분
- **완료 기준** 블록 카드마다 **추가 초록 · 삭제 빨강**이 붙은 코드 3~8줄이 보인다. `16` §2.1 의 색 문법을 그대로 쓴다.
- **오류 시** `code_block.hunk_ord` 가 null 이면 diff 가 표시 불가이거나 나누지 못한 파일이다 — 그 경우의 문구가 따로 있어야 한다

### R-6 · 각주 접기
- **세부** 한 화면에 각주가 4~5줄이다 (「모양은 지금 상태만 나타내요」「여기는 프로젝트를 바꾸는 요청만 받아요」「작업을 보내면…동의한 것으로 봐요」「끝난 작업은 사라지지 않아요」). **한 번은 보여주되 매번 읽게 하지 않는다** — 처음 N회 이후 `(?)` 로 접는다.
- **우선순위** 보완 · **선행** R-2
- **도구** `app/renderer/copy.js` · 각 화면
- **소요** 60분
- **완료 기준** 첫 사용에는 그대로 보이고, 5번째 방문부터는 각주가 `(?)` 하나로 줄어든다. **정직성은 그대로다** — 지워지는 것이 아니라 접힌다.
- **오류 시** `tests/unit.test.js` copy-key 검사

### R-7 · 접힌 Brief 가 빈칸이 아니게
- **세부** D-132 로 다시 연 프로젝트의 Brief 는 접힌다. 그런데 접히면 **제목과 시각만 남아 카드가 통째로 비어 보인다.** 접힌 상태에 **첫 답 한 줄**을 남긴다.
- **우선순위** 필수 · **선행** R-1
- **도구** `app/renderer/screens/brief.js` (`if (opts.folded) return;` 자리)
- **소요** 45분
- **완료 기준** 접힌 Brief 에 「이 프로젝트가 하는 일」의 첫 답이 한 줄로 보인다. 펼치면 여섯 답 전부.
- **오류 시** `brief.js` 의 folded 분기 · `tests/brief.test.js`

### R-8 · 「지금 할 일」을 눈에 띄게
- **세부** 허용 대기·답 대기가 지금은 **우상단 작은 칩**이다. 사용자가 당장 해야 할 유일한 행동인데 가장 안 보인다. 화면 위쪽에 한 줄 배너로 올리고 행동 버튼을 붙인다.
- **우선순위** 필수 · **선행** R-2
- **도구** `app/renderer/screens/sc02.js` · `sc03.js`
- **소요** 60분
- **완료 기준** 허용 대기 상태에서 **화면 상단 1/4 안에** 무엇을 해야 하는지와 그 버튼이 있다.
- **오류 시** `sc03-*.png` 재촬영

### R-9 · 상단 경로 정리
- **세부** 상단에 `/tmp/juqode-seed-y8pvqI` 같은 전체 경로가 등폭으로 있다. 비개발자에게 의미가 없고 폭만 먹는다. **폴더 이름만** 보이고 전체 경로는 툴팁·펼치기로.
- **우선순위** 보완 · **선행** 없음
- **도구** `app/renderer/design/base.css` `.topbar .projid`
- **소요** 30분
- **완료 기준** 상단에 폴더 이름만 보이고, 마우스를 올리면 전체 경로가 나온다.
- **오류 시** `base.css` 의 `max-width: 42ch` 줄

### R-10 · 재측정 + 비개발자 3명
- **세부** R-1 의 네 지표를 다시 재고, **실제 비개발자 3명**에게 SC-02→SC-03→SC-04 를 보여주고 「지금 무슨 일이 일어났고 다음에 뭘 눌러야 하나」를 말하게 한다. 고쳐 주지 않는다 — **어디서 막히는지만 적는다.**
- **우선순위** 필수 · **선행** R-2~R-9
- **도구** 실행 빌드 · 기록지
- **소요** 90분
- **완료 기준** `readability-after.json` 이 before 대비 **빈 공간 감소 · 컨트롤 감소 · 첫 화면 카드 증가**를 숫자로 보인다. 3명 각각 「어디서 처음 막혔는가」 한 문장.
- **오류 시** — (측정이지 구현이 아니다)

**R 합계: 10작업 · 약 11시간 30분**

---

# P0 · 화면 확인

### P0-1 · 확정 화면 ↔ 구현 대조표 만들기
- **세부** SC-01/02/03/04 · TD-01 을 실행해 스크린샷을 뜨고, Canon `15` 의 상태 목록과 1:1 대조표를 만든다. 오늘 들어온 4개 신규 표면(되돌리기 확인 박스 · 빈 폴더 카드 · 첫 실행 3줄 · 배포 경고 줄)을 표에 추가한다.
- **우선순위** 필수 · **선행** 없음
- **도구** `npm start` · `tests/e2e/visual.mjs` · Claude Design 캔버스
- **소요** 60분
- **완료 기준** `docs/design/SCREEN_MATRIX.md` 에 화면×상태 행이 모두 채워지고, 각 행에 스크린샷 파일명 또는 "미구현" 이 적혀 있다.
- **오류 시** `tests/e2e/visual.mjs` 의 `results` JSON · `app/renderer/copy.js` (문구 누락이면 여기)

### P0-2 · 로그인 화면 · 상한 카드 와이어 그리기
- **세부** 신규 화면 2개를 캔버스 아트보드로 그린다: ① 로그인(이메일/매직링크/오프라인 유예) ② 하루 상한 도달 카드. `16` 색·`18` 어투를 그대로 쓴다.
- **우선순위** 필수 · **선행** P0-1
- **도구** Claude Design 캔버스 (Figma 는 비어 있어 쓰지 않음)
- **소요** 90분
- **완료 기준** 아트보드 2장이 캔버스에 있고, 각 화면의 상태(입력중·실패·오프라인유예)가 별도 아트보드로 있다.
- **오류 시** 캔버스 아티팩트 URL · `app/renderer/design/tokens.css` (색 토큰 불일치면 여기)

### P0-3 · 신규 문구 Canon 반영 요청서 작성
- **세부** ERD.md §5 의 CF-22 · CF-23 · F-17 · write-class 4건을 JuQode-Private 에 낼 변경 요청 문서로 정리. **JuQode-Private 은 건드리지 않는다** — 요청서만 이 저장소에 둔다.
- **우선순위** 필수 · **선행** P0-2
- **도구** 텍스트 편집
- **소요** 45분
- **완료 기준** `docs/design/CANON_CHANGE_REQUEST.md` 에 4건 각각 「현재 Canon 문장 · 구현 문장 · 바꿔야 하는 이유 · 판정자 · 날짜」가 있다.
- **오류 시** `app/renderer/copy.js` 의 `gap.*` 주석 (각 CF 번호가 거기 적혀 있다)

---

# P1 · DB 구성

### P1-1 · Supabase 무료 프로젝트 슬롯 확보
- **세부** 프로토타입 `xkydfvbwgwcoenbpzdew` 를 프로덕션으로 승격한다. ① `night_run_v0` 스키마 + `public` 미러 드롭 ② 개방 RLS 정책 전부 삭제 ③ 살릴 데이터가 있으면 드롭 전에 받아 둘 것.
- **우선순위** 필수 · **선행** 없음 · **결정됨 (D-A7)**: 프로토타입 승격
- **도구** Supabase 대시보드 · Supabase MCP `list_projects`
- **소요** 30분
- **완료 기준** 대시보드에서 프로덕션용 프로젝트가 `ACTIVE_HEALTHY` 이고, 그 안에 `night_run_v0` 같은 프로토타입 스키마가 **없다**.
- **오류 시** Supabase 대시보드 → Settings → Billing (상한 초과 시 여기서 막힌다)

### P1-2 · 서버 테이블 3개 + RLS 적용
- **세부** `BACKEND_A.md` §3 의 `profile` · `policy` · `usage_day` 와 3개 RLS 정책을 마이그레이션으로 적용.
- **우선순위** 필수 · **선행** P1-1
- **도구** Supabase MCP `apply_migration` · `list_tables`
- **소요** 45분
- **완료 기준** Studio 테이블 편집기에 3개가 보이고, 각 테이블 RLS 배지가 **Enabled**. 익명 키로 `select` 하면 0행이 온다.
- **오류 시** Supabase → Logs → Postgres · `get_advisors`(security)

### P1-3 · `consume_work()` RPC + 동시성 검증
- **세부** RPC 를 만들고, 같은 계정으로 병렬 호출해도 `works` 가 정확히 1씩 오르는지 확인 (`for update` 가 실제로 잠그는지).
- **우선순위** 필수 · **선행** P1-2
- **도구** Supabase MCP `execute_sql` · `apply_migration`
- **소요** 60분
- **완료 기준** 상한 3인 계정에서 5번 연속 호출 → `allowed` 가 `true,true,true,false,false` 로 나온다. 20개 병렬 호출 후 `usage_day.works` 가 정확히 상한값에서 멈춘다.
- **오류 시** Supabase → Logs → Postgres (`deadlock detected` / `permission denied for table`)

### P1-4 · 관리자 시나리오 손으로 돌려보기
- **세부** Studio 에서 `policy.daily_work_limit` 를 바꾸고, `profile.status` 를 `suspended` 로 바꿔 RPC 응답이 즉시 달라지는지 확인. V1 관리자 화면은 Studio 다.
- **우선순위** 필수 · **선행** P1-3
- **도구** Supabase Studio
- **소요** 30분
- **완료 기준** 상한을 5→1 로 내린 직후 호출이 `allowed=false` 로 바뀐다. `suspended` 계정은 상한과 무관하게 `false`.
- **오류 시** `consume_work()` 본문 (`security definer` · `search_path` 누락이 흔하다)

### P1-5 · 로컬 마이그레이션 4 — `project.owner_id`
- **세부** `project` 테이블 재작성(`project_new` → 복사 → rename), `unique(owner_id, path)`. 기존 행의 `owner_id` 는 최초 로그인 계정으로 채운다.
- **우선순위** 필수 · **선행** P1-2
- **도구** Claude Code · `node --test tests/store.test.js`
- **소요** 90분
- **완료 기준** 기존 DB 파일을 열면 History 가 그대로 있고 `owner_id` 컬럼이 있다. 다른 `owner_id` 로 같은 경로를 열면 **행이 2개** 생긴다.
- **오류 시** `app/main/db/db.js` `migrate()` · 부팅 로그 `db.refused` (`JUQODE_TRACE=1`)

### P1-6 · `repo.js` 프로젝트 읽기 전부에 소유자 조건
- **세부** `openProject` · `recentProjects` · `select * from project where id = ?` 를 전부 찾아 `owner_id` 조건을 건다. **빠뜨리면 계정 전환 시 남의 프로젝트가 보인다.**
- **우선순위** 필수 · **선행** P1-5
- **도구** `grep -n "from project" app/main/` · Claude Code
- **소요** 60분
- **완료 기준** 계정 A 로 프로젝트 2개를 열고 로그아웃 → 계정 B 로 로그인하면 최근 목록이 **비어 있다.**
- **오류 시** `app/main/db/repo.js` · `app/main/ipc.js` (`select * from project where id = ?` 가 여러 곳에 있다)

### P1-7 · 구독 테이블 + 등급 판정 (결제 없음)
- **세부** `plan` · `subscription` 을 만들고 `consume_work()` 이 상한을 **plan → policy 오버라이드** 순으로 읽게 한다. `payment` · `billing_webhook` 은 선언만 하고 비워 둔다 (D-A5).
- **우선순위** 필수 · **선행** P1-3
- **도구** Supabase MCP `apply_migration` · `execute_sql`
- **소요** 60분
- **완료 기준** 무료 등급 계정과 유료 등급 계정의 `consume_work()` 상한이 서로 다르게 나온다. `policy.daily_work_limit_override` 를 넣으면 그것이 이긴다.
- **오류 시** `consume_work()` 본문 · `subscription.status` 값 (active 가 아닌 구독이 상한을 주면 안 된다)

### P1-8 · 등급 없는 계정의 기본값 확인
- **세부** 구독 행이 아예 없는 신규 계정이 어떻게 되는지. 무료 등급 기본값으로 떨어지는지, 아니면 0 이 되어 아무것도 못 하는지.
- **우선순위** 필수 · **선행** P1-7
- **도구** Supabase `execute_sql`
- **소요** 30분
- **완료 기준** 가입 직후(구독 행 없음) 계정이 무료 등급 상한으로 Work 를 시작할 수 있다. **0 이 되어 막히지 않는다.**
- **오류 시** `consume_work()` 의 coalesce 분기

---

# P2 · CRUD 연결

### P2-1 · 네트워크 허용 origin 하나 뚫기
- **세부** `security.js` `enforceLocalOnly()` 에 Supabase origin 한 개만 추가. 와일드카드 금지. 차단 카운터는 그대로 둔다.
- **우선순위** 필수 · **선행** P1-2
- **도구** Claude Code · `node --test tests/security.test.js`
- **소요** 30분
- **완료 기준** 앱 실행 중 `https://<ref>.supabase.co/auth/v1/health` 가 200 을 받고, 아무 다른 도메인 요청은 여전히 취소된다(e2e 의 외부요청 카운트).
- **오류 시** DevTools Network 탭 · `tests/e2e/boot.test.mjs` 의 `externalRequests`

### P2-2 · `auth.js` — 토큰 저장과 세션 읽기
- **세부** Electron `safeStorage` 로 토큰 암호화 저장(네이티브 의존성 추가 금지). 세션 읽기 · 갱신 · 삭제.
- **우선순위** 필수 · **선행** P2-1
- **도구** Claude Code · Electron `safeStorage`
- **소요** 90분
- **완료 기준** 로그인 후 앱을 껐다 켜도 로그인 상태가 유지된다. `userData` 안의 토큰 파일을 텍스트로 열면 **읽을 수 없다.**
- **오류 시** `app/main/auth.js` · `safeStorage.isEncryptionAvailable()` (Linux 는 키링 없으면 false)

### P2-3 · 채널 3개 + preload 노출
- **세부** `juqode:auth-me` · `auth-login` · `auth-logout`. preload 에 named 메서드로만 노출. **e2e 의 surface 목록도 같이 갱신** (`tests/e2e/visual.mjs`).
- **우선순위** 필수 · **선행** P2-2
- **도구** Claude Code · `npm run test:e2e`
- **소요** 45분
- **완료 기준** e2e 의 `renderer API surface is not exactly the declared one` 가 통과한다.
- **오류 시** `app/preload/preload.js` ↔ `app/main/ipc.js` (둘의 채널 목록이 정확히 같아야 한다)

### P2-4 · 로그인 화면 + 오프라인 유예
- **세부** `juqode:boot` 보다 먼저 신원을 정한다. 미로그인 → 로그인 화면. 토큰이 살아 있고 마지막 검증이 7일 이내면 네트워크 없이도 동작하고, 화면이 그 사실을 말한다.
- **우선순위** 필수 · **선행** P2-3 · P0-2
- **도구** Claude Code · `app/renderer/screens/`
- **소요** 90분
- **완료 기준** 네트워크를 끊고 앱을 켜면 유예 안내와 함께 SC-01 이 뜬다. 8일 지난 토큰이면 로그인 화면이 뜬다.
- **오류 시** `app/renderer/renderer.js` 의 부팅 순서 · DevTools Console

### P2-5 · preflight 0단계 — 상한 소모
- **세부** `supervisor.preflight` 의 4단계 **직후**(= `work` 행 생성 직전)에 `consume_work()` 를 넣는다. `20` 의 "History = 시작된 Work" 와 카운트 정의를 일치시킨다.
- **우선순위** 필수 · **선행** P2-3 · P1-3
- **도구** Claude Code · `node --test tests/work.test.js`
- **소요** 60분
- **완료 기준** 상한 1인 계정에서 Work 를 하나 끝내고 다시 요청하면 상한 카드가 뜬다. Claude Code 가 꺼져 있어서 실패한 요청은 **카운트를 쓰지 않는다.**
- **오류 시** `app/main/work/supervisor.js` `preflight()` · Supabase `usage_day` 행

### P2-6 · 상한 카드 문구 + 화면
- **세부** 담을 사실 셋: 오늘 몇/몇 · 언제 초기화(서버 `current_date`) · 누구에게 말해야 늘어나는지. 문구는 `gap.*` 에 CF 번호와 함께.
- **우선순위** 필수 · **선행** P2-5 · P0-3
- **도구** Claude Code · `app/renderer/copy.js`
- **소요** 45분
- **완료 기준** 상한 도달 상태에서 카드에 세 사실이 모두 보인다. `tests/unit.test.js` 의 copy-key 검사 통과.
- **오류 시** `tests/unit.test.js` "every copy key the renderer NAMES actually exists"

### P2-7 · 감사 로그 업로드 (요약만)
- **세부** Work 종료 시 `{누가 · 프로젝트 id 해시 · 승인한 도구 종류 · 결과}` 만 보낸다. **diff · 코드 · 경로 · 프롬프트는 보내지 않는다.**
- **우선순위** 보완 · **선행** P2-5
- **도구** Claude Code · Supabase MCP
- **소요** 60분
- **완료 기준** Supabase 테이블에 행이 쌓이고, 그 행 어디에도 파일 경로나 코드가 없다(행 하나를 눈으로 읽어 확인).
- **오류 시** Supabase → Logs → API · `app/main/work/supervisor.js` 종료 경로

---

# P3 · 테스트

### P3-1 · 계정 격리 회귀 테스트
- **세부** 계정 A 의 프로젝트가 계정 B 에게 절대 보이지 않는다를 저장소 계층에서 측정.
- **우선순위** 필수 · **선행** P1-6
- **도구** `node --test tests/store.test.js`
- **소요** 60분
- **완료 기준** `owner_id` 조건을 한 군데라도 지우면 테스트가 **실패한다** (직접 지워 보고 확인).
- **오류 시** `tests/store.test.js`

### P3-2 · 상한 경계 테스트
- **세부** 0회·상한-1·상한·상한+1, 그리고 자정 넘김(서버 날짜 기준).
- **우선순위** 필수 · **선행** P2-5
- **도구** `node --test` · Supabase `execute_sql`
- **소요** 60분
- **완료 기준** 네 경계가 모두 기대대로. 날짜를 하루 넘기면 카운트가 0부터 다시 시작한다.
- **오류 시** `consume_work()` 의 `current_date` (서버 타임존이 UTC 라는 것을 화면이 말하는지도 확인)

### P3-3 · 오프라인 · 네트워크 실패 경로
- **세부** 로그인 중 끊김 · 정책 읽기 실패 · 상한 호출 실패 세 경우. **결정됨 (D-A6): 막지 않는다** — 마지막으로 읽은 정책으로 7일 동작하고, 8일째부터 로그인 화면. 유예 중에는 화면이 오프라인 상태임을 말하고, 그 동안 쌓인 사용량은 다음 접속 때 정산한다.
- **우선순위** 필수 · **선행** P2-4 · P2-5
- **도구** DevTools Network throttling · `node --test`
- **소요** 90분
- **완료 기준** 세 경우 모두 화면이 무슨 일이 있었는지 말한다. 7일이 지난 토큰으로는 Work 가 시작되지 않는다. 조용히 실패하는 경로가 **없다.**
- **오류 시** `app/main/auth.js` · DevTools Console

### P3-4 · 오늘 들어온 6개 기능 수동 검수
- **세부** 되돌리기(편집·생성·삭제·바이너리) · 저장(빈 폴더에서 init 포함) · 배포(스크립트 없음/있음) · 실패→초안 · TTY 경고 · 빈 폴더 카드.
- **우선순위** 필수 · **선행** P0-1
- **도구** `npm start` · 실제 폴더
- **소요** 90분
- **완료 기준** 각 항목 스크린샷 1장 + 한 줄 판정이 `docs/dev-evidence/` 에 남는다.
- **오류 시** 각 기능의 테스트 파일 (`tests/revert.test.js` · `tests/qc.test.js` · `tests/term.test.js`)

### P3-5 · 전체 스위트 + 변이 확인
- **세부** 단위 + e2e 전부. 새로 들어온 가드(소유자 조건 · 상한) 를 일부러 깨서 테스트가 잡는지 확인.
- **우선순위** 필수 · **선행** P3-1~4
- **도구** `npm test` · `scripts/mutate`
- **소요** 60분
- **완료 기준** 전부 초록. 가드를 지우면 빨강. **타임아웃은 kill 이 아니다** — 실제 실패 메시지를 확인할 것.
- **오류 시** 각 테스트 파일 · `.mutate-work/`

---

# P4 · 배포

### P4-1 · 빌드 설정 점검 (Windows 우선)
- **세부** `electron-builder` 로 win nsis + zip. D-125 대상 OS 가 Windows 인데 **이 저장소는 Linux 에서만 측정됐다.**
- **우선순위** 필수 · **선행** P3-5 · **⚠ Windows 호스트 필요**
- **도구** `npm run pack:win` · Windows 머신
- **소요** 60분
- **완료 기준** Windows 에서 설치되고 앱이 뜬다. `claude.cmd` 탐지(DV-9)가 실제로 동작한다.
- **오류 시** `app/main/claude-detect.js` `resolveBin()` · `dist/win-unpacked/`

### P4-2 · 서명 여부 화면 확인
- **세부** WBS-33: 서명 안 된 빌드는 화면이 그렇게 말한다. 실제 설치본에서 그 문구가 나오는지.
- **우선순위** 필수 · **선행** P4-1
- **도구** `npm run pack:win` · `JUQODE_SIGNATURE_EXE` 픽스처
- **소요** 30분
- **완료 기준** 설치본 SC-01 에 서명 안내가 보인다.
- **오류 시** `app/main/signing.js` · `tests/signing.test.js`

### P4-3 · Supabase 프로덕션 설정 잠그기
- **세부** 이메일 확인 켜기 · 리다이렉트 URL 제한 · 익명 가입 차단 · advisors 경고 0.
- **우선순위** 필수 · **선행** P1-4
- **도구** Supabase MCP `get_advisors` · Studio → Auth
- **소요** 45분
- **완료 기준** `get_advisors(security)` 결과가 비어 있다.
- **오류 시** Supabase → Advisors 탭

### P4-4 · 첫 사용자 5명 파일럿
- **세부** 실제 비개발자 5명에게 설치본을 주고 첫 30분을 옆에서 본다. 어디서 멈추는지만 기록한다 — 고치지 않는다.
- **우선순위** 필수 · **선행** P4-1 · P4-2
- **도구** 설치본 · 기록지
- **소요** 90분 × 5
- **완료 기준** 5명 각각 "어디서 처음 멈췄는가" 한 문장이 있다.
- **오류 시** — (측정이지 구현이 아니다)

### P4-5 · 100명 규모 점검
- **세부** MAU · DB 용량 · egress 를 실제 수치로 확인하고, 무료 프로젝트 자동 일시정지(7일 저활동) 가 걸릴 조건인지 판단.
- **우선순위** 보완 · **선행** P4-4
- **도구** Supabase → Usage
- **소요** 30분
- **완료 기준** 사용량 페이지 수치가 무료 한도(MAU 50,000 · DB 500MB · egress 5GB) 대비 몇 % 인지 문서에 적힌다.
- **오류 시** Supabase → Organization → Usage

---

## 확장 (지금 만들지 않음)

| 항목 | 추가 시점 |
|---|---|
| 조직/역할 RBAC · SSO | 계정이 두 자리가 되고 "누가 무엇을 못 하게" 가 실제 민원이 될 때 |
| 파일수정·터미널 on/off 정책 | 읽기 전용 계정 요구가 실제로 들어올 때 (`allowSpec()` 한 곳에 붙는다) |
| 클라우드 Context 저장 · Skill 공유 | V2~V3. **코드 파생물이 서버로 나가므로 §2 의 약속이 바뀐다 — 별도 동의 필요** |
| 무료 모델(OpenCode 등) 지원 | V3. README 3번 "Claude Code ONLY" 를 여는 결정이고 `claude/session.js` 전제가 모델별로 갈라진다 |
| 토큰 프록시 · 사용량 미터링 | 회사가 토큰 비용을 내기로 바뀔 때만 |

## 합계

| 단계 | 작업 | 시간 |
|---|---|---|
| **R 가독성** | **10** | **11h 30m** |
| P0 화면 확인 | 3 | 3h 15m |
| P1 DB 구성 | 8 | 6h 45m |
| P2 CRUD 연결 | 7 | 7h |
| P3 테스트 | 5 | 6h |
| P4 배포 | 5 | 10h 45m (파일럿 7.5h 포함) |
| **계** | **38** | **약 45시간** |

**창업자 결정이 막고 있는 것 1건:** P4-1 — Windows 호스트.

---

## 접어 둔 것 (지금 하지 않는다)

| 항목 | 왜 접었나 |
|---|---|
| 와이어프레임을 Figma 로 옮기기 | Figma MCP 월 20회 한도 소진 · ERD 와 WBS 가 이미 나갔으므로 지금 급한 것은 화면 자체다 |
| 캔버스 공개 링크 | `AG_EDU` 조직이 「Anyone with the link」를 잠가 두었다 — 코드로 풀 수 없다. 필요하면 `docs/design/canvas/screenspec.html`(파일 하나, 계정 불필요)이나 PDF 로 전달 |
| 공통 파일 관리 표 | 관리할 파일이 사실상 diff 하나뿐 — `output_ref` 를 실제로 쓸 때 함께 |
| 교차 참조 복합 외래키 | 저장 계층이 거부하고 테스트가 고정한다. 정식 해법은 Canon 판정 대상 | (P1-1 · P3-3 은 2026-09-12 에 결정됨: D-A7 · D-A6)
