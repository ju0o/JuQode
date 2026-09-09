# WBS-01 · 저장소 · 데스크톱 기반 — 증거

| | |
|---|---|
| **판정** | **PARTIAL** — 리눅스에서 검증한 것은 전부 통과. **대상 OS(Windows) 부팅은 NOT TESTED.** |
| **선행** | WBS-00 = PARTIAL, 아키텍처 블로커 없음 ([WBS-00-REPORT](../wbs-00/WBS-00-REPORT.md)) |
| **범위** | 부팅 · 창 하나 · SC-01 프로젝트 없는 상태 · Light/Dark 기반 · 보안 기본값. **WBS-02 이후는 만들지 않았다.** |

## 1. 인수 조건 대조 (`21` WBS-01)

| 인수 조건 | 결과 |
|---|---|
| clean checkout → SC-01 이 뜨는 셸 | **PASS** — `npm ci` → `npm run start` |
| **Windows 10 (1809+) · Windows 11 에서 부팅** (D-125) | **NOT TESTED** — 이 기계는 네이티브 Ubuntu 26.04. Windows 호스트 없이는 만족 불가 |
| 네트워크 없이 동작 | **PASS** — 부팅 시 외부 요청 **0건** (앱이 직접 계수) |
| 시작 시간 실측 (사전 상수 없음) | **측정함** — 아래. 예산은 **정하지 않았다** |
| 창 하나 | **PASS** — `BrowserWindow.getAllWindows().length === 1` |

## 2. 실측

부팅 3회, Xvfb, `JUQODE_TRACE=1` (`tests/e2e/boot.test.mjs`):

```json
{ "runs": 3, "windows": 1, "externalRequests": 0,
  "shownVia": ["ready-to-show","ready-to-show","ready-to-show"],
  "didFinishLoadMs": { "min": 469, "median": 612, "max": 872 } }
```

패키징본(`dist/linux-unpacked/juqode`) 단일 실행 — 개발 모드보다 빠르다:

```
app.ready 58ms · did-finish-load 262ms · window.shown 273ms (ready-to-show) · quit exit 0
```

> **이 숫자는 리눅스 바닥값이다.** Windows 는 PE 로더 + Defender/SmartScreen 이 지배적이고 측정되지 않았다.
> `21` WBS-01 이 요구하는 **대상 OS 별 시작 시간 실측은 아직 없다.**

## 3. SC-01 시각 검증 (두 테마)

| | |
|---|---|
| 스크린샷 | [`sc01-light.png`](sc01-light.png) · [`sc01-dark.png`](sc01-dark.png) — 실제 앱에서 CDP 로 캡처 |
| 화면 | `data-screen="SC-01"` |
| 문구 | `프로젝트 열기` · `프로젝트 폴더 열기` · `최근에 연 프로젝트` — **`18` 사전에서 그대로** |
| 주 행동 | **1개** (`14` §4 T4: 기본 상태에 주 행동은 하나) |
| 배경 | light `rgb(238,240,244)` · dark `rgb(12,14,18)` |
| 가로 넘침 | **0px** |
| 구성 | 가운데로 모인 성긴 진입 화면 — **세로 중심에서 12px** (`17`). 첫 제출은 `#root` 에 높이가 없어 `height:100%` 가 무너지면서 **165px 위**에 있었고, 그것을 '가운데로 모인' 이라고 적었다. 감사가 잡았다 |

### 3.1 독립 감사가 잡은 내 오류 — 정정 기록

첫 제출에서 주 버튼을 **Canon 이 정한 대로 만들지 않았다.** `16` §6 은 `pri = ink` 이고
Canon 프로토타입은 `.btn.pri{background:var(--ink);color:var(--board)}` 다 — **양쪽이 함께 뒤집히므로
대비가 구조적으로 깨질 수 없다.** 나는 대신 강조색 배경 + `--on-juq` 라는 **Canon 에 없는 토큰**을
만들었고, 그 토큰을 `:root[data-theme="dark"]` 블록에 넣는 것을 빠뜨렸다.

결과: **OS 가 라이트인데 사용자가 '어둡게' 를 누르면 밝은 청록 위 흰 글자, 대비 1.83:1.**
Windows 10/11 의 기본값이 라이트이므로 **이것이 대상 OS 의 출시 경로였다.**

그리고 내가 "회귀를 막았다" 고 적은 대비 검사는 **그 경로를 한 번도 지나지 않았다** —
호스트(Xvfb)가 다크를 선호해 미디어 블록이 조용히 올바른 값을 공급했기 때문이다.
**검사가 검증한다고 적은 것을 검사하지 않았다.**

**고친 방법:** 우회로를 지키는 대신 **실패 양식 자체를 없앴다.** Canon 의 `pri = ink` 로 되돌리고
`--on-juq` 를 삭제했다. 그리고 대비 검사를 **OS 선호 × 토글의 여섯 조합 전부**로 확장했다:

| | 시스템 | 밝게 | 어둡게 |
|---|---|---|---|
| **OS = light** | 11.78 | 11.78 | **12.81** ← 예전에 1.83 이던 경로 |
| **OS = dark** | 12.81 | 11.78 | 12.81 |

AA 기준 4.5:1. 여섯 칸 전부 통과한다.

**이 절을 남기는 이유:** 첫 보고서 · 커밋 · PR 세 곳에서 "고쳤고 회귀를 막았다" 고 적었고
**그 진술은 거짓이었다.** 감사가 잡지 않았으면 대상 OS 사용자가 만났을 결함이다.

## 4. 보안 검토

렌더러 탐침 — 실제 실행 중인 앱에서:

```json
{"keys":["versions","openProject"],"require":"undefined","process":"undefined",
 "module":"undefined","ipcRenderer":"undefined"}
```

- `contextIsolation: true` · `nodeIntegration: false` (worker · subframe 포함) · `sandbox: true` · `webviewTag: false`
- **렌더러에 노출된 표면은 이름 붙은 두 함수뿐**이다. 범용 `invoke` 통로를 두지 않았다 — 그러면 모든 채널이 열린다
- `will-navigate` 거부 · `setWindowOpenHandler` 거부 · `will-attach-webview` 거부
- CSP `default-src 'none'; connect-src 'none'` — 외부 자산이 하나도 없다
- 자격증명 저장 없음 · 텔레메트리 없음 · 렌더러에서 셸 실행 경로 없음

> **격리를 주장하지 않는다.** 여기서 강제한 것은 **앱 내부 경계**다. 이 호스트는 `chrome-sandbox` 를
> root 소유로 만들 수 없고 AppArmor 가 비특권 유저 네임스페이스를 막아, 모든 실행에 `--no-sandbox` 가
> 필요했다 — **OS 수준 Chromium 샌드박스는 검증하지 못했다.** `07` §2 · `19` §D1 의 문구는 그대로 유효하다.

## 5. 종료 · 고아

```
실행 중 Electron 프로세스: 6   →   SIGTERM   →   남은 프로세스: 0
정상 종료 경로(window-all-closed → quit): exit 0
```

스파이크 C 가 "부모만 죽이면 손자가 남는다" 를 실측했으므로, 종료는 **프로세스 수로 확인**한다.

## 6. 패키징

| 대상 | 결과 |
|---|---|
| Linux `dir` | **PASS** — 빌드되고 **실제로 부팅**, exit 0 |
| Windows `dir` + `zip` (x64) | **PARTIAL** — 진짜 `PE32+ executable ... x86-64` 246 MB + zip 153 MB **생성**. **실행한 적 없다** |
| Windows NSIS 설치 프로그램 | **미시도** — 스파이크 A 가 `spawn wine ENOENT` 로 실패함을 이미 확인 |
| Windows 코드 서명 | **NOT SIGNED** — 아래 |

**함정을 하나 더 확인했다.** electron-builder 로그에 `• signing with signtool.exe` 가 찍힌다.
PE 인증서 테이블을 직접 읽어 보면:

```
certificate table size: 0  →  UNSIGNED
```

**로그 줄을 서명 성공으로 읽으면 거짓 보고가 된다.** 스파이크 A 의 P-1(189 KB 가짜 Setup.exe)과 같은 부류다.
패키징 판정은 **로그가 아니라 산출물 검사**로 한다.

## 7. 테스트

| | |
|---|---|
| 단위 11개 | 보안 기본값 · preload 표면 · 토큰 두 테마 · reduced-motion · 부분/대기 칩 구별 · **가짜 진행 금지** · **문구가 Canon 전사인지** · CSP · **범위 봉쇄** |
| 부팅 스모크 | 3회 · 창 1개 · 외부 요청 0 · exit 0 |
| 시각 + 동작 | SC-01 렌더 · 브리지 표면 · 문구 · 대비 · 넘침 0 · 폴더 열기의 정직한 응답 |
| 오프라인 · reduced-motion · 종료 | 외부 요청 0 · reduced-motion 부팅 exit 0 · SIGTERM 뒤 고아 0 |

범위 봉쇄 테스트는 `main.js` 가 `showOpenDialog` · `child_process` · `node-pty` · `sqlite` · `claude` 에
손대지 않았음을 **기계로** 확인한다 — WBS-02 이후가 새어 들어오면 실패한다.

## 8. 남은 위험

1. **대상 OS 전체가 미검증.** Windows 부팅 · 시작 시간 · 설치 프로그램 · 서명 · OS 별 스크린샷.
   Windows 호스트/러너는 WBS-01 인수의 **경성 전제**다.
2. **OS 수준 샌드박스 미검증** (호스트 제약). 앱 내부 경계만 확인했다.
3. **폴더 열기는 아직 없다** — 의도적이다(WBS-02). 버튼은 실패가 아니라 `지금 안 됨 · 실패 아님` 으로 답한다.
4. **`--force-prefers-reduced-motion` 부팅은 통과했지만**, 모션 자체가 거의 없는 화면이라 강한 검증은 아니다.
   실질 검증은 애니메이션이 있는 화면(WBS-37)에서 다시 해야 한다.
5. 아이콘 없음 — 기본 Electron 아이콘이 쓰인다.

---

## 9. 독립 감사 (읽기 전용) 와 그 반영

감사가 재현한 것: 단위 11/11 · e2e 3종 전부 통과 · 네 스파이크 전부 재실행되어 보고 수치와 일치 ·
렌더러 탈출 7개 벡터 전부 실패 · `app/` 전체 grep 에서 WBS-02+ 코드 0건 ·
Windows 미검증 진술이 **모든 곳에서 일관되며 어디서도 완화되지 않았다** · 격리 과대주장 없음.

감사가 잡은 결함과 반영:

| # | 결함 | 반영 |
|---|---|---|
| **B-1** | 다크 토글이 1.83:1 버튼을 출시. 대비 검사가 그 경로를 안 지남. **세 곳에서 거짓 주장** | Canon 의 `pri = ink` 로 복귀, `--on-juq` 삭제, 검사를 여섯 조합으로 확장 (§3.1) |
| **H-1** | `npm test` 가 클린 체크아웃에서 **0개 테스트 실행** (`node --test tests/` 가 디렉터리로 해석 안 됨). e2e 두 개는 러너 자체가 없었다 | `tests/*.test.js` 로 수정, e2e 3종을 `test:e2e` 에 연결, `test:all` 추가 |
| **H-2** | SC-01 이 중심에서 165px 위 — `#root` 에 높이가 없었다 | `#root { height: 100% }`. 중심 편차 검사를 e2e 에 추가(현재 12px) |
| **H-4** | 주 버튼이 Canon 의 `pri = ink` 가 아니라 내가 만든 강조색 조합 | B-1 과 같은 수정 |
| **H-5** | **7개 변이 중 6개를 테스트가 못 잡았다** | 범위 검사를 `app/` 전체 순회로, preload 검사를 매개변수 이름이 아니라 **문자열 리터럴 채널 형태**로, 문구 검사를 **전수 열거 + Canon 없으면 실패**로, 토큰 검사를 **이름이 아니라 값 + 두 다크 블록 일치**로. **7/7 이 잡힌다** |
| **M-1** | 사용자 문구 2건이 Canon 18 에 없고 `copy.js` 를 우회. 하나는 `WBS-02` 라는 내부 ID 를 UI 에 노출 | `copy.js` 의 `dev:` 블록으로 옮기고 **DEV-ONLY 로 명시**, 칩은 Canon `unavailable.chip` 재사용, 내부 ID 제거 |
| **M-4** | hero 가 카드가 아니어서 텍스트가 보드 위에 직접 앉음 (`16` §1 위반) | `card hero` |
| **M-5** | 타이포 척도가 `16` §3 보다 한 단 큼 | 제목 20/26 · 본문 13/19 · `.sm` 12/17 · `.xs` 11/15 로 정정 |
| **L-1** | `--on-juq` 중복 선언 | 토큰 자체가 사라짐 |
| **L-6** | 50k 최악값 530 → 실제 490 | 정정 |

**변이 테스트 재실행 결과** (같은 7개):

```
baseline                       pass 11  fail 0
M1 child_process in window.js  pass 10  fail 1   ← 예전엔 통과했다
M2 새 project.js (dialog+spawn) pass 10  fail 1   ← 예전엔 통과했다
M3 generic invoke passthrough  pass 10  fail 1   ← 예전엔 통과했다
M4 지어낸 한국어 문구           pass 10  fail 1   ← 예전엔 통과했다
M5 Canon 도달 불가             pass 10  fail 1   ← 예전엔 조용히 통과했다
M6 --board 가 다크에 없음       pass 10  fail 1   ← 예전엔 통과했다 (= B-1 의 사각지대)
M7 가짜 진행률 바              pass  9  fail 2
```

### 아직 반영하지 않은 것 — 판단이 필요해서 남긴다

| # | 내용 | 왜 남겼는가 |
|---|---|---|
| **H-3** | 테마 토큰·토글·칩 문법은 사실상 **WBS-36** 의 산출물이다. 승인 범위는 WBS-00 → WBS-01 이었다 | 토큰 없이는 SC-01 을 Canon 대로 그릴 수 없어 불가피했지만, **토글과 영속화는 아니었다.** 범위를 넘은 것이 맞고 여기 밝혀 둔다. 되돌릴지는 PM 판단이다 |
| **M-2** | **Canon 이 자기모순이다.** `16` §2.1 의 다크 표와 `visual-design.html` 의 다크 값이 **10개 토큰에서 다르다.** 나는 프로토타입 쪽을 골랐고(출처는 파일에 적었다) 보고서에는 "§2 · §2.1 전사" 라고 잘못 적었다 | **구현자가 조용히 정할 일이 아니다.** 어느 쪽이 정본인지 PM/Founder 판정이 필요하다. 보고서의 잘못된 문구는 고쳤다 |
| **M-3** | 스파이크 원시 로그가 `/tmp` 에만 있어 재부팅하면 사라진다. Spike D 픽스처는 이미 없다 | `21`:22 는 원시 로그를 산출물로 요구한다. 크기가 커서 커밋 여부는 판단이 필요하다 |
| **M-6** | `visual.mjs` 가 추적 중인 스크린샷을 덮어쓴다 | 증거 생성과 검증을 분리해야 한다 |
| **L-4** | 코드 저장소 `README.md` 가 아직 "구현 없음 / HOLD" 라고 말한다 | Gate 가 열렸으므로 사실이 아니다 |
