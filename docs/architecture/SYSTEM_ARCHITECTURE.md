# System Architecture — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_SYSTEM_ARCHITECTURE_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. 이 아키텍처가 섬기는 것

**다음으로 되돌아가게 만드는 구조는 그 자체로 오답이다.**

```
파일 트리 + 채팅 + Diff + 터미널
```

Software 가 주 인터페이스 · `SEE → POINT → SAY` · POINT 는 선택 · Context 자동 준비 ·
Semantic Place · Field/Grain Realm 하나 · Problem Module · Outcome-first Result ·
`PASS / FAIL / UNKNOWN` · Evidence over Agent Claims · Software Time · Rollback Safety ·
Raw 기술 사실 도달 가능 · No Fake Motion · Local Project · **Coding Agent Provider 하나** · Offline-first.

---

## 2. Runtime

| | |
|---|---|
| **데스크톱 런타임** | **Electron 44.x** |
| **측정 기준선** | Electron 44.2.0 · Chromium 152.0.7977.76 · Node 24.20.0 · SQLite 3.53.4 |

| OS | v0.1 지위 |
|---|---|
| **Linux x86_64** | **기준 플랫폼 · Founder Dogfood** |
| **Windows x64** | QA 이후 릴리스 후보. **지금 지원을 주장하지 않는다** |
| **macOS** | **v0.1 출시 약속이 아니다** |

---

## 3. 프로세스 경계

```
┌─ Renderer / Software World ────────────────────────────────┐
│  Canvas 2D 물리 엔진 + 얇은 DOM 껍데기                       │
│  파일시스템 없음 · 프로세스 실행 없음 · 자격증명 없음          │
│  상태를 소유하지 않는다. 아래에서 온 모델을 그린다             │
└───────────────────────────┬────────────────────────────────┘
                            │ 타입된 IPC — 동사 목록이 고정된다
┌───────────────────────────▼────────────────────────────────┐
│  Trusted Local Runtime                                      │
│  ├─ Project Understanding                                   │
│  ├─ Semantic Model                                          │
│  ├─ Persistence                                             │
│  ├─ Evidence                                                │
│  ├─ Git Safety                                              │
│  └─ Agent Lifecycle                                         │
└───────────────────────────┬────────────────────────────────┘
                            │
                   ClaudeCodeAdapter
                            │
                            ▼
                      Claude Code
                      ├─ Permission Enforcement
                      └─ Built-in OS Sandbox
```

**바깥의 진실**

```
Repository / Files   ·   Git   ·   Artifacts   ·   OS Credential Store
```

> ## **Renderer 는 파일시스템 · 프로세스 · 자격증명에 직접 닿지 않는다.**
>
> 렌더러 메인 월드에서 `process` · `require` · `module` · `Buffer` 가
> 전부 `undefined` 임을 실측으로 확인했다.

---

## 4. 무엇이 어디의 진실인가

| 층 | 진실 |
|---|---|
| **Repository** | 사용자 코드 (Machine Truth) |
| **Git** | 변경과 안전 — 이전 평형 · 버려진 상태 · 시간축의 점 |
| **SQLite** | JuQode 의 이해 — 자리 · 문제 · 증거 메타 · Context |
| **파일시스템** | Raw 원본 — Agent Log · Diff · 스크린샷 (삭제하지 않는다) |
| **OS 자격증명 저장소** | 비밀 |
| **Renderer** | **아무것도 아니다.** 위의 함수일 뿐이다 |

> **손상 복구:** JuQode 저장소가 깨져도 **사용자 코드는 하나도 잃지 않는다.**
> 잃는 것은 JuQode 의 이해이고 **다시 만들 수 있다.**
> 예외는 **Context** — 사용자 자산이므로 사람이 읽는 형식으로 별도 Export 를 유지한다.

---

## 5. UI 는 상태를 갖지 않는다

**No Fake Motion 을 구조로 강제한다** — UI 는 Event 스트림 없이 몸을 움직일 방법이 **없어야** 한다.

동결 렌더러가 이 계약을 지킴을 실측으로 확인했다 —
실제 정지 이후 **TRUE IDLE 에서 앱이 요청한 프레임은 0** 이었다.

---

## 6. 측정 기준선 — **Canon 이 아니다**

Linux x86_64 · World 캔버스 1,728×940 (1,624,320 px) · Electron 44.2.0

| 상태 | fps | draw p50 | late% |
|---|---|---|---|
| focus transition | 47.0 | 2.6 ms | 2.1% |
| working / disturbed | 60.0 | 2.5 ms | 0% |
| settling | 60.3 | 2.2 ms | 0% |
| deep view | 59.0 | 2.6 ms | 1.7% |
| running (관측) | 60.0 | 2.5 ms | 0% |
| **TRUE IDLE** | **0 프레임** | — | — |

페이지 로드 526 ms · RSS 약 476.7 MB · IPC 0.21 ms · 파일 읽기 약 0.09 ms · spawn 약 156.24 ms

> **이 수치를 영원히 보증되는 Product Canon 으로 동결하지 않는다.** 회귀를 알아보기 위한 기준선이다.
> **Windows · macOS 는 측정하지 않았다. 지원을 주장하지 않는다.**
