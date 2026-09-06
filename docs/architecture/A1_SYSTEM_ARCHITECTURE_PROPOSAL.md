# A1 · System Architecture — PROPOSED

> ## ⚠️ PROPOSED — 결정이 아니다
>
> | | |
> |---|---|
> | **Status** | **PROPOSED** |
> | **Architecture Frozen** | **NO** |
> | **Implementation Authorized** | **NO** |
> | **Phase** | A1a — Architecture Decision Packet |
> | **Product Version** | v0.1 MVP |
> | **Product SSOT** | `JuQode-Private/docs/current/00_MASTER_INDEX.md` |
> | **판정 대장** | `JuQode-Private/docs/current/14_A1_ARCHITECTURE_DECISION_PACKET.md` |
> | **확인일** | 2026-09-06 (A1a) |
>
> **이 문서는 초안이다.** 여기 있는 어떤 문장도 Canon 이 아니고, 구현 지시가 아니다.
> 선택지 · 비용 · 반대 근거는 위의 판정 대장에 있다. **결정은 PM 과 Founder 가 한다.**


> ## 🔄 A1b 개정 — PM 판정 반영
>
> A1a 는 **PASS** 했다. 이 문서는 그 뒤 PM 이 지시한 정정을 반영한 판이다.
> **여전히 `PROPOSED` 이며 아무것도 동결되지 않았다.**

---

## 1. 이 제안이 섬겨야 하는 것

아키텍처는 동결된 제품을 섬긴다. **다음으로 되돌아가게 만드는 구조는 그 자체로 오답이다.**

```
파일 트리 + 채팅 + Diff + 터미널
```

Software 가 주 인터페이스 · `SEE → POINT → SAY` · POINT 는 선택 · Context 자동 준비 ·
Semantic Place · Field/Grain Realm 하나 · Problem Module · Outcome-first Result ·
`PASS / FAIL / UNKNOWN` · Evidence over Agent Claims · Software Time · Rollback Safety ·
Raw 기술 사실 도달 가능 · No Fake Motion · Local Project · **Coding Agent Provider 하나** · Offline-first.

---

## 2. 네 개의 층 (PROPOSED)

```
┌─ UI 프로세스 ─────────────────────────────────────────────┐
│  Canvas 2D 물리 엔진 + 얇은 DOM 껍데기                      │
│  Node 없음 · 파일시스템 없음 · 프로세스 실행 없음            │
│  상태를 만들지 않는다. 아래에서 온 모델을 그린다             │
└──────────────────────────┬────────────────────────────────┘
                           │  타입된 IPC — 동사 목록이 고정된다
┌──────────────────────────▼────────────────────────────────┐
│  신뢰 로컬 런타임                                           │
│  Semantic Model · Qode/Execution 수명주기 · Evidence 판정   │
│  프로젝트 루트를 정규화해 잠근다 (심링크 · .. 탈출 차단)      │
└───┬───────────┬───────────┬───────────┬───────────────────┘
    │           │           │           │
    ▼           ▼           ▼           ▼
 저장 계층    Git 안전     에이전트     자격증명
 (관계+원본)  (스냅샷)    (자식 프로세스) (OS 저장소)
```

| 층 | 무엇이 진실인가 |
|---|---|
| **Repository** | **사용자 코드의 진실** (Machine Truth) |
| **Git** | **변경과 안전의 진실** — 이전 평형 · 버려진 상태 |
| **저장 계층** | **JuQode 의 이해** — 자리 · 문제 · 증거 메타 · Context |
| **파일시스템 아티팩트** | **Raw 원본** — Agent Log · Diff · 스크린샷 (D-010: 삭제하지 않는다) |
| **UI** | **아무것도 아니다.** 위의 함수일 뿐이다 |

> **손상 복구의 기본 전략:** JuQode 저장소가 깨져도 **사용자의 코드는 하나도 잃지 않는다.**
> 잃는 것은 JuQode 의 이해이고 그것은 **다시 만들 수 있다.** → 백업하지 않고 재구성한다.

---

## 3. UI 가 상태를 갖지 않는다는 규칙

Phase 4A 프로토타입은 `S` 객체 하나가 전부인 상태 기계다. **그 형태를 유지하되 소유자를 옮긴다.**

| | 4A (현재) | 제안 |
|---|---|---|
| 상태의 주인 | 브라우저 메모리 | **신뢰 런타임 + 저장 계층** |
| 새로 고침 | **상태가 사라진다** (4A 한계 8) | 살아남는다 (MUST #25) |
| 몸의 움직임 | 목(mock) 타이머 | **실제 Agent Event** (D-014) |

> **No Fake Motion 을 구조로 강제한다** — UI 는 Event 스트림 없이 몸을 움직일 방법이 **없어야** 한다.

---

## 4. 데스크톱 런타임 — 미결

**Electron 과 Tauri 가 서로 다른 축에서 이긴다.** 이 문서는 어느 쪽도 선택하지 않는다.

| | Electron | Tauri v2 |
|---|---|---|
| 렌더링 일관성 | **모든 OS 에서 같은 Chromium** | OS 마다 다른 웹뷰 (Linux = WebKitGTK) |
| 권한 경계 | 규율로 지켜야 한다 | **기본값이 안전하다** |
| 번들 | 큼 | 작음 |
| 저장 계층 | **`node:sqlite` 없음(실측)** → 네이티브 바인딩 + 리빌드 | `rusqlite` 성숙 · 리빌드 없음 |
| 권한 경계 실측 | 부모 프로세스는 **경계가 아니다** — 강제는 Provider 권한 계층 | 동일 |

### A1b — 측정했다 (Linux 한정)

동결 렌더러를 그대로 두 엔진에 올려 실제 GUI 에서 쟀다. 같은 뷰포트 · DPR 2 · 1.62 Mpx 캔버스.

| 상태 | Chromium 130 fps / draw p50 | WebKitGTK 2.52.6 fps / draw p50 |
|---|---|---|
| focus transition | **59.3 / 3.1 ms** | **6.7 / 55 ms** |
| working · disturbed | **59.3 / 2.8 ms** | **13.3 / 37 ms** |
| settling | **59.7 / 4.4 ms** | **28.3 / 22 ms** |
| running (관측) | **60.0 / 4.4 ms** | **17.0 / 35 ms** |
| 지연 프레임 | 0 ~ 1.1% | **83 ~ 100%** |
| 페이지 로드 | **396 ms** | **7,889 ms** |

**그리고 동결 렌더러는 Canon 을 지킨다** — `idle` 에서 앱이 요청한 프레임은 **0** 이었다.
*"실제 사건이 없으면 화면은 완전히 고요하다"* 가 구현으로 실증되었다.

> **이 측정이 런타임을 결정하지 않는다.**
> macOS(WKWebView) · Windows(WebView2) 는 **재지 않았고 추정하지 않는다.**
> **Windows 의 Tauri 는 WebView2(Chromium 계열)** 이므로 이 Linux 결과를 옮기면 틀린다.
> → 판정 대장 A1-14 는 **STILL OPEN** 이다.

---

## 5. 이 제안이 하지 않는 것

- 아키텍처를 동결하지 않는다
- 구현을 시작하지 않는다
- 새 UI · 새 Realm · 새 제품 기능을 만들지 않는다
- `prototype/` 을 건드리지 않는다
