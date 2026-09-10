# RESUME — JuQode Autonomous MVP Long Run V2

**마지막 체크포인트:** 배치 35 (렌더러 생존자 0) · 브랜치 `dev/mvp-autonomous-v01`
**작업 트리:** clean · 백그라운드 프로세스 없음 · **stash 없음** (배치 33 의 미완 작업은 풀렸다)
**스위트:** unit 573/573 · `visual.mjs` PASS · `boot.test.mjs` PASS · `offline-shutdown.mjs` PASS

---

## 1. 다음 재개 시 그대로 붙여넣을 지시문

```
CONTINUE THE SAME JUQODE AUTONOMOUS MVP LONG RUN.
Do NOT restart planning. Do NOT create a new run. Do NOT reset the branch.
Current remote branch: dev/mvp-autonomous-v01
Last checkpoint: batch 35 (renderer mutants: zero survivors). Working tree clean, all suites green.

Read RESUME.md first. There is NO blocker.

Queue, in order:
  1. §4 — 셸 줄의 남은 구멍: 도달 못 한 사용 불가 카드 · busy 경로 · 세션이 스스로 끝나는 경우.
  2. §3 — `rec` 클래스 정리(CSS 가 없다) · 원한다면 메인 프로세스 스윕 재측정.
  3. §5 — WBS-32(사람 검증) · DV-13~16(Windows). 둘 다 PM 이 "나중" 으로 판정했다.
살아 있는 렌더러 뮤턴트는 0 이다 — §3 은 더 이상 큐가 아니다.

Keep the same operating loop: IMPLEMENT → TEST → PRODUCT QA → TECHNICAL/SECURITY QA →
TEST ADVERSARY → VISUAL QA when UI changes → FIX → RETEST → MUTATION / NEGATIVE CHECK →
CHECKPOINT COMMIT → CONTINUE.
Never push a red suite. Windows-only requirements remain DEFERRED_VALIDATION.
Continue now.
```

---

## 2. 이번 세션에 한 일 (배치 34 · 35)

| 커밋 | 내용 |
|---|---|
| `70345ef` | 배치 33 e2e 패치 초록으로 — 막고 있던 단언 하나의 **진짜** 원인 |
| `6e11da6` | td01 생존자용 픽스처 + 네 상태 e2e · 스윕 러너에 `ONLY=` 재측정 모드 |
| `2935e47` | DV-11 PM 판정 기록 (파이프 셸 GO · 동반 조건 4개) |
| `b0d338c` | **WBS-25** 셸 명령줄 — 메인 프로세스 (`app/main/term/session.js`) |
| `f5c7547` | 같은 것의 결함 둘 (끝난 줄이 이름을 잃음 · 프로젝트 전환 시 종료) |
| `7f6630c` | **WBS-25** 화면 + CF-22 + `BATCH-34-QA.md` |
| (배치 35) | 렌더러 뮤턴트 **16개 전부** 정리 — `BATCH-35-QA.md` |

전체 기록: `docs/dev-evidence/mvp-run/BATCH-34-QA.md`.

**스윕 재측정 (처음):** 배치 33 생존자 35 → **6 사라짐**(코드가 다시 쓰였다) · **13 사살** ·
**16 생존**. 현재 트리 62 사이트 중 46 사망 = **74%** (배치 33 시점 49%).

---

## 3. 렌더러 뮤턴트 — 생존자 0

배치 35 가 16개를 전부 정리했다 (`BATCH-35-QA.md`). 측정 기록:

| | |
|---|---|
| `td01.js` 5 | 5 사살 |
| `sc02.js` 4 | 2 사살 · 2 GONE(순수 함수 추출) |
| `sc03.js` 3 | 1 사살 · 2 GONE(도달 불가 분기 삭제) |
| `sc04.js` 4 | 4 사살 |
| 추출로 새로 생긴 3 | 3 사살 |

목록 원본은 `BATCH-34-sweep.json` · `BATCH-33-sweep.json` (둘 다 저장소에 있다).

**남은 것 하나:** `btn ... rec` 는 렌더러 네 화면에서 15번 쓰이는데 **어떤 CSS 도 `.rec` 를
정의하지 않는다.** 복구 동작 표시가 화면에서 아무 차이도 만들지 않는다. 색을 주는 것은
`16` §2.1 색 문법에 걸리는 디자인 결정이고 지우는 것은 네 화면 변경이라, 적어 두고 넘겼다
(`BATCH-35-QA.md` §3).

**배치 35 가 비싸게 배운 것 둘:**
- **조용히 건너뛰는 길이 검사는 검사가 아니다.** sc04 뮤턴트 셋이 첫 시도에서 살아남았다 —
  단언이 `if (groups().length > 1)` 뒤에 있었고 이 런의 SC-04 는 그룹이 하나였다. 물려받은
  검사도 같은 이유로 이미 공허했다. 이제 두 자리 모두 **개수를 단언**한다.
- **"동등 뮤턴트로 보인다"를 서두르지 말 것.** 배치 34 가 그렇게 적은 하나가 배치 35 에서
  죽었다 — 카드가 스냅샷이라는 사실이 관찰 가능한 차이를 만들었다.

**따로 적어 둘 것 하나:** `btn ... rec` 는 렌더러 네 화면에서 15번 쓰이는데 **어떤 CSS 도
`.rec` 를 정의하지 않는다.** 복구 동작 표시가 화면에서는 아무 차이도 만들지 않는다. 색을 주는
것은 `16` §2.1 색 문법에 걸리는 디자인 결정이고 지우는 것은 네 화면 변경이라, 배치 35 는 적어
두고 넘겼다 (`BATCH-35-QA.md` §3).

재측정 방법 (다시 재고 싶을 때):
```bash
rm -rf .mutate-work    # 트리가 바뀌면 워커 사본은 새로 떠야 한다
ONLY=docs/dev-evidence/mvp-run/BATCH-34-sweep.json W=2 \
  python3 scripts/mutate/sweep-renderer.py app/renderer/screens/{sc02,sc03,sc04}.js
```
사이트 하나에 약 6분(2워커 기준 두 개씩). e2e 타임아웃은 900s 다 — **타임아웃은 kill 로 세어진다.** 정직한
실행 시간보다 낮은 천장은 모든 뮤턴트를 가짜 kill 로 만든다.

---

## 4. 셸 줄(WBS-25)에 남은 구멍 — 알고 남긴 것

- **`15` TD-01 의 지금 안 됨 카드(셸이 시작되지 않음)는 그렸지만 도달해 본 적이 없다.**
  이 픽스처는 셸 시작 실패를 만들 수 없다. `JUQODE_TERM_SHELL` 같은 테스트 어포던스로
  없는 셸을 가리키게 하는 것이 가장 싼 길로 보인다(`JUQODE_SIGNATURE_EXE` 와 같은 패턴).
- **busy 경로**(앞 줄이 도는 동안 보낸 줄)는 단위로만 검사된다. 화면 문구는 미검증.
- **세션이 스스로 끝나는 경우**(사용자가 `exit` 를 친다)는 `termEnded` 칩이 있지만 e2e 가
  도달하지 않는다. 다음 줄을 치면 새로 열리는 재개 경로도 마찬가지다.
- **마커 천장:** 명령이 마커 문자열을 스스로 출력하면 줄이 끝난 것으로 읽힌다. 난수로 추측을
  막았을 뿐이다. 별도 파일 서술자가 답이지만 셸마다 다르다.
- **Windows:** `shellFor()` 의 Windows 갈래는 **자리표시다.** `$?`/`printf` 마커는 cmd.exe
  에서 그대로 돌지 않는다. 재기 전까지 Windows 에 대해 아무 말도 하지 말 것.

---

## 5. 남은 MVP 큐 전체

| | 상태 |
|---|---|
| 배치 33 e2e 마무리 | **완료** (`70345ef`) |
| 렌더러 뮤턴트 16개 | **완료** — 배치 35, 측정으로 0 생존 확인 |
| td01 생존자 9개 | **완료** (`6e11da6`) |
| 스윕 재실행(실제 kill 측정) | **완료** — 49% → 74% |
| WBS-25 셸 명령줄 | **완료** (Linux) · Windows 미검증 |
| DV-11 | **판정됨 · 구현됨** |
| WBS-33 | 완료 (`952d68b`) — DV-16(실제 패키징 exe 검증) 대기 |
| WBS-32 (사람 검증) | 미착수 — PM: 나중 |
| DV-13/14/15/16 | 사용자 Windows 재실행 대기 — PM: 나중. 파이프 셸 검증도 여기 붙는다 |

---

## 6. 비싸게 배운 것 — 계속 유효

- **추측하지 말고 찍어라.** 배치 33 이 세 번 틀린 원인을 `results.json` 한 번이 잡았다.
  이제 `visual.mjs` 는 단언 전에 관측값 전부를 `tmp-visual/results.json` 에 남긴다.
- **위치는 정체성이 아니다.** 목록에서 고를 때는 이름/경로로.
- **관찰 지점과 단언 사이에 단계를 끼워 넣지 말 것.**
- **전이 상태를 고정 지연으로 관찰하려 하지 말 것.** `멈춤 요청함` 은 700ms 뒤에 이미
  `멈췄어요` 였다. 관찰 가능한 것을 단언하고, 거짓이 되는 상태가 아님을 단언한다.
- **타임아웃은 kill 로 세어진다.** 스윕 천장이 실행 시간보다 낮으면 전부 가짜 kill 이다.
- **없어진 코드는 죽인 것이 아니다.** 재측정은 사이트를 인덱스가 아니라 자기 자신으로 맞추고,
  사라진 것은 GONE 으로 보고한다.
- **`evalJs` 템플릿 리터럴 안 주석에 백틱 금지.**
- **`pkill -f` / `pgrep -f` 금지** (자기 셸을 죽인다). pidfile 또는 `pgrep -x`.
- **VISUAL QA 는 진짜로 본다.** 배치 34 의 레이아웃 결함 둘은 단언 전부 통과 상태에서
  스크린샷으로만 보였다.

## 7. 이 런의 보안 제약 (계속 유효)

- 실제 자격증명/사용자 비밀/사설 토큰 커밋 금지. 합성 픽스처 마커는 합성이라고 명시할 때만.
- 사용자의 실제 프로젝트를 절대 수정하지 않는다.
- 제외 경로 변경 보고는 **메타데이터만** (D-126a).
- 측정하지 않은 것을 측정했다고 말하지 않는다 — 특히 Windows.
- **빨간 스위트를 푸시하지 않는다.**
- 셸 줄에 **차단 목록을 만들지 말 것** (`19` §C4). `tests/term.test.js` 가 그것을 검사한다 —
  걸러내는 척하는 제품은 걸러내지 못한 것을 안전하다고 가르친다.
