# RESUME — JuQode Autonomous MVP Long Run V2

**마지막 체크포인트:** 배치 34 · 브랜치 `dev/mvp-autonomous-v01`
**작업 트리:** clean · 백그라운드 프로세스 없음 · **stash 없음** (배치 33 의 미완 작업은 풀렸다)
**스위트:** unit 572/572 · `visual.mjs` PASS · `boot.test.mjs` PASS · `offline-shutdown.mjs` PASS

---

## 1. 다음 재개 시 그대로 붙여넣을 지시문

```
CONTINUE THE SAME JUQODE AUTONOMOUS MVP LONG RUN.
Do NOT restart planning. Do NOT create a new run. Do NOT reset the branch.
Current remote branch: dev/mvp-autonomous-v01
Last checkpoint: batch 34 (WBS-25 shell line · sweep re-measure). Working tree clean, all suites green.

Read RESUME.md first. There is NO blocker this time — §3 is a queue, not a wall.

Queue, in order:
  1. §3 — 살아 있는 뮤턴트 16개. td01 4개는 "화면에서 안 눌러 본 버튼" 이고 싸다.
  2. §4 — 셸 줄의 남은 구멍: 도달 못 한 사용 불가 카드 · busy 경로 · 세션이 스스로 끝나는 경우.
  3. §5 — WBS-32(사람 검증) · DV-13~16(Windows). 둘 다 PM 이 "나중" 으로 판정했다.

Keep the same operating loop: IMPLEMENT → TEST → PRODUCT QA → TECHNICAL/SECURITY QA →
TEST ADVERSARY → VISUAL QA when UI changes → FIX → RETEST → MUTATION / NEGATIVE CHECK →
CHECKPOINT COMMIT → CONTINUE.
Never push a red suite. Windows-only requirements remain DEFERRED_VALIDATION.
Continue now.
```

---

## 2. 이번 세션에 한 일 (배치 34)

| 커밋 | 내용 |
|---|---|
| `70345ef` | 배치 33 e2e 패치 초록으로 — 막고 있던 단언 하나의 **진짜** 원인 |
| `6e11da6` | td01 생존자용 픽스처 + 네 상태 e2e · 스윕 러너에 `ONLY=` 재측정 모드 |
| `2935e47` | DV-11 PM 판정 기록 (파이프 셸 GO · 동반 조건 4개) |
| `b0d338c` | **WBS-25** 셸 명령줄 — 메인 프로세스 (`app/main/term/session.js`) |
| `f5c7547` | 같은 것의 결함 둘 (끝난 줄이 이름을 잃음 · 프로젝트 전환 시 종료) |
| `7f6630c` | **WBS-25** 화면 + CF-22 + `BATCH-34-QA.md` |

전체 기록: `docs/dev-evidence/mvp-run/BATCH-34-QA.md`.

**스윕 재측정 (처음):** 배치 33 생존자 35 → **6 사라짐**(코드가 다시 쓰였다) · **13 사살** ·
**16 생존**. 현재 트리 62 사이트 중 46 사망 = **74%** (배치 33 시점 49%).

---

## 3. 살아 있는 뮤턴트 16개 — 다음 배치의 재료

원본은 `.mutate-work/results.json` (재측정 결과) 와 `docs/dev-evidence/mvp-run/BATCH-33-sweep.json`
(배치 33 원본, 저장소에 있다 — 스크래치패드에서 한 번 날렸다).

| 파일 | 개수 |
|---|---|
| `td01.js` | 5 |
| `sc02.js` | 4 |
| `sc04.js` | 4 |
| `sc03.js` | 3 |

**td01 넷은 싸다 — 전부 "카드는 그렸는데 버튼을 눌러 본 적이 없다":**
- 모호함 카드에서 **읽기를 고르는** 버튼 (`id === 'work'` · `x.id === id`)
- 실행 중 카드의 **멈추기** 버튼 (`x.id === 'qc.dev.stop'`) — 배치 34 는 `서버 꺼줘` 로
  라우팅해서 껐고 버튼은 안 눌렀다
- 실패 카드 재실행 버튼의 강조 클래스 (`r.state === 'failed' ? ' rec' : ''`)

**다섯 번째는 동등 뮤턴트로 보인다** (`already_running && r.data?.pid` → `||`). 관찰 가능한
차이를 못 찾았고, 못 찾았다고 적혀 있다. 죽이지 못한 것을 죽였다고 하지 말 것.

재측정 방법:
```bash
rm -rf .mutate-work    # 트리가 바뀌면 워커 사본은 새로 떠야 한다
ONLY=docs/dev-evidence/mvp-run/BATCH-33-sweep.json W=2 \
  python3 scripts/mutate/sweep-renderer.py app/renderer/screens/{sc02,sc03,sc04,td01}.js
```
29개에 약 40분(2워커). e2e 타임아웃은 900s 다 — **타임아웃은 kill 로 세어진다.** 정직한
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
| td01 생존자 9개 | **완료** (`6e11da6`) — 4개는 다른 경로로 아직 산다 (§3) |
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
