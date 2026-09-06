# `experiments/a1b/` — 버리는 코드

> ## ⚠️ DISPOSABLE. 제품 코드가 아니다.
>
> | | |
> |---|---|
> | **Status** | **DISPOSABLE** — A1b / A1b.1 표적 검증용 일회용 실험 |
> | **Architecture Frozen** | **NO** |
> | **Implementation Authorized** | **NO** |
> | **수명** | A1 Architecture Freeze 가 끝나면 **삭제한다** |
>
> **두 데스크톱 셸은 벤치마크 실험일 뿐 제품이 아니다.**
> **`prototype/` 을 한 글자도 건드리지 않았다** — 동결본(sha256 `c535bd10…`)을 **읽기만** 했다.
> **실제 유료 코딩 에이전트를 호출하지 않았다.**

| 경로 | 무엇을 물었는가 | 어느 A1 질문 |
|---|---|---|
| `bench/harness.js` | 공통 계측기. 동결본이 노출하는 `window.JQ_DEV` 를 구동한다 | A1-14 |
| `electron/` | **Electron 44.2.0** 셸 — 실제 GUI 프레임 · TRUE IDLE · IPC · 파일 · spawn · **번들 Node 의 `node:sqlite`** | **A1-14 · A1-8** |
| `tauri/` | Tauri v2 셸 + `webkit_host.py` (WebKitGTK 직접 호스트) | **A1-14** |
| `exp7-agent-containment.sh` | 부모 프로세스가 자식을 실제로 가두는가 | **A1-7** |
| `exp8-git-exact-restore.sh` | 되돌리기가 사용자의 스테이징을 보존하는가 | **A1-15** |

## 무엇이 뒤집혔는가

| 주장 | 실측 |
|---|---|
| **A1b: "유휴 0 프레임이 실증됐다"** | **거짓.** 커밋된 원본은 96 프레임 · ⚠ 였다. TRUE IDLE 재정의 후 **0 확인**, A1b 방법은 **90 으로 재현** |
| **A1b: "Electron 엔 node:sqlite 가 없다"** | **Node 20 탓이었다.** Electron 44(Node 24)엔 **있고 experimental 경고도 없다** |
| *"cwd 고정 + env 제거 → 루트 밖 쓰기를 막는다"* | **거짓.** `../` · 심링크 · `.env` 수정 · git ref 조작이 전부 성공 |
| *"되돌리기가 사용자 상태를 보존한다"* | **거짓.** `read-tree HEAD` 가 부분 스테이징을 파괴 |
| *"`node:sqlite` 로 네이티브 모듈 0건"* | **Electron 33 엔 없다** (Node 20.18.3) |
| *"엔진 성능은 측정 불가"* | **측정했다.** Electron 44/Chromium 152 = 60fps · draw 2.2~2.6ms / WebKitGTK 6.7~28fps (Linux) |

## 계측 방법론 — 세 번 고쳤다

1. **하니스가 스스로 rAF 루프를 돌리면** 앱이 고요한지 알 수 없고 항상 60fps 로 보인다
   → `requestAnimationFrame` 을 감싸 **앱이 요청한 프레임만** 센다
2. **rAF 간격은 vsync 에 물려 항상 16.7ms** 다 → 여유를 못 본다
   → **콜백 안에서 실제로 쓴 시간(draw cost)** 을 잰다. 이것이 엔진 비교값이다
3. **고정 시간을 기다리고 "유휴"라고 부르면** 가라앉음의 꼬리가 유휴로 집계된다
   → **정지를 기다린다**(`waitQuiet`). TRUE IDLE = 연속 1,000ms 무프레임 확인 후의 창

> **반대 방향의 함정도 찾았다.** 창이 가려지면 Chromium 이 rAF 를 통째로 억제해 **모든 값이 0** 이 된다.
> 그것을 "고요함"으로 읽으면 같은 거짓말을 반대로 하는 것이다.
> **활성 상태가 실제로 40fps 를 넘는 런만 채택한다.**

## 실행

```bash
cd experiments/a1b/electron && npm install && BENCH_DPR=2 ./node_modules/.bin/electron --no-sandbox .
python3 experiments/a1b/tauri/webkit_host.py
bash experiments/a1b/exp7-agent-containment.sh
bash experiments/a1b/exp8-git-exact-restore.sh
```

결과 원본은 `results/` 에, 해석은
`JuQode-Private/docs/current/14_A1_ARCHITECTURE_DECISION_PACKET.md` 에 있다.

## 정직하게 남기는 한계

- **macOS(WKWebView) · Windows(WebView2) 는 재지 않았다. 추정하지 않는다**
- **Windows 의 Tauri 는 WebView2(Chromium 계열)** — 이 Linux 결과를 옮기면 틀린다
- **Tauri 셸은 빌드·실행되지만 내부 계측이 결과를 돌려주지 못했다.**
  WebKitGTK 값은 **Tauri 가 Linux 에서 쓰는 그 엔진(webkit2gtk-4.1 2.52.6)을 직접 띄워** 잰 것이다.
  **A1b.1 에서 Tauri 재탐색은 하지 않았다** — PM 지시대로 기존 WebKitGTK 근거를 그대로 쓴다
- Electron 벤치는 이 머신에 `chrome-sandbox` SUID 설정이 없어 `--no-sandbox` 로 돌렸다 — **배포 시엔 정상 설정이 필요하다**

**여기 있는 숫자를 결정으로 읽지 마라.** 결정은 PM 과 Founder 가 한다.
