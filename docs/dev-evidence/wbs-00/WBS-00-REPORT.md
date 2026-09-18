# WBS-00 · 기술 스파이크 보고서

| | |
|---|---|
| **일자** | 2026-09-09 |
| **판정** | **PARTIAL** — 실행 가능한 것은 전부 실행했다. **대상 OS(Windows)는 하나도 검증하지 못했다.** |
| **승인 근거** | Founder Final Planning Gate PASS (2026-09-09) · Planning SSOT `ju0o/JuQode-Private@270ee4e` |
| **코드 저장소 시작 SHA** | `7a6e55ee178fb9a2104622817d7bbf6e698f9053` |
| **스파이크 코드** | 버리는 코드. 제품 모듈로 승격하지 않았다 |

---

## 0. 가장 먼저 말해야 하는 것 — 대상 OS 를 검증하지 못했다

D-125 는 대상 OS 를 **Windows 10 (1809+) · Windows 11** 로 정한다. 이 Run 이 돌아간 기계는:

```
Linux ju0o 7.0.0-31-generic  ·  Ubuntu 26.04.1 LTS  ·  x86_64
/proc/version 에 microsoft 없음 (WSL 아님)  ·  /mnt/c 없음  ·  wine 없음
```

**네이티브 리눅스다.** 따라서 스파이크 A · B · C 의 Windows 부분은 **실행되지 않았다.**
문서에서 유추하지 않았고, 리눅스 결과를 Windows 결과로 옮겨 적지 않았다.
해당 항목은 전부 **NOT TESTED** 이며, 그것이 이 보고서의 가장 중요한 사실이다.

`19` §V 의 다음 행은 이 스파이크로 **닫히지 않는다**:

- 데스크톱 런타임 패키징 · PTY(ConPTY) · 서명 — **NOT VALIDATED** 유지
- 실제 프로세스 스폰/시그널(Windows) — **NOT VALIDATED** 유지

리눅스에서 나온 PASS 가 사는 이유는 하나다: **Windows 스파이크가 무엇을 재현해야 하는지 정확히 규정한다.**
"프로세스 수명주기가 검증되었다" 로 읽으면 잘못 읽은 것이다.

---

## 1. 종합 판정

| 스파이크 | 리눅스에서 | 대상 OS(Windows) |
|---|---|---|
| **A** Electron 데스크톱 셸 | **PASS** | **NOT TESTED** (설치 프로그램 생성은 **FAIL** — wine 없음) |
| **B** PTY / 터미널 계약 | **PASS** (POSIX) · 고아 처리 **PARTIAL** | **NOT TESTED** (ConPTY 는 Windows 전용) |
| **C** 프로세스 수명주기 · 취소 · 고아 | **PASS** (POSIX) · 종료 확인 **PARTIAL** | **NOT TESTED** |
| **D** 10k 파일 증거 성능 | **PASS** — 단, **정합성 결함 2건 발견** | 해당 없음 (플랫폼 무관) |

**WBS-00 = PARTIAL.**
아키텍처 블로커는 발견되지 않았다. 환경 블로커(대상 OS 부재)가 남는다.

---

## 2. 제품 계약을 바꾸는 발견 — 우선순위 순

### 2.1 🔴 Git 경로에 비밀 파일 제외가 없다 (스파이크 D)

`19` §C1 ④ 와 §E 는 `.env*` · `*.pem` · `*.key` 를 증거에서 제외한다고 선언한다.
**메커니즘 A(Git)는 그 제외를 구현하지 않는다 — `.gitignore` 를 그대로 상속할 뿐이다.**

반증 테스트: `.gitignore` 에서 비밀 파일 항목만 빼고(= 비밀을 gitignore 하지 않은 사용자) 같은 스크립트를 다시 돌렸다.

```
basis tree 안의 비밀 경로:  .env · .env.local · .env.production
                          certs/deploy.key · keys/server.pem · src/mod001/local.key
JuQode 가 쓴 오브젝트 안의 평문:  JUQODE_SPIKED_SECRET_ENV / _ENVLOCAL / _ENVPROD / _KEY / _NESTEDKEY / _PEM
```

**평문 비밀이 `<app data>/evidence/<work-id>/objects/` 로 복사된다.** 그리고 `19` §P ② 는 렌더된 패치를
**영구 보존**한다(History 는 사라지지 않으므로). 대상 사용자가 비개발자라는 점이 이 결함을 키운다 —
`.gitignore` 를 손보지 않은 프로젝트가 정확히 이 경우다.

이것은 구현 실수가 아니라 **명세의 구멍**이다. §E 본문이 이름 기반 제외를 Git 분기에 적용한 적이 없다.
비Git 경로(메커니즘 B)는 제대로 제외한다(`chmod 000` 테스트로 파일을 연 적조차 없음을 증명).

**WBS-08 이 열리기 전에 `19` §E 를 고쳐야 한다.** 이 보고서는 증거일 뿐 Canon 을 바꾸지 않았다.

### 2.2 🔴 §E 의 "무시된 파일 공백" 완화책이 작동하지 않는다 (스파이크 D)

§E 는 전후 `git status --ignored=matching` 을 비교해 증거에 담기지 않은 변경을 사용자에게 알리겠다고 한다.
실측: 에이전트가 `app.log` 와 `.env.local` 을 **수정**했는데 전후 출력이 **문자 단위로 동일**했다.

```
before: ! .env  ! .env.local  ! .env.production  ! app.log
after : ! .env  ! .env.local  ! .env.production  ! app.log
```

`--ignored=matching` 은 무시된 **경로**를 나열할 뿐 내용도 mtime 도 보지 않는다.
경로가 추가·삭제될 때만 달라진다. **설계 목적 그대로의 경우에 침묵한다.**

### 2.3 🟠 추적되지 않은 파일이 캡처마다 다시 해시된다 (스파이크 D)

q19 §6 의 "A 는 저장소 크기가 아니라 **바뀐 파일 수**에 비례한다" 는 주장은
**이미 사용자 인덱스에 있는 파일에만** 참이다. untracked 파일은 복사한 인덱스에 없으므로
매 캡처(Work 당 2회, 영원히) 다시 해시·압축된다.

| | 시간 | 증거 디스크 |
|---|---|---|
| 같은 128 MB untracked 바이너리, 연속 3회 캡처 | **매번 6.6 s** | **매번 +132 MB** |
| 같은 파일을 커밋한 뒤 | 276 ms | +0 |
| 10k 파일 전부 untracked (갓 `git init`) | 2.5–3.3 s | 캡처당 60 MB |

갓 만든 프로젝트를 여는 비개발자가 정확히 이 경로를 밟는다.

### 2.4 🟠 SIGTERM 으로는 드로어 셸이 죽지 않는다 (스파이크 B)

| 신호 | `onExit` | 셸 생존 |
|---|---|---|
| `kill()` (기본 SIGHUP) | `{exitCode:0, signal:1}` | 죽음 |
| `kill('SIGTERM')` | **발생 안 함** | **생존** |
| `kill('SIGINT')` | **발생 안 함** | **생존** |
| `kill('SIGKILL')` | `{exitCode:0, signal:9}` | 죽음 |

대화형 bash 는 프롬프트에서 SIGTERM/SIGINT 를 무시한다. 정상 동작이지만,
**드로어 PTY 를 닫는 가장 자연스러운 선택이 아무 일도 하지 않는다.**
`19` §C4 의 `SIGTERM→5s→SIGKILL` 사다리는 **child_process 로 도는 Quick Command 에는 맞고
드로어 셸에는 틀리다.** 두 계약을 분리해야 한다.

### 2.5 🟠 PTY 에서 stderr 는 분리할 수 없다 (스파이크 B)

fd 가 하나이므로 자식의 fd 1 과 fd 2 가 같은 슬레이브 장치다. node-pty 의 한계가 아니라 POSIX 의 성질이다.
`19` §C4 는 "종료 코드·stderr 숨기지 않음" 을 약속한다 — 드로어 안에서 그것은 **"전부 보여 준다"** 로만 만족된다.
드로어는 어떤 줄이 stderr 인지 **라벨링할 수 없다**.
따라서 실제 Quick Command 는 파이프를 쓰는 `child_process` 로 돌려야 한다(REC-010 이 이미 그렇게 말한다 —
이제 그 결정에 측정이 붙었다).

### 2.6 🟠 취소된 프로세스는 종료 코드 0 으로 끝난다 (스파이크 C)

신호를 스스로 처리하고 깨끗이 끝나는 자식은 **성공과 바이트 단위로 구별되지 않는다**.
§C3-C 가 Claude Code 에 대해 적어 둔 사실이 **일반 성질**로 확인됐다.
**종료 코드는 취소 판별자가 될 수 없다.** 신호를 처리하지 않고 죽은 자식만 `signal:'SIGINT'` / 셸 `130` 을 준다.

### 2.7 🟠 그룹 킬은 `detached:true` 없이는 JuQode 자신을 죽인다 (스파이크 C)

```
driver pid=54146 pgid=54146 | kid pid=54153 pgid=54146 | shared=true
process.kill(-54146, SIGTERM) → 종료됨  node e8_selfkill.js   (driver exit 143)
```

스크립트 실행 중 드라이버가 실제로 죽었다. **모든 자식을 자기 프로세스 그룹으로 띄우는 것은 선택이 아니다.**

### 2.8 🟡 `kill(pid,0)` 은 좀비를 살아 있다고 답한다 (스파이크 C)

```
zombie pid 53645: kill(0)=alive   ps="Z    sleep"
```

`kill(pid,0)` 은 **"없어졌다"만 증명할 수 있고 "돌고 있다"는 증명하지 못한다.**
`Z` 는 죽은 것으로 읽어야 한다. pid 재사용 대비로 `{pid, started_at}` 을 **저장만 하지 말고 비교**해야 한다.

### 2.9 🟡 고아는 실재하고 일부는 원천적으로 못 잡는다 (스파이크 B · C)

PTY 를 죽이면 **포그라운드 프로세스 그룹만** 확실히 죽는다.
세션 스윕(`sid === pty.pid`)으로 4가지 고아 유형 중 3가지를 회수했다.
**`setsid` 로 세션을 떠난 자식은 어떤 부모측 방법으로도 못 잡는다** — 분리형 dev 서버가 정확히 그것이다.
제품은 "드로어가 뒷정리를 다 한다" 고 말하면 안 된다.

### 2.10 🟡 Electron 42+ 는 `postinstall` 이 없다 (스파이크 A)

```
39.0.0 → {"postinstall":"node install.js"}      42.0.0 → undefined
41.0.0 → {"postinstall":"node install.js"}      44.3.0 → undefined
```

바이너리는 첫 `require('electron')` 때 **지연 다운로드**된다.
**`npm ci` 만으로는 실행 가능한 Electron 이 없다** — 에어갭/오프라인 CI 가 깨진다.
빌드 단계에 `node node_modules/electron/install.js` 를 명시하고 `~/.cache/electron` 을 캐시해야 한다.

---

## 3. 스파이크별 측정값

### A — Electron 데스크톱 셸

**버전** (실행 중인 메인 프로세스의 `process.versions`):
`electron 44.3.0` · `chrome 152.0.7977.78` · `node 24.20.0` · `modules 149` (네이티브 모듈 ABI)

**부팅** (리눅스, Xvfb, `--no-sandbox`): `app.ready` → `window.constructed` → `did-finish-load` → `ready-to-show` → `quit exit 0`.
`BrowserWindow.getAllWindows().length === 1` — **창 하나** 확인.

**시작 시간** (10회, 목표치 없음 — 승인된 예산이 없으므로 만들지 않는다):

| 지점 | median | max |
|---|---|---|
| `app.ready` | 216 ms | 242 ms |
| `did-finish-load` | 407 ms | 436 ms |
| 패키징본 `did-finish-load` | 306 ms | — |

**이 숫자는 리눅스 바닥값이다.** Windows 는 PE 로더 + Defender/SmartScreen 이 지배적이고 **측정되지 않았다.**

**패키징**

| 대상 | 결과 |
|---|---|
| Linux AppImage · dir | **PASS** — 빌드되고 **부팅됨**, exit 0 |
| Windows zip · unpacked (builder · forge 양쪽) | **PARTIAL** — 진짜 PE32+ x64 산출물 생성, **실행한 적 없음** |
| Windows NSIS 설치 프로그램 | **FAIL** — `spawn wine ENOENT` |
| Windows Squirrel 설치 프로그램 | **FAIL** — `You must install both Mono and Wine on non-Windows` |
| Windows 코드 서명 | **NOT TESTED** |

wine 장벽은 **설치 프로그램에만** 있다. 앱 번들 자체는 wine 없이 만들어진다.

**함정 (P-1):** NSIS 실패 뒤에도 `dist/` 에 189 KB `Setup.exe` 가 남았다 — 110 MB 페이로드가 안 박힌 중간 산출물이다.
`dist/` 에서 `.exe` 존재만 보고 "Windows 설치 프로그램 생성" 이라고 보고하면 거짓이 된다. **크기와 종료 코드로 판정할 것.**

**오프라인**: 정상 부팅에서 외부 요청 **0건**, exit 0.
단 `--proxy-server` 는 킬 스위치가 아니다 — 렌더러는 막히지만 메인의 `net.fetch` 는 **200 을 받는다**(3/3 재현).
차단은 `session.webRequest` 계층에서만 양쪽 다 막혔다.

**종료 · 고아**: `app.quit()` exit 0 · SIGTERM exit 0 · SIGKILL 137 — **세 경우 모두 고아 0**.

**보안 기본값**: `contextIsolation:true` · `nodeIntegration:false` · `sandbox:true` · preload + 좁은 IPC 로 정상 부팅.
렌더러 탐침(개발·패키징본 동일): `{"require":"undefined","process":"undefined","module":"undefined","bridge":"object","ipcRenderer":"undefined"}`.
Electron 44 의 **기본값이 이미 안전하다.**

> **정직한 공백:** 이 호스트는 `chrome-sandbox` 를 root 소유로 만들 수 없고 AppArmor 가 비특권 유저 네임스페이스를
> 막아, 모든 실행에 `--no-sandbox` 가 필요했다. **OS 수준 Chromium 샌드박스는 검증하지 못했다.**
> 앱 내부 경계만 확인했다. `07` §2 · §D1 의 "앱 내부 경계이며 사용자 프로세스 격리가 아니다" 라는 문구는 그대로 유효하다.

**메모리** (§D1 이 "수용하되 측정하지 않았다" 고 남긴 칸을 채운다): 빈 창 하나, 유휴 상태
프로세스 6개 · **PSS 합계 372 MiB** (RSS 합계 733 MiB 는 공유 페이지를 중복 계산한다).

### B — PTY / 터미널 계약

node-pty 1.1.0 을 **소스에서 컴파일**(리눅스 prebuild 없음, 2.5 s). Windows 는 prebuild + **자체 번들 `conpty.dll` + `OpenConsole.exe`** (버전 고정) — 별도의 패키징·서명 표면이다.

| 항목 | POSIX |
|---|---|
| PTY 생성 (`bash`, `sh`) | PASS — 진짜 제어 tty (`pts/5`) |
| 명령 실행 | PASS — **stdout·stderr 단일 스트림** |
| resize | PASS — `stty size` · `tput cols` · SIGWINCH 3중 확인 |
| close · `onExit` | PASS — 단 §2.4 의 신호 주의 |
| 고아 정리 | **PARTIAL** — §2.9 |
| 대화형 입력 · Ctrl-C | PASS — `\x03` 이 자식을 끊고 셸은 생존, `130` |
| 스폰 실패 감지 | PASS — **단 throw 가 아니다** (아래) |

**스폰 실패는 예외를 던지지 않는다.** `forkpty()` 가 먼저 fork 하므로 실패는 자식에서 일어나고 PTY 로만 보고된다:
`execvp(3) failed.: No such file or directory` · `chdir(2) failed.: Not a directory`.
TD-01 의 `터미널을 열 수 없습니다` 는 **try/catch 로 잡을 수 없고**, "세션이 서기 전에 `onExit` 이 왔다" 로 판정해야 한다.

**격리 없음, 측정으로 확인**: 자식이 `PWD` = 실제 프로젝트 루트, `WHOAMI=skkse12`,
주입한 토큰 그대로, 홈 읽기 가능, 네트워크 가능. **TD-01 안전 배너는 정당하다.**

**처리량** ~30 MiB/s, `pause()` 로 정확히 0 바이트 — 배압은 실재한다. 폭주 명령 대비 링 버퍼가 필요하다.

### C — 프로세스 수명주기

| 항목 | POSIX |
|---|---|
| spawn (`detached` 유무) | PASS — §2.7 |
| 장수 핸들 유효성 | PASS — `exitCode===null` ⟺ 생존 (같은 앱 프로세스 안에서만) |
| 프로세스 트리 / 그룹 | PASS — 부모만 죽이면 **손자가 PPID 1 로 살아남는다**; 그룹 킬은 전부 정리 |
| 우아한 종료 → 강제 | PASS — SIGTERM 무시하는 자식에게 **SIGKILL 이 2011 ms 에 실제로 발화** |
| SIGINT 취소 | PASS — §2.6 |
| 종료 확인 | **PARTIAL** — §2.8, pid 재사용은 재현 못 함 |
| 고아 탐지 | PASS(상속 pgid) / **PARTIAL**(자가 `setsid`) |

정상 자식의 그룹 소멸 확인까지 **5 ms ~ 16.6 ms** (5회). §C4 의 5 s 유예는 이 부류에 300배 여유다 —
다만 소켓을 정리하는 실제 dev 서버는 측정하지 않았다.

**Windows 에서 가장 큰 미지수:** Node 문서대로라면 Windows 의 SIGTERM 은 이미 `TerminateProcess` 이고,
그렇다면 **우아한 단계가 아예 없다.** dev 서버가 flush 할 기회 없이 죽는다.
`CTRL_BREAK_EVENT` 경로는 네이티브 애드온이나 헬퍼 exe 가 필요하다. **WBS-24 설계 전에 답해야 한다.**

### D — 10k 파일 증거 성능

픽스처: 22,427 파일 / 231 MB (basis 대상 9,910 파일 / 162 MB), Git · 비Git 두 변형.
스크래치가 tmpfs(RAM) 라 픽스처는 ext4/NVMe 로 옮겨 측정했다 — 그러지 않으면 디스크가 아니라 RAM 을 재게 된다.

| 시나리오 | median | worst | peak RSS |
|---|---|---|---|
| **A** Git basis, 추적됨·깨끗 | **101 ms** | 112 ms | 8 MB |
| **A** 1,000 파일 변경 | 360 ms | 391 ms | 16 MB |
| **A** 9,000 파일 변경 | 3,787 ms | **5,634 ms** | 19 MB |
| **A** 갓 `git init`(전부 untracked) | 2,530 ms | 3,271 ms | 16 MB |
| **B** sha256 manifest, warm | 391 ms | 419 ms | 83 MB |
| **B** 같은 것, cold | 1,990 ms | **14,085 ms** | 84 MB |
| **A** 50k 파일, 추적됨 | 490 ms | 490 ms | 17 MB |

**A 가 B 보다 warm 3.9× · cold 19× · 최악 108× 빠르고 메모리는 10× 적다.**

**바이트 동일성 증명 — 10k 에서도 성립.** 78,411 줄 지문(모든 파일 + `.git/**` + 인덱스 + 스테이징)이
캡처 전후 **완전 동일**, 사용자 `.git` 에 쓴 오브젝트 **0개**. 사용자가 스테이징해 둔 편집도 그대로 살아남았다.

**큰 파일 절벽**: 128 MB → 4.9 s / RSS 136 MB · **1 GB 비압축 → 58 s**, 증거 +1,029 MB.
`core.bigFileThreshold`(512 MiB) 미만은 통째로 메모리에 올라온다. §E 의 2 GiB **총량** 상한은 이 경우를 못 막는다.

---

## 4. WBS-01 로 갈 수 있는가

**갈 수 있다. 단 조건부다.**

발견된 것 중 **WBS-01(저장소·데스크톱 기반)을 막는 아키텍처 블로커는 없다.**
스파이크 A 는 D-125(Electron)를 반박할 근거를 하나도 내지 않았다 — 창 하나, 안전한 기본값,
깨끗한 종료, 고아 0, 외부 요청 0, 리눅스 패키징 동작.

§2 의 결함들은 전부 **WBS-08 · 16 · 23 · 24 · 25 영역**이고 WBS-01 이 건드리지 않는다.

**그러나 WBS-01 의 인수 조건 첫 줄은 이 기계에서 만족될 수 없다:**

> `21` WBS-01 Acceptance: **Windows 10 (1809+) · Windows 11 에서 부팅한다** (D-125 가 대상 OS 를 정한다)

따라서 WBS-01 은 **PARTIAL 로 끝날 수밖에 없다.**
리눅스에서 진짜로 만들고 진짜로 검증하되, Windows 부팅·시작 시간·설치 프로그램·서명·OS 별 스크린샷은
**NOT TESTED** 로 남는다. 그것을 PASS 라고 적지 않는다.

---

## 5. 남은 위험

1. **대상 OS 전체가 미측정.** Windows 호스트 또는 Windows CI 러너는 WBS-01 인수의 **경성 전제**이고 대체 불가다.
2. **Windows 에 우아한 종료 단계가 없을 수 있다** (§C 3.4). WBS-24 설계 전에 답해야 한다.
3. **평문 비밀이 영구 증거 저장소로 들어간다** (§2.1). WBS-08 전에 `19` §E 를 고쳐야 한다.
4. **자가 `setsid` 자식은 어느 OS 에서도 부모측에서 못 잡는다.**
5. **네이티브 모듈 ABI**: Electron 44 = Node 24.20.0 = `modules 149`. node-pty 는 그 ABI 로 재빌드해야 한다.
6. **OS 수준 샌드박스 미검증** (호스트 제약). 앱 내부 경계만 확인했다 — 문구를 격상하면 안 된다.
7. **진짜 cold boot 미측정** (root 없음). 모든 cold 숫자는 낙관적이다.

## 6. 권고

**WBS-01 에서 지금 할 것**
- Electron **44.3.0 고정**(캐럿 없이), `electron-builder@26.15.3` 고정. ABI 149 는 node-pty 계약이다.
- `npm ci` 뒤 **명시적 바이너리 페치 단계**를 넣고 `~/.cache/electron` 을 캐시한다 (§2.10).
- 검증된 `webPreferences` 를 그대로 쓴다 + `setWindowOpenHandler(deny)` + `will-navigate` 가드.
- 오프라인은 **세션 계층**에서 강제한다. `--proxy-server` 플래그로는 메인 프로세스가 새어 나간다.
- `ready-to-show` 에 **타임아웃 폴백**을 둔다 (10회 중 1회 발생하지 않았다).
- 패키징 검증은 **파일 존재가 아니라 종료 코드와 크기**로 판정한다 (§P-1).
- **시작 시간 예산을 아직 적지 않는다.** Windows 실측이 나온 뒤 정한다.

**대상 OS 를 위해 필요한 것**
- **Windows 러너를 붙인다.** 편의가 아니다 — NSIS·Squirrel 이 wine 없이 하드 실패하고, 서명은 어차피 Windows 가 필요하다.
  이 하나로 WBS-01 인수(OS 별 스크린샷 + 실측 시작 시간)와 `19` §V 의 패키징·서명 행이 함께 열린다.

**WBS-08 이 열리기 전에 Canon 을 고쳐야 하는 것**
- `19` §E 의 Git 경로에 **이름 기반 비밀 제외**를 추가 (`:(exclude).env` 등) 하고, 압축 해제 후 스캔으로 증명한다.
- §E 의 무시된-파일 공백 검사를 `(path, size, mtime_ns)` 비교로 교체하거나, **탐지 불가임을 제품이 정직하게 말한다.**
- JuQode 소유 인덱스를 Work 사이에 **보존**해 untracked 파일 재해시를 없앤다 (§2.3).
- 총량 상한과 별개로 **파일당 크기 가드**를 둔다 (§D 큰 파일 절벽).

**WBS-16 · 23 · 24 · 25 를 위해**
- `stopAndVerify()` **하나의 공용 원시 함수**로 만든다 — 취소 · 정지 · 정리가 같은 것을 필요로 한다.
- 모든 자식을 **자기 프로세스 그룹**으로 띄운다 (POSIX `detached:true` / Windows Job Object).
- **그룹에 신호하고, 종료를 폴링으로 확인한다.** 종료 이벤트를 믿지 않는다.
- **종료 코드로 취소를 추론하지 않는다** (§2.6).
- 드로어 셸과 Quick Command 는 **다른 종료 계약**을 쓴다 (§2.4).
- 스윕 후 남은 것을 **사용자에게 그대로 보여 준다** — 다만 목록이 완전하다고 약속하지 않는다 (§2.9).

## 7. 재현 · 원시 증거

**정직한 정정 (2026-09-09).** 첫 제출에서 원시 로그는 `/tmp` 에만 있었다. 독립 감사가 그것을
지적했고(M-3), **그 뒤 실제로 사라졌다** — 세션 스크래치가 정리되면서 전부 없어졌다.

죽은 로그를 되살릴 수는 없으므로 **재생성 가능한 형태로 바꿨다.** 스크립트가 저장소에 있고,
`raw/` 의 JSON 은 그 스크립트를 이 호스트에서 돌린 실제 출력이다:

| 파일 | 스크립트 |
|---|---|
| [`raw/spike-c.json`](raw/spike-c.json) | `scripts/spikes/process-lifecycle.mjs` |
| [`raw/spike-d-evidence-contract.json`](raw/spike-d-evidence-contract.json) | `scripts/spikes/evidence-contract.mjs` |

**남아 있지 않은 것:** 스파이크 A 의 부팅·패키징 로그와 스파이크 D 의 10k 픽스처 성능표는
당시 전사이며 원시 로그가 없다. A 의 측정값은 WBS-01 이 같은 것을 더 나은 조건에서 다시 재고
있으므로([`../wbs-01/`](../wbs-01/)) 그쪽이 더 신뢰할 만한 증거다.

두 스크립트 모두 harmless 명령만 쓰고, 자기 픽스처를 `/var/tmp` 에 만들었다 지우며,
**사용자 프로젝트를 건드리지 않는다.**

## 8. §2.1 정정 후속 — 대체 계약이 실험으로 뒷받침되었다 (2026-09-09)

§2.1 이 지적한 Git 경로의 비밀 제외 부재는 이제 **정정 계약이 검증된 뒤** Canon 에 반영됐다
(Private PR #13, D-126a). 검증 중에 **한 번 더 배운 것이 있다:**

> `:(exclude)` pathspec **만으로는 부족하다.** pathspec 은 `add` 가 고려할 대상만 거른다.
> 사용자가 **이미 커밋해 둔** `.env` 는 복사된 인덱스에 그대로 남아 `write-tree` 가 그 blob 을
> 계속 참조한다. 첫 시도가 정확히 그렇게 실패했고, basis 트리에 여섯 개 비밀 경로가 전부 남았다.
> **복사 인덱스에서 `rm --cached` 까지** 해야 트리에서 사라진다.

정정 후 측정: basis 트리의 비밀 경로 **0**, JuQode 가 쓴 오브젝트 중 마커 포함 **0 / 8**,
수정된 `.env.local` 을 제외-경로 원장이 **탐지**, 사용자 `.git` 에 쓴 오브젝트 **0**,
부분 스테이징 **보존**. 원문: [`raw/spike-d-evidence-contract.json`](raw/spike-d-evidence-contract.json).
