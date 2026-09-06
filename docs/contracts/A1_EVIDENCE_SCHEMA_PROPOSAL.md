# A1 · Evidence Schema — PROPOSED

> ## 📜 SUPERSEDED / HISTORICAL
>
> | | |
> |---|---|
> | **Status** | **SUPERSEDED / HISTORICAL** |
> | **Superseded By** | [`EVIDENCE_SCHEMA.md`](EVIDENCE_SCHEMA.md) — **현재 기준은 그쪽이다** |
> | **왜 남기는가** | **왜 그렇게 정했는가**의 이력. 선택지 · 비용 · **반증된 주장** · 실측 근거 |
> | **확인일** | 2026-09-06 (A1c) |
>
> **이 문서를 현재 기준으로 읽지 마라.** 본문의 `PROPOSED` · `PENDING` 표기는
> **당시 상태를 그대로 보존한 것**이며 A1c 에서 동결된 결정으로 대체되었다.
> 최종 판정: `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md`

> ## ⚠️ PROPOSED — 결정이 아니다
>
> | | |
> |---|---|
> | **Status** | **SUPERSEDED / HISTORICAL** |
> | **Architecture Frozen** | **YES** (A1c) |
> | **Implementation Authorized** | **NO** — PM 원격 확인 이후 |
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

> ### ⚠ A1b 정정 — Agent 의 말은 이 테이블에 들어올 수 없다
>
> A1a 는 `claim_source ∈ {AGENT_CLAIM, MEASURED}` 컬럼으로 **한 테이블 안에서** 구분했다.
> **PM 이 이것을 기각했다.** 같은 테이블에 있으면 언젠가 `UPDATE` 한 줄로 섞인다.
>
> ```
> AgentEvent / AgentClaim   에이전트가 '말한 것'.   검증 진실이 아니다
> Evidence                  JuQode 가 '측정한 것'.  PASS / FAIL / UNKNOWN
> ```

```
AgentClaim
├─ id
├─ execution_id       →  실행에서 나온다
├─ text               →  설명의 재료. 검증 진실이 아니다
└─ artifact_id        →  원본 발화

Evidence                    ← 측정된 것만 들어온다
├─ id
├─ execution_id       →  실행에서 나온다
├─ kind               →  TEST | BUILD | GIT | RUNTIME | SCREENSHOT
├─ status             →  PASS | FAIL | UNKNOWN
├─ what_would_verify  →  UNKNOWN 이면 필수
├─ measured_at
└─ artifact_id        →  Raw 원본 참조
```

> **`claim_source` 컬럼을 삭제했다.** 에이전트의 발화가 들어갈 자리가 **아예 없다.**
> 주장을 Evidence 로 승격하려면 **행을 새로 써야 하고, 그러려면 측정이 있어야 한다.**

---

## 3. Canon 을 스키마 제약으로 올린다

| 제약 | 무엇을 강제하는가 |
|---|---|
| `CHECK (status <> 'UNKNOWN' OR length(trim(what_would_verify)) > 0)` | **`UNKNOWN` 은 반드시 행동 가능하다.** 빈 문자열도 막는다 |
| **Evidence 에 에이전트 발화 컬럼이 없다** | **주장은 사실이 아니다** — 구조로 분리했다 |
| `CHECK (level <> 'CRITICAL' OR text IS NOT NULL)` | 중요한 것이 **Discovery 에 의존하지 않는다** |

> 이것이 이 스키마의 핵심 논지다 — **원칙 7과 P3 를 코드의 성실성이 아니라 저장소의 성질로 만든다.**

### ⚠ 다만 스키마가 못 하는 것도 적는다 (A1b)

| | 무엇이 강제하는가 |
|---|---|
| 모든 Problem 에 Observation 이 최소 하나 | **스키마 아님.** 트랜잭션 불변식 + 고아 점검 |
| 자리 정정이 리팩터를 견딘다 | **스키마 아님.** 재식별 확신도 로직 |

> **"스키마가 막아준다"고 쓰지 않는다. 무엇이 막는지 이름을 댄다.**

---

## 4. 증거의 종류와 v0.1 범위

| 종류 | v0.1 |
|---|---|
| **실제 Repository 변경** | ✅ 필수 |
| **Git Evidence** | ✅ 필수 |
| **Test** | ✅ 있으면 수집 · 없으면 `UNKNOWN` |
| **Build** | ✅ 있으면 수집 · 없으면 `UNKNOWN` |
| **Runtime Observation (RUN)** | ✅ 최소 — 새 문제를 몸에 넣는 경로 |
| **Screenshot** | ⚠ 계단식 — 기술적으로 얻을 수 있으면 모으고, 아니면 `UNKNOWN` + `what_would_verify` |

> **v0.1 활성 Observation 출처는 `RUNTIME` · `TEST` · `BUILD` 셋이다.**
> **`STATIC` 분석은 꺼져 있다** — 스키마에 자리는 있으나 v0.1 에서 켜지 않는다.

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
