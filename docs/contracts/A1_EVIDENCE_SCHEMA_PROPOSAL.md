# A1 · Evidence Schema — PROPOSED

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

---

## 1. 세 상태. 둘이 아니다

```
PASS      →  확인됨
FAIL      →  문제 있음
UNKNOWN   →  아직 확인 못함
```

> **PASS/FAIL 만 있으면 "확인 못 함"을 표현할 수 없고, 시스템이 거짓말하도록 강제된다.**

내부 상태는 **사라지지 않는다.** 화면은 사람 말로 번역하되 기술 정보 층에 원래 이름으로 남는다.
**`UNKNOWN` 을 `PASS` 처럼 보이게 만들지 않는다.**

---

## 2. 봉투 (PROPOSED)

```
Evidence
├─ id
├─ execution_id       →  실행에서 나온다
├─ kind               →  TEST | BUILD | GIT | RUNTIME | SCREENSHOT
├─ status             →  PASS | FAIL | UNKNOWN
├─ claim_source       →  AGENT_CLAIM | MEASURED
├─ what_would_verify  →  UNKNOWN 이면 필수
└─ artifact_id        →  Raw 원본 참조
```

---

## 3. Canon 을 스키마 제약으로 올린다

| 제약 | 무엇을 강제하는가 |
|---|---|
| `CHECK (status <> 'UNKNOWN' OR what_would_verify IS NOT NULL)` | **`UNKNOWN` 은 반드시 행동 가능하다** — "무엇이 있으면 확인되는가"를 언제나 함께 말한다 |
| `CHECK (claim_source <> 'AGENT_CLAIM' OR status <> 'PASS')` | **주장은 사실이 아니다.** 에이전트의 말만으로 `확인됨` 이 될 수 없다 |
| `CHECK (level <> 'CRITICAL' OR text IS NOT NULL)` | 중요한 것이 **Discovery 에 의존하지 않는다** |

> 이것이 이 스키마의 핵심 논지다 — **원칙 7과 P3 를 코드의 성실성이 아니라 저장소의 성질로 만든다.**
> 규칙을 어기려면 **행을 삽입할 수 없어야** 한다.

---

## 4. 증거의 종류와 v0.1 범위

| 종류 | v0.1 |
|---|---|
| **실제 Repository 변경** | ✅ 필수 |
| **Git Evidence** | ✅ 필수 |
| **Test** | ✅ 있으면 수집 · 없으면 `UNKNOWN` |
| **Build** | ✅ 있으면 수집 · 없으면 `UNKNOWN` |
| **Runtime Observation (RUN)** | ✅ 최소 — 새 문제를 몸에 넣는 경로 |
| **Screenshot** | ⚠ 프로젝트 종류에 따름 — 지원 계약 참조 |

---

## 5. 결과의 정보 순서는 고정이다

```
1. Outcome              무엇이 달라졌나
2. Impact               어디에 영향이 있나
3. Evidence             제대로 됐나
4. Attention / Unknown  내가 확인해야 할 것이 남았나
5. Raw Evidence         (원하면) 원본
```

**Diff · Commit · 로그 · 기술적 테스트 이름으로 시작하지 않는다.**

**묻히면 안 되는 것:** 결제 · 삭제 · 외부 전송 · 권한 · 공개 · 데이터 손실 · 검증 실패.
영향이 큰 불확실성은 **Evidence 상세 안에 접어 두지 않는다.**

---

## 6. 미결

- `signature` 계산 방식 — 같은 실패를 무엇으로 같다고 판정하는가
- 스크린샷 비교(회귀) 를 v0.1 에서 하는가. 현재 제안은 **하지 않는다**
