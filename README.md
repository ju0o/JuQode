# JuQode

> ## Developers Code. Vibe Coders Qode.

**JuQode는 IDE가 아니다. AI Software Creation Interface다.**

전통적인 개발자는 Code를 읽고, 이해하고, 직접 수정한다.
바이브 코더는 Code를 읽기보다 AI에게 반복적으로 묻는다.

> "이게 뭐야?" · "왜 안 돼?" · "이거 해줘." · "어디가 바뀌었어?" · "문제 없어?" · "다 됐어?"

그 행위는 Code가 아니다. 그것을 **Qode**라고 부른다.

---

## 사용자는 무엇을 하는가

사용자는 Code나 File을 조작하지 않는다.
**자기 Software를 보고, 중요한 곳을 가리키고, 원하는 것을 말한다.**

```
SEE  →  POINT  →  SAY
```

```
OPEN → WORLD → OBSERVE → POINT(선택) → SAY → QODE → PREPARE → AGENT
     → ACTUAL CHANGE → EVIDENCE → SETTLE → UNDERSTAND
```

**Qode란** — 사용자가 원하는 Software 변화를 말하면, JuQode가 필요한 Context / Skill / 대상을 준비하고,
Coding Agent가 **실제 변경**을 수행하고, JuQode가 그것을 **검증**해서
**사람이 이해할 수 있는 Software 상태**로 되돌려주는 하나의 작업 단위.

---

## 이 저장소의 역할

**이 저장소는 JuQode의 Code 저장소이며, 동시에 시각 Canon과 Prototype의 집이다.**

| Repository | 담는 것 | 무엇의 Truth인가 |
|---|---|---|
| **JuQode** (이 repo) | **Code / 구현** · 코드와 함께 사는 설계·기술 명세 · **시각 Canon** · **Prototype** | **Implementation & Design Truth** |
| JuQode-Private | **기획** — Strategy · PRD · Canon · Scope · Decisions · Roadmap | **Product Truth** |

분리 기준은 공개/비공개가 아니라 **`기획 vs 코드와 함께 사는 것`** 이다. (현재 두 저장소 모두 Private)

> **Product SSOT의 입구는 `JuQode-Private/docs/current/00_MASTER_INDEX.md`다.**
> 제품 정의 · Scope · 결정 이력을 알아야 한다면 거기서 시작한다.

---

## Status

| | |
|---|---|
| **Version** | **v0.1 — First Real Qode Loop** |
| **S0 — SSOT Consolidation** | ✅ **완료 / PASS** |
| **A1 — Architecture Freeze** | ✅ **CLOSED / PASS** |
| **현재 Phase** | **D1 — Local Persistence / Artifact Store** |
| **현재 Gate** | **D1 Implementation Gate** |
| **Architecture Frozen** | **YES** · Founder **APPROVED** (2026-09-06) |
| **Implementation** | **AUTHORIZED — D1 SCOPE ONLY.** S1/R1/E1/Q1 이후는 닫혀 있다 |
| **다음** | **S1 — Real Project → Semantic Software Model** (D1 Gate 통과 후) |

```
S0 → A1 → D1 → S1 → R1 → E1 → Q1 → Q2 → QA → v0.1
```

| Phase | | |
|---|---|---|
| **S0** | SSOT Consolidation | **완료 / PASS** |
| **A1** | Architecture Freeze | ✅ **CLOSED / PASS** |
| **D1** | Local Persistence / Artifact Store | ▶ **CURRENT / OPEN** |
| **S1** | Real Project → Semantic Software Model | 대기 |
| **R1** | Claude Code Runtime | 대기 |
| **E1** | Evidence / Git Safety / UNKNOWN | 대기 |
| **Q1** | First Real Qode End-to-End | 대기 — **코드가 여기서 실제로 동작한다** |
| **Q2** | RUN → Problem → Second Qode | 대기 |
| **QA** | Founder Dogfood / Release Gates | 대기 |
| **v0.1** | First Qode MVP Release | — |

**v0.1 이후의 V1 / Later는 `JuQode-Private/docs/current/05` · `06`에 방향으로만 있다.**

> **구 Phase 0~7 번호 체계는 SUPERSEDED다.**
> 근거: `JuQode-Private/docs/current/10_DECISIONS.md` §3 C-4.

---

## 지금 여기 있는 것

### 현재 설계 Canon → [`docs/design/`](docs/design/)

```
SOFTWARE_PHYSICS_CANON.md            법칙 (상위)
KINETIC_SOFTWARE_REPRESENTATION.md   재료 — 장(場)과 결
SEMANTIC_PLACE_CANON.md              의미의 자리
WHOLE_PRODUCT_INTERACTION.md         제품 전체 상호작용
MVP_WIREFRAME.md                     MVP 동결
MVP_DESIGN_CONVERGENCE.md            v0.1 화면 결정판 · 설계 SSOT
```

### 현재 구현 기준선 → [`prototype/`](prototype/) · [`docs/prototype/`](docs/prototype/)

**빌드 없이 `prototype/index.html`을 열면 된다.** 외부 요청 0건.
Qode Loop이 실제로 돈다 — 문제를 누르고, 자리가 집히고, "이거 고쳐줘"라고 치면 몸이 가라앉는다.

> **Prototype은 IMPLEMENTATION BASELINE이지 최종 아키텍처가 아니다.**
> Backend · DB · Git · 실제 Coding Agent는 아직 없다. Working / Result는 시뮬레이션이다.

→ [docs/README.md](docs/README.md) · [prototype/README.md](prototype/README.md)

---

## What JuQode is not

JuQode를 다음 중 하나로 축소하지 않는다.

- Claude Code GUI
- 쉬운 VS Code
- Context Manager 앱
- Git GUI
- Agent Animation 앱
- Visual Diff Tool

각각은 JuQode의 일부가 될 수 있지만, JuQode 자체는 아니다.

### 되살리지 않는 것

C + A Hybrid를 Primary Interface 구조로 · Feature Map을 Primary Workspace로 ·
Build World를 v0.1 Primary Surface로 · Construction Metaphor · 큰 Context 관리 페이지 ·
Raw Diff를 기본 결과 화면으로 · Git graph / File Tree를 사용자 멘탈 모델로.

---

<sub>**내부/역사 각주 —** 브랜드의 기원 서사에서 `Q`는 다섯 겹이었다:
`Question → Quest → Queue → Quick → Qode`.
이것은 **내부 어휘이며 제품 화면 · 온보딩 · 튜토리얼 용어로 쓰지 않는다.**
현재의 주 작업 단위는 **`Qode` 하나**다. (`JuQode-Private/docs/current/10_DECISIONS.md` §3 C-3)</sub>
