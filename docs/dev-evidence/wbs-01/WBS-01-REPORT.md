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
| 배경 | light `rgb(238,240,244)` · dark `rgb(12,14,18)` — `16` §2 토큰과 일치 |
| 가로 넘침 | **0px** |
| 구성 | 가운데로 모인 성긴 진입 화면 (`17`: SC-02 카드 격자와 구별되어야 한다) |

**직접 보고 고친 결함 1건.** 어두운 테마의 주 버튼이 **밝은 청록 위 흰 글자**라 대비가 나빴다.
`--juq` 가 다크에서 밝은 색으로 뒤집히는데 전경색만 흰색으로 고정돼 있었다.
`--on-juq` 토큰을 도입해 테마마다 전경을 고르게 했고, 회귀 방지로 대비 계산을 e2e 에 넣었다:

```
lightPriContrast 7.32:1   darkPriContrast 8.96:1   (AA 기준 4.5:1)
```

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
