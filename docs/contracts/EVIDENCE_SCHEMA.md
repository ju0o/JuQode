# Evidence Schema — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_EVIDENCE_SCHEMA_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. 세 상태. 둘이 아니다

```
PASS      →  확인됨
FAIL      →  문제 있음
UNKNOWN   →  아직 확인 못함
```

> **PASS/FAIL 만 있으면 "확인 못 함"을 표현할 수 없고, 시스템이 거짓말하도록 강제된다.**
> 내부 상태는 사라지지 않는다. **`UNKNOWN` 을 `PASS` 처럼 보이게 만들지 않는다.**

---

## 2. AgentClaim 과 Evidence 는 다른 테이블이다

```
AgentClaim
├─ id · execution_id · text · artifact_id
└─ 설명의 재료. 검증 진실이 아니다

Evidence                    ← 측정된 것만 들어온다
├─ id · execution_id
├─ kind               →  TEST | BUILD | GIT | RUNTIME | SCREENSHOT
├─ status             →  PASS | FAIL | UNKNOWN
├─ what_would_verify  →  UNKNOWN 이면 필수
├─ measured_at
└─ artifact_id        →  Raw 원본 참조
```

> **에이전트의 발화가 들어갈 자리가 아예 없다.**
> 주장을 Evidence 로 승격하려면 **행을 새로 써야 하고, 그러려면 측정이 있어야 한다.**

---

## 3. Canon 을 스키마 제약으로

| 제약 | 무엇을 강제하는가 |
|---|---|
| `CHECK (status <> 'UNKNOWN' OR length(trim(what_would_verify)) > 0)` | **`UNKNOWN` 은 반드시 행동 가능하다.** 빈 문자열도 막는다 |
| **Evidence 에 에이전트 발화 컬럼이 없다** | **주장은 사실이 아니다** |
| `CHECK (level <> 'CRITICAL' OR text IS NOT NULL)` | 중요한 것이 **Discovery 에 의존하지 않는다** |

### 스키마가 못 하는 것도 적는다

| | 무엇이 강제하는가 |
|---|---|
| 모든 Problem 에 Observation 최소 하나 | **트랜잭션 불변식 + 고아 점검** |
| 자리 정정이 리팩터를 견딘다 | **재식별 확신도 로직** |

---

## 4. 증거의 종류와 v0.1 범위

| 종류 | v0.1 |
|---|---|
| **실제 Repository 변경** | ✅ 필수 |
| **Git Evidence** | ✅ 필수 |
| **Test** | ✅ 있으면 수집 · 없으면 `UNKNOWN` |
| **Build** | ✅ 있으면 수집 · 없으면 `UNKNOWN` |
| **Runtime Observation (RUN)** | ✅ 최소 — 새 문제를 몸에 넣는 경로 |
| **Screenshot** | ⚠ 계단식 — 얻을 수 있으면 모으고, 아니면 `UNKNOWN` + `what_would_verify` |

> **v0.1 활성 Observation 출처는 `RUNTIME` · `TEST` · `BUILD` 셋이다. `STATIC` 은 OFF.**

---

## 5. 결과의 정보 순서는 고정이다

```
1. Outcome   2. Impact   3. Evidence   4. Attention / Unknown   5. Raw
```

**묻히면 안 되는 것:** 결제 · 삭제 · 외부 전송 · 권한 · 공개 · 데이터 손실 · 검증 실패.

---

## 6. 미결

- **`signature` 계산 방식** — 같은 실패를 무엇으로 같다고 볼지 (**E1**)
- 스크린샷 회귀 비교를 v0.1 에서 하는가 — **하지 않는다**
