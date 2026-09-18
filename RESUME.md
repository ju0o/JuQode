# RESUME — JuQode Autonomous MVP Long Run V2

**마지막 체크포인트:** 배치 37 (2026-09-18) · 브랜치 `dev/mvp-autonomous-v01` (**푸시 완료** · Draft PR [#4](https://github.com/ju0o/JuQode/pull/4))
**작업 트리:** clean · 백그라운드 프로세스 없음 · stash 없음 · worktree 없음
**스위트:** unit **597/597** · `check-dbml` 통과(49표 · MVP 26표를 `schema.sql` 과 대조) ·
`visual.mjs` PASS · `boot.test.mjs` PASS · `offline-shutdown.mjs` PASS
**정지 사유:** 사람이 더 시킬 때까지. **§3 ③ 은 여전히 닫혀 있고**, 게이트 없는 Phase A
작업 둘(R-0 · P0-1)이 남아 있다 — 배치 36 때와 달리 「할 것이 없다」가 아니다 (§4).

> **저장소는 PUBLIC 이다** (2026-09-18 확인). 배치 37 에서 히스토리 전체를 훑었다 —
> 모든 브랜치 끝점 · 모든 blob · 민감해 보이는 파일 이름. 걸린 것은 전부 **합성 픽스처**다
> (`ghp_0123456789…` · `AKIA0123456789ABCDEF` — JuQode 가 비밀을 **가리는지** 재는 테스트의
> 재료다). `experiments/a1/exp4-credentials.sh` 는 자격증명이 아니라 OS 키링이 **있는지**
> 묻는 탐침이다. 진짜 자격증명은 히스토리에 없다.

**세 게이트가 전부 닫혔다.** ① · ② 는 Founder 개정 D-138 (2026-09-11) 로 열려 배치 36 에서
닫혔고, ② 의 마지막 둘은 PM 이 **폐기**로 판정했다. 남은 것은 §3 ③ — **사람과 Windows** 뿐이다.

> **Canon 은 PM 승인(2026-09-11) 뒤 커밋·푸시되었다** — `JuQode-Private` `7c28496`
> (브랜치 `canon/mvp-run-implementation-findings` · Draft PR [#14](https://github.com/ju0o/JuQode-Private/pull/14),
> #13 위에 쌓여 있다). 배치 36 의 구현이 근거로 삼는 문서가 그것이다. **둘 다 머지 승인 안 됨.**

---

## 1. 다음 재개 시 그대로 붙여넣을 지시문

```
CONTINUE THE SAME JUQODE AUTONOMOUS MVP LONG RUN.
Do NOT restart planning. Do NOT create a new run. Do NOT reset the branch.
Current remote branch: dev/mvp-autonomous-v01
Last checkpoint: batch 37 (2026-09-18). Working tree clean, all suites green (unit 597/597).

Read RESUME.md first, then docs/design/WBS_REMAINING.md.

Gates ① and ② are CLOSED. Gate ③ is still shut and may NOT be done by the agent.
Batch 36 said there was nothing left outside the gates; the 2026-09-13 Owner/PM ruling
reopened planning/reconciliation work, and batch 37 did four of Phase A's seven.

Do this, in order:
  1. Do the two Phase A items that need NO gate — R-0 (e2e assertion impact map) and
     P0-1 (screen ↔ Canon matrix). WBS_REMAINING.md §12 rows 5 and 6 define them.
  2. Then ask the PM the three one-line questions in RESUME §4 (G-G · G-F · G-C). Each one
     unblocks work that is already specified — do not invent the answers.
  3. Ask the PM whether §3 ③ has opened, and hand them its "무엇이 있어야 풀리나".
  4. If ③ is shut and the three questions are unanswered, there is NOTHING left that the
     agent may do alone. STOP and say so. Do not invent work.

Do NOT start P1 / P2 / P3 / P4 production implementation. They are held until MVP_CERTIFIED
(WBS_REMAINING.md §7). The single exception is X-6, and only if G-F says yes.

Do NOT build `work.requested` or `qc.terminal`. They are RETIRED (PM, 2026-09-11), the
implementation already has neither, and `tests/e2e/visual.mjs` now MEASURES that absence
together with what must stay. Finishing the backlog by building them is the failure mode
those five assertions exist to stop.

Canon (`JuQode-Private/docs/current/**`) is the Owner's to write — file writes there were
blocked in this session. See §4 for the two items still waiting on them.

Keep the same operating loop: IMPLEMENT → TEST → PRODUCT QA → TECHNICAL/SECURITY QA →
TEST ADVERSARY → VISUAL QA when UI changes → FIX → RETEST → MUTATION / NEGATIVE CHECK →
CHECKPOINT COMMIT → CONTINUE.
Never push a red suite. Windows-only requirements remain DEFERRED_VALIDATION.
```

---

## 2. 이번 세션에 한 일 (배치 34 · 35 · 36)

| 커밋 | 내용 |
|---|---|
| `70345ef` | 배치 33 의 빨간 단언 해제 — 원인은 행 선택이 아니라 단언 자체였다 |
| `6e11da6` | td01 픽스처 + 네 상태 e2e · 스윕 러너 `ONLY=` 재측정 모드 |
| `2935e47` | **DV-11 PM 판정** 기록 (파이프 셸 GO · 동반 조건 4개) |
| `b0d338c` `f5c7547` | **WBS-25** 셸 명령줄 — 메인 프로세스 |
| `7f6630c` | **WBS-25** 화면 + **CF-22** + `BATCH-34-QA.md` |
| `1c34685` | td01 뮤턴트 5/5 사살 |
| `a31b083` | 남은 렌더러 생존자 11개 — 7 사살 · 4 GONE · **생존 0** |
| `1237661` | 셸이 시작되지 않는 상태 · `exit` 뒤에 죽어 있던 줄 (**제품 결함**) |
| `69b65d9` | td01 전체 스윕 첫 측정 — 15개 중 12 사살, 나머지 처리 |
| `db1b199` | **`16` §2.1 초록 ▸ 를 화면에 올림** · 나가는 길 없던 카드 하나 |
| `d1f0516` | 문구 검사가 이름만 보고 있었다 — 열두 개가 숨어 있었다 |
| `294ad3c` | `term/session.js` 첫 스윕 — 6개 중 5 사살, 남은 하나는 **동등**(근거 기록) |
| `4b1ebf3` | **배치 36 · D-138** SC-02 위계 개정 + **게이트 ① · ② 닫음** (아래 §2.1) |
| `bee695c` | **PM 폐기 판정의 회귀 검사** — 두 컨트롤의 **부재**를 측정한다 (§2.2) |

전체 기록: `BATCH-34-QA.md` · `BATCH-35-QA.md` · `CHECKPOINTS.md`.

**측정된 것:**
- 렌더러 뮤턴트 **생존 0** (배치 33 생존자 35 → 6 GONE · 25 사살 · 추출로 생긴 3도 사살)
- `td01.js` 전체 15 사이트 → 12 사살 → 나머지 처리 후 **13 사이트 전부 커버**
- 초록 ▸ 대비 **6.96:1**(밝게) · **7.36:1**(어둡게), 두 테마 색이 서로 다름

**이번에 찾은 제품 결함 넷:**
1. `exit` 뒤의 다음 줄이 **아무 일도 하지 않았다** — 세션 없음이 `closed`/`not-open` 두
   이름으로 오는데 렌더러가 앞의 것만 봤다. 거절 이유조차 화면에 없어 터미널이 죽은 것처럼
   보였다.
2. **시작 실패 카드에 누를 것이 하나도 없었다** — `18` 은 `▸ 다시 보내기` 를 처음부터
   갖고 있었고 `refusalCard` 는 콜백까지 받고 있었다.
3. **`16` §2.1 의 초록 ▸ 가 화면에 존재한 적이 없다** — `.rec` 를 정의하는 스타일시트가
   없었다. 코드는 세 곳에서 그 문법을 인용하고 있었다.
4. **액터 칩이 `'JUQODE'` 를 하드코딩** — `18` 에 없는 낱말이다. 낱말은 사전에서, 대문자는
   스타일시트에서로 옮겼다(형제인 Claude 칩이 이미 그렇게 한다).

**내 코드에서 나온 것 하나:** 배치 34 에 넣은 포커스 복원의 겹친 가드가 `back` 이 null 일 때
`back.value` 에 닿아 **렌더 도중 throw** → 서랍 전체가 안 그려진다. 뒤에 이미 `try/catch` 가
있었다. 겹친 가드가 방어가 아니라 새 크래시 경로였다.

---

### 2.1 배치 36 — Founder 개정 D-138 (재부팅으로 끊겼다가 이어서 끝냄)

크래시 직전 작업이 12개 파일에 uncommitted 로 남아 있었다. Canon 쪽 근거(D-138 · `18` · `15`)를
확인하고 이어서 끝냈다.

**측정된 것:**
- 기본 SC-02 의 가장 큰 물체 `brief` → `intent`, 밀도 **0.765 → 0.424**
- Work 가 도는 동안 가장 큰 물체도 주 열 첫 카드도 `stream`
- **1440 · 1280 · 1024 에서 주어도 순서도 같고 가로 스크롤 0** (D-138 §9)

**제품 결함 셋:** Work 가 도는 중에도 `아직 요청한 작업이 없어요` 라고 말했다 · 실패한 Work 의
`변경 읽기` 가 조건 없이 붙어 빈 리더를 여는 버튼이었다 · 가드 카드에 `15` 의 네 동작 중 하나만
있었다(`기다리기` 를 "안 누르면 되는 일" 로 접은 판단이 틀렸다 — 닫을 길이 없으면 알림이 사용자가
들고 있는 요청 위에 앉아 있는다).

**내 검사에서 나온 것 둘:**
1. `visual.mjs` 가 Brief 의 여섯 답을 **도착 직후**에 읽고 있었다. D-138 은 해석이 끝나면 접힘이
   기본이므로 그 자리에서 0 이다 — 크래시가 남긴 빨간 단언이 이것이었다. 기본 상태를 먼저 재고
   여섯 답은 `펼치기` 를 누른 자리에서 잰다.
2. **시각 QA 가 잡았다:** 레일의 머리줄이 줄어들기만 해서 자기 버튼을 라벨보다 좁게 눌렀고
   `다시 읽\n기` · `펼치\n기` 로 낱말이 가운데서 끊겼다. **단언은 전부 통과한 상태였다.**
   Range 의 줄 수를 세는 검사를 남겼다.

PENDING 문구 목록 **12 → 3** (`work.ago` · `term.mock` · `qc.full` 은 이미 "결정됨", 새로 남은
둘은 `work.requested` · `qc.terminal` — 둘 다 Founder 판단).

### 2.2 PM Canon/MVP Closure 판정 (2026-09-11)

**`work.requested` · `qc.terminal` = 폐기.** 문구 키가 있다는 이유로 라벨을 붙이지 않는다
(요청문이 스스로를 이름한다 · D-138 §6) · 목적지가 이미 들어와 있는 표면인 컨트롤은 동작이
아니다 (Quick Command 는 TD-01 안에 그대로 · **D-134 불변**).

**구현은 이미 둘 다 만든 적이 없다** — 고칠 코드가 없었고, 문제는 **부재가 측정되지 않았다는
것**이었다. 다섯 검사를 **쌍으로** 넣었다: 요청문이 있다 / 라벨이 없다 · QC 가 TD-01 안에 있다 /
자기참조 링크가 없다. 한쪽만 걸면 반대로 깨진다. 라벨은 **문구 키가 아니라 렌더된 글자**로 본다.

**PR 스택 판정:** #14 가 단일 누적 Canon Closure PR 이다. #13 은 **SUPERSEDED**
(`956a8c3` 이 `7c28496` 의 조상임을 기계로 확인) — 표시해 두었고 **닫지는 않았다.**

---

### 2.3 배치 37 (2026-09-18) — Owner/PM 판정을 받아 적고, Phase A 를 열고, 영상을 찍었다

배치 36 이후 **2026-09-13 Owner/PM 조건부 승인**이 도착했다. 그것이 「할 것이 없다」를
「게이트 없이 지금 할 것이 일곱」으로 바꿨다 (`WBS_REMAINING.md` §12).

| 커밋 | 내용 |
|---|---|
| `55d49c1` | **X-1 판정 기록** — `SPEC_RECONCILE.md` · `WBS_REMAINING.md`, 그리고 낡아진 세 문서에 낡았다고 적음 |
| `ed031a3` | **X-3 + P3-7** — ERD ↔ `schema.sql` 대조 검사기, `npm run test:unit` 이 먼저 돈다 |
| `d526c9f` | **실사용 영상** + `tests/e2e/fixture.mjs` 추출 + README 교체 |
| `77e6a8d` | README — GIF 8초를 앞에 (GitHub 은 저장소 mp4 를 재생하지 않는다) |
| `77c5cb6` | `security.test.js` 의 userData 검사가 **파일 이름에 묶여 있던 것** 수정 |

**Phase A 진척: 7 중 4.** ① e2e 기준선 ✅ · ② X-1 ✅ · ③ X-3 ✅ · ④ P3-7 ✅ ·
⑤ R-0 ❌ · ⑥ P0-1 ❌ · ⑦ X-7 (G-G 대기).

**측정된 것:**
- `check-dbml.mjs` 가 이제 **MVP 26표의 표·컬럼·not null** 을 `schema.sql` + `db.js`
  MIGRATIONS 와 대조한다. `schema.sql` 에서 `stopped_at` 을 지우면, `project.name` 의
  not null 을 떼면 **빨개진다** — 둘 다 직접 지워 확인했다.
- 실사용 영상 **81.6초 · 0.9 MB** · 1280x800 @24. 릴리스 `demo-v0.1` 자산.
- GitHub 은 저장소 raw 도 릴리스 자산도 `application/octet-stream` + `nosniff` 로 내려준다 —
  `<video>` 태그는 **재생되지 않는 빈 상자**가 된다. 실측.

**검사기 자체에서 나온 결함 둘** (그림의 결함이 아니었다):
1. `-- user's words` 의 **아포스트로피 하나**가 문자열 시작으로 읽혀 `quick_command_run` 의
   표 끝 `)` 까지 삼켰다. 그래서 그 표는 통째로 잘린 채 비교되고 있었다.
2. dbdiagram 은 예약어 컬럼을 `"text"` 로 따옴표 친다. 따옴표를 벗기지 않아 세 표의 그 컬럼이
   **파일 전체에서 존재하지 않는 것**이 되어 있었다 — `Ref:` 검사까지 같이 눈감고 있었다.

**내 리팩터에서 나온 것 하나:** `fixture.mjs` 추출이 `security.test.js` 를 빨갛게 만들었다.
규칙이 깨진 게 아니라 **검사가 `visual.mjs` 안의 글자를 찾고 있었다.** 고치면서 드러난 것:
`scripts/demo/record-demo.mjs` 도 앱을 띄우는데 **그 검사 밖에 있었다.** 목록에 넣었고,
녹화기에서 `JUQODE_USER_DATA` 를 빼면 빨개지는 것을 확인했다.

**`main` 에도 푸시했다** — README 와 영상만. **구현은 머지하지 않았다** (PR #4 는 Draft 그대로).
인수 판정이 나지 않은 것을 기본 브랜치에 두지 않는다는 규칙은 그대로다.

---

## 3. ⚠️ HUMAN GATE — 남은 것은 ③ 하나

### ① 문구 중복 4개 — **닫힘 (2026-09-11 · D-138 개정과 함께)**

`18` 쪽에서 풀렸다. `presence.title` 은 **접혔고**(같은 네 글자 · §0.8), 나머지 셋은 중복이
**아니었다** — `work.observed` · `work.open` · `qc.kicker` 는 각각 다른 표면의 이름이고
어느 화면도 그리지 않고 있었을 뿐이다. 셋 다 배치 36 에서 화면에 올라갔다.
규칙(`copy.js` 에서 고치지 않는다)은 지켜졌다: `18` 이 먼저 바뀌었다.

### ② 미구현 컨트롤 7개 — **닫힘 (다섯 구현 · 둘 폐기)**

`15` 부록(Human Gate ② 판정 기록 · 2026-09-11)이 자리를 정해 주었다.

| 키 | 상태 |
|---|---|
| `guard.answer` · `guard.wait` · `work.now` · `work.open` · `work.resubmit` · `term.out` | **구현됨** (배치 36) |
| `work.requested` · `qc.terminal` | **폐기 — PM 판정 2026-09-11** (§2.2). 구현은 이미 부합하고, 부재를 재는 검사가 들어갔다 |

**이 게이트는 닫혔다 — 끝까지.** `18` · `15` 가 폐기를 기록했고(Canon `334f6c9`), 그 **뒤에**
`copy.js` 에서 두 키를 지우고 PENDING 에서도 뺐다. 순서가 규칙 그대로다.
산출물 넷도 맞췄다 — 둘 다 실제로 그리고 있었다(QC 카드 세 종류의 터미널 링크 12곳 ·
SC-03 breadcrumb 의 라벨 5곳). **지운 것은 라벨이고 요청문이 아니다.**

**PENDING 문구 목록 12 → 3 → 1.** 남은 셋 중 `work.ago` · `term.mock` · `qc.full` 은 이미
"결정됨" 이고, 폐기된 둘은 키 자체가 없어졌다.

### ③ WBS-32 (사람 도그푸드) · DV-13~16 (Windows) — **열리지 않았다**

`13` §11 DoD 와 `09` §14 는 **비개발자가 이해하는지**를 묻는다 — 사람이 앉아서 써야 답이
나오고, 에이전트가 대신 답하면 그건 증거가 아니라 추정이다. Windows 항목은 그 OS 에서
직접 돌려야 한다. **PM 판정: 둘 다 나중, DEFERRED 유지.**

**무엇이 있어야 풀리나:** 비개발자 테스터 한 명 / Windows 기기에서의 실행 로그.
파이프 셸(WBS-25)의 Windows 검증도 여기 붙는다 — `shellFor()` 의 Windows 갈래는
**측정이 아니라 자리표시**이고, `$?`/`printf` 마커는 cmd.exe 에서 그대로 돌지 않는다.

---

## 4. 게이트 밖에 남은 작업

> **배치 36 은 여기에 「없다」고 적었다. 2026-09-13 Owner/PM 판정이 그것을 바꿨다.**
> 판정문이 *"Planning/reconciliation work for X may continue"* 라고 열어 주었고,
> `WBS_REMAINING.md` 가 그것을 Phase A 일곱 작업으로 풀었다. 넷은 배치 37 이 했다.

**게이트 없이 지금 할 수 있는 것 — 둘 남았다.**

| | 작업 | 산출물 | 소요 |
|---|---|---|---|
| **R-0** | e2e 단언 영향 지도 — `visual.mjs` 618 단언 중 R 트랙이 깨뜨릴 것을 「고칠 것/지울 것/그대로」로 분류 | `docs/dev-evidence/readability-assertion-map.md` | 60분 |
| **P0-1** | 화면 ↔ Canon 대조표 | `docs/design/SCREEN_MATRIX.md` | 60분 |

**판정 하나를 기다리는 것 — 셋.**

| 게이트 | 한 줄로 물어야 할 것 | 막고 있는 것 |
|---|---|---|
| **G-G** | `SPEC_RECONCILE.md` §2 의 컬럼 해석 ①②③ 이 맞는가 | X-7 → X-4 → (V1 의 P1-2) |
| **G-F** | X-6(프로세스 추적)이 MVP 인증 **전에** 필요한 재조정 진실성 결함 수정인가 | X-6 |
| **G-C** | Canon `18`/`15`/`20` 개정 8건 | R-6 · P2-4 · P2-6 · X-5 · X-6 |

**자동화된 Founder/PM 제품 결정은 여전히 소진되어 있다.** 위 셋은 새로 만들 결정이 아니라
**이미 받은 판정을 컬럼·문구 단위로 옮겨도 되는지 확인**하는 것이다. MVP 인증 자체는 §3 ③,
사람과 Windows 다.

| | 어디 |
|---|---|
| Canon | `JuQode-Private` `334f6c9` · `canon/mvp-run-implementation-findings` · Draft PR **#14** (누적 · #13 을 대체) |
| 구현 | `JuQode` `dev/mvp-autonomous-v01` · Draft PR **#4** |

**둘 다 머지 승인 안 됨.** PR #3(Foundation)은 손대지 않았다. PR #13 은 SUPERSEDED 로 표시하고
**머지 없이 닫았다** — 브랜치 · 히스토리는 보존(`956a8c3` 은 `#14` head 의 조상). **PR #4 가 병합 불가로 보이는 이유는 draft 플래그 하나뿐이다** —
`mergeable: MERGEABLE` · `CLEAN`. (push 직후 몇 초간 `UNKNOWN` 이 나오는 것은 GitHub 의 비동기
재계산이지 문제가 아니다.)

### Canon — 둘 다 끝났다

이 세션에서 `JuQode-Private` 파일 쓰기가 한동안 분류기에 차단됐다. 둘 다 해소되었다:

1. ~~**커밋 안 된 상태 표기 정리**~~ — **완료** (Owner 가 직접 `b37ac3f` 로 push).
   `19` 의 D-125~D-129 `🟡 제안` → `✅ 확정` · 문서 머리 `CANDIDATE` → Final Planning Gate PASS
   (`13`~`23` · `25` · `27`) · `04` 서문의 확정 범위 `D-137` → `D-138`.
   **건드리지 않은 것:** `26` 로드맵의 CANDIDATE 전부 · `04` §1 의 🟡 규칙 서술 · `08`~`11` 의
   `PROPOSED` — 전부 정당하다.
2. ~~**Gate ② 폐기 기록**~~ — **완료** (Canon `334f6c9` · 구현 반영까지). 둘 다 끝났다.

### PM 판단이 필요한 것 하나 — 손대지 않았다

`05` 의 가정 원장(A-8 ~ A-15)이 아직 **"Founder 판정 대기"** 이고 "이 표는 Founder Planning
Gate 의 심사 대상" 이라고 적는데, 그 Gate 는 **2026-09-09 에 PASS 했다.** 그런데 `03` §4.1 은
"제품 의미 · 범위 · 설계는 이 승인으로 바뀌지 않았다" 고도 적는다. Gate 가 A-8~A-15 를
**전제째 승인한 것인지**는 상태 표기 정리가 아니라 **해석**이므로, 고치면 결정의 의미가 바뀔 수
있어 남겨 두었다. **새 Founder 결정을 만들지는 않았다** — 문서가 불완전하다는 이유만으로
결정을 발명하지 않는다.

---

## 5. 알고 남긴 천장

- **마커 천장** — 셸 줄의 종료 코드는 난수 마커 + `printf` 로 받는다. 명령이 그 문자열을
  스스로 출력하면 줄이 끝난 것으로 읽는다. 별도 파일 서술자가 답이지만 셸마다 다르다.
- **Windows** — `shellFor()` 의 Windows 갈래는 자리표시다(§3 ③).
- **`.rec` 를 쓰지 않는 복구 경로** — SC-01·SC-02·SC-03·SC-04·TD-01 은 표시를 붙였다.
  새 화면을 만들 때 복구 동작에는 `rec` 를 붙일 것.
- **`13` §11 DoD 는 WBS-32 를 포함한다** — §3 ③ 이 열리기 전에는 MVP 를 "끝났다" 고 말할 수
  없다.

---

## 6. 비싸게 배운 것 — 계속 유효

- **추측하지 말고 찍어라.** 배치 33 이 세 번 틀린 원인을 `results.json` 한 번이 잡았다.
  `visual.mjs` 는 단언 전에 관측값 전부를 `tmp-visual/results.json` 에 남긴다.
- **조용히 건너뛰는 길이 검사는 검사가 아니다.** `if (groups().length > 1)` 뒤의 단언 셋이
  한 번도 실행되지 않았다. 이제 개수를 **단언**한다 — 건너뛰는 대신 터지도록.
- **다른 키로 만족되는 가드는 가드가 아니다.** 문구 검사가 잎 이름만 봐서 열두 개가 숨었다.
- **"동등 뮤턴트로 보인다"를 서두르지 말 것.** 배치 34 가 그렇게 적은 하나가 배치 35 에서
  죽었다.
- **겹친 방어 가드가 새 크래시 경로가 될 수 있다.** 뒤에 catch 가 있으면 앞의 가드는 빚이다.
- **전이 상태를 고정 지연으로 관찰하지 말 것.** `멈춤 요청함` 은 700ms 뒤 이미 `멈췄어요`.
- **타임아웃은 kill 로 세어진다.** 스윕 천장이 실행 시간보다 낮으면 전부 가짜 kill.
- **없어진 코드는 죽인 것이 아니다** — 재측정은 GONE 으로 보고한다.
- **위치는 정체성이 아니다** · **관찰 지점과 단언 사이에 단계를 끼워 넣지 말 것.**
- **`evalJs`/픽스처 템플릿 리터럴 안 주석에 백틱 금지.** 이번에도 두 번 당했다.
- **grep 을 `head` 로 잘라 읽고 "없다" 라고 결론내지 말 것.** 이번에 한 번 그렇게 틀렸다.
- **`pkill -f` / `pgrep -f` 금지** (자기 셸을 죽인다). pidfile 또는 `pgrep -x`.
- **`nohup ... &` 는 PPID 1 로 재부모화된다** — 셸의 프로세스 트리에 자식으로 안 보인다.
  "안 돌고 있다" 로 오독하기 쉽다. `ps -eo pid,ppid,etimes,args` 로 직접 확인할 것.
- **VISUAL QA 는 진짜로 본다.** 배치 34 의 레이아웃 결함 둘, 배치 36 의 낱말 가운데 끊김
  (`펼치\n기`) 은 **단언이 전부 통과한 상태에서** 스크린샷으로만 보였다.
- **철자에 묶인 가드는 가드가 아니다.** `mode = snap ? … : 'unknown'` 한 줄을 정규식으로 박아
  둔 검사가, 같은 규칙을 early return 으로 다시 쓴 순간 빨개졌다. 리팩터에 깨지고 철자만
  유지한 회귀에는 통과한다 — 붙잡아야 할 것은 **규칙**이다.
- **검사도 개정을 따라간다.** `17` 이 요구하던 "여러 카드 · 여러 크기" 를 단언하던 블록이
  외부 리뷰가 혼란스럽다고 한 바로 그 배치를 통과시키고 있었다. 검사는 카드의 벽을 금지하는
  것만큼 쉽게 **강제**한다.

---

## 7. 이 런의 보안 제약 (계속 유효)

- 실제 자격증명/사용자 비밀/사설 토큰 커밋 금지. 합성 픽스처 마커는 합성이라고 명시할 때만.
- 사용자의 실제 프로젝트를 절대 수정하지 않는다.
- 제외 경로 변경 보고는 **메타데이터만** (D-126a).
- 측정하지 않은 것을 측정했다고 말하지 않는다 — 특히 Windows.
- **빨간 스위트를 푸시하지 않는다.**
- 셸 줄에 **차단 목록을 만들지 말 것** (`19` §C4). `tests/term.test.js` 가 검사한다 —
  걸러내는 척하는 제품은 걸러내지 못한 것을 안전하다고 가르친다.
- **문구는 `copy.js` 에서 고치지 않는다** — `18` 을 먼저 고친다 (§3 ①).

---

## 8. 도구

```bash
# 뮤테이션 스윕 (파일을 가리지 않는다)
rm -rf .mutate-work                    # 트리가 바뀌면 워커 사본은 새로 떠야 한다
W=2 python3 scripts/mutate/sweep-renderer.py <파일…>
ONLY=<이전 results.json> W=2 python3 scripts/mutate/sweep-renderer.py <파일…>   # 생존자만 재측정

# 스윕이 도는 동안 대상 파일을 편집하지 말 것 — 러너가 매 뮤턴트마다 원본을 다시 읽고 단언한다.
# e2e 타임아웃 기본 900s (`E2E_TIMEOUT`). 타임아웃은 kill 로 세어진다.
```

측정 기록: `BATCH-33-sweep.json`(배치 33 원본) · `BATCH-34-sweep.json`(재측정) — 둘 다 저장소에.
