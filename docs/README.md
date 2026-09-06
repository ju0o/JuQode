# JuQode — Code-side Documentation

> **네 층으로 갈라져 있다.**
> **CURRENT CANON** · **CURRENT IMPLEMENTATION BASELINE** · **HISTORICAL STUDIES** · **FUTURE ARCHITECTURE**
>
> | | |
> |---|---|
> | **현재 Phase** | **S0 — SSOT Consolidation** |
> | **Implementation** | **HOLD** — A1이 아키텍처를 동결할 때까지 · **Architecture Frozen: NO** |
> | **Product SSOT** | `JuQode-Private/docs/current/00_MASTER_INDEX.md` |

---

## 1. CURRENT CANON — 지금의 시각 기준

**충돌하면 위에 있는 것이 이긴다.**

| 순서 | | |
|---|---|---|
| 1 | [`design/SOFTWARE_PHYSICS_CANON.md`](design/SOFTWARE_PHYSICS_CANON.md) | **법칙 (상위 SSOT)**. 믿음 3 · 행동 5 · 통제 2. 채널 배타성. Qode 6-상태 기계 |
| 2 | [`design/KINETIC_SOFTWARE_REPRESENTATION.md`](design/KINETIC_SOFTWARE_REPRESENTATION.md) | **재료 — 장(場)과 결.** 법칙이 어떤 재료 위에서 일어나는가 |
| 3 | [`design/SEMANTIC_PLACE_CANON.md`](design/SEMANTIC_PLACE_CANON.md) | **의미의 자리.** 테두리 없이 집힌다. 의미는 결의 방향을 정한다 |
| 4 | [`design/WHOLE_PRODUCT_INTERACTION.md`](design/WHOLE_PRODUCT_INTERACTION.md) | **제품 전체 상호작용.** `SEE → POINT → SAY` · OPEN/POINT/SAY/QODE/RUN/IMPORT/CONNECT |
| 5 | [`design/MVP_WIREFRAME.md`](design/MVP_WIREFRAME.md) | **MVP 동결.** 문제 모듈 + 여덟 화면 + Realm 하나 |
| 6 | [`design/MVP_DESIGN_CONVERGENCE.md`](design/MVP_DESIGN_CONVERGENCE.md) | **v0.1 화면 결정판 · 설계 SSOT.** 판은 언제나 하나 · 주어는 제품이 쓴다 |

**대응 인터랙티브 보드 (의존성 0 · 더블클릭으로 열린다)**

| | |
|---|---|
| [`design/software-physics-canon.html`](design/software-physics-canon.html) | 법칙 참조 카드. 제품 화면이 아니다 |
| [`design/kinetic-software-study.html`](design/kinetic-software-study.html) | 운동 표상 5장면 |
| [`design/semantic-place-study.html`](design/semantic-place-study.html) | 의미의 자리 연구 4편 |
| [`design/whole-product-board.html`](design/whole-product-board.html) | 8프레임 제품 보드 |
| [`design/mvp-wireframe.html`](design/mvp-wireframe.html) | MVP 동결 8프레임 + 와이어플로 |
| [`design/mvp-design-convergence.html`](design/mvp-design-convergence.html) | **수렴판 8프레임** |

**렌더 검토 기록 (실제 픽셀을 보고 쓴 것)**

| | |
|---|---|
| [`design/SEMANTIC_PLACE_PM_REVIEW.md`](design/SEMANTIC_PLACE_PM_REVIEW.md) | 근거 이미지 `design/evidence/semantic-place/` |
| [`design/KINETIC_PM_VISUAL_GATE.md`](design/KINETIC_PM_VISUAL_GATE.md) | 근거 이미지 `design/evidence/kinetic/` |

> **읽는 순서: 법칙 → 재료 → 자리 → 제품 → MVP 동결 → 수렴판.**
> 법칙이 *왜*, 재료가 *무엇 위에서*, 자리가 *어디를 집는가*, 제품이 *무엇을 하는가*,
> 동결과 수렴이 *v0.1 화면*을 정한다.

---

## 2. CURRENT IMPLEMENTATION BASELINE

| | |
|---|---|
| [`prototype/PHASE_4A_FUNCTIONAL_PROTOTYPE.md`](prototype/PHASE_4A_FUNCTIONAL_PROTOTYPE.md) | **동작하는 프로토타입의 문서.** 하나의 기계, 아홉 개의 상태 |
| [`../prototype/`](../prototype/) | **실제 코드.** `index.html`을 열면 끝이다. 외부 요청 0건 |
| `prototype/evidence/phase-4a/` | **실제 프로토타입을 눌러서 얻은 화면 15장 + 영상** |

> **BASELINE이지 FINAL PRODUCTION ARCHITECTURE가 아니다.**
> 물리 엔진 · 상태 기계 · 껍데기는 그대로 가져간다.
> **그 아래(저장 · 실제 Agent · 실제 Git · 실제 Evidence)는 아직 없다.**
>
> **Lovable credits 사용 0.** 저장소 안에서 vanilla로 구현되었다.

---

## 3. HISTORICAL STUDIES — 보존한다. 현재 기준이 아니다

| | | 왜 |
|---|---|---|
| [`design/PRIMARY_WORKSPACE_V02.md`](design/PRIMARY_WORKSPACE_V02.md) | 3R.1 화면 명세 | §3.3 폐기 · 6건 소급 정정. 이후 세대가 표상을 교체했다 |
| [`design/primary-workspace-v02.html`](design/primary-workspace-v02.html) | 위 명세의 보드 | **점밭 표현은 폐기됨** |
| [`design/SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md`](design/SOFTWARE_PHYSICS_VISUAL_GRAMMAR.md) | 3R.3 시각 문법 | **시각형(점밭 · 구획)은 Founder가 기각했다.** 그 안의 Build Contract는 실행되지 않았다 |
| [`design/software-physics-visual-grammar.html`](design/software-physics-visual-grammar.html) | 위 문법의 보드 | 기각된 표현의 기록 |

**JuQode-Private 쪽 역사 층** — `docs/00`~`27` · `docs/visual/` · `docs/design/`(C+A Hybrid) ·
`docs/reviews/` · `docs/handoffs/`. 전부 상단에 상태 헤더가 붙어 있다.

> **역사 문서는 왜 그렇게 결정했는지의 증거다. 삭제하지 않는다.**
> 다만 **현재 구현 기준으로 쓰지 않는다.**

---

## 4. ARCHITECTURE PROPOSALS — A1b 개정판. 전부 `PROPOSED`

> ## ⚠️ **Architecture Frozen: NO · Implementation Authorized: NO**
>
> **A1a 는 PASS 했고, 아래는 PM 판정을 반영한 A1b 개정판이다. 여전히 결정이 아니다.**
>
> **A1b 실측이 A1a 의 주장 셋을 뒤집었다** — 에이전트 격리 · 되돌리기의 상태 보존 · Electron 의 `node:sqlite`.
> 각 문서의 `⚠ A1b 정정` 절이 무엇이 틀렸는지 적는다.
> 선택지 · 비용 · 반대 근거 · Worker 권고는 전부
> `JuQode-Private/docs/current/14_A1_ARCHITECTURE_DECISION_PACKET.md` 에 있고,
> **PM 판정 · Founder 판정은 전부 `PENDING`** 이다.

| 문서 | 무엇을 제안하는가 |
|---|---|
| [`architecture/A1_SYSTEM_ARCHITECTURE_PROPOSAL.md`](architecture/A1_SYSTEM_ARCHITECTURE_PROPOSAL.md) | 네 개의 층 · 무엇이 어디의 진실인가 · 데스크톱 런타임 (**미결**) |
| [`architecture/A1_PROJECT_UNDERSTANDING_PROPOSAL.md`](architecture/A1_PROJECT_UNDERSTANDING_PROPOSAL.md) | 로컬 사실 → AI 의미 → 사람 정정. 로컬/AI 경계 |
| [`architecture/A1_SEMANTIC_MODEL_PROPOSAL.md`](architecture/A1_SEMANTIC_MODEL_PROPOSAL.md) | 자리는 어떻게 나오는가 · **"개체가 아니다" ↔ "저장해야 한다" 의 긴장** |
| [`architecture/A1_QODE_RUNTIME_PROPOSAL.md`](architecture/A1_QODE_RUNTIME_PROPOSAL.md) | Qode ↔ Execution · 실행 경계 · Provider 이음매 · 되묻기 조건 |
| [`architecture/A1_EVIDENCE_PIPELINE_PROPOSAL.md`](architecture/A1_EVIDENCE_PIPELINE_PROPOSAL.md) | Observation / Problem / Evidence 세 층 · **정직한 지원 계약** |
| [`architecture/A1_GIT_SAFETY_PROPOSAL.md`](architecture/A1_GIT_SAFETY_PROPOSAL.md) | 되돌리기 · 더러운 저장소 · Git 없는 프로젝트 (**실측 근거 최다**) |
| [`data/A1_DATA_MODEL_PROPOSAL.md`](data/A1_DATA_MODEL_PROPOSAL.md) | ER 논리 모델 — 엔티티마다 왜 존재하고 어디가 진실인가 |
| [`data/A1_PERSISTENCE_PROPOSAL.md`](data/A1_PERSISTENCE_PROPOSAL.md) | 저장 후보 비교 · **논리 SQL (실행 금지)** · 마이그레이션 전략 |
| [`contracts/A1_CONTEXT_BLOCK_PROPOSAL.md`](contracts/A1_CONTEXT_BLOCK_PROPOSAL.md) | 필수 5필드 · 사람이 읽는 Export 형식 |
| [`contracts/A1_AGENT_EVENT_PROPOSAL.md`](contracts/A1_AGENT_EVENT_PROPOSAL.md) | No Fake Motion 을 데이터로 강제하는 봉투 |
| [`contracts/A1_EVIDENCE_SCHEMA_PROPOSAL.md`](contracts/A1_EVIDENCE_SCHEMA_PROPOSAL.md) | `PASS/FAIL/UNKNOWN` · **Canon 을 CHECK 제약으로 올린다** |
| [`security/A1_LOCAL_SECURITY_PROPOSAL.md`](security/A1_LOCAL_SECURITY_PROPOSAL.md) | 위협 11개 · 경계 · **못 막는 것을 정직하게 말한다** |

**버리는 코드:** [`../experiments/a1/`](../experiments/a1/) · [`../experiments/a1b/`](../experiments/a1b/)
— 아키텍처 비교용 일회용 검증. **DISPOSABLE 로 표시했고 `prototype/` 을 한 글자도 건드리지 않았다.**
**실제 유료 코딩 에이전트를 호출하지 않았다.**

> **⚠ v0.1 아키텍처 방향은 전부 `PROPOSED`이며 결정되지 않았다.**
> Local-first · SQLite가 Product State · Repository가 Machine Truth · Git이 안전 Truth ·
> 큰 아티팩트는 파일시스템 · 비밀은 OS Credential Storage · 첫 Provider = Claude Code ·
> 내부 Provider 추상 · Qode와 Execution 분리 · 데스크톱 런타임.
> **구현된 것이 아니다.** A1에서 확정한다.

**Context Block Format을 사람이 읽을 수 있는 형식으로 유지하는 것**은 이미 내려진 결정이다 (D-024).
사용자가 자기 Context를 언제든 밖으로 가져갈 수 있어야 한다.

---

## 5. 구현 시 반드시 지켜야 할 구조 규칙

**기능은 미룰 수 있지만 구조는 미루지 않는다.**

| 규칙 | 이유 |
|---|---|
| Context Block에 `id` + `version` | History / Sync / Restore |
| Context에 `scope` | Cloud / Team 경계 |
| Context에 `origin` | 승인 UX와 신뢰 |
| Context에 `portable` 플래그 | Cloud를 막지 않기 위한 최소 조건 |
| Context에 Vault 플래그 | 공유를 켤 때 사고 방지 |
| Export는 사람이 읽을 수 있는 형식 | Ownership 신뢰 + Import 기반 |
| **Agent Event를 구조화해서 저장** | No Fake Motion의 기반 |
| Evidence에 **`UNKNOWN`** 상태 | 정직한 표시 |
| 모든 UI 요소가 **Raw 참조**를 가짐 | 5 Level Depth의 기반 |
| `CRITICAL`은 `text` 필수 | 중요한 것이 Discovery에 의존하지 않게 강제 |
| 행동에 **`reversibility` 등급** 필드 | `reversible \| irreversible \| destructive` |
| 자리 · 질량 · 상태 · 증거는 **Realm 독립** | 미래 Realm과 호환 |

> **이 표에 들어 있지 않은 것 — 아직 결정되지 않았다**
>
> | 방향 | 상태 |
> |---|---|
> | **Qode와 Execution을 별개 구현 엔티티로 분리** | **PROPOSED** — D-061 · **A1에서 결정.** 구현 필수 구조 규칙이 아니다 |
> | **내부 Provider 추상** | **PROPOSED** — D-059 · **A1에서 결정.** v0.1이 약속하는 것은 **Coding Agent Provider 하나**까지다 |
>
> **`Software Time` 점이 검증된 `SETTLED`에서만 생긴다**는 규칙은 위와 별개로 **이미 CANON**이며
> (Software Physics L3 / E2) 제안 대상이 아니다.

→ 전체: `JuQode-Private/docs/current/04_MVP_V01_SPEC.md` §6

---

## 6. 절대 되살리지 않는 것

| | |
|---|---|
| C + A Hybrid를 Primary Interface 구조로 | 공간 문법 자체가 교체되었다 |
| Feature Map을 Primary Workspace로 | Primary는 Software World다 |
| Build World / Software City를 v0.1 Primary Surface로 | **대체물 제작도 금지** |
| Construction / 정원 / 작업대 메타포 | 시각 정체성은 메타포가 아니라 재료의 법칙이다 |
| 큰 Context 관리 페이지 | Context는 판 안의 접힌 한 줄이다 |
| Raw Diff를 기본 결과 화면으로 | 기본은 Outcome |
| Git graph · File Tree를 사용자 멘탈 모델로 | 사실은 남고 형태는 죽었다 |
| 세로 레일 · 탭줄 · 트리 · 폴더 삼각형 | 하나라도 남으면 IDE로 읽힌다 |
| 진행률 바 · 퍼센트 · 스피너 · Agent 아바타 | No Fake Motion |
| gradient · glass · 큰 둥근 카드 · emoji | Visual Tone 동결 |

→ 근거와 사유: `JuQode-Private/docs/current/10_DECISIONS.md` §3

---

## 7. Open

- 라이선스 (아직 결정되지 않음)
- Open Source 전환 시점
- 외부 기여(Contribution) 수용 여부와 방식

**제품 차원의 미결정 전체:** `JuQode-Private/docs/current/11_OPEN_DECISIONS.md`
