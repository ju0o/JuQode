# Logical Data Model — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_DATA_MODEL_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. 네 가지 구분

| 이것과 | 이것은 다르다 |
|---|---|
| **안정된 자리 동일성** | **매핑 지문** |
| **아는데 지금 안 그리는 것** | **`UNKNOWN`** |
| **Agent 의 주장** | **Evidence** |
| **스냅샷 이후의 차이** | **자동으로 Agent 의 작업** |

---

## 2. 관계도

```
Project ──1:N── SoftwareBoundary ──1:N── SemanticPlace ──1:N── SemanticPlaceRevision
                                              │                    (mapping_fingerprint)
                     ┌────────────────────────┼────────────────────────┐
                     │                        │                        │
              SemanticSourceMapping   SemanticRelation           PlaceNaming
              (N:N 파일↔revision)      (자리↔자리)      (place_id 에 묶인다 · 지문 아님)
                                              │
Project ──1:N── ContextBlock ──1:N── ContextVersion              Problem ──N:1── SemanticPlace
                     │         (current_version →)                   ▲
                     │                                               │ N:N
                     └──── N:N (usage) ──── Qode           ProblemObservation
                                              │                      │
                                              │ 1:N            Observation
                                          Execution ───1:N──────────┘
                                              │
        ┌──────────────┬──────────────┬───────┴──────┬──────────────┐
        │              │              │              │              │
   AgentEvent     AgentClaim      Evidence     SafetyRecord   SoftwareTimePoint
   (말한 것)      (말한 것)      (측정한 것)         │
        │                             │              │
        └──────── Artifact ◄──────────┴──────────────┘
Skill ──N:N── Qode
```

---

## 3. 무엇이 어디에 사는가

| 어디 | 무엇 | 왜 |
|---|---|---|
| **Repository** | 사용자 코드 · 파일 | Machine Truth |
| **Git** | 이전 평형 · 버려진 상태 · 시간축의 점 | 변경/안전 Truth |
| **SQLite** | 자리 · 문제 · Qode · 실행 · Context · Evidence **메타** | 관계 질의가 필요하다 |
| **파일시스템** | Agent Log 원본 · Diff · 스크린샷 · 테스트 출력 | 삭제하지 않는 원본이 DB 를 부풀리면 안 된다 |
| **OS 자격증명 저장소** | 비밀 | 평문 DB 금지 |
| **사람이 읽는 파일** | Context Export | Free Floor |
| **어디에도 없다** | `.gitignore` 된 파일(`.env` 등) | **스냅샷 밖 → 되돌려도 안 돌아온다.** 그래서 에이전트 쓰기는 **DENY** |

---

## 4. 핵심 규칙

| 엔티티 | 규칙 |
|---|---|
| **SemanticPlace** | `place_id` 는 **영구**. 사용자에게 개체로 노출되지 않는다. `confidence` 와 "지금 그리는가"는 **다른 축** |
| **SemanticPlaceRevision** | 지문은 **재식별 신호**. 영구 동일성이 아니다 |
| **PlaceNaming** | **`place_id` 에 붙는다.** 지문에 붙이면 리팩터 한 번에 정정이 증발한다 |
| **ContextBlock** | 필수 5필드 `id · version · scope · origin · portable`. **본문은 `ContextVersion` 에만 산다** — 현재 본문의 주인은 하나여야 한다 |
| **Qode / Execution** | `RUN` 실행은 `qode_id` 가 **NULL** |
| **AgentClaim** | **이것만으로 `SETTLED` 가 될 수 없다** |
| **Evidence** | **에이전트 발화가 들어갈 컬럼이 없다.** `UNKNOWN` 이면 `what_would_verify` 필수 |
| **Problem** | Observation 연결은 **트랜잭션 불변식**이 강제한다. FK 가 아니다 |
| **SafetyRecord** | **트리 둘** — 워킹트리와 사용자 인덱스를 따로 찍는다 |
| **SoftwareTimePoint** | **확인된 평형만 점이 된다** |
| **Artifact** | **영구. 삭제하지 않는다.** DB 에는 참조만 |
