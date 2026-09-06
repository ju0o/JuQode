# JuQode — Code-side Documentation

> **네 층으로 갈라져 있다.**
> **CURRENT CANON** · **CURRENT IMPLEMENTATION BASELINE** · **HISTORICAL STUDIES** · **FUTURE ARCHITECTURE**
>
> | | |
> |---|---|
> | **A1 — Architecture Freeze** | ✅ **CLOSED / PASS** |
> | **현재 Phase** | **D1 — Local Persistence / Artifact Store** |
> | **Implementation** | **AUTHORIZED — D1 SCOPE ONLY** · **Architecture Frozen: YES** |
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

## 4. ARCHITECTURE — **CANON. 동결되었다**

> ## ✅ **Architecture Frozen: YES** · Founder Approval: **APPROVED** (2026-09-06)
>
> **PM 이 원격 A1c 커밋을 확인했다. A1 = CLOSED · D1 = OPEN.**
> **구현은 D1 범위만 허가되었다.** S1 · R1 · E1 · Q1 이후는 아직 열리지 않았다.
>
> 한 장 요약: `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md`

| 문서 | 무엇을 정했는가 |
|---|---|
| [`architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md) | **Electron 44.x** · 기준 OS **Linux x86_64** · 프로세스 경계 · 무엇이 어디의 진실인가 |
| [`architecture/PROJECT_UNDERSTANDING.md`](architecture/PROJECT_UNDERSTANDING.md) | 로컬 사실 → AI 의미 → 사람 정정. **열기가 AI 에 의존하지 않는다** |
| [`architecture/SEMANTIC_SOFTWARE_MODEL.md`](architecture/SEMANTIC_SOFTWARE_MODEL.md) | 안정된 자리 동일성 · 지문은 재식별 신호 · **5~7 은 렌더링 예산** |
| [`architecture/QODE_RUNTIME.md`](architecture/QODE_RUNTIME.md) | Qode ≠ Execution · 어댑터 둘 · 되묻기 세 조건 |
| [`architecture/EVIDENCE_PIPELINE.md`](architecture/EVIDENCE_PIPELINE.md) | Observation → Problem → Evidence · **지원 계약** |
| [`architecture/GIT_SAFETY.md`](architecture/GIT_SAFETY.md) | 트리 둘 안전 모델 · 미지원 상태 · **무시 파일 DENY** |
| [`data/DATA_MODEL.md`](data/DATA_MODEL.md) | ER 논리 모델 |
| [`data/PERSISTENCE.md`](data/PERSISTENCE.md) | **번들 `node:sqlite`** · 논리 SQL · 마이그레이션 |
| [`contracts/CONTEXT_BLOCK_FORMAT.md`](contracts/CONTEXT_BLOCK_FORMAT.md) | 필수 5필드 · 사람이 읽는 Export |
| [`contracts/AGENT_EVENT_SCHEMA.md`](contracts/AGENT_EVENT_SCHEMA.md) | No Fake Motion 을 데이터로 강제 |
| [`contracts/EVIDENCE_SCHEMA.md`](contracts/EVIDENCE_SCHEMA.md) | **AgentClaim ≠ Evidence** · `UNKNOWN` 은 행동 가능 |
| [`security/LOCAL_SECURITY.md`](security/LOCAL_SECURITY.md) | **DEFAULT DENY** · **샌드박스 필수** · 못 막는 것을 말한다 |

### 역사 — 왜 그렇게 정했는가

`A1_*_PROPOSAL.md` 12개는 **SUPERSEDED / HISTORICAL** 로 남는다.
선택지 · 비용 · **반증된 주장** · 실측 근거가 거기 있다. **현재 기준으로 읽지 마라.**

**버리는 코드:** [`../experiments/a1/`](../experiments/a1/) · [`../experiments/a1b/`](../experiments/a1b/)
— **Historical Architecture Evidence.** `prototype/` 을 한 글자도 건드리지 않았고,
**실제 유료 코딩 에이전트를 호출하지 않았다.**

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
