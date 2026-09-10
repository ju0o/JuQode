# Batch 31 — Windows 에서 실제로 실행해 보고 나서야 보인 것들

사용자가 Windows PC 에서 `scripts/verify-windows.ps1` 을 실제로 돌린 로그를 보내왔다.
이 배치는 그 로그의 **모든 실패 항목을 하나씩 원인까지 따라간 결과**다.

리눅스에서는 전부 통과하던 것들이다. 이것이 D-125 가 존재하는 이유이고,
`DEFERRED_VALIDATION.md` 가 "구현했다"와 "확인했다"를 끝까지 갈라 적는 이유다.

## 사용자 로그 · 보고된 실패

| # | 보고된 증상 | 진단 | 원인 |
|---|---|---|---|
| 1 | unit tests FAIL — `no unit tests ran` | 제품 아님 · **스크립트** | `tests/*.test.js` 글롭 |
| 2 | e2e FAIL — `exited 1` | 제품 아님 · **테스트 하네스** | e2e 3종이 POSIX 전용 |
| 3 | packaged exe never finished loading | 제품 아님 · **하네스 누수의 2차 피해** | 단일 인스턴스 잠금 |
| 4 | WBS-00 spikes FAIL — `no JSON produced` | **원인 불명 — 하네스가 이유를 안 남김** | 아래 |
| 5 | 종료 후 JuQode/electron 4개 생존 | 제품 아님 · **하네스** | `.cmd` 껍데기만 죽임 |
| 6 | 스크립트 자체가 line 243 에서 PowerShell 에러로 사망 | **하네스** | `Set-StrictMode` |

## 사용자 질문: 방금 찾은 spawn 버그와 관련이 있는가

**없다.** 여섯 개 중 하나도 아니다.

`session.js` 의 spawn 버그는 **Work 를 시작할 때만** 발현한다. 이 하네스는 Work 를 한 번도
시작하지 않는다 — 부팅, 렌더, 테마, 패키징, 스파이크만 본다. 그래서 이 로그는 그 버그의
증거가 아니고, 그 버그가 이 로그의 원인도 아니다.

두 개는 **서로 독립인 별개의 Windows 결함**이며, 둘 다 이 배치에서 고쳤다.
spawn 버그의 실제 증상은 사용자가 앱에서 본 것 — "Claude Code 연동이 안 된 것처럼 보인다" — 쪽이다.

## 하나씩

### 1 · `no unit tests ran` — 글롭을 아무도 펼치지 않았다

```
"test:unit": "node --test --test-timeout=60000 tests/*.test.js"
```

리눅스에서는 **bash** 가 글롭을 펼쳐서 node 에 파일 목록을 넘긴다. Windows 의 npm 은
`cmd.exe` 로 스크립트를 돌리고, `cmd.exe` 는 글롭을 펼치지 않는다. node 는 `tests/*.test.js`
라는 **이름의 파일**을 찾다가 아무것도 못 찾고, 하네스는 `pass=0` 을 보고 던진다.

고침: 글롭을 따옴표로 묶어 **node 자신이** 펼치게 한다 (node 22 의 test runner 는 글롭을 받는다).
그러면 두 OS 에서 같은 목록이 나온다. 측정: 리눅스 `# pass 546`, 따옴표 전후 동일.

### 2 · e2e 가 POSIX 전용이었다

세 파일 전부 Windows 에 없는 것에 의존하고 있었다.

- `xvfb-run` — Windows 에는 없고, 필요도 없다 (진짜 데스크톱이 있다)
- `node_modules/.bin/electron` — Windows 의 shim 은 `electron.cmd` 이고, 그것도 `cmd.exe` 를
  거쳐야 한다 (CVE-2024-27980 완화). **제품이 지키는 규칙과 정확히 같은 규칙**이다
- `process.kill(-pid)` — Windows 에 프로세스 그룹이 없다. 던진다
- `pgrep` — 없다

고침: `tests/e2e/launch.mjs` 하나가 "어떻게 띄우고 · 어떻게 죽이고 · 몇 개 살아있는지"를
OS 별로 답한다. 세 파일이 그것을 쓴다. 리눅스 e2e 는 리팩터 후에도 그대로 통과한다.

`countElectron()` 은 **이 체크아웃의** electron 만 센다. 개발자 머신의 다른 Electron 앱도
`electron.exe` 라서, 전역으로 세면 남의 앱 때문에 고아 검사가 실패한다.

### 3 · packaged exe never finished loading — 앞 단계가 남긴 시체 때문

패키징 단계 **직전**에 SC-01 CDP 단계가 있고, 그 단계는 electron 을 4개 남기고 끝났다 (#5).
앱은 `requestSingleInstanceLock()` 을 잡는다. 그래서 새로 뜬 `JuQode.exe` 는

```js
if (!app.requestSingleInstanceLock()) { app.quit(); }
```

에서 **아무 trace 도 출력하지 않고 즉시 종료**한다. 하네스는 `did-finish-load` 이벤트가
없다는 것만 보고 "패키징이 실패했다"고 적었다. 패키징은 성공했을 가능성이 높다.

**한 단계의 누수가 다음 단계를 엉뚱한 이유로 실패시킨 것**이고, 이것이 이 로그에서 가장
값비싼 오진이다.

고침 두 가지. (a) 단계 사이에 `Sweep` 을 넣되, **쓸어낸 사실을 `$Leaks` 에 기록**한다 —
누수는 여전히 실패로 보고된다, 다음 단계를 오염시키지만 않을 뿐이다.
(b) 이 실패 메시지가 이제 살아있는 프로세스 수와 로그 첫 줄을 함께 말한다.

### 4 · spikes 가 JSON 을 안 남겼다 — 이유를 알 수 없다

여기서 **추측하지 않는다.** `spikes.log` 는 사용자 머신에 있고 나는 못 본다.

대신 이 실패가 다음 번에는 스스로를 설명하도록 두 곳을 고쳤다.

- 스크립트: `uncaughtException` / `unhandledRejection` 에서도 **부분 증거를 쓰고** 나간다.
  spawn 의 `'error'` 이벤트는 비동기로 뜨므로 스파이크 본문의 try/catch 가 절대 못 잡는다 —
  가장 유력한 후보였고, 두 spawn 에 핸들러를 달았다.
- 하네스: `spikes produced no JSON` 대신 **node 종료 코드와 마지막 6줄**을 같이 던진다.

증상만 말하고 원인을 감추는 메시지는, 원인을 모른다는 사실조차 감춘다.

### 5 · 프로세스 4개 생존 — `.cmd` 껍데기만 죽였다

```powershell
$proc = Start-Process -FilePath 'node_modules\.bin\electron.cmd' ...
Stop-Process -Id $proc.Id -Force        # ← cmd.exe 를 죽인다. electron.exe 는 산다
```

Windows 에 프로세스 그룹이 없으니 `/T` (tree) 가 유일한 대응물이다. `Stop-Tree` 로 바꿨다.
마지막 고아 검사도 `Get-Process -Name electron` (머신 전역) 대신 **이 체크아웃 + `dist` 아래**
것만 세도록 좁혔다 — 그리고 발견하면 죽인다. 검증 스크립트가 개발자 머신을 더럽히면 안 된다.

### 6 · line 243 — StrictMode 아래에서 없는 속성을 읽었다

```powershell
$fails = @($R.Keys | Where-Object { $R[$_] -is [IDictionary] -and $R[$_].status -eq 'FAIL' })
```

`$R` 에는 단계 결과만 있는 게 아니다. `$R.host` 도 dictionary 이고, `status` 가 없다.
`Set-StrictMode -Version Latest` 아래에서 없는 속성 읽기는 **종료 오류**다.

**재현하고 고쳤다.** 리눅스에 PowerShell 7.6.6 을 받아 격리 재현:

```
-- old expression:
  THREW: The property 'status' cannot be found on this object. Verify that the property exists.
-- new expression:
  fails = unitTests  count=1
```

바로 아래 markdown 루프는 이미 `.Contains('status')` 로 묻고 있었다. 한 곳만 빠뜨린 것이고,
같은 파일 안에 정답이 있었다. 스크립트 전체 파싱도 통과 (`Parser::ParseFile` → PARSE OK).

## 같이 고친 별개의 Windows 결함 — 취소가 아무것도 안 죽인다

로그를 따라가다 `session.js` 의 `stop()` 에서 발견했다. spawn 버그의 **쌍둥이**다.

```js
const group = -child.pid;
process.kill(group, 'SIGTERM');   // Windows: 그룹이 없다. 던진다
```

주석은 정직하게 "Windows 는 커버 안 됨 (DV-7)"이라고 적혀 있었지만, 그 말은
**Windows 에서 취소 버튼이 아무 일도 하지 않는다**는 뜻이다. `15` 의 취소 계약이 한 OS 에서
전혀 성립하지 않는다. 게다가 이제 우리가 쥔 pid 는 `cmd.exe` 껍데기라, `/T` 없이는
진짜 claude 프로세스와 그 아래 node 가 살아남는다.

`killPlan(platform, pid, force)` 를 순수 함수로 빼서 **리눅스에서 Windows 의 답을 검사**한다.
`launchArgv` 와 같은 형태다. Windows 의 1차 시도는 `/T` (강제 아님), 2차가 `/T /F` — Windows
가 콘솔 자식에게 제공하는 부드러운 단계는 사실상 없으므로, 에스컬레이션이 실제로 닿는 단계다.
`tests/unit.test.js` 의 능력 목록에 `spawnSync(` 와 `taskkill` 을 등재했다 —
프로세스를 띄우는 곳은 전부 열거되어야 한다.

## 테스트

| | |
|---|---|
| unit | `# tests 546 · # pass 546 · # fail 0` |
| e2e (리팩터 후, 리눅스) | boot · visual+behaviour · offline/reduced-motion/shutdown 전부 PASS, exit 0 |
| PowerShell 파싱 | PARSE OK (pwsh 7.6.6) |
| line 243 회귀 | 옛 식 THREW · 새 식 `fails = unitTests` |
| `killPlan` | linux/darwin 그룹 · win32 `/T`, 강제 단계만 `/F` |
| `launchArgv` | `.cmd`/`.bat` 만 래핑, 인자 순서 보존 |

## 여전히 확인 못함

Windows 에서 **실제로 다시 돌려봐야** 아는 것들이다. 이 배치는 리눅스에서 고쳤을 뿐이다.

- e2e 3종이 Windows 에서 통과하는가 (`launch.mjs` 는 리눅스에서만 측정됐다)
- 패키징 실패가 정말 단일 인스턴스 잠금 때문이었는가 — 누수를 없앤 다음 다시 봐야 안다
- spikes 가 왜 죽었는가 — 다음 실행이 스스로 말할 것이다
- `taskkill /T` 가 claude 트리를 실제로 끝내는가 (DV-7)
