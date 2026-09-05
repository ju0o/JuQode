# JuQode — Code-side Documentation

> **여기에는 설계 명세만 있다. 기술 명세는 아직 없다. 의도된 것이다.**

---

## 지금 있는 것

| | |
|---|---|
| [`design/PRIMARY_WORKSPACE_V02.md`](design/PRIMARY_WORKSPACE_V02.md) | **Primary Workspace 최종 설계 명세** (Phase 3R.1). Lovable Build Contract 포함 |
| [`design/primary-workspace-v02.html`](design/primary-workspace-v02.html) | 위 명세의 **비주얼 보드**. 브라우저로 열면 된다. 의존성 0 |

`primary-workspace-v02.html`은 보드이면서 동시에 **MASS LAYOUT 엔진의 참조 구현**이다.
여섯 개의 소프트웨어 유형이 특별 케이스 코드 없이 **질량 값만 다른 같은 렌더러**로 그려진다.

---

## 왜 기술 명세가 없는가

JuQode는 현재 **Phase 3 (Functional Prototype)** 단계다.
첫 인터랙티브 코드는 [`prototype/`](../prototype/)에 있고, 그 문서는 그 안의 README다.
아래 기술 명세들은 **Phase 4 (MVP Architecture Freeze)** 의 산출물이므로 아직 없다.

기획 문서(Strategy · PRD · UX · Roadmap)는 **JuQode-Private**에 있다.
이 저장소에는 **코드와 함께 사는 문서만** 둔다.

---

## 여기에 들어올 것

| 후보 | 내용 | 언제 |
|---|---|---|
| Context Block Format Spec | Context를 파일로 내보내고 가져오는 형식 | Phase 4 |
| Agent Event Schema | Agent 작업 이벤트의 구조화된 표현 | Phase 4 |
| Evidence Schema | Test / Build / Screenshot / Git 검증 결과의 표현 | Phase 4 |
| Architecture Notes | Agent 실행 / Evidence 파이프라인 / Context 저장 구조 | Phase 4 |

**Phase 4 = MVP Architecture Freeze.** 그 앞에 Canvas Wireflow(2) · Lovable Handoff(2.5) ·
Lovable Functional Prototype(3)이 있고, 구현은 Phase 5~6이다.

**Context Block Format을 사람이 읽을 수 있는 형식으로 유지하는 것**은
이미 내려진 결정이다 (`JuQode-Private/docs/26_DECISIONS.md` D-024).
사용자가 자기 Context를 언제든 밖으로 가져갈 수 있어야 한다.

---

## 구현 시 반드시 지켜야 할 구조 규칙

기능은 미룰 수 있지만 구조는 미루지 않는다.
`JuQode-Private/docs/24_MVP_SCOPE.md` §5의 9개 Structural Rules를 MVP부터 적용한다.

| 규칙 | 이유 |
|---|---|
| Context Block에 식별자 + 버전 | 나중에 History / Sync / Restore 가능 |
| Context에 Scope 필드 | 나중에 Cloud / Team 경계 가능 |
| Context에 Vault 플래그 | 공유 기능을 켤 때 사고 방지 |
| Export는 사람이 읽을 수 있는 형식 | Ownership 신뢰 + Import 기반 |
| Quest와 Workspace를 분리 | 나중에 병렬 작업 가능 |
| Agent Event를 구조화해서 저장 | Build World / No Fake Motion의 기반 |
| Evidence에 `UNKNOWN` 상태 | 정직한 표시 (Evidence over Agent Claims) |
| 모든 UI 요소가 Level 5 참조를 가짐 | 5 Level Depth 구조의 기반 |
| `CRITICAL`은 `text` 필수 | 중요한 것이 Discovery에 의존하지 않게 강제 |

---

## Open

- 라이선스 (아직 결정되지 않음)
- Open Source 전환 시점
- 외부 기여(Contribution) 수용 여부와 방식
