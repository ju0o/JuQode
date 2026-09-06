# Evidence Pipeline — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_EVIDENCE_PIPELINE_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. 세 층

```
Observation   기계가 본 것. 원본에 붙어 있다. 사람에게 안 보인다
     │  집계 / 해석
     ▼
Problem       사람 말 한 줄. 자리에 매여 있다. 화면에 뜨는 것은 이것뿐
     │
Evidence      JuQode 가 실제로 측정한 것. PASS / FAIL / UNKNOWN
```

| | |
|---|---|
| **v0.1 활성 Observation 출처** | `RUNTIME` · `TEST` · `BUILD` |
| **`STATIC`** | **OFF** — 노이즈 비율 미검증. 문제 지표는 최대 3행이다 |
| `USER` · `STATIC` 등 | 스키마에 자리는 두되 **비활성** |

---

## 2. AgentClaim ≠ Evidence

```
AgentEvent / AgentClaim   에이전트가 말했거나 내보낸 것
Evidence                  JuQode 가 실제로 측정한 것
```

**테이블을 나눈다.** 같은 테이블의 플래그였다면 `UPDATE` 한 줄로 뚫린다.
에이전트의 말은 **설명의 재료**이지 검증 진실이 아니다.

---

## 3. 모든 Problem 은 Observation 으로 뒷받침된다

> **FK 하나가 이것을 보장한다고 주장하지 않는다.**

| 무엇으로 강제하는가 | 어떻게 |
|---|---|
| **트랜잭션 불변식** | Problem 은 최소 하나의 Observation 과 **같은 트랜잭션 안에서만** 생성된다 |
| **명시적 연결 구조** | `problem_observation` 링크 테이블 |
| **검사 가능한 불변식** | *고아 Problem 0건* 을 테스트와 기동 시 점검으로 확인한다 |

**묶는 키** = `(place_id, signature)`. `occurrences · first_seen · last_seen` 을 센다 —
화면의 **`3번 중 2번`** 이 여기서 나온다. 지어내지 않는다.
**정렬은 심각도 순**(시간순 아님). **경중은 색이 아니라 결의 거동**(`misalign` / `break`).

---

## 4. `UNKNOWN` 은 정당한 최종 상태다 — 단 행동 가능해야 한다

| 내부 | 화면 |
|---|---|
| `PASS` | **확인됨** |
| `FAIL` | **문제 있음** |
| `UNKNOWN` | **아직 확인 못함** |

> **"확인 못 했다"로 끝내지 않고 "무엇이 있으면 확인되는가"를 항상 함께 말한다.**
> 그렇지 않으면 정직함이 **무력함**이 된다. → `what_would_verify` 는 스키마 제약이다.

---

## 5. v0.1 출시 지원 계약

> ## **열린다(OPENABLE) ≠ 출시 지원한다(RELEASE SUPPORTED).**

| 층 | 무엇 | 실행 관측 | 화면 증거 | Test/Build |
|---|---|---|---|---|
| **FULL — v0.1 출시 지원** | **경계 하나짜리 로컬 웹 애플리케이션 + 발견 가능한 로컬 실행/dev 명령.** 프레임워크 중립 | ✅ | ✅ 라우트 단위 | ✅ 있으면 |
| **BEST-EFFORT / EXPERIMENTAL** | 백엔드 / API | ✅ | ⛔ `UNKNOWN` | ✅ 있으면 |
| | CLI 도구 | ✅ | ⛔ `UNKNOWN` | ✅ 있으면 |
| | 라이브러리 / SDK | ⛔ 스스로 실행되지 않는다 | ⛔ `UNKNOWN` | ✅ 테스트가 유일한 증거 |
| **NOT v0.1 출시 지원** | 다중 Software / 모노레포 | ⛔ | ⛔ | — |
| | 데스크톱 · 모바일 앱 자동화 | ⛔ | ⛔ | — |
| **OPENABLE (약속 아님)** | 이해 못 한 저장소 | ⛔ | ⛔ | ⛔ |

**Screenshot Evidence 는 계단식** — 기술적으로 얻을 수 있으면 모으고, 아니면 `UNKNOWN` + `what_would_verify`.

---

## 6. 결과의 정보 순서 — 고정

```
1. Outcome   2. Impact   3. Evidence   4. Attention / Unknown   5. Raw
```

**Diff · Commit · 로그 · 기술적 테스트 이름으로 시작하지 않는다.**
**묻히면 안 되는 것:** 결제 · 삭제 · 외부 전송 · 권한 · 공개 · 데이터 손실 · 검증 실패.

---

## 7. 미결

- **`signature` 계산 방식** — 같은 실패를 무엇으로 같다고 볼지 (**E1**)
- **어떤 스택까지 실제로 관측되는지** — 구현해 봐야 안다 (**E1 / Q1**)
- **실행 중 외부 동시 편집**은 JuQode 것으로 귀속하지 않는다 — 소유권 `UNKNOWN`
