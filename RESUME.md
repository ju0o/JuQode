# RESUME — JuQode Autonomous MVP Long Run V2

**마지막 체크포인트:** 배치 35 · 브랜치 `dev/mvp-autonomous-v01` (푸시 완료)
**작업 트리:** clean · 백그라운드 프로세스 없음 · stash 없음
**스위트:** unit 576/576 · `visual.mjs` PASS · `boot.test.mjs` PASS · `offline-shutdown.mjs` PASS
**정지 사유:** 남은 작업이 **전부 사람의 판단을 기다린다** (§3). PM 판정 2026-09-11.
게이트 없이 할 수 있는 마지막 하나(§4)는 **이 세션에서 끝냈다.**

---

## 1. 다음 재개 시 그대로 붙여넣을 지시문

```
CONTINUE THE SAME JUQODE AUTONOMOUS MVP LONG RUN.
Do NOT restart planning. Do NOT create a new run. Do NOT reset the branch.
Current remote branch: dev/mvp-autonomous-v01
Last checkpoint: batch 35. Working tree clean, all suites green.

Read RESUME.md first.

THIS RUN IS GATED. §3 lists three items and NONE of them may be done by the agent alone —
PM judged them Human Gate on 2026-09-11. Do not "unblock" them by deciding for the human:
the copy one would break this project's own rule (edit `18` first, never copy.js), and
deleting the duplicate keys was explicitly NOT approved.

Do this, in order:
  1. Ask the PM whether any §3 gate has opened, and hand them §3's "무엇이 있어야 풀리나".
  2. If a gate is open, do that item.
  3. If no gate is open, there is NOTHING left that the agent may do alone — §4 (the last
     un-gated item, sweeping `app/main/term/session.js`) was finished in batch 35.
     STOP and say so. Do not invent work.

Keep the same operating loop: IMPLEMENT → TEST → PRODUCT QA → TECHNICAL/SECURITY QA →
TEST ADVERSARY → VISUAL QA when UI changes → FIX → RETEST → MUTATION / NEGATIVE CHECK →
CHECKPOINT COMMIT → CONTINUE.
Never push a red suite. Windows-only requirements remain DEFERRED_VALIDATION.
```

---

## 2. 이번 세션에 한 일 (배치 34 · 35)

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

## 3. ⚠️ HUMAN GATE — 세 항목 (PM 판정 · 2026-09-11)

**에이전트가 혼자 진행하면 안 되는 것들이다.** "막혀 있으니 대신 결정한다" 가 이 run 에서
가장 하기 쉬운 실수이고, 특히 ① 은 그렇게 하면 **이 프로젝트 자신의 규칙을 어긴다.**

### ① 문구 중복 4개 — **삭제 승인 안 됨**

| 키 | 이미 렌더되는 같은 문구 |
|---|---|
| `presence.title` | `presence.kicker` |
| `work.observed` | `work.lastSeen` |
| `work.open` | `history.result` · `guard.open` |
| `qc.kicker` | `term.qcTitle` |

화면은 한 번만 말할 수 있으므로 키 하나를 접어야 하는데, `copy.js` 헤더의 규칙이
**"여기서 고치지 말고 `18` 을 먼저 고쳐라"** 다. copy.js 에서 지우는 것은 규칙 위반이고
**PM 이 승인하지 않았다.**

**무엇이 있어야 풀리나:** `18` 쪽에서 해당 키를 접거나 용도를 구분해 준 결과. 그 전까지는
`tests/unit.test.js` 의 PENDING 에 이유와 함께 남아 있고, 그게 맞는 상태다.

### ② 미구현 컨트롤 7개 — `15` 를 읽어야 한다

`guard.answer` · `guard.wait` · `work.now` · `work.requested` · `work.resubmit` ·
`qc.terminal` · `term.out`.

`15` 가 이름 붙인 컨트롤·레이블이고, **어디에 어떤 동작으로 놓이는지는 `15` 에 있다.**
에이전트가 자리를 정하면 그것은 구현이 아니라 발명이다.

(`guard.wait` 만 예외 — **보류가 아니라 결정**이다: 기다리기는 아무것도 누르지 않으면
일어나는 일이고, 친 문구는 이미 칸에 남아 있다. `refusalCard` 에 이유가 적혀 있다.)

**무엇이 있어야 풀리나:** 각 항목에 대한 `15` 의 해당 절, 또는 PM 이 정한 배치·동작.

### ③ WBS-32 (사람 도그푸드) · DV-13~16 (Windows)

`13` §11 DoD 와 `09` §14 는 **비개발자가 이해하는지**를 묻는다 — 사람이 앉아서 써야 답이
나오고, 에이전트가 대신 답하면 그건 증거가 아니라 추정이다. Windows 항목은 그 OS 에서
직접 돌려야 한다. **PM 판정: 둘 다 나중, DEFERRED 유지.**

**무엇이 있어야 풀리나:** 비개발자 테스터 한 명 / Windows 기기에서의 실행 로그.
파이프 셸(WBS-25)의 Windows 검증도 여기 붙는다 — `shellFor()` 의 Windows 갈래는
**측정이 아니라 자리표시**이고, `$?`/`printf` 마커는 cmd.exe 에서 그대로 돌지 않는다.

---

## 4. 게이트 없던 마지막 하나 — **끝났다** (배치 35)

`app/main/term/session.js` 스윕 (PM 승인 2026-09-11): `6 · 4 killed` → 경계 검사를 추가한 뒤
**`6 · 5 killed · 1 SURVIVED`**, 그리고 그 하나는 **동등 뮤턴트**다.

- **찾은 구멍:** `bytes + size > OUTPUT_LIMIT` 를 `>=` 로 넓히면 **정확히 가득 찬 출력이
  잘렸다고 표시된다** — 잃은 것이 없는데 잃었다고 말한다. 열어 보니 스위트에 **절단 검사가
  하나도 없었다**(넘친 쪽도, 딱 맞는 쪽도). 양쪽을 다 만들었다.
- **남은 하나는 동등하다:** `room > 0` → `>=`. `bytes <= OUTPUT_LIMIT` 이 불변이라 `room` 은
  음수가 될 수 없고, 새로 열리는 경우는 `room === 0` 뿐인데 그때 `subarray(0, 0)` 은 빈
  문자열이라 아무것도 바뀌지 않는다. **죽이지 못한 것이 아니라 죽일 것이 없다** — 다음 스윕이
  같은 것을 다시 파지 않도록 그 자리에 불변식을 적어 두었다.

`app/main/ipc.js` 는 그 사이 터미널 핸들러 셋이 늘었지만 배치 25~30 스윕 대상이었고, 새 핸들러
셋은 `tests/term.test.js` 가 직접 부른다(저장소 거절 · 프로젝트 전환 · 열지 못한 셸).

**즉 이제 게이트 밖에 남은 작업이 없다.** 자세한 것은 `BATCH-35-QA.md` §7.

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
- **VISUAL QA 는 진짜로 본다.** 배치 34 의 레이아웃 결함 둘은 단언이 전부 통과한 상태에서
  스크린샷으로만 보였다.

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
