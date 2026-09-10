# RESUME — JuQode Autonomous MVP Long Run V2

**마지막 체크포인트:** `a6337dd` · 브랜치 `dev/mvp-autonomous-v01` (푸시 완료)
**작성 시각:** 2026-09-10 · 작업 트리 clean · 백그라운드 프로세스 없음 (전부 정리됨)

---

## 1. 다음 재개 시 그대로 붙여넣을 지시문

```
CONTINUE THE SAME JUQODE AUTONOMOUS MVP LONG RUN.
Do NOT restart planning. Do NOT create a new run. Do NOT reset the branch.
Current remote branch: dev/mvp-autonomous-v01
Last checkpoint: a6337dd (Batch 31 — Windows fixes). Working tree was clean.

Read RESUME.md first, then resume the queue in this order:

  1. 렌더러 뮤테이션 스윕 마무리 — sc02/sc03/sc04/td01, 68 sites. 미완이다 (아래 §3).
  2. WBS-33 잔여 — 서명되지 않은 빌드 배너 UI (§4). PM 이 다음 큐로 지정했다.
  3. 사용자가 Windows verify-windows.ps1 재실행 데이터를 주면 DV-13/14/15 판정,
     그리고 DV-11(pty) 트레이드오프를 PM 에게 요약 보고 (§5). PM 이 GO 를 낼 예정.

Keep the same operating loop: IMPLEMENT → TEST → PRODUCT QA → TECHNICAL/SECURITY QA →
TEST ADVERSARY → VISUAL QA when UI changes → FIX → RETEST → MUTATION / NEGATIVE CHECK →
CHECKPOINT COMMIT → CONTINUE.
Windows-only requirements remain DEFERRED_VALIDATION and must not globally stop unrelated work.
Do not return after the next WBS or batch. Continue now.
```

---

## 2. 직전에 한 일 — 배치 31 (커밋 `a6337dd`, 푸시됨)

사용자가 Windows PC 에서 `scripts/verify-windows.ps1` 을 실제로 돌린 로그를 보내왔고,
보고된 실패 6개를 전부 원인까지 추적해 고쳤다. 전체 기록: `docs/dev-evidence/mvp-run/BATCH-31-QA.md`.

**핵심 결론 (사용자 질문에 대한 답):** 보고된 6개 중 **어느 것도 `session.js` spawn 버그와
관련이 없다.** 그 버그는 Work 를 시작할 때만 발현하고, 하네스는 Work 를 시작하지 않는다.

| 고친 것 | 파일 |
|---|---|
| `tests/*.test.js` 글롭을 cmd.exe 가 안 펼침 → 따옴표로 node 가 펼치게 | `package.json` |
| e2e 3종이 POSIX 전용 → OS 별 launch/kill/count 를 한 곳에 | `tests/e2e/launch.mjs` (신규) + 3종 |
| `Stop-Process` 가 `.cmd` 껍데기만 죽임 → `taskkill /T`, 단계 사이 Sweep(누수는 기록) | `scripts/verify-windows.ps1` |
| line 243 StrictMode 종료 오류 → `.Contains('status')` | `scripts/verify-windows.ps1` |
| spikes 가 이유 없이 죽음 → 크래시에도 부분 증거를 쓰고 하네스가 이유를 보고 | `scripts/windows-spikes.mjs` |
| **제품 결함:** Windows 에서 취소가 아무 프로세스도 안 죽임 → `killPlan()` + `taskkill /T` | `app/main/claude/session.js` |
| **제품 결함:** `.cmd` 을 cmd.exe 로 안 감쌈 → `launchArgv()` 공유 | `app/main/claude-detect.js` · `session.js` |

측정: unit `546/546` · e2e 전부 PASS(리눅스) · PowerShell `PARSE OK` (pwsh 7.6.6) ·
line 243 격리 재현 후 수정 확인.

---

## 3. 다음 작업 ① — 렌더러 뮤테이션 스윕 마무리 (미완)

**상태: 미완. 68개 중 완주한 회차가 없다.** 최신 회차(`sweepui5`)는 사용자 이석으로
시작 20초 만에 안전 종료했고, 그 이전 회차(`sweepui4`)는 30/68 에서 끊겼다 —
게다가 그것은 배치 31 **이전** 트리 기준이라 다시 돌려야 한다.

대상 4파일 · 68 sites:
`app/renderer/screens/sc02.js` · `sc03.js` · `sc04.js` · `td01.js`

**도구 위치 (이 세션 스크래치패드 — 재부팅하면 사라진다):**
```
/tmp/claude-1000/-home-skkse12-Desktop-Projects-Team-JuQode/bc9a37d4-.../scratchpad/
  gen.py       # 파일 하나의 뮤테이션 사이트 열거 (tests/src.js 로 주석 제거한 CODE 기준)
  sweepui.py   # 렌더러 스윕 러너 (unit 먼저, 그 다음 visual e2e)
```
사라졌으면 이전 세션 스크래치패드에 원본이 있다:
`.../2d34b13d-e94d-46fe-b67e-1ea9d7f13eda/scratchpad/{gen.py,sweepui.py}`

**재실행 명령:**
```bash
SP=<이 세션 scratchpad>
rm -rf $SP/sweepui                      # 워커 사본은 반드시 새로 뜬다 (배치 31 이 트리를 바꿨다)
cd $SP && nohup python3 -u sweepui.py \
  app/renderer/screens/sc02.js app/renderer/screens/sc03.js \
  app/renderer/screens/sc04.js app/renderer/screens/td01.js > sweepui6.log 2>&1 &
```
소요: 2워커 기준 대략 50~70분.

**스윕 중 지켜야 할 것 (실측으로 배운 것들):**
- **스윕이 도는 동안 위 4개 렌더러 파일을 편집하지 말 것.** 러너가 매 뮤턴트마다 REPO 의
  원본을 다시 읽어 `orig.count(ctx) == 1` 을 단언한다. 편집하면 그 단언이 깨진다.
  (`app/main/**` 과 테스트 편집은 안전 — 워커는 자기 사본을 쓴다.)
- **프로세스를 `pkill -f` / `pgrep -f` 로 찾지 말 것.** 패턴이 내 셸 자신에게도 맞아
  자기 프로세스 그룹을 죽인다 (이 런에서 3번 당했다). pidfile 을 쓰거나,
  `pgrep -x python3` + `/proc/<pid>/cmdline` 확인 후 죽인다.
  전 회차 정리는 `pgrep -x electron` + `readlink /proc/<pid>/cwd` 로 `sweepui/` 아래
  것만 골라 죽였다 — 그 방법이 안전하다.
- nohup 백그라운드로 띄우면 `$!` 가 **래퍼 bash** 의 pid 다. python 은 그 자식이다.
  둘 다 정리해야 한다.

---

## 4. 다음 작업 ② — WBS-33 잔여: 서명되지 않은 빌드 배너 (PM 지시)

**요구 출처 (확인된 것):**
`21_WBS.md` line 100, WBS-33 위험 열 — **"서명 인증서 없음 → 서명되지 않은 빌드임을
표시(숨기지 않음)"**. PM 이 인용한 `13` §8 은 절대 제품 규칙(D-105~D-121) 절이다 —
착수 전에 그 절에서 이 배너를 지배하는 D 번호를 확인해서 배너 문구/색에 인용할 것.

**아직 확인하지 않은 것 (착수 시 먼저 할 일):**
- 서명 상태가 메인 프로세스에서 렌더러로 **어떤 경로로 가는지** — 기존 `juqode:versions`
  IPC 에 얹을지 새 채널을 팔지. `app/main/ipc.js` 와 `preload` 표면을 먼저 읽을 것.
- 판정 근거는 **PE 인증서 테이블**이어야 한다 (빌더 로그가 아니라). 하네스는 이미
  `Get-AuthenticodeSignature` 로 그렇게 한다 — 앱 런타임에서 같은 사실을 무엇으로 알지
  결정해야 한다. 리눅스/개발 실행에서는 "서명 없음"이 정상 상태라는 점도 처리할 것.
- 색: `16` §2.1 색 문법상 **red 는 실패 전용**이다. 서명되지 않은 빌드는 실패가 아니라
  **사실 고지**이므로 red 를 쓰면 안 된다. amber FILL(부분)/OUTLINE(대기)도 의미가 다르다.
  착수 전에 `16` §2.1 을 다시 읽고 어떤 토큰이 맞는지 정할 것 — 여기서 틀리면 그 자체가 결함이다.
- 문구는 `18_KOREAN_UX_COPY.md` 에 이미 있는지 먼저 찾을 것. 없으면 새로 만들되 D-114
  어휘(확인됨/예상됨/확인 못함)와 충돌하지 않게.
- UI 변경이므로 **VISUAL QA 필수** — `tests/e2e/visual.mjs` 에 렌더 증거를 추가한다.

---

## 5. 다음 작업 ③ — Windows 재실행 데이터가 오면

사용자가 `verify-windows.ps1` 을 다시 돌려 DV-11/13/14/15 데이터를 줄 예정이다.

받으면 판정할 것:
- **DV-13** — e2e 3종이 Windows 에서 통과하는가 (`launch.mjs` 는 리눅스에서만 측정됐다)
- **DV-14** — 패키징된 exe 로딩 실패가 정말 단일 인스턴스 잠금 때문이었는가.
  누수를 없앴으니 이번엔 깨끗한 조건에서 나온다. 여전히 실패하면 **다른 원인**이고,
  그때는 `files: ["app/**/*", "package.json"]` 과 ASAR/userData 경로를 봐야 한다.
- **DV-15** — spikes 가 왜 죽었는가. 하네스가 이제 종료 코드와 마지막 6줄을 보고한다.

### PM 에게 보고할 DV-11 트레이드오프 요약 (초안 — 데이터 오면 확정)

PM 이 "파이프 셸이 sudo/ssh/git 자격증명을 못 받는다는 실측이 이미 있으니 그쪽으로 결론
나면 GO" 라고 했다. 그 실측은 `docs/dev-evidence/mvp-run/DV-11-PIPE-SHELL-SPIKE.md` 에 있다.

| | 얻는 것 | 잃는 것 | 이 런에서 검증 가능한가 |
|---|---|---|---|
| **node-pty** | 진짜 터미널 — `/dev/tty` · 색 · 순서 · 작업 제어 | 네이티브 모듈(Electron 버전마다 재빌드) · **이 저장소의 능력 격리 검사가 금지** · Windows ConPTY 미검증 | **아니오** |
| **파이프 셸** | 네이티브 모듈 없음 · 정지는 이미 됨 · stdin 으로 답 가능 | `sudo`/`ssh`/자격증명 **불가** · 색 없음 · 순서 근사 · 세션 상태 직접 관리 | **예 (Linux)**. Windows 미검증 |
| **mock** (`18` `term.mock`) | 아무것도 실행 안 하니 아무것도 안 틀림 · 문구 존재 | 셸 줄이 없다 — `15` TD-01 요구가 남는다 | 예 |

결정적 사실 하나: `sudo`/`ssh`/git 자격증명 프롬프트는 **stdin 을 읽지 않는다.**
`/dev/tty` 를 직접 연다. 그래서 파이프 셸에서는 **멈추지 않고, 틀린 답을 받는다** —
사용자가 답할 기회조차 없이 실패한다.

**파이프 셸로 GO 할 경우 반드시 함께 가야 하는 조건 (PM 에게 명시할 것):**
제품이 화면에서 그 한계를 **말해야 한다.** "sudo/ssh/자격증명 프롬프트는 이 터미널에서
답할 수 없습니다" 를 사용자가 그 명령을 치기 전에, 또는 실패한 직후에 알아야 한다.
그렇지 않으면 D-114 의 "확인 못함"을 제품이 "실패"로 위장하는 셈이 된다.

**아직 안 잰 것 (GO 문서에 그대로 남길 것):** Windows 의 파이프 셸도 ConPTY 도 안 쟀다.
Electron 메인 프로세스 안에서 같은 결과가 나오는지도 별개 측정이다. node-pty 는 능력
격리 검사가 금지해서 실제로 들여보지 않았다.

---

## 6. 남은 MVP 큐 전체

| | 상태 |
|---|---|
| 렌더러 스윕 (sc02/sc03/sc04/td01, 68) | **미완 — 다시 돌려야 함** (§3) |
| WBS-33 서명 배너 UI | **다음 큐** (§4) |
| WBS-32 (사람 검증) | 미착수 — 비개발자 테스터 필요, 절차는 이전 보고 참조 |
| DV-11 (pty 제품 결정) | PM 판단 대기 (§5) |
| DV-13/14/15 | 사용자 Windows 재실행 대기 |

## 7. 이 런의 보안 제약 (계속 유효)

- 실제 자격증명/사용자 비밀/사설 토큰 커밋 금지. 합성 픽스처 마커는 **합성이라고 명시할 때만**.
- 사용자의 실제 프로젝트를 절대 수정하지 않는다. 런타임 실험은 일회용 스크래치 저장소에서.
- 제외 경로 변경 보고는 **메타데이터만** (D-126a). 내용을 읽어 확인하지 않는다.
- 측정하지 않은 것을 측정했다고 말하지 않는다 — 특히 Windows.
