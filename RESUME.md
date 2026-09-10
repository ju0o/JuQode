# RESUME — JuQode Autonomous MVP Long Run V2

**마지막 체크포인트:** `758af26` · 브랜치 `dev/mvp-autonomous-v01` (푸시 완료)
**작업 트리:** clean · 백그라운드 프로세스 없음
**주의:** `git stash@{0}` 에 **미완성 e2e 작업**이 들어 있다 (§3 을 반드시 먼저 읽을 것)

---

## 1. 다음 재개 시 그대로 붙여넣을 지시문

```
CONTINUE THE SAME JUQODE AUTONOMOUS MVP LONG RUN.
Do NOT restart planning. Do NOT create a new run. Do NOT reset the branch.
Current remote branch: dev/mvp-autonomous-v01
Last checkpoint: 758af26 (Batch 33 — renderer sweep). Working tree was clean.

Read RESUME.md first. §3 is the blocker — there is unfinished e2e work in git stash
and one RED assertion to fix before anything else.

Queue, in order:
  1. §3 — e2e 스택을 되살리고 `the drawer did not reopen in the second project` 를 고친다.
     그것이 초록이 되어야 배치 33 의 나머지가 커밋될 수 있다.
  2. §4 — td01 생존자 9개 (긴 실행 · 이미 실행 중 · 실패 상태).
  3. §5 — 스윕 재실행으로 실제 kill 수를 측정한다. 지금까지는 측정한 적이 없다.
  4. §6 — WBS-32(사람 검증) · DV-11 PM 판정 · Windows 재실행 데이터(DV-13/14/15/16).

Keep the same operating loop: IMPLEMENT → TEST → PRODUCT QA → TECHNICAL/SECURITY QA →
TEST ADVERSARY → VISUAL QA when UI changes → FIX → RETEST → MUTATION / NEGATIVE CHECK →
CHECKPOINT COMMIT → CONTINUE.
Never push a red suite. Windows-only requirements remain DEFERRED_VALIDATION.
Continue now.
```

---

## 2. 이번 세션에 한 일

| 커밋 | 내용 |
|---|---|
| `bcacd91` | 뮤테이션 스윕 러너를 저장소로 옮김 (`scripts/mutate/`) — 스크래치패드에 뒀다가 재부팅에 날아갔다 |
| `952d68b` | **WBS-33** 서명되지 않은 빌드 배너 (CF-21) |
| `2f90f32` | **DV-11** 판정 재료 한 장 + PM 판정란 |
| `758af26` | **배치 33** 렌더러 스윕 완주 · 모호함 카드 중복 버튼 수정 · `hasEvidenceGap` 순수 함수 |

스윕 결과: **68개 중 33개 죽고 35개 생존** (sc02 11 · sc03 8 · sc04 7 · td01 9).
전체 기록은 `docs/dev-evidence/mvp-run/BATCH-33-QA.md`.

---

## 3. ⚠️ 먼저 할 일 — stash 에 있는 e2e 작업과 빨간 단언 하나

```bash
git stash list          # stash@{0}: batch-33 e2e work in progress
git stash pop           # tests/e2e/visual.mjs 만 들어 있다
node tests/e2e/visual.mjs
```

**현재 상태: 빨간불.** 실패하는 단언은 `the drawer did not reopen in the second project`
(`tests/e2e/visual.mjs`, 검색어 `drawerAfterSwitch`).

- **제품 결함이 아니다.** 내가 바꾼 "프로젝트 전환" 행 선택 때문이다.
- 원래는 `[...recent-row].at(-1).click()` 이었다. Work 두 개짜리 세 번째 프로젝트(SEED3)를
  픽스처에 심으면서 그 위치가 다른 프로젝트를 가리키게 됐다.
- 세 번 고쳐 봤고 셋 다 실패했다: ① SEED2 를 이름으로 고르기 ② "현재와 다른 프로젝트"
  고르기 ③ ②에서 SEED3 제외. **아직 원인을 못 잡았다.**
- **다음에 할 일:** 그 단계에서 전환 **전/후의 프로젝트 경로와 `window.__drawer()` 를 모두
  찍어서** 어느 프로젝트로 갔고 드로어가 왜 닫혔는지 먼저 본다. 추측하지 말 것 —
  세 번의 실패가 전부 추측이었다.

같은 내용이 `docs/dev-evidence/mvp-run/BATCH-33-e2e-PENDING.patch` 에도 있다 (563줄).
stash 가 없어졌으면 그 패치를 적용하면 된다.

### stash 안에 들어 있는 것 (전부 실제 구멍을 막는 단언들)

| 대상 | 무엇을 막는가 |
|---|---|
| Shift+Enter | 이 파일의 모든 제출이 버튼 클릭이라 keydown 핸들러 커버리지가 0이었다. `&&`→`||` 면 **평범한 타이핑이 Work 를 시작한다** |
| SC-03 패널 불변식 | 8개 지점에서 스냅샷+패널을 채집해 ⟺ 검사. 생존자 5개가 여기 |
| SC-04 블록 스코핑 | `f.file === scoped` 를 `!==` 로 뒤집으면 **고른 파일만 빼고 전부** 보여준다 (D-118 반전) |
| SC-02 모호함 카드 | 커버리지가 아예 없었다. §2 의 중복 버튼 수정을 검증하는 테스트가 여기 있다 |
| 오래됨 부정 케이스 | `&&` 면 멀쩡한 프로젝트가 오래됨 상태를 갖는다 |
| History `더 보기` 부재 | `>=0` 이면 빈 목록 위에 "0개 더" 가 뜬다. SEED3 픽스처가 이걸 위한 것 |
| 최근 목록 행 선택 | 위치 → 이름. **위치는 정체성이 아니다** (§5 교훈) |
| presence 캔버스 폴링 | 고정 sleep → bounded polling |

**주의: `app/renderer/screens/sc02.js` 의 중복 버튼 수정은 이미 커밋됐지만 전용 e2e 테스트는
이 stash 안에 있다.** 즉 지금 그 수정은 단위 스위트로만 검증된 상태다.

---

## 4. td01 생존자 9개 — 손대지 않았다

전부 드로어 QC 카드의 **도달하지 못한 상태**들이다: `r.kind === 'long_running'` ·
`r.reason === 'already_running'` · `r.state === 'failed'` · `id === 'qc.terminal.open'`.

이유: 픽스처의 `dev` 스크립트가 `vite` 인데 설치돼 있지 않아 즉시 죽는다.
**제안:** 픽스처의 `dev` 를 `node -e "setInterval(()=>{},1000)"` 같은 장수 명령으로 바꾸면
긴 실행 · 이미 실행 중 상태가 실제로 도달 가능해지고, `build: 'vite build'` 는 실패 상태용으로
그대로 둔다. (`tests/e2e/visual.mjs` 의 `scripts:` 줄)

---

## 5. 이번에 비싸게 배운 것 — 반드시 지킬 것

- **위치는 정체성이 아니다.** 픽스처 프로젝트 하나를 추가했더니 `[1]` 번째 행이 다른
  프로젝트를 가리켰고, 이후 전 단계가 엉뚱한 저장소에서 돌다가 **400줄 떨어진 곳에서**
  "Agent Presence 캔버스가 없다"로 터졌다. 목록에서 무언가를 고를 때는 이름/경로로 고른다.
- **`evalJs` 템플릿 리터럴 안 주석에 백틱을 쓰지 말 것.** 리터럴이 조기 종료된다. 두 번 당했다.
- **기존 테스트의 관찰 지점과 단언 사이에 새 단계를 끼워 넣지 말 것.** 그 테스트가 보려던
  상태를 파괴한다. 드로어는 토글이 아니라 **상태로** 열고 닫는다.
- **전제조건을 단언하라.** 이번에 내 테스트의 결함 네 개가 조용히 통과하지 않고 터진 것은
  전부 전제조건 단언 덕이었다 (`hidden===0` · `f.ok===true` · 프로젝트 경로 등).
- **e2e 로 도달 불가능한 규칙은 순수 함수로 뺀다.** `killPlan` · `launchArgv` ·
  `hasEvidenceGap` 이 그 패턴이다.
- **`pkill -f` / `pgrep -f` 금지** (자기 셸을 죽인다). pidfile 또는 `pgrep -x` + `/proc/<pid>/cmdline` 확인.
- nohup 백그라운드의 `$!` 는 **래퍼 bash** 의 pid 다. python 은 그 자식이다. 둘 다 정리할 것.

---

## 6. 남은 MVP 큐 전체

| | 상태 |
|---|---|
| 배치 33 e2e 마무리 | **막힘 — §3** |
| td01 생존자 9개 | 미착수 — §4 에 방법 |
| 스윕 재실행(실제 kill 측정) | 테스트가 커밋돼야 의미가 있다 |
| WBS-33 | **완료** (`952d68b`) — 단 DV-16(실제 패키징 exe 검증) 대기 |
| DV-11 | 판정 재료 완료 (`2f90f32`) — **PM 판정 대기**, 권고는 파이프 셸 + 네 가지 동반 조건 |
| WBS-32 (사람 검증) | 미착수 — 비개발자 테스터 필요 |
| DV-13/14/15/16 | 사용자 Windows 재실행 대기 |

## 7. 스윕 도구 (이제 저장소에 있다)

```bash
rm -rf .mutate-work    # 워커 사본은 트리가 바뀌면 새로 떠야 한다
W=2 python3 scripts/mutate/sweep-renderer.py app/renderer/screens/sc02.js …
```
2워커 기준 68개에 약 70분. **스윕이 도는 동안 대상 파일을 편집하지 말 것** —
러너가 매 뮤턴트마다 원본을 다시 읽고 단언한다.

## 8. 이 런의 보안 제약 (계속 유효)

- 실제 자격증명/사용자 비밀/사설 토큰 커밋 금지. 합성 픽스처 마커는 합성이라고 명시할 때만.
- 사용자의 실제 프로젝트를 절대 수정하지 않는다.
- 제외 경로 변경 보고는 **메타데이터만** (D-126a). 내용을 읽어 확인하지 않는다.
- 측정하지 않은 것을 측정했다고 말하지 않는다 — 특히 Windows.
- **빨간 스위트를 푸시하지 않는다.**
