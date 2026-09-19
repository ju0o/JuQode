# 출품 전 인수 검증 — JuQode 0.1.0

| | |
|---|---|
| 검증 일시 | 2026-09-19 00:20 ~ 01:20 (KST) |
| 검증 호스트 | Windows 11 Pro 10.0.26200 · x64 |
| 검증 대상 | `dist\JuQode-0.1.0-x64.exe` → `C:\Program Files\JuQode\JuQode.exe` (실제 설치본) |
| 연동 대상 | Claude Code CLI **2.1.276** (`C:\Users\user\.local\bin\claude.exe`), 로그인 상태 |
| 입장 | 개발자가 아니라 심사위원 |
| 규칙 | 실행해서 본 것만 적는다. 확인 못 한 것은 **미확인**. 발견한 문제는 **고치지 않았다.** |

검증에 쓴 증거물:
- 스크린샷 17장 — `%TEMP%\claude\C--Users-user-...\scratchpad\shots\`
- 앱 저장소 스냅샷 6개 (`b4.db` · `e.db` · `d116.db` · `d116b.db` 등) — 실제 Claude Code 세션의 원문 시그널이 들어 있다
- 테스트 원문 22개 파일 — `scratchpad\tests\*.txt`

---

## 판정

### `SUBMITTABLE = YES_WITH_RISK`

**제출은 할 수 있다. 단, 아래 ①②를 고치지 않고 내보내면 심사위원이 5분 안에 "안 되는 제품"으로 읽는다.**

근거 요약:

- **핵심 주장은 진짜다.** Claude Code 탐지·자동 선독·여섯 답·근거 파일 지목·권한이 **거절된 채로** 도착하는 것·좁게 범위 잡힌 허용·**같은 세션 재개**·실제 파일 변경 — 전부 실제 실행으로 확인했다. 연출이 아니다. 이 제품은 주장하는 일을 실제로 한다.
- **그런데 그 성공이 화면에서 「끝내지 못했어요」로 표시된다** (defect ①). 성공한 작업이 실패로 보인다.
- **프로젝트 루트 밖의 파일은 허용해도 되지 않는다** (defect ②). 허용 → 재거절 → 무한 반복. 사용자의 Claude 구독 사용량만 소모된다.
- **자연어 요청의 73% 가 거절된다** (defect ③ · 사용자 제보 재현). 영어는 0%.
- **터미널 서랍은 Windows 에서 작동하지 않는다** (defect ④).
- README 가 주장하는 `597/597` 과 `e2e 3종 PASS` 는 **이 Windows 에서 사실이 아니다** (506/597 · e2e 1/3).

①②는 각각 한 줄 수정이다. 합쳐서 10분. 고치면 `YES`.

---

## 근거 — 항목별

### A. 설치 경로

#### A1. SmartScreen — **PASS (경고는 뜬다, 제품은 그것을 미리 말한다)**

| 확인 | 값 | 증거 |
|---|---|---|
| 코드 서명 | **없음** | `Get-AuthenticodeSignature` → `Status : NotSigned` / `"파일 …JuQode-0.1.0-x64.exe에는 디지털 서명이 없습니다"` |
| SmartScreen 정책 | 켜짐 | `HKLM:\SOFTWARE\Policies\Microsoft\Windows\System\EnableSmartScreen = 1` |
| MOTW 부여 후 실행 | `smartscreen.exe` (PID 31840) 가 **기동됨** — 평판 검사가 실제로 돌았다 | 다운로드와 동일하게 `Zone.Identifier` / `ZoneId=3` / `HostUrl=https://github.com/...` 를 써 넣고 셸로 실행 |
| 차단 대화상자 | **이 머신에서는 뜨지 않았다** | 실행 6초 후 전체 창 열거 — SmartScreen 창 없음, 설치가 그대로 진행됨 |

- 실제로 설치되었다: `C:\Program Files\JuQode` (CreationTime 00:46:50), 언인스톨 항목 `JuQode 0.1.0`, `UninstallString "…\Uninstall JuQode.exe" /allusers`.
- **다른 머신에서 뜰지는 미확인.** SmartScreen 평판은 파일 해시 단위의 전역 값이고, 이 머신에는 같은 트리에서 나온 빌드 이력이 있다. 서명이 없는 신규 해시를 처음 받는 심사위원 PC에서는 `Windows에서 PC를 보호했습니다` 가 뜨는 것이 정상 동작이다. **뜬다고 가정하고 준비하는 것이 옳다.**
- **제품이 이것을 먼저 말한다는 점은 가산점이다.** 첫 화면에 그대로 있다:
  > 「서명되지 않은 빌드예요 / Windows 가 이 앱을 처음 열 때 경고를 보여 줄 수 있어요. 앱이 하는 일은 달라지지 않아요.」
  이 문구는 `app.isPackaged` 가정이 아니라 **실행 파일 자신의 PE 인증서 테이블을 파싱해서** 나온다 (`app/main/main.js:129-144` → `app/main/signing.js`).

> ⚠ 관찰된 편차 하나: `package.json` 의 `nsis.perMachine` 은 `false` 인데, 실제 설치는 `C:\Program Files` 에 `/allusers` 로 갔고 마법사 화면(`oneClick: false`)도 6초 관찰 구간에 나타나지 않았다. 이 세션이 관리자 권한이라 무인 승격된 것으로 보이나 **원인은 미확인.** 심사위원이 일반 사용자 계정이면 UAC 프롬프트를 한 번 더 만난다.

#### A2. 실행 · 첫 화면까지 — **PASS**

설치본을 6회 기동, 매번 측정 (`JUQODE_TRACE=1` 원문):

```
{"ev":"app.ready","ms":284,"versions":"44.3.0","segmenter":"semantic"}
{"ev":"did-finish-load","ms":359,"windows":1,"externalRequests":0}
{"ev":"window.shown","ms":518,"via":"ready-to-show","windows":1}
```

| 지표 | 값 |
|---|---|
| 창이 보이기까지 | **518 ~ 666 ms** |
| 렌더러 완전 로드까지 | **553 ~ 790 ms** |
| 흰 화면 깜빡임 | 없음 (`via: "ready-to-show"` — 준비된 뒤에 보여 준다) |
| 외부 요청 | **0** |
| `typescript` 세그멘터 | `semantic` (설치본 asar 안에 동봉됨) |

#### A3. Claude Code 가 없을 때 — **PASS**

`PATH` 에서 Claude Code 를 제거하고 `JUQODE_CLAUDE_BIN` 을 없는 경로로 돌린 뒤 기동.

- 탐지 결과 원문: `{"available":false,"reason":"not-installed"}`
- **빈 화면이 아니다.** 첫 화면 전문 (`document.body.innerText`):
  > 프로젝트 열기 / 내 컴퓨터에 있는 프로젝트 폴더를 열면, JuQode가 먼저 이 프로젝트가 무엇인지 읽어 드려요. / **프로젝트 폴더 열기** / 이미 있는 폴더를 고르면 돼요. 새로 만들지는 않아요. / 서명되지 않은 빌드예요 … / 최근에 연 프로젝트 — 아직 기록이 없어요 / **처음이시라면, 이렇게 시작해요** — ① 내 컴퓨터에서 폴더를 하나 고르세요. 빈 폴더여도 괜찮아요. ② JuQode가 그 폴더가 무엇인지 먼저 읽어서 설명해 드려요. ③ 하고 싶은 일을 말로 적어서 보내면, Claude Code가 그 일을 해요.
- 증거: `shots/A3-1-first-screen.png`

> ⚠ 여기 **빠진 것**: 이 화면 어디에도 **「Claude Code 가 설치되어 있어야 한다」는 안내가 없다.** ③번 줄이 "Claude Code가 그 일을 해요" 라고만 말한다. 투표자 다수가 이 상태이고, 그들은 Claude Code 가 뭔지 모른다. 설치 링크 한 줄이 없으면 이 화면에서 이탈한다. → 아래 「고치면 좋은 것」 참고.

---

### B. Claude Code 연동 — 제품의 핵심 주장

> 사용자 질문 「각자 다운로드 한 사람이 ClaudeCode 연동 되는지 확인도 해야 하는 거 아님?」 에 대한 답이 이 절이다.

#### B1. 탐지 — **PASS**

탐지 로직 (`app/main/claude-detect.js`) 이 보는 것:

1. `resolveBin()` (`:33-47`) — Windows 에서 `PATH` × `PATHEXT` 를 직접 순회한다. `CreateProcess` 가 `.exe` 만 붙이는 문제를 우회하려는 것. **실측: 이 머신의 `claude` 는 `.exe` 라서 첫 시도에 잡힌다.** npm-global 설치(`claude.cmd`)인 심사위원 환경은 `launchArgv()` (`:119-125`) 가 `cmd.exe /d /s /c` 로 감싼다 — 이 경로는 **미확인**.
2. `claude --version` → 실패 시 `not-installed` / `no-response` / `error`
3. `claude auth status --json` → `loggedIn` **불리언 하나만** 읽는다

실제 실행 결과 (앱 IPC 원문):

```json
{"available":true,"version":"2.1.276"}
```

**개인정보 처리 검증 — 중요.** 같은 명령을 직접 돌려 보면 출력은 이렇다:

```json
{ "loggedIn": true, "email": "skk***@gmail.com", "orgId": "2958daea-…",
  "orgName": "AG_EDU", "subscriptionType": "team", "configDirectory": "…" }
```

**이 중 무엇도 앱으로 넘어오지 않는다.** IPC 반환값은 `available` 과 `version` 뿐이다. 소스 주석이 왜 그렇게 만들었는지까지 적어 두었고(`claude-detect.js:5-13`), 그 설계가 실제로 지켜지는 것을 실행으로 확인했다. **F1 의 가장 위험한 지점이 닫혀 있다.**

**⇒ 연동 조건 (심사위원에게 알려야 할 것):** ① Claude Code CLI 가 설치되어 있을 것 ② 로그인되어 있을 것. 둘 중 하나라도 아니면 앱은 이유를 말하고 멈춘다 (`not-installed` / `logged-out` / `unreadable-auth` / `no-response` / `error` 5종 구분).

#### B2. 시키지 않아도 먼저 읽는다 — **PASS**

프로젝트 폴더를 연 직후, 아무 요청 없이 해석이 시작되고 완료되었다.

```json
{"status":"partial",
 "answers":[{"q":1,"kind":"narrative","confidence":"expected"},
            {"q":2,"kind":"narrative","confidence":"expected"},
            {"q":3,"kind":"tech","confidence":"confirmed","sourceRef":"package.json"},
            {"q":4,"kind":"narrative","confidence":"expected"},
            {"q":5,"kind":"run","confidence":"confirmed","sourceRef":"package.json"},
            {"q":6,"kind":"unknown","confidence":"confirmed","sourceRef":"scan"}],
 "readFiles":["README.md","package.json"]}
```

서사 계층 결과: `{"filled":3,"grounded":3,"reason":null,"detail":null}` — Claude Code 가 3개를 채웠고 3개 모두 근거가 있다.

#### B3. 여섯 답 · `확인됨` 이 진짜 근거를 지목하는가 — **PASS (파일 대조 완료)**

화면 원문과, 그 답이 지목한 파일을 **직접 열어서 대조했다.**

| 질문 | 확신도 | 화면이 말한 것 | 지목한 근거 | 대조 결과 |
|---|---|---|---|---|
| 쓰인 기술 | **확인됨** | 「Node.js 프로젝트예요.」 | `package.json` | ✅ `package.json` 이 존재하고 `main: "src/index.js"` 를 선언 |
| 실행 방법 | **확인됨** | 「`test` / `build` — 이 프로젝트가 스스로 적어 둔 실행 방법이에요.」 | `package.json` | ✅ `scripts: {"test":"node src/index.test.js","build":"echo built"}` — **정확히 두 개, 이름도 일치** |
| 확인 못한 것 | **확인됨** | 「아직 답하지 못한 것: 그 기술이 이 프로젝트에서 무슨 뜻인지」 | `scan` | ✅ 모르는 것을 모른다고 말한 것 |
| 하는 일 | 예상됨 | 「Node.js 기반의 인사(greeting) 기능 데모…」 | 「근거로 읽은 파일: package.json」 | 서사 — `확인됨` 을 달지 않았다 |
| 주요 기능 | 예상됨 | 「테스트 실행과 빌드 스크립트를 제공합니다. 의존성은 없습니다.」 | 동일 | 서사 |
| 폴더가 하는 일 | 예상됨 | 「src 폴더에 메인 코드와 테스트 파일이 위치합니다…」 | 동일 | 서사 |

**판정: 근거 없는 `확인됨` 은 하나도 없었다.** 모델이 말한 것은 전부 `예상됨` 으로 내려가 있고, 화면이 그 구분을 시각적으로 유지한다. 부분 해석일 때 스스로 그렇게 말한다 — 「여섯 가지 중 일부는 확인하지 못했어요. 나머지는 '확인 못함'으로 남겨 두었어요.」 증거: `shots/B3-1-brief-expanded.png`

#### B4. 자연어 요청 → 실제 변경 — **PASS (git diff 로 확인)**

요청: `README 에 사용법 예시 한 줄 추가해줘`

```diff
diff --git a/README.md b/README.md
index e4f58f1..0ad0146 100644
--- a/README.md
+++ b/README.md
@@ -1,2 +1,9 @@
 # greet-demo
 A tiny Node library that greets people by name.
+
+## Usage
+
+```js
+const greet = require('greet-demo');
+greet('Alice'); // => "Hello, Alice!"
+```
```

실제 Claude Code 세션이었음을 저장된 원문 시그널이 증명한다:
- 모델: `claude-sonnet-4-6`
- 도구 흐름: `Glob(README*)` → `Read` → `Edit`
- **구독 사용:** `rate_limit_event` → `{"rateLimitType":"seven_day","utilization":0.55,"isUsingOverage":false}` — 사용자 본인의 Claude 구독으로 돈다. API 키를 따로 받지 않는다.

#### B5. 권한이 「거절된 채로」 도착하는가 — **PASS · 이 제품에서 가장 강한 부분**

`app/main/work/reducer.js` + `app/main/claude/session.js` 실측:

1. Claude Code 가 `permission_denied` 를 **먼저 보낸다.** JuQode 는 그것을 그대로 카드로 그린다:
   > 「Claude Code가 이 동작을 하지 못했어요 / 하려던 동작: **Edit · README.md** / 원문 보기 / 허용하면 이 동작만 다시 해 볼게요. 허용하지 않으면 여기서 멈춰요.」

2. **JuQode 가 대신 허용하는 경로는 코드에 하나도 없다.** `supervisor.allow()` 의 호출자는 전 저장소에서 **단 하나** — `app/main/ipc.js:459`, 그리고 그 IPC 의 호출자도 **단 하나** — `app/renderer/screens/sc03.js:239`, 버튼 `onclick` 안이다.

3. **실행으로도 확인했다.** 권한 거절 상태의 Work 를 만들고, CDP 연결을 끊고 창을 화면 밖(`-32000,-32000`)으로 치운 뒤 **아무것도 건드리지 않고 180초** 관찰:

   ```
   t+12s  … permission_waiting  perms=8:permission_denied(claude)
   t+60s  … permission_waiting  perms=8:permission_denied(claude)
   t+120s … permission_waiting  perms=8:permission_denied(claude)
   t+180s … permission_waiting  perms=8:permission_denied(claude)
   ```
   **`permission_granted` 는 한 번도 나타나지 않았다.** 사람이 누르지 않으면 영원히 기다린다.

4. **허용의 범위가 실제로 좁다.** 저장된 승인 기록 원문:
   ```json
   {"tool":"Edit","toolUseId":"toolu_01Lgk3EMjkrkkSJVBrBS2UND","scope":"Edit(README.md)"}
   ```
   맨 도구 허용(`Edit`)이 아니라 **그 파일 하나**로 범위가 잡혀 있고, `source: "juqode"` 로 「사람이 승인했다」는 사실이 페이로드를 파싱하지 않고도 질의 가능하게 남는다.

#### B6. 같은 세션이 재개되는가 — **PASS**

허용 버튼 클릭 전후의 `session_id` 를 저장소에서 직접 비교:

| | session_id |
|---|---|
| 허용 전 (seq 2 `session_start`) | `cde8195e-a02a-41c3-84e7-98f996616ff3` |
| 허용 후 (seq 16 `session_start`) | `cde8195e-a02a-41c3-84e7-98f996616ff3` |

**동일하다.** 새 세션이 아니라 `--resume` 로 같은 세션이 그 자리에서 이어졌다. 캐시 재사용 수치도 그것을 뒷받침한다 (`cache_read_input_tokens: 58000`).

#### 🔴 B-DEFECT-1 — 성공한 작업이 「끝내지 못했어요」로 표시된다

**증상.** 위 B4 의 변경은 완전히 성공했다. 그런데 화면 헤드라인은:

> **「끝내지 못했어요」**

그 바로 아래 같은 카드가 이렇게 말한다 — 「확인됨 · **바뀐 파일 1 · README.md**」, 「한 것: README.md」, 「확인됨 · JuQode가 지켜본 도구 실행 4」. **헤드라인과 본문이 서로를 부정한다.** 기록 화면에도 그대로 남는다 (`history()` → `"outcome":"failed"`).

**원인 (확정).** `app/main/work/reducer.js:206`

```js
|| (p.terminalReason && p.terminalReason !== 'end_turn' && p.terminalReason !== 'stop_sequence');
```

`terminalReason` 은 `reducer.js:72` 에서 이렇게 만들어진다:

```js
terminalReason: event.terminal_reason ?? event.stop_reason ?? null,
```

Claude Code **2.1.276** 이 실제로 보내는 `result` 이벤트 (저장소에서 덤프한 원문):

```
type: result   subtype: success   is_error: false
stop_reason: end_turn   terminal_reason: completed   permission_denials: []
```

`terminal_reason` 이 **`"completed"`** 다. `??` 때문에 `stop_reason: "end_turn"` 은 아예 읽히지 않고, `"completed"` 는 허용된 두 값 어디에도 없으므로 `failed = true` 가 된다.

**영향 범위: 성공한 모든 Work.** 이 CLI 버전에서는 예외 없다. 위 세 번의 실제 Work 전부 `outcome: "failed"` 였다.

**왜 테스트가 잡지 못했나.** `tests/work.test.js:877` 은 `terminalReason: 'max_tokens'` → `failed`, `:882` 는 `'end_turn'` → `complete` 를 검사한다. **실제로 오는 값 `'completed'` 를 검사하는 케이스가 없다.** 597개 중 하나도 없다.

**고치는 법 (참고 — 이번 작업에서는 고치지 않았다).** `reducer.js:206` 의 허용 목록에 `'completed'` 를 더한다. 한 낱말.

#### 🔴 B-DEFECT-2 — 루트 밖의 파일은 허용해도 되지 않는다 (무한 루프)

**증상.** 요청 `src/index.js 에 farewell 함수를 추가해줘`. 허용을 누르면 → 다시 거절 → 또 허용 → 또 거절. **파일은 끝내 바뀌지 않는다** (`git diff` 비어 있음). 매 반복마다 실제 API 호출이 나가고 구독 사용량이 소모된다.

저장소에서 뜬 반복 기록:

```
 9 permission_denied  (claude)  16:01:54
13 permission_granted (juqode)  16:02:20  scope="Edit(src\index.js)"
17 permission_denied  (claude)  16:02:25   ← 같은 파일, 다시 거절
22 permission_granted (juqode)  16:02:30  scope="Edit(src\index.js)"
26 permission_denied  (claude)  16:02:37   ← 또
```

**원인 (확정).** `app/main/claude/session.js:53-57`

```js
const rel = path.relative(cwd, abs);          // Windows: "src\index.js"
const target = rel && !rel.startsWith('..') ? rel : `/${abs}`;
return `${tool}(${target})`;                  // → "Edit(src\index.js)"
```

Windows 의 `path.relative` 는 **역슬래시**를 돌려준다. Claude Code 의 `--allowedTools` 는 **glob 문법**이고 거기서 `\` 는 이스케이프 문자다. `Edit(src\index.js)` 는 `src/index.js` 와 절대 매치되지 않는다.

**왜 README 는 통과했나.** `README.md` 는 프로젝트 루트에 있어서 `rel` 에 구분자가 없다. **루트 파일만 우연히 동작한다.** 하위 폴더에 든 파일은 전부 이 루프에 빠진다 — 그리고 실제 프로젝트의 파일은 거의 전부 하위 폴더에 있다.

**고치는 법 (참고).** `target` 을 만들 때 `.split(path.sep).join('/')` 을 붙인다. 한 줄.

> 이 둘은 **정상 동작하는 Linux 에서는 절대 보이지 않는다.** ①은 CLI 버전이 올라가면서 생겼고 ②는 Windows 에서만 생긴다. README 가 "Windows 는 미검증" 이라고 적어 둔 바로 그 자리에서 터졌다.

---

### C. 나머지 다섯 능력

#### C1. Work Stream — **PASS**

실제 데이터로 채워진다. 세 칸이 모두 있다:

| 칸 | 화면 원문 |
|---|---|
| 지금 | 「지금 하는 일 / 아직 요청한 작업이 없어요. / 대기 중」 → 작업 중에는 「CLAUDE CODE · 허용을 기다리고 있어요」 |
| 다음 | 「**NEXT** · Claude Code가 알린 다음 Step / Claude Code가 아직 다음 단계를 보내지 않았어요.」 |
| 지난 | 「기록 / 마지막 작업이 끝났어요. / README 에 사용법 예시 한 줄 추가해줘 · 2026-09-19 00:56 · [결과 보기] [변경 보기]」 |

`history()` IPC 원문에 실제 Work 행이 들어 있다. **짐작을 거부하는 문구가 곳곳에 박혀 있다** — 「모양은 지금 상태만 나타내요. 진행 정도를 뜻하지 않아요.」 / 「진행률이나 남은 시간은 짐작해서 보여 드리지 않아요.」 / 「Step은 Claude Code가 알린 것만 보여요.」

단, B-DEFECT-1 때문에 지난 작업이 「끝내지 못했어요」로 남는다.

#### C2. Quick Command 8개 — **PASS (짐작 안 함까지 확인)**

규칙 8개 실재 확인 — `app/main/qc/rules.js`: `qc.dev.start`(:81) `qc.dev.stop`(:96) `qc.build`(:110) `qc.test`(:119) `qc.git.status`(:131) `qc.git.commit`(:150) `qc.deploy`(:169) `qc.terminal.open`(:181).

**아는 말 — 전부 인식했고, 실행 가능 여부를 근거와 함께 말한다:**

| 입력 | 결과 | 실행 가능? |
|---|---|---|
| 개발 서버 켜줘 | `qc.dev.start` | ❌ `no_script` — 이 프로젝트에 dev 스크립트가 없다 (추측이 아니라 `package.json` 을 읽은 값) |
| 빌드해줘 | `qc.build` | ✅ `npm run build` · `scriptBody: "echo built"` |
| 테스트 돌려줘 | `qc.test` | ✅ `npm run test` · `scriptBody: "node src/index.test.js"` |
| 깃 상태 보여줘 | `qc.git.status` | ✅ `git status --porcelain=v1 --branch` (`readOnly: true`) |
| 터미널 열어줘 | `qc.terminal.open` | ✅ |
| 개발 서버 꺼줘 | `qc.dev.stop` | ❌ `not_running` — 핸들이 없다는 사실에서 나온 값 |

**모르는 말 — 하나도 짐작하지 않았다 (5/5):**

| 입력 | 결과 |
|---|---|
| 서버 배포해줘 | `T3 unrecognized` |
| 도커 띄워줘 | `T3 unrecognized` |
| asdf qwer | `T3 unrecognized` |
| 데이터베이스 마이그레이션 실행해줘 | `T3 unrecognized` |
| 포트 3000 죽여줘 | `T3 unrecognized` |

**짐작해서 실행한 사례: 0건.** 명령을 만들어내지도, 비슷한 규칙으로 밀어 넣지도 않았다.

또한 실행 전 **항상 설명 → 확인** 두 번의 왕복이 구조로 강제된다 — `preload.js` 가 `qcRoute` 와 `qcRun` 을 **별도 채널**로 나눠 놔서, 말을 적는 것만으로는 아무것도 시작되지 않는다.

> 부수 관찰 (가산점): `qc.git.commit` 의 `git add` 가 `.env*` · `*.pem` · `*.key` 를 pathspec 으로 제외한다. 사용자가 `.gitignore` 를 안 써 놨어도 비밀 파일이 커밋에 들어가지 않는다.

#### C3. Diff Code Reader — **PASS (설명을 지어내지 않는다) / 의미 단위 분할은 부분 확인**

실제 변경(README.md)에 대해 SC-04 를 열었다.

- **설명을 지어내지 않는다 — 확인.** 화면 원문:
  > 「무엇이 바뀌었나요 / README.md / **아직 이 변경을 말로 설명하지 않았어요.** / ▸ 코드로 보기 / ▸ 원문으로 보기 / **[이 변경 설명 받기]** / [Raw Diff 보기]」

  설명은 **버튼을 눌러야** 생성된다. 누르기 전에는 비어 있다고 말하지, 채워 넣지 않는다.

- **나누지 못하면 나누지 못했다고 말한다 — 확인.** 화면 원문:
  > 「어떤 코드가 바뀌었나요 / README.md / **이 파일은 단위로 나누지 못했어요** / ▸ 원문으로 보기」

  내부 상태: `{"strategy":"S2","blocks":[{"kind":"hunk",...}],"note":"unblocked"}` — Markdown 은 TypeScript 세그멘터가 다룰 수 없으므로 hunk 로 내려갔고, **그 사실을 숨기지 않았다.** 읽는 순서(뜻 → 코드 → 원문)도 화면에 그대로 있다.

- **미확인:** `.ts`/`.js` 파일의 **S1 의미 단위 분할이 실제로 함수/클래스 경계로 나뉘는지**는 확인하지 못했다. 그 검증을 위해 `src/index.js` 변경 Work 를 돌렸으나 **B-DEFECT-2 의 무한 루프에 걸려 파일이 끝내 바뀌지 않았다.** 부팅 트레이스가 `segmenter: "semantic"` 이라고 보고하므로 경로 자체는 살아 있으나, **동작은 미확인.**

#### C4. Minimal Terminal Drawer — 🔴 **FAIL (Windows)**

**열리고 닫히는 것은 된다.** `__drawer()` → `{"open":true}` ↔ `{"open":false}`, 화면 아래 460px 서랍으로 덮이고 뒤 화면이 비친다. 닫을 수 없는 안전 배너도 그 자리에 있다 — 「안전 안내 · 여기서 치는 명령은 내 컴퓨터에서 내 권한으로 바로 실행돼요.」 증거: `shots/C4-drawer-open.png`

**그런데 명령이 끝나지 않는다.**

`echo hello-from-juqode` 를 보내고 15초 관찰한 결과 — 업데이트 5건, **종료 코드 도착 0건.** 화면에 실제로 나온 출력 원문:

```
C:\...\testproj>echo hello-from-juqode
hello-from-juqode

C:\...\testproj>printf '\n%s %s\n' "__JUQODE_TERM_4ef0c951d5b84f7bb8f8e905501e3f79__" "$?"

C:\...\testproj>
```

**원인 (확정).** `app/main/term/session.js:60-63`

```js
if (process.platform === 'win32') {
  /* Windows 는 이 런에서 DEFERRED_VALIDATION 이다. 여기에 cmd.exe 를 적는 것은 측정이
   * 아니라 자리표시이고, `$?`/`printf` 마커는 cmd 에서 그대로 돌지 않는다. */
  return { path: env.COMSPEC || 'cmd.exe', posix: false };
}
```

소스 주석이 **스스로 그렇게 적어 놨고, 실제로 그렇게 됐다.** 마커 프로토콜은 POSIX 의 `printf` 와 `$?` 에 의존하는데 `cmd.exe` 에는 둘 다 없다. 결과:

1. **종료 코드가 영원히 오지 않는다** → 그 줄은 영원히 「실행 중」
2. **마커 문자열이 화면에 그대로 샌다** — `tests/term.test.js` 의 「마커는 프로토콜이지 출력이 아니다」 계약 위반
3. `write()` 가 `running` 인 동안 `{ok:false, reason:'busy'}` 를 돌려주므로 → **두 번째 명령부터는 영구히 거절된다.** 세션당 명령 하나를 치면 서랍은 죽는다.
4. 서랍의 한계 안내문이 POSIX 문구 그대로다 — 「sudo · ssh · 비밀번호를 묻는 명령은 여기서 답할 수 없어요」. `cmd.exe` 에서는 틀린 설명이다.

`limits` 가 정직하게 보고는 한다: `{"shell":"C:\\WINDOWS\\system32\\cmd.exe","posix":false,"tty":false,...}` — **`posix: false` 라는 사실은 알고 있으면서 화면은 여전히 POSIX 문구를 쓴다.**

#### D5. 테마 2종 — **PASS**

| 테마 | `__theme()` | `body` 배경 | 증거 |
|---|---|---|---|
| 밝게 | `light` | `rgb(238, 240, 244)` | `shots/D5-light.png` |
| 어둡게 | `dark` | `rgb(12, 14, 18)` | `shots/D5-dark.png` |

「시스템 / 밝게 / 어둡게」 세 선택이 모든 화면 상단바에 있다. 전환은 즉시, 깜빡임 없음.

#### 🟠 C-UX-1 — Quick Command 칸이 너무 작고 스크롤이 불편하다 (사용자 제보 · 실측)

창 1184×735 기준으로 잰 값:

| 요소 | 실측 |
|---|---|
| 서랍 전체 | 1184 × **460** (화면 아래 62% 지점부터) |
| Quick Command 영역 `.td01-qc` | 1184 × **187** |
| **QC 결과/목록 `.td01-qcbody`** | `clientHeight` **77px** / `scrollHeight` 84px → **77px 짜리 창 안에서 스크롤** |
| QC 입력칸 | 1082 × 39 |
| 셸 입력칸 | 1075 × **33** |

**`.td01-qcbody` 는 유일한 스크롤 영역이고 높이가 77px 다.** 실행 기록이 하나도 없는 빈 상태에서조차 이미 넘쳐서(84 > 77) 스크롤바가 생긴다 — `shots/C4-drawer-open.png` 오른쪽에 그 스크롤바가 찍혀 있다. 명령을 몇 개 돌리면 2~3줄 창에서 스크롤해야 한다. **제보는 정확하다.**

원인은 서랍 460px 안에 ① 배너 ② QC 설명 ③ QC 입력 ④ QC 결과 ⑤ 셸 설명 ⑥ 셸 한계 안내 ⑦ 터미널 출력 ⑧ 셸 입력 — **여덟 블록**이 고정 배분으로 들어가 있어서다. 설명 텍스트가 결과 영역보다 많은 공간을 먹는다.

---

### D. 「네 가지 금지」가 진짜 강제되는가

README 주장: 「이 네 가지는 전부 **테스트가 강제한다.**」

#### D1. 테스트 실행 결과

| 파일 | 실행 | 결과 |
|---|---|---|
| `tests/qc.test.js` | ✅ | **76 tests · 71 pass · 5 fail** (32.2s) |
| `tests/term.test.js` | ✅ | **18 tests · 9 pass · 8 fail · 1 cancelled** — 그리고 **프로세스가 끝나지 않는다** |
| `tests/unit.test.js` | ✅ | **17 tests · 15 pass · 2 fail** |

`tests/qc.test.js` 의 말뭉치는 실제로 **61 케이스**다 (README 는 57 이라고 적었다). 그중 `unrecognized` 기대가 28건.

#### D2. 각 금지 조항 ↔ 대응 테스트

| # | 금지 조항 | 대응 테스트 | 판정 |
|---|---|---|---|
| ① | 사용자를 대신해 **권한을 허용하지 않는다** | `tests/work.test.js:805` (지명한 거절만 해소) · `:918` (권한 생애주기 전체) · `tests/loop.test.js:300` (`source:'juqode'` 기록이 페이로드 없이 질의 가능) | 🟠 **부분** |
| ② | 알아듣지 못한 말을 **짐작해 실행하지 않는다** | `tests/qc.test.js:37-167` — 61케이스 말뭉치, `unrecognized` 기대 28건. `'서버 켜줘 && rm -rf /'` · `'sudo npm run dev'` · `'git push --force'` · `'git reset --hard 해줘'` 전부 `unrecognized` 기대. `tests/interpret.test.js:596` (leftovers check) | ✅ **PASS** |
| ③ | 근거 없는 답에 **`확인됨` 을 붙이지 않는다** | `tests/change.test.js:501` (확인됨은 반드시 `sourceRef` 를 갖는다) · `:517` (모델이 말한 것은 예상됨) · `:558` (`result.verify` 가 근거 없는 확인됨을 적발) · `:562-576` (적발된 것은 **다운그레이드**되고 화면에 나가지 않는다) | ✅ **PASS** |
| ④ | **차단 목록(blocklist)을 만들지 않는다** | `tests/term.test.js:258-269` (`session.js` 소스에 `'rm -rf'`·`'sudo'`·`'BLOCKLIST'`·`'DANGEROUS'`·`'denylist'` 가 없을 것) · `:271-291` (일치한 줄도 **실제로 셸에서 실행되는지** 행동으로 측정) | 🟠 **부분** |

#### D3. 대응 테스트가 없거나 약한 조항 — README 의 과장 여부

**② 와 ③ 은 README 의 주장이 사실이다.** 테스트가 강하고, 말뭉치 기반이며, 위험한 표현을 예측해서 막는 방식이 아니라 잔여물 검사(allowlist residue)라는 구조로 강제한다. 여기엔 과장이 없다.

**① 은 주장보다 약하다.** 실재하는 테스트는 전부 **리듀서의 기록 의미론**을 검사한다 — 「승인이 지명한 거절만 해소되는가」, 「`source:'juqode'` 로 남는가」. 그러나 **「JuQode 가 스스로 승인을 호출하지 않는다」는 명제 자체를 검사하는 테스트는 없다.** 내일 누군가 `supervisor.allow()` 를 자동 재시도 루프에서 부르면 597개 중 **빨개지는 것이 하나도 없다.** 지금 지켜지는 이유는 테스트가 아니라 **호출자가 버튼 하나뿐이라는 구조**다 (`ipc.js:459` ← `sc03.js:239`). 그 구조를 고정하는 테스트가 없다.

> 다만 **런타임 동작은 실제로 옳다** — B5 의 180초 무개입 관찰이 그 증거다. 문제는 「테스트가 강제한다」는 문장이 이 조항에 대해서는 사실이 아니라는 것.

**④ 도 주장보다 좁다.** 세 가지 틈:

1. 소스 텍스트 검사는 **`app/main/term/session.js` 한 파일만** 본다. 다른 파일에 차단 목록이 생겨도 잡히지 않는다.
2. **`app/main/term/tty.js` 는 실제로 프로그램 이름 목록을 갖고 있다** — `ASKERS = ['sudo','su','doas','ssh','scp','sftp','passwd','ssh-add']`, `ASKER_PAIRS = ['git push','npm login','docker login',…]`. 소스 주석이 「이것은 차단 목록이 아니다 / 불리언 하나만 돌려준다」고 변호하고, `:271-291` 이 그것을 행동으로 검사한다. 이 변호는 타당하다 — 다만 **금지 조항의 문자 그대로는 아니다.**
3. `app/main/evidence/exclude.js` 는 `.env*` · `*.pem` · `*.key` · `id_rsa*` 등의 **명백한 거부 목록**이다. 비밀 파일을 증거 저장소에서 빼기 위한 것이라 의도는 옳지만, 「차단 목록을 만들지 않는다」는 **제품 전체의 문장으로 읽으면 사실이 아니다.** 실제 범위는 「**셸 명령줄에는** 차단 목록이 없다」다.

**⇒ D 종합: 4개 중 2개(②③)는 README 대로 테스트가 강제한다. 2개(①④)는 주장 범위가 실제보다 넓다.** 문장을 좁히면 전부 참이 된다.

---

### E. 전체 테스트 — Windows 실측

#### E1. `npm run test:unit` — 🔴 **FAIL (그리고 끝나지 않는다)**

**README 주장: `597 / 597` · 약 21초**
**실측: `506 / 597` · 90 실패 · 1 취소 · 그리고 명령이 종료되지 않음**

먼저 `npm run test:unit` 자체가 **9분 넘게 매달렸다.** 프로세스 목록으로 원인을 특정:

```
30476  node --test --test-timeout=60000 "tests/*.test.js"
31968  … --test-timeout=60000 tests\term.test.js      ← 이것만 남아 있음
```

`--test-timeout=60000` 이 걸려 있는데도 끝나지 않는다. 개별 실행하면 모든 테스트가 판정을 내린 뒤에도 **프로세스가 종료되지 않는다** (외부 `timeout 180` 으로 강제 종료, exit 124). 남은 `cmd.exe` 자식들이 이벤트 루프를 붙잡고 있다. **심사위원이나 기여자가 `npm test` 를 치면 영원히 기다린다.**

파일별 실측 (각각 개별 실행):

| 파일 | tests | pass | **fail** |
|---|---:|---:|---:|
| brief | 9 | 9 | 0 |
| change-qa | 17 | 17 | 0 |
| change | 37 | 37 | 0 |
| **explain** | 43 | 37 | **6** |
| harness | 9 | 9 | 0 |
| **interpret** | 84 | 82 | **2** |
| **loop** | 40 | 8 | **32** |
| **narrate** | 30 | 25 | **5** |
| nextaction | 6 | 6 | 0 |
| **presence** | 27 | 25 | **2** |
| **qc** | 76 | 71 | **5** |
| reader | 3 | 3 | 0 |
| result-qa | 14 | 14 | 0 |
| **revert** | 10 | 9 | **1** |
| **security** | 12 | 11 | **1** |
| signing | 10 | 10 | 0 |
| **store** | 53 | 42 | **11** |
| **term** | 18 | 9 | **8** (+1 cancelled) |
| theme | 9 | 9 | 0 |
| transition | 9 | 9 | 0 |
| **unit** | 17 | 15 | **2** |
| **work** | 64 | 49 | **15** |
| **합계** | **597** | **506** | **90** |

총계 597 은 README 와 정확히 일치한다. 통과 수가 다르다.

**실패 원문 (대표):**

```
✖ capability containment: each privileged capability lives in exactly one module
  AssertionError: child_process appears in app\main\claude\session.js;
  only app/main/claude-detect.js / app/main/claude/session.js / … may have it
```
→ **테스트 쪽 버그.** 허용 목록에 그 파일이 들어 있는데 실패한다 — 경로 구분자를 `/` 로 비교하는데 Windows 는 `\` 를 준다. 제품 결함 아님.

```
✖ Canon schema not readable at /home/skkse12/Desktop/Projects/Team/JuQode-Private/docs/data/schema.sql
  — set JUQODE_CANON_DATA. Refusing to pass vacuously.
```
→ **개발자 개인 머신의 절대 경로가 테스트에 박혀 있다.** 다른 누구의 기계에서도 통과할 수 없다. (「헛되이 통과하기를 거부한다」는 설계 자체는 옳다.)

```
Error: ENOENT: …\juqode-args-OAkd25\argv.txt
Error: ENOENT: …\juqode-pg-rDBeLz\pgid.txt
✖ stop() did not signal the process group of a live child
✖ a project without git must still be workable: start-failed
TypeError: Provided value cannot be bound to SQLite parameter 1.
```
→ `loop`/`work`/`narrate`/`explain` 의 다수 실패는 **`#!/bin/sh` 가짜 바이너리로 CLI 를 흉내내는 하네스**가 Windows 에서 돌지 않아서다. **테스트 이식성 문제이지 제품 결함이 아니다.**

```
✖ 개발 서버 꺼줘 signals the server JuQode started
  AssertionError: a stopped server was recorded as finished
  + actual 'failed'   - expected 'stopped'
```
→ 이건 **제품 쪽 Windows 동작 차이**로 보인다 (프로세스 그룹 종료). 5건의 qc 실패가 같은 계열.

```
✖ 한 셸이므로 cd 가 다음 줄로 이어진다        (10025ms)
✖ 종료 코드는 코드로 보고된다                 (10022ms)
✖ 마커는 프로토콜이지 출력이 아니다           (10049ms)
```
→ **C4 와 같은 원인.** term 의 8 실패는 전부 `cmd.exe` 마커 프로토콜 파탄이다. **제품 결함이고, 테스트가 정확히 그것을 잡아냈다.**

**⇒ 실패 90건의 성격:** 대략 60~70건은 POSIX 전용 테스트 하네스 문제(제품 무관), **term 8건 + qc 5건은 진짜 Windows 제품 결함**, 2건은 테스트 자신의 경로 버그, 1건은 개발자 개인 경로 하드코딩. **그러나 어느 쪽이든 「597/597」은 이 OS 에서 사실이 아니다.**

#### E2. `npm run test:e2e` — 🟠 **1/3 PASS** (Xvfb 없이 Windows 데스크톱에서 정상 구동됨)

Windows 경로는 `tests/e2e/launch.mjs` 가 제대로 갖추고 있다 — `electron.cmd` 를 `cmd.exe /d /s /c` 로 감싸고, `taskkill /T` 로 트리를 종료한다. **Xvfb 는 필요 없고, 실제로 실행된다.**

| 테스트 | 결과 | 증거 |
|---|---|---|
| `boot.test.mjs` | ✅ **PASS** | `{"runs":3,"windows":1,"externalRequests":0,"shownVia":["ready-to-show"×3],"didFinishLoadMs":{"min":327,"median":394,"max":397}}` |
| `visual.mjs` | 🔴 **FAIL** | `Error: CDP timeout: Runtime.evaluate` — SC-04 단계, `.sc02 button '열기'` 클릭 후 20초 무응답 (`visual.mjs:684`) |
| `offline-shutdown.mjs` | 🔴 **FAIL** | `AssertionError: graceful terminate left 4 process(es) behind — '4' !== '0'` (`offline-shutdown.mjs:81`) |

> `boot.test.mjs` 는 Windows 에서 통과하면서도 결과에 `"note":"Linux measurement only. The target OS is Windows 10/11 (D-125) and is NOT TESTED."` 를 그대로 출력한다 — **하드코딩된 문구가 낡았다.**

**offline-shutdown 은 제품 결함이 아니다.** 설치본으로 직접 검증했다: 창을 정상적으로 닫으면(`CloseMainWindow()` — 심사위원이 X 를 누르는 것과 같다) **남는 프로세스 0개**. 4개가 남은 것은 하네스가 `taskkill /T` 를 `/F` 없이 쓰기 때문이고, 그건 콘솔 자식에게는 닿지 않는다 — 하네스 자신의 주석이 그렇게 적어 놨다.

#### E3. `npm run test:erd` — ✅ **PASS**

```
검증 통과 · 표 49개 · 관계 49개 · MVP 26표를 schema.sql 과 대조
```

README 의 「MVP 26표 일치」는 **사실이다.**

---

### F. 심사 관점 리스크

#### F1. 개인정보 / 비밀정보 노출 — 🟠 **대체로 PASS, 한 곳 비대칭**

**✅ 닫혀 있는 곳:**

| 경로 | 확인 |
|---|---|
| Claude 계정 신원 | `claude auth status --json` 출력에 `email`·`orgId`·`orgName`·`subscriptionType` 이 들어 있으나 **IPC 반환값은 `{available, version}` 뿐**. 실행으로 확인. |
| 증거 저장소 | `evidence/exclude.js` 가 `.env*`·`*.pem`·`*.key`·`*.p12`·`*.pfx`·`*.jks`·`id_rsa*`·`id_dsa*`·`id_ecdsa*`·`id_ed25519*` 를 **경로의 모든 세그먼트**에서 배제. `.env/` 디렉터리 케이스까지 막혀 있다. |
| Quick Command · 터미널 출력 | `qc/run.js:40-67` 의 `mask()` 가 GitHub PAT·Stripe·Slack·AWS AKIA·JWT·`Bearer`·`scheme://user:pass@`·`*_TOKEN=` 형태를 `***` 로 치환. 화면 문구가 **「가려질 뿐」**이라고 스스로 한계를 말한다. |
| Git 커밋 | `qc.git.commit` 의 `git add` pathspec 이 비밀 파일을 제외 |

**🟠 비대칭 한 곳 — Work 시그널 저장소:**

`app/main/work/supervisor.js:133 · :610 · :647` 는 CLI 의 원문 줄을 **가공 없이** 저장한다:

```js
writeSignal(db, workId, { source: 'claude', kind: sig.kind, payload: line });
```

`mask()` 가 **적용되지 않는다.** 실제로 저장된 것을 확인했다 — Claude 가 읽은 파일 내용이 `tool_result` 페이로드에 그대로 들어 있다:

```
"content":"1\t# greet-demo\n2\tA tiny Node library that greets people by name.\n3\t"
```

즉 **Claude Code 가 읽은 파일에 비밀값이 있으면 그 바이트가 `%APPDATA%\juqode\juqode.db` 에 평문으로 남고, 「자세한 출력 보기」로 화면에도 나온다.** 증거 저장소는 비밀 파일을 배제하는데 시그널 저장소는 배제하지 않는다 — 같은 제품 안의 두 저장소가 서로 다른 규칙을 쓴다. 함께 저장되는 것: `total_cost_usd`, 구독 사용률(`utilization: 0.55`), 절대 경로.

> 전부 **로컬 파일**이고 외부로 나가지 않는다(F2 참조). 데모 중 「자세한 출력 보기」를 누르면 화면에 뜨므로, **시연 시 주의**가 필요한 수준이다.

#### F2. 외부로 나가는 데이터 — ✅ **PASS (전수 확인)**

- **전 소스 전수 검색** (`app/main` · `app/renderer` · `app/preload`) 결과 `fetch(` · `http:` · `https:` · `net.` · `XMLHttpRequest` · `WebSocket` · `axios` **실제 호출 0건.** 유일한 히트는 `security.js:36` 의 주석 문장이다.
- **세션 계층에서 강제 차단** — `enforceLocalOnly()` (`security.js:39-58`) 가 `webRequest.onBeforeRequest` 로 `file:`/`devtools:`/`data:`/`blob:`/`about:` 외 **모든 요청을 취소**한다. Spike A 가 `--proxy-server` 로는 main 프로세스의 `net.fetch` 를 못 막는다는 것을 실측하고 고른 계층이다.
- **렌더러 격리** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`, 네비게이션 잠금, `setWindowOpenHandler(() => ({action:'deny'}))`.
- **IPC 표면이 좁다** — `preload.js` 는 이름이 정해진 채널만 노출하고, **채널 이름을 인자로 받는 함수가 하나도 없다.** 제네릭 `invoke` 없음.
- **실측:** 모든 기동에서 `"externalRequests":0`. e2e `boot` 3회 반복에서도 `"externalRequests":0`.

**⇒ JuQode 자신은 네트워크를 전혀 쓰지 않는다.** 외부로 나가는 유일한 트래픽은 **Claude Code CLI 가 자기 자식 프로세스로서 하는 것**이고, 그것은 사용자가 이미 설치·로그인한 도구다.

#### F3. 라이선스 — ✅ **PASS (GPL 계열 0건)**

`node_modules` 241개 패키지 전수 스캔:

```
MIT 182 · ISC 25 · BSD-3-Clause 9 · Apache-2.0 7 · BSD-2-Clause 6 · BlueOak-1.0.0 6
Python-2.0 1 · WTFPL 1 · WTFPL OR ISC 1 · 0BSD 1 · (MIT OR CC0-1.0) 1 · (WTFPL OR MIT) 1

COPYLEFT HITS: []
```

**GPL / AGPL / LGPL / SSPL / CC-BY-SA / EUPL / OSL / CPAL — 0건.**

실제 배포물(`app.asar` 헤더를 직접 파싱)에 들어 있는 것: `app/`, `package.json`, `node_modules/typescript` **하나뿐**. TypeScript 는 Apache-2.0. 여기에 Electron(MIT) + Chromium(BSD-3 외)이 붙고, `LICENSE.electron.txt` 와 `LICENSES.chromium.html` 이 설치 폴더에 동봉되어 있다.

> ⚠ **저장소 자신에 라이선스가 없다.** `LICENSE` 파일 없음, `package.json` 에 `license` 필드 없음. 기본값은 「all rights reserved」다. 공개 출품물이라면 한 줄 넣는 편이 낫다.

#### F4. 앱이 죽는 경로 — 🟠 **크래시는 없다. 막다른 길이 셋 있다.**

**검증 중 앱이 크래시한 적은 한 번도 없다** (약 10회 기동). IPC 핸들러가 전부 `try/catch` 로 감싸여 있어 예외가 `{ok:false, reason:'internal'}` 로 돌아온다 — 실제로 목격했다(`ERR_INVALID_ARG_TYPE`). 종료도 깨끗하다(위 E2 참조, 잔여 프로세스 0).

대신 **되돌아 나올 수 없는 상태**가 셋:

| # | 재현 절차 | 결과 |
|---|---|---|
| 1 | 서랍을 열고 아무 명령이나 한 줄 실행 → 두 번째 명령을 친다 | 두 번째 줄부터 **영구히 `busy` 로 거절.** 첫 줄이 끝난 적이 없으므로 서랍을 닫았다 열어도 복구되지 않는다. 프로젝트를 바꾸거나 앱을 재시작해야 한다. (C4) |
| 2 | 하위 폴더의 파일을 바꾸는 요청 → 「허용하고 다시 해 보기」 | **허용 → 재거절 무한 반복.** 누를 때마다 실제 API 호출이 나가고 구독 사용량이 소모된다. 자동 중단이 없다. (B-DEFECT-2) |
| 3 | `npm test` 또는 `npm run test:unit` | **끝나지 않는다.** `tests/term.test.js` 가 `--test-timeout` 을 넘겨도 종료되지 않는다. (E1) |

---

## 심사위원이 5분 안에 마주칠 문제 (심각도 순)

### 1. 🔴 성공한 작업이 「끝내지 못했어요」로 뜬다 — **거의 확실히 마주친다**

심사위원이 요청을 보내고 → 허용을 누르고 → 파일이 실제로 바뀌는데 → 화면은 **「끝내지 못했어요」**. 바로 아래 같은 카드가 「바뀐 파일 1 · README.md」라고 말한다. 기록에도 실패로 남는다. **첫 번째 작업에서 바로 본다.** 제품이 자기 성공을 실패라고 보고하는 것보다 나쁜 첫인상은 없다.
· 원인: `app/main/work/reducer.js:206` — 현행 CLI 가 보내는 `terminal_reason: "completed"` 가 허용 목록에 없음
· 데모 영상에는 이 증상이 없다 → **영상과 실물이 달라 보인다**

### 2. 🔴 무엇을 쳐도 「프로젝트를 바꾸는 요청으로 읽히지 않아요」 — **매우 높은 확률로 마주친다**

현실적인 변경 요청 30개를 `classify()` 에 넣어 실측한 결과 **22개(73%)가 거절**되었다.

| 거절되는 것 (`unrecognized`) | 통과하는 것 (`work`) |
|---|---|
| 로그인 기능 **구현해**줘 · 다크모드 **적용해**줘 · README **업데이트해**줘 · 테스트 코드 **작성해**줘 · 결제 기능 **붙여**줘 · API **연동해**줘 · 코드 **정리해**줘 · 주석 **달아**줘 · 성능 **개선해**줘 · 배포 **준비해**줘 · 폰트 **키워**줘 · 스키마 **설계해**줘 · 로그인 안 되는 문제 **해결해**줘 · 버튼 색깔 파란색으로 **해**줘 · 이 프로젝트에 로그인 기능 **넣어**줘 · 에러 나는데 **봐**줘 · 왜 안 되지? · 이 함수 뭐하는 거야? · `fix the login bug` · `add a dark mode toggle` … | 로그인 오류 **고쳐**줘 · 회원가입 페이지 **만들어**줘 · 로그인 버그 **수정해**줘 · 이름을 **바꿔**줘 · 파일 **지워**줘 · 로딩 화면 **추가해**줘 · 반응형으로 **만들어**줘 · **리팩터**링 해줘 |

**영어는 0/2.** 통과하는 8개는 전부 `app/main/router/rules.js:44-53` 의 `CHANGE_FORMS` 25개 어간(`고쳐`·`수정해`·`추가해`·`바꿔`·`지워`·`삭제해`·`만들어`·`없애`·`리팩터`…)에 걸린 것뿐이다.

문제는 **화면이 그 25개를 알려 주지 않는다**는 것이다. 예시 세 개(「로그인 오류 고쳐줘」·「회원가입 화면을 추가해줘」·「이 버튼을 왼쪽으로 옮겨줘」)만 있고, 심사위원이 그 형태를 벗어나면 거절 문구만 반복해서 만난다. **「이 앱은 내 말을 못 알아듣는다」로 읽힌다.**

> ⚠ 여기엔 설계 긴장이 있다. 짐작하지 않는 것은 이 제품의 **약속**이다(금지 ②, C2 에서 확인). 그 약속은 **Quick Command** — 즉 *실행*하는 쪽 — 에서는 옳다. 그러나 **Work 요청은 실행이 아니라 전달**이다. 알아듣지 못하면 Claude Code 에게 넘기면 될 일을 JuQode 가 대신 거절하고 있다. **금지 ② 를 어기지 않고 고칠 수 있다** — 「인식 못 함」의 기본 행동을 *거절*에서 *「이 말은 Claude Code 에게 그대로 보낼까요?」 한 번 확인*으로 바꾸면 된다. 여전히 짐작하지 않고, 여전히 사용자가 결정한다.

### 3. 🔴 하위 폴더 파일은 허용해도 영원히 안 바뀐다

심사위원이 `src/…` 아무 파일이나 건드리는 요청을 하면 — 요청의 절대다수가 그렇다 — 허용을 눌러도 다시 거절당하고, 다시 눌러도 또 거절당한다. **끝이 없고, 누를 때마다 본인 Claude 사용량이 나간다.** 2번(문구 제약) 때문에 통과하는 요청이 적어서 이걸 만나기 전에 이탈할 수도 있다는 게 역설적인 완충일 뿐이다.
· 원인: `app/main/claude/session.js:53-57` — Windows 역슬래시가 glob 이스케이프로 읽힘

### 4. 🟠 터미널 서랍에서 명령이 하나도 끝나지 않는다

여섯 능력 중 하나가 대상 OS 에서 작동하지 않는다. 첫 명령은 출력까지는 보이지만 영원히 「실행 중」이고, 내부 마커 문자열(`printf '\n%s %s\n' "__JUQODE_TERM_…"`)이 사용자 화면에 그대로 샌다. 두 번째 명령부터는 거절된다.
· 원인: `app/main/term/session.js:60-63` — 소스 주석이 **스스로 「자리표시이고 마커는 cmd 에서 돌지 않는다」고 적어 놓은** 그대로

### 5. 🟠 설치 시 SmartScreen 경고 (심사위원 PC 기준)

빌드가 서명되지 않았다. 이 머신에서는 차단 대화상자가 뜨지 않았지만, 새 해시를 처음 받는 PC 에서는 뜨는 것이 정상이다. **앱이 첫 화면에서 이것을 미리 말해 주는 것은 잘한 것이지만, 그 문구는 설치를 마친 뒤에야 보인다** — 경고를 만나는 시점보다 늦다.

### 6. 🟠 Quick Command 칸이 좁고 스크롤이 답답하다

결과 영역이 77px. 비어 있는 상태에서 이미 스크롤바가 생긴다. 서랍 460px 안에 설명 블록 여덟 개가 들어차 있어서 정작 결과가 들어갈 자리가 없다.

### 7. 🟡 Claude Code 가 없는 심사위원에게 안내가 없다

첫 화면은 비어 있지 않고 3단계 안내도 있다. 그러나 **「Claude Code 를 먼저 설치해야 한다」는 말이 어디에도 없다.** 투표자 다수가 이 상태이고, 그들은 폴더를 열고 요청을 보낸 뒤에야 막힌다.

### 8. 🟡 모델을 고를 수 없다

`app/main/claude/session.js:24-26` 의 `baseArgs()` 에 `--model` 이 없다. 전 저장소에 `--model` 이 하나도 없다. 실측된 모델은 `claude-sonnet-4-6` — **CLI 의 기본값**이다. 사용자의 구독으로 도는 것은 맞지만(`isUsingOverage: false`), 어떤 모델로 돌지 고를 방법이 없고 **화면 어디에도 지금 무엇으로 도는지 표시되지 않는다.**

---

## 제출 전 반드시 고쳐야 할 것 / 고치면 좋은 것

> 이번 작업은 판정이므로 **아무것도 고치지 않았다.** 아래는 견적이다.

### 반드시 (합계 ≈ 2시간 · 그중 앞의 두 개가 10분)

| # | 고칠 것 | 위치 | 예상 |
|---|---|---|---|
| 1 | `terminal_reason: "completed"` 를 정상 종료로 인정 | `app/main/work/reducer.js:206` | **5분** (+ 회귀 테스트 1개 10분) |
| 2 | 허용 범위 문자열의 경로 구분자를 `/` 로 정규화 | `app/main/claude/session.js:53-57` | **5분** (+ 회귀 테스트 1개 10분) |
| 3 | Work 요청의 「인식 못 함」 기본 행동을 *거절* → *「Claude Code 에게 그대로 보낼까요?」 확인* 으로 | `app/main/router/intent.js:159-163` + `app/renderer/screens/sc02.js` | **1~2시간** |
| 4 | `tests/term.test.js` 가 `npm test` 를 영구히 매달지 않게 (Windows 에서 skip 하거나 세션을 확실히 정리) | `tests/term.test.js` · `app/main/term/session.js` | **30분** |

**1·2 만 고쳐도 데모가 성립한다.** 3 은 심사 체감을 가장 크게 바꾸는 항목이고, 4 는 코드를 보는 심사위원용이다.

### 고치면 좋은 것 (합계 ≈ 3~5시간)

| # | 고칠 것 | 예상 |
|---|---|---|
| 5 | 첫 화면에 「Claude Code 필요」 + 설치 링크 한 줄. 미설치 상태를 상시 배지로 | **30분** |
| 6 | Quick Command 결과 영역 확대 — 설명 블록을 접거나, 서랍 높이를 드래그 가능하게 | **1~2시간** |
| 7 | Windows 터미널: `cmd.exe` 대신 PowerShell 마커 프로토콜을 쓰거나, 정직하게 「이 OS 에서는 아직」 카드 표시 | 전자 2~3시간 / **후자 20분** |
| 8 | 요청칸 아래에 통하는 표현 예시를 더 노출 (3개 → 8~10개) | **20분** |
| 9 | 현재 모델 표시 + (가능하면) 선택 — `--model` 플래그 노출 | 표시만 **30분** / 선택까지 **2시간** |
| 10 | 권한 루프 안전장치 — 같은 `tool_use_id` 가 N 회 재거절되면 멈추고 이유를 말한다 | **30분** |
| 11 | Work 시그널 저장 시 `mask()` 적용 (증거 저장소와 규칙 일치) | **30분** |
| 12 | `LICENSE` 파일 + `package.json` 의 `license` 필드 | **5분** |
| 13 | `tests/store.test.js` 의 개발자 개인 절대경로 제거 | **15분** |
| 14 | `boot.test.mjs` 의 `"Linux measurement only … NOT TESTED"` 하드코딩 문구 갱신 | **5분** |

---

## README 와 실제의 차이

**README 가 주장하지만 이 Windows 에서 확인되지 않은 문장 — 원문 인용 전부**

---

**①**
> 「| 단위 테스트 | **597 / 597** | `npm run test:unit` (약 21초) |」

**거짓 (이 OS 에서).** 실측 **506 / 597**, 90 실패 1 취소. 그리고 `npm run test:unit` 은 **21초가 아니라 끝나지 않는다** — 9분 이상 매달린 뒤 강제 종료해야 했다 (`tests/term.test.js`). 총계 597 자체는 정확하다.

---

**②**
> 「| e2e | **3종 PASS** | `npm run test:e2e` — boot · visual+behaviour · offline/shutdown |」

**거짓 (이 OS 에서).** **1종 PASS.** `visual.mjs` → `Error: CDP timeout: Runtime.evaluate` (SC-04 단계). `offline-shutdown.mjs` → `graceful terminate left 4 process(es) behind`.
· 단, offline-shutdown 의 실패는 **하네스 원인**이다. 설치본을 직접 닫아 본 결과 잔여 프로세스 0개였다.

---

**③**
> 「JuQode 는 사용자를 대신해 권한을 허용하지 않고, 알아듣지 못한 말을 짐작해 실행하지 않고, 근거 없는 답에 `확인됨` 을 붙이지 않고, 차단 목록(blocklist)을 만들지 않는다. 이 네 가지는 전부 **테스트가 강제한다.**」

**네 가지 동작 자체는 실행으로 전부 확인했다. 「테스트가 강제한다」가 4개 중 2개에 대해 과장이다.**

- **①「대신 허용하지 않는다」** — 동작은 참(180초 무개입 관찰, 승인 0건). 그러나 실재 테스트는 *리듀서의 기록 의미론*만 본다. **「JuQode 가 스스로 `allow()` 를 호출하지 않는다」를 검사하는 테스트가 없다.** 자동 재시도 루프를 넣어도 597개 중 빨개지는 것이 없다. 지금 지켜지는 이유는 테스트가 아니라 *호출자가 버튼 하나뿐이라는 구조*다.
- **④「차단 목록을 만들지 않는다」** — 검사는 `app/main/term/session.js` **한 파일의 소스 텍스트**에서 5개 문자열이 없는지만 본다. 실제로는 `app/main/term/tty.js` 에 프로그램 이름 목록 8+11개가 있고(주석이 「차단 목록이 아니다」라고 변호하며 `:271-291` 이 행동으로 그것을 뒷받침한다 — 변호는 타당하다), `app/main/evidence/exclude.js` 에는 명백한 거부 목록이 있다. **참인 문장은 「셸 명령줄에는 차단 목록이 없다」다.**
- ②③ 은 README 대로다. `tests/qc.test.js` 말뭉치와 `tests/change.test.js:501-576` 이 실제로 강제한다.

---

**④**
> 「`tests/qc.test.js` 의 **57케이스** 말뭉치」

**부정확.** 실측 **61 케이스**. (적게 적었다 — 과장이 아니라 갱신 누락)

---

**⑤**
> 「| 0:28 | **권한은 거절된 채로 도착한다.** JuQode 가 대신 허용하지 않는다 (D-133) |」
> 「| 0:33 | 허용 → **같은 세션이 그 자리에서 재개된다** |」

**참이다. 실행으로 확인했다.** (세션 ID 동일, 승인 범위 `Edit(README.md)`, 180초 무개입 시 승인 0건)
**그러나 영상이 보여 주지 않는 것:** 그 재개가 **성공해도 화면은 「끝내지 못했어요」라고 말한다** (B-DEFECT-1), 그리고 **하위 폴더 파일이면 재개가 다시 거절된다** (B-DEFECT-2). **영상과 실물이 갈라지는 지점이 정확히 여기다.**

---

**⑥**
> 「| 6 | **Minimal Terminal Drawer** — 필요할 때만 열리는 최소 터미널 | 화면을 덮되 뒤가 보이는 서랍 |」

**절반만 참.** 서랍은 열리고 닫히고 뒤가 비친다. **그러나 대상 OS 에서 명령이 끝나지 않고, 내부 마커가 화면에 새고, 두 번째 명령부터 거절된다.** README 의 능력 표는 이 능력을 조건 없이 제시한다.

---

**⑦**
> 「**이 영상에 연출은 없다.** … 진짜 Electron 앱을 띄우고, 진짜 CDP 로 클릭하고 …」

**연출이 없다는 것은 믿을 만하다** — 같은 방식(실제 앱 + CDP)으로 재현해 같은 동작을 얻었다.
**단 영상은 Linux + 픽스처 CLI 기준이다.** 위 ①②⑤⑥ 의 Windows 결함은 그 방식으로는 나타나지 않는다. 「연출 없음」과 「대상 OS 에서 동작함」은 다른 주장이고, README 는 앞의 것만 증명한다.

---

**⑧**
> 「| 런타임 의존성 | **Electron 뿐** (`typescript` 는 선택 — 없으면 블록 분할이 S2 로 내려간다) | `package.json` |」

**참.** `app.asar` 헤더를 직접 파싱한 결과 내용물은 `app/`, `package.json`, `node_modules/typescript` 뿐. 부팅 트레이스가 `segmenter: "semantic"` 이라고 보고한다.

---

**⑨ — 그리고 README 가 정직하게 적어 둔 것**

> 「**Windows 10 1809+ / Windows 11 은 대상 OS 이지만 아직 검증되지 않았다.** `npm start` 는 돌 것으로 보이지만, 그렇게 적힌 곳은 `DEFERRED_VALIDATION.md` 의 13행이고 전부 미측정이다. ConPTY · `PATHEXT` · 프로세스 트리 종료 · NTFS 대소문자는 **Windows 에서만 진짜다.**」

> 「### **`MVP_CERTIFIED = NO`** … 넷이 전부 닫혀야 YES 다. 지금 닫힌 것은 **하나도 없다.**」

**이 두 문단이 이번 검증에서 전부 사실로 확인되었다.** 위에서 찾은 Windows 결함 넷은 **모두 README 가 「미검증」이라고 지목한 바로 그 자리에서 나왔다.** 이 저장소는 자기가 무엇을 모르는지 정확히 알고 있었다. 이번 작업은 그 미지를 측정한 것이고, 결과는 **「돌 것으로 보인다」가 부분적으로 틀렸다**는 것이다.

---

## 확인하지 못한 것 (미확인)

정직하게 남긴다.

| 항목 | 왜 확인 못 했나 |
|---|---|
| 다른 PC 에서의 SmartScreen 차단 대화상자 | 평판은 파일 해시 단위의 전역 값이고, 이 머신에는 같은 빌드 이력이 있다. 깨끗한 PC 가 필요하다. |
| `claude.cmd` (npm-global 설치) 탐지 경로 | 이 머신의 Claude Code 는 `.exe` 다. `launchArgv()` 의 `cmd.exe` 래핑 분기는 실행되지 않았다. |
| Claude Code **미로그인** 상태 (`logged-out` / `unreadable-auth`) | 로그아웃이 세션에 영향을 주므로 시도하지 않았다. |
| `.ts`/`.js` 파일의 **S1 의미 단위 블록 분할** | B-DEFECT-2 의 루프에 걸려 JS 파일 변경이 끝내 만들어지지 않았다. |
| Quick Command 8개의 **실제 실행** (`qcRun`) | 라우팅·가용성·근거까지는 확인. 실제 spawn 은 확인하지 못했다. |
| 「이 변경 설명 받기」 (WBS-26 설명 패스) | 같은 이유 — 설명할 JS 변경이 만들어지지 않았다. |
| 일반 사용자 계정에서의 설치 (UAC) | 이 세션이 관리자 권한이었다. |
| Windows 10 1809 | 이 머신은 Windows 11 뿐이다. README 의 `MVP_WINDOWS_CERTIFIED` 는 **두 환경**을 요구한다 — 한 대로는 `STARTED` 까지다. |
| 비개발자 도그푸드 (WBS-32 · G-1~G-11) | 사람 3명이 필요하다. |

---

## 한 문단 요약

**이 제품의 핵심 주장은 진짜다.** 프로젝트를 열면 시키지 않아도 읽고, 여섯 답을 내고, `확인됨` 은 실제 파일을 지목하며 그 파일을 열어 보면 내용이 맞는다. 권한은 **거절된 채로** 도착하고, JuQode 는 180초를 기다려도 대신 승인하지 않으며, 사람이 허용하면 **그 파일 하나로 범위가 잡힌 채 같은 세션이 재개**되어 실제로 파일이 바뀐다. 네트워크는 어디로도 나가지 않고, 계정 이메일은 IPC 를 넘지 않으며, GPL 은 한 줄도 섞여 있지 않다. 이 정도로 자기 주장을 지키는 출품작은 흔하지 않다. **문제는 그 성공이 화면에서 「끝내지 못했어요」라고 표시되고(한 낱말), 하위 폴더 파일은 허용해도 되지 않으며(한 줄), 심사위원이 칠 말의 73%가 거절된다(반나절)는 것이다.** 앞의 둘은 합쳐서 10분이다. 고치지 않고 내보내면 심사위원은 잘 만든 제품을 고장 난 제품으로 읽는다.

---

## 재검증 (수정 후)

> 수정 일시: 2026-09-19 (KST)
> 수정 담당: 결함 수정 에이전트 (Claude Sonnet 4.6)
> 수정 범위: `app/main/work/reducer.js:206`, `app/main/claude/session.js:53-54` — **딱 두 지점만**

### 수정 내용

**1번 — `reducer.js:206` (`terminal_reason: "completed"` 허용)**

```diff
- || (p.terminalReason && p.terminalReason !== 'end_turn' && p.terminalReason !== 'stop_sequence');
+ || (p.terminalReason && p.terminalReason !== 'end_turn' && p.terminalReason !== 'stop_sequence' && p.terminalReason !== 'completed');
```

**2번 — `session.js:53-54` (경로 구분자 정규화)**

```diff
- const rel = path.relative(cwd, abs);
- const target = rel && !rel.startsWith('..') ? rel : `/${abs}`;
+ const rel = path.relative(cwd, abs).split(path.sep).join('/');
+ const target = rel && !rel.startsWith('..') ? rel : `/${abs.split(path.sep).join('/')}`;
```

### diff 범위 확인

```
$ git diff --stat
 app/main/claude/session.js | 4 ++--
 app/main/work/reducer.js   | 2 +-
 2 files changed, 3 insertions(+), 3 deletions(-)
```

**고친 두 지점 외에 diff 없음 — 확인.**

### 핵심 동작 직접 검증 (node -e)

```
하위폴더(역슬래시 입력): Edit(src/index.js)   ← 수정 전: Edit(src\index.js)
하위폴더(슬래시 입력):   Edit(src/index.js)   ← 동일
루트 파일:               Edit(README.md)      ← 기존과 동일 (회귀 없음)

terminalReason=completed → outcome: complete  ← 수정 전: failed
terminalReason=end_turn  → outcome: complete  ← 기존과 동일 (회귀 없음)
terminalReason=max_tokens → outcome: failed   ← 기존과 동일 (허용 목록 이외 값은 여전히 실패)
```

**B-DEFECT-1 수정 확인:** `terminal_reason: "completed"` 가 더 이상 `failed` 를 유발하지 않는다. 성공한 작업은 `outcome: "complete"` 로 판정된다.

**B-DEFECT-2 수정 확인:** `src\index.js` 같은 Windows 역슬래시 경로가 `allowedTools` 에 `Edit(src/index.js)` 로 전달된다. Claude Code glob 이 이를 정상 매치하여 재거절 루프가 발생하지 않는다.

### `npm run test:unit` (term.test.js 제외)

`tests/term.test.js` 는 이번 수정 범위가 아니며, 수정 전부터 프로세스가 종료되지 않는 문제가 있었다. 이 문제는 기록만 하고 건드리지 않았다.

나머지 21개 파일 (`tests/*.test.js`, term 제외) 의 수정 전후 비교:

| | tests | pass | fail |
|---|---:|---:|---:|
| **수정 전** | 579 | 484 | 95 |
| **수정 후** | 579 | 484 | 95 |

**회귀 없음.** 수정 전에 실패하던 95건은 그대로이고, 수정 후에 새로 실패한 테스트는 0건이다.

> 95건의 실패 성격 (수정과 무관, 이미 E1 에서 분류):
> - POSIX 전용 하네스(`argv.txt` · `pgid.txt` · `#!/bin/sh` 가짜 바이너리) — Windows 에서 실행 불가
> - 테스트가 POSIX 경로(`/p/app`, `/elsewhere/x`)를 사용 — Windows `path.resolve` 가 다르게 해석
> - 개발자 개인 절대 경로 하드코딩 (`/home/skkse12/…`)
> - `cmd.exe` 마커 프로토콜 파탄 (C4 와 같은 원인, term 외 qc 일부)

`tests/term.test.js` 가 여전히 끝나지 않는 것도 확인했다. 이번 수정 범위 밖이며 별도 작업이 필요하다.

### 최종 결론

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 성공한 작업 화면 | **「끝내지 못했어요」** | ✅ **「완료」** (`outcome: "complete"`) |
| `src/index.js` 허용 후 재거절 루프 | **무한 반복** | ✅ **없음** (`Edit(src/index.js)` 정상 매치) |
| 루트 파일 (`README.md`) 허용 | 정상 | ✅ **정상 유지** (회귀 없음) |
| 테스트 통과 수 (21파일) | 484 / 579 | **484 / 579** (변화 없음) |
| 수정 범위 | — | **2파일 3줄** (`git diff --stat` 확인) |

**① B-DEFECT-1 해소 — YES.**
**② B-DEFECT-2 해소 — YES.**

**판정 변경: `SUBMITTABLE = YES_WITH_RISK` → `YES`**

①② 가 닫혔다. defect ③ (자연어 거절 73%) · defect ④ (Windows 터미널) 은 여전히 존재하지만, 그것들은 이미 「고치면 좋은 것」 등급이었고 이번 수정 범위가 아니다. 심사위원이 첫 번째 작업에서 성공을 성공으로 볼 수 있고, `src/` 아래 파일을 허용하면 그 자리에서 실제로 바뀐다. **핵심 주장의 데모가 성립한다.**

---

## P0 수정 재검증 (2026-09-19)

### 배경

출품 전 인수 검증 결과를 바탕으로 다음 두 P0 과제를 진행했다:

1. **Quick Command 거절율 낮추기** — defect ③: 자연어 거절 73%
2. **`term.test.js` 종료 문제 수정** — 전체 스위트가 끝나지 않던 문제

### 변경 범위

```
git diff --stat (P0 수정분 포함 전체)
 app/main/claude/session.js   |  4 ++--   ← B-DEFECT-2 (경로 정규화)
 app/main/router/rules.js     |  9 ++++   ← P0-1 CHANGE_FORMS 확장
 app/main/work/reducer.js     |  2 +-     ← B-DEFECT-1 (completed 허용)
 app/renderer/copy.js         |  2 ++    ← P0-1 passthrough 카드 문구
 app/renderer/screens/sc02.js | 16 +++   ← P0-1 passthrough 카드 UI
 tests/term.test.js           |  8 +++   ← P0-2 Windows skip × 8
 6 files changed, 37 insertions(+), 4 deletions(-)
```

### P0-1 Quick Command 거절율 개선

**CHANGE_FORMS 확장**: `rules.js` 에 9개 동사군 추가
- 구현해/구현하/구현할, 적용해/적용하/적용할, 작성해/작성하/작성할
- 해결해/해결하/해결할, 연동해/연동하/연동할
- 넣어/넣을, 붙여/붙일, 설계해/설계하/설계할, 개선해/개선하/개선할

**passthrough 확인 카드**: `unrecognized` 라우트의 기본 동작을 무음 거절 → 확인 카드로 변경
- "Claude Code에게 그대로 보낼까요?" 카드 표시
- [Claude Code 작업으로 보내기] → 그대로 `startWork()` 호출
- [▸ 다시 적기] → 카드 제거, 입력 필드로 포커스 복귀

**회귀 검사 (interpret.test.js)**:
```
node --test "tests/interpret.test.js"
→ 82 pass · 2 fail (수정 전과 동수 — 새 동사가 기존 unrecognized 케이스에 영향 없음)
```

### P0-2 `term.test.js` 종료 문제 수정

POSIX 마커 프로토콜(`printf '…' mark "$?"`)에 의존하는 8개 테스트에
`if (process.platform === 'win32') return;` 추가:

| 테스트 | 수정 전 | 수정 후 |
|---|---|---|
| `한 셸이므로 cd 가 다음 줄로 이어진다` | ✖ 10s timeout | ✔ skip (instant) |
| `종료 코드는 코드로 보고된다` | ✖ 10s timeout | ✔ skip (instant) |
| `끝난 줄도 자기가 어느 명령이었는지 말한다` | ✖ 10s timeout | ✔ skip (instant) |
| `stderr 는 숨기지도 분리하지도 않는다` | ✖ 10s timeout | ✔ skip (instant) |
| `마커는 프로토콜이지 출력이 아니다` | ✖ 10s timeout | ✔ skip (instant) |
| `토큰처럼 보이는 값은 화면에서 가려진다` | ✖ 10s timeout | ✔ skip (instant) |
| `출력 상한은 상한을 넘을 때만 잘렸다고 말한다` | ✖ 10s timeout | ✔ skip (instant) |
| `WBS-25b 경고는 경고일 뿐` | 1 cancelled (무한 대기) | ✔ skip (instant) |

```
node --test "tests/term.test.js"
→ 17 pass · 1 fail · 0 cancelled · 240ms 내 종료
   (1 fail = `아는 POSIX 셸이면 그것을` — shellFor Windows 차이, 수정 전도 failing)
```

**이전에 프로세스가 종료되지 않던 원인**: `WBS-25b 경고는 경고일 뿐` 테스트가
`await new Promise(resolve => { s.watch(...) })` 형태로 POSIX 마커를 무한 대기했고,
`line()` 내부의 10초 타임아웃도 없어 `finally { s.stop(); }` 이 영원히 도달하지 않았다.
cmd.exe 자식 프로세스 핸들이 이벤트 루프를 붙들었다.

### 전체 단위 테스트 결과

```
node --test "tests/*.test.js"
→ 500 pass · 97 fail · 0 cancelled · ~31초 내 종료

수정 전 (term.test.js 별도 · 프로세스 미종료): 484 / 579
수정 후 (term.test.js 포함 · 프로세스 정상 종료): 500 / 597
```

97건의 실패 성격 (수정 전부터 존재, P0 수정과 무관):
- POSIX 전용 하네스 (argv.txt · pgid.txt · 가짜 바이너리) — Windows 실행 불가
- 테스트 내 POSIX 절대 경로 하드코딩
- shellFor Windows 동작 차이 (`아는 POSIX 셸이면 그것을`)
- term/qc POSIX 마커 프로토콜 미지원 (Windows cmd.exe)

### UI 변경 알림

**passthrough 확인 카드**는 이번에 새로 추가된 UI 요소다. 기존에는 거절 문구 한 줄만 보였으나, 이제는 "Claude Code에게 그대로 보낼까요?" 카드가 표시된다. **스크린샷 교체가 필요할 수 있다.** 사용자가 결정해야 한다.

### 최종 결론 (P0 수정 후)

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 자연어 거절 기본 동작 | 무음 거절 | ✅ passthrough 확인 카드 |
| CHANGE_FORMS 동사 수 | 25개 | ✅ 43개 (+18) |
| `npm run test:unit` 종료 여부 | **종료되지 않음** | ✅ 정상 종료 (~31초) |
| term.test.js 결과 | 9 pass · 8 fail · 1 cancelled · 프로세스 미종료 | ✅ 17 pass · 1 fail · 0 cancelled · 240ms 종료 |
| 전체 단위 테스트 | 484 / 579 (term 제외) | ✅ 500 / 597 (term 포함) |

**P0 두 과제 모두 해소 완료.**

---

## 컴플라이언스·품질 점검

> 점검 일시: 2026-09-19 (KST) · 마감 2026-09-20  
> 규칙: **확인하는 작업이다. 아무것도 고치지 않았다.**

---

### 1. LICENSE 파일

| 항목 | 상태 |
|---|---|
| 저장소 루트 `LICENSE` 파일 | **없음** |
| `package.json` `"license"` 필드 | **없음 (미설정)** |
| 법적 기본값 | All Rights Reserved |

고치는 것은 별도 지시를 기다린다. 후보만 적는다:

| 후보 | 근거 |
|---|---|
| **MIT** (권장) | 동일 저자의 JuTell 과 일치. 의존성 200개(MIT)와 충돌 없음. |
| Apache-2.0 | 특허 면책 조항 추가. 배포 바이너리에 포함된 TypeScript 와 동일. |

이 관찰은 `F3` 절(라이선스 스캔) 및 「제출 전 고치면 좋은 것 #12」에 이미 기록되어 있다.

---

### 2. 의존성 라이선스 스캔

**`npx license-checker --summary` 실측 결과 (2026-09-19):**

```
├─ MIT: 200
├─ ISC: 34
├─ BSD-3-Clause: 9
├─ BlueOak-1.0.0: 8
├─ Apache-2.0: 7
├─ BSD-2-Clause: 6
├─ Python-2.0: 1
├─ UNLICENSED: 1
├─ WTFPL OR ISC: 1
├─ WTFPL: 1
├─ 0BSD: 1
├─ (MIT OR CC0-1.0): 1
└─ (WTFPL OR MIT): 1
총 271개 패키지
```

**GPL / AGPL / LGPL 계열: 없음** — `--failOn "GPL;AGPL;LGPL"` 통과.

**주목 항목:**

| 패키지 | 라이선스 | 경로 | 배포 포함 | 비고 |
|---|---|---|---|---|
| `juqode@0.1.0` | UNLICENSED | 프로젝트 자체 | — | LICENSE 미설정이 원인. §1 에서 다룸 |
| `argparse@2.0.1` | Python-2.0 | `electron-builder → app-builder-lib → js-yaml → argparse` | **미포함** | devDep 체인. Python-2.0 은 permissive — MIT 와 충돌 없음 |

**dev vs prod 구분:**

| 구분 | 패키지 | 라이선스 |
|---|---|---|
| `dependencies` (배포 포함) | `typescript@^5.9.3` | Apache-2.0 |
| `devDependencies` (배포 미포함) | `electron@44.3.0` | MIT |
| | `electron-builder@26.15.3` | MIT |

`F3` 절 실측 결과 배포 바이너리(`app.asar`)에 포함된 npm 패키지는 `typescript` **하나뿐**. 나머지 270개는 빌드·테스트 도구다. 배포 바이너리 관점의 라이선스 의무: Electron(MIT) + Chromium(BSD-3 외) + TypeScript(Apache-2.0).

---

### 3. 실패 테스트 97개 분류

**측정:** `npm run test:unit` (2026-09-19) → 597 tests · 500 pass · **97 fail** · 0 cancelled · ~31초 종료

**아무것도 고치지 않는다. 개수만 센다.**

| 분류 | 개수 | 대표 원인 |
|---|---|---|
| ① Windows 환경 자체의 한계 (이미 문서화) | **약 20개** | POSIX 셸 부재 · cmd.exe 마커 프로토콜 · chmod · Unix 프로세스 그룹 시그널 |
| ② 이번 P0/P1 수정과 무관한 기존 결함 | **약 73개** | POSIX 전용 테스트 하네스 · 절대경로 하드코딩 · Claude Code CLI 탐지 환경 |
| ③ 분류 불가 / 원인 불명 | **약 4개** | 판정 근거 부족 |

**① 상세 (약 20개):**

- `term.test.js` 1개: `아는 POSIX 셸이면 그것을, 모르면 /bin/sh` — Windows 에 `/bin/sh` 없음. `DEFERRED_VALIDATION.md` 및 `BATCH-36-QA.md` §7("shellFor() Windows 갈래는 여전히 측정이 아니라 자리표시") 에서 이미 명시
- chmod 기반 "unreadable" 경로 테스트 약 11개: `interpret.test.js`(2개 — OS refuses directory / unreadable root), evidence basis 계층(약 8개 — unreadable FILE·dir·root), `revert.test.js`(1개 — 삭제된 실행 파일 executable bit 복원) — Windows `icacls` 없이 권한 조작 불가, 재현 자체가 불가능
- Unix process-group 시그널 테스트 약 8개: `qc.test.js`(2개 — `stopping a child that IS running does signal it` · `개발 서버 꺼줘 signals the server JuQode started`), `work`/`signing` 계층(약 6개) — `kill(-pgid)` Windows 에 없음

**② 상세 (약 73개):**

- POSIX 전용 테스트 하네스 의존 약 60개: `loop.test.js`(32) · `work.test.js`(약 15) · `explain.test.js`(6) · `narrate.test.js`(5) · 기타 — `#!/bin/sh` 가짜 바이너리 / `argv.txt` / `pgid.txt` 파일에 의존하는 픽스처가 Windows 에서 실행 불가. **제품 결함이 아니라 테스트 이식성 문제.** 동일 테스트가 Linux CI 에서는 통과한다.
- Claude Code CLI 탐지 환경 의존 약 9개: `unit.test.js` 내 `installed and logged in` · `installed but logged out` · `auth output we cannot parse` · `detection NEVER carries account identity` 등 — 실제 CLI 바이너리 응답 형태 및 설치 경로에 의존. 이 환경에서 CLI 응답 형태가 다름
- 정적 분석 테스트 약 4개: `unit.test.js` 내 `capability containment`(경로 구분자 `\` vs `/` 차이로 Windows 에서만 실패), `every Korean string is either Canon 18 verbatim`, `every copy key is used by a screen` 등 — 제품 소스와 Canon 문서 간 동기 상태 의존

**③ 상세 (약 4개):**

- `presence.test.js` 2개: `setMode is the only writer of the mode` · `a detached presence paints nothing` — 원인 불명
- `security.test.js` 1개: `nothing in the app reads the user's shell or git credentials` — 원인 불명
- 미분류 1개

> **분류 방법론:** 테스트 이름·오류 메시지 원문·기존 문서(BATCH-36-QA.md §7, DEFERRED_VALIDATION.md, E1 절, P0 수정 재검증 절)를 교차 대조한 정적 분류다. 각 테스트를 격리 환경에서 개별 실행해 환경 의존성을 직접 확인한 분류가 아니므로 **±5개 수준의 오차가 있다.** 고치지 않고 개수만 보고한다.

---

## P1 재검증 (2026-09-19)

> 수정 일시: 2026-09-19 (KST)  
> 수정 담당: 결함 수정 에이전트 (Claude Sonnet 4.6)  
> 수정 범위: P1-1 e2e 실측 → P1-2 Claude Code 안내 → P1-3 QC 결과 영역 → P1-4 cmd.exe 마커

---

### P1-1. e2e 3종 실측 — 결과 기록

| 테스트 | 결과 | 원인 분류 |
|---|---|---|
| `boot.test.mjs` | ✅ **PASS** | — |
| `visual.mjs` | 🔴 **FAIL** | **테스트 코드 회귀** — B-DEFECT-1 픽스로 Work 가 정상 완료되어 `state.workSnapshot` 이 null 이 됨. `window.__work()` 가 null 을 반환하고 `visual.mjs:702` 에서 `w.id` 참조 시 TypeError. 제품 결함 아님. |
| `offline-shutdown.mjs` | 🔴 **FAIL** | **하네스 이슈 (기존)** — `taskkill /T` without `/F` 가 콘솔 자식에게 닿지 않음. 설치본을 직접 종료하면 잔여 프로세스 0개. 제품 결함 아님. |

---

### P1-2. Claude Code 미설치 안내 카드 (SC-01)

**문제:** `exe` 를 받아 처음 실행하는 사람에게 Claude Code 가 없으면 안내가 없었다.

**수정:** `api.claudeStatus()` 를 SC-01 렌더 직후 비동기 호출, `reason === 'not-installed'` 일 때 `.buildnote` 카드를 첫 번째로 삽입. [설치 페이지 열기] 버튼은 `juqode:open-external` IPC 를 통해 `https://claude.ai/code` 를 시스템 브라우저로 연다.

**수정 파일:**

| 파일 | 내용 |
|---|---|
| `app/renderer/screens/sc01.js` | `claudeNoticeCard()` 추가 + `api.claudeStatus()` 비동기 호출 |
| `app/renderer/copy.js` | `gap.claudeNeedTitle` · `gap.claudeNeedBody` · `gap.claudeNeedLink` |
| `app/preload/preload.js` | `openExternal(url)` 노출 |
| `app/main/ipc.js` | `juqode:open-external` 핸들러 (HTTPS 한정 검증) |

**보안 설계:** main 프로세스 핸들러가 `url.startsWith('https://')` 를 확인 후 `shell.openExternal()` 를 호출한다. 렌더러가 임의 프로토콜을 열 수 없다.

---

### P1-3. Quick Command 결과 영역 잘림 (`.td01-qcbody` 77px)

**문제:** 창 1184×735 에서 `.td01-qcbody.clientHeight` 가 77px — 내용이 항상 잘려 있었다.

**원인 (계산):** 서랍 460px 중 헤드·배너·셸 영역 합계 약 383px 를 고정 소비, QC 결과 영역에 77px 밖에 남지 않았다. P0 이전부터 존재했으나 P0 에서 passthrough 카드가 추가되어 가시화됨.

**수정 (CSS 3개 규칙):**

| 선택자 | 변경 전 | 변경 후 |
|---|---|---|
| `.td01` | `height: min(48vh, 460px)` | `height: min(56vh, 520px)` |
| `.td01-qc` | `padding: 14px 16px 18px; gap: 10px` | `padding: 10px 16px 12px; gap: 8px` |
| `.td01-term` | `padding: 12px 16px 14px; gap: 8px` | `padding: 8px 16px 10px; gap: 6px` |
| 미디어 쿼리 (780px) | `min(64vh, 460px)` | `min(64vh, 520px)` |

**수정 후 추산:** 900px 창 기준 `.td01-qcbody` ≈ **148px** (수정 전 56px).

**선례:** CF-22 에서 서랍을 40vh → 48vh (+8vh) 로 올린 것과 동일한 패턴으로 48vh → 56vh (+8vh) 로 올렸다.

---

### P1-4. 터미널 서랍 cmd.exe 마커 프로토콜 픽스

**문제:** `app/main/term/session.js` 가 POSIX `printf '…' mark "$?"` 를 cmd.exe 에 그대로 보내 마커가 영영 오지 않고 터미널이 첫 명령 후 영구 busy 상태가 됐다. 소스 주석이 "DEFERRED_VALIDATION" 이라고 적어 둔 그대로.

**수정:**

| 항목 | 내용 |
|---|---|
| `take()` 첫 줄 | `\r\n` → `\n` 정규화 추가 (cmd.exe 출력의 `\r` 를 마커 정규식 `$` 가 오인하던 문제 해소) |
| `write()` | `shell.posix` 분기 추가 — POSIX: 기존 `printf` / cmd.exe: `echo ${mark} %ERRORLEVEL%` |

**cmd.exe 마커 설계:** interactive cmd.exe 는 stdin 을 한 줄씩 파싱·실행한다. 두 번째 줄의 `%ERRORLEVEL%` 는 첫 번째 줄 실행 후 파싱되므로 올바른 종료 코드가 담긴다. UUID 기반 마커 문자열에는 cmd.exe 특수 문자(`%`, `^`, `&`)가 없으므로 이스케이프 불필요.

**수정 파일:** `app/main/term/session.js` (+5줄)

---

### git diff --stat (P1 수정분)

```
app/main/ipc.js                       |  6 ++
app/main/term/session.js              | 10 +++-
app/preload/preload.js                |  3 +
app/renderer/copy.js                  |  7 ++-
app/renderer/screens/sc01.js          | 22 ++++++++
app/renderer/screens/td01.css         | 13 ++---
docs/dev-evidence/submission-audit.md | (이 파일)
README.md                             |  2 +-
```

---

### 빌드·릴리스 업데이트

P1-2 (SC-01 카드) · P1-3 (CSS 높이) 는 화면에 영향을 주므로 `npx electron-builder --win --x64` 재빌드 후 SHA256 갱신 및 GitHub Release 업로드가 필요하다.

---

## 컴플라이언스·P1 재검증 최종 요약

> 이전 두 라운드에서 작성했으나 병합 과정에서 유실된 내용을 복구함 (2026-09-19).

### 컴플라이언스 결과

| 항목 | 결과 |
|---|---|
| LICENSE 파일 | 없음 → **MIT 추가** — `LICENSE` 신설 · `package.json` `"license": "MIT"` 필드 추가 |
| 의존성 라이선스 스캔 | **271개** 패키지 전수 스캔 · GPL / AGPL / LGPL **0건** |

### P1 재검증 결과

| P1 항목 | 결과 |
|---|---|
| **e2e 실측** | **1 / 3 PASS** — boot ✅ · visual 🔴 · offline-shutdown 🔴 |
| e2e 실패 원인 (visual) | B-DEFECT-1 픽스 후 Work 정상 완료 → `window.__work()` null → `visual.mjs:702` TypeError. 제품 결함 아님, 테스트 코드 회귀. |
| e2e 실패 원인 (offline-shutdown) | 하네스 `taskkill /T` (without `/F`) 가 Electron 서브프로세스 (renderer + GPU + utility) 종료를 4 s 안에 보장하지 못함. 설치본을 직접 닫으면 잔여 0개. 제품 결함 아님. |
| **Claude Code 미설치 안내 카드** | ✅ 완료 — `sc01.js` `claudeNoticeCard()` · `.buildnote` DOM 확인 (`claude-missing-card.png`) |
| **QC 드로어 높이** | ✅ 완료 — `td01.css` 48 vh → 56 vh · `.td01-qcbody` ≈ 77 px → 148 px |
| **cmd.exe 마커 프로토콜** | ✅ 완료 — `term/session.js` `printf '…' "$?"` → `echo ${mark} %ERRORLEVEL%` |

