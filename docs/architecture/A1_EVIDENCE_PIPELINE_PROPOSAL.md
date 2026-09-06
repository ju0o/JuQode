# A1 · Evidence Pipeline — PROPOSED

> ## 📜 SUPERSEDED / HISTORICAL
>
> | | |
> |---|---|
> | **Status** | **SUPERSEDED / HISTORICAL** |
> | **Superseded By** | [`EVIDENCE_PIPELINE.md`](EVIDENCE_PIPELINE.md) — **현재 기준은 그쪽이다** |
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

## 1. 이 파이프라인이 약하면 제품이 온통 `SETTLING` 이 된다

Canon 부록 B 가 직접 지목한 실패 모드다. `확인됨` 이 거의 안 나오면 제품의 핵심 약속이 무너진다.

---

## 2. 세 층 (PROPOSED)

```
Observation   기계가 본 것. 여섯 출처. 원본에 붙어 있다. 사람에게 안 보인다
     │  (자리 + 서명) 으로 묶는다
     ▼
Problem       사람 말 한 줄. 자리에 매여 있다. 화면에 뜨는 것은 이것뿐
     │
Evidence      그 변경이 정상임을 뒷받침하는 검증 자료. PASS / FAIL / UNKNOWN
```

| 규칙 | 왜 |
|---|---|
| **Observation 없는 Problem 은 존재할 수 없다** — **트랜잭션 불변식으로 강제한다** | D-014 의 데이터판 — 증거 없는 문제는 연출이다 |
| 묶는 키 = `(place_id, signature)` | 같은 실패가 네 곳에서 보고돼도 **한 줄**이다 |
| `occurrences · first_seen · last_seen` 을 센다 | 화면의 **`3번 중 2번`** 이 여기서 나온다. 지어내지 않는다 |
| 정렬 = **심각도 순** | 시간순이 아니다 (Return UX) |
| `kind ∈ {misalign, break}` | 결의 거동을 정한다. **색이 아니다** |

> ### ⚠ A1b 정정 — FK 는 그 불변식을 증명하지 않는다
>
> A1a 는 *"(FK 필수)"* 라고 적었다. **거짓이다.**
> `observation.problem_id` 가 nullable FK 이면 보장되는 것은
> *"problem_id 가 있으면 그 Problem 은 실재한다"* 뿐이고,
> **Observation 이 하나도 없는 Problem 을 막지 못한다.** 방향이 반대다.
>
> | 무엇으로 강제하는가 | 어떻게 |
> |---|---|
> | **트랜잭션 불변식** | Problem 은 **최소 하나의 Observation 과 같은 트랜잭션 안에서만** 생성된다 |
> | **명시적 연결 구조** | `problem_observation` 링크 테이블 — 관계를 1급으로 만든다 |
> | **검사 가능한 불변식** | *고아 Problem 0건* 을 테스트와 기동 시 점검으로 확인한다 |
>
> **"스키마가 막아준다"고 쓰지 않는다. 막는 것은 트랜잭션 경계와 점검이다.**

**v0.1 활성 출처는 셋이다 — `RUNTIME` · `TEST` · `BUILD`.** (A1b 에서 PM 확정)
**`STATIC` 분석은 v0.1 에서 꺼져 있다** (PM 결정)**.** 노이즈 비율이 검증되지 않았고 **문제 지표는 최대 3행**이다 —
린트 경고 40개가 들어오면 제품이 죽는다.
`USER` · `STATIC` 은 **스키마에 자리를 두되 비활성**이다. 확장 가능하지만 켜지 않는다.

---

## 3. `UNKNOWN` 은 정당한 최종 상태다 — 단 행동 가능해야 한다

| 내부 | 화면 |
|---|---|
| `PASS` | **확인됨** |
| `FAIL` | **문제 있음** |
| `UNKNOWN` | **아직 확인 못함** |

> **"확인 못 했다"로 끝내지 않고 "무엇이 있으면 확인되는가"를 항상 함께 말한다.**
> 그렇지 않으면 정직함이 **무력함**이 된다.

**제안:** 이것을 UI 관례가 아니라 **스키마 제약**으로 올린다.
`UNKNOWN` 인 Evidence 행은 `what_would_verify` 없이 **저장될 수 없다.**

---

## 4. 정직한 v0.1 지원 계약 (PROPOSED — Founder 승인 사안)

> ### ⚠ A1b 정정 — 열린다(OPENABLE)와 출시 지원한다(RELEASE SUPPORTED)는 다르다
>
> A1a 는 *"표상이 설명할 수 있다"* 를 *"v0.1 이 지원한다"* 와 같은 표에 섞어 놨다.
>
> ```
> OPENABLE           열린다. 몸이 그려진다. 모르는 곳은 모르는 곳으로 남는다
> RELEASE SUPPORTED  v0.1 이 "이건 됩니다" 라고 약속하는 범위
> ```
>
> **저장소가 열린다는 사실은 출시 지원 약속이 아니다.**

| 층 | 무엇 | 실행 관측 | 화면 증거 | Test/Build |
|---|---|---|---|---|
| **FULL — v0.1 출시 지원** (PM 결정) | **경계 하나짜리 로컬 웹 애플리케이션 · 로컬 실행/dev 명령을 발견할 수 있는 것.** 프레임워크 중립 (Next · Vite · React · Vue · Svelte · 정적 · 동등물) | ✅ | ✅ 라우트 단위 | ✅ 있으면 |
| **BEST-EFFORT / EXPERIMENTAL** | 백엔드 / API | ✅ | ⛔ `UNKNOWN` | ✅ 있으면 |
| | CLI 도구 | ✅ | ⛔ `UNKNOWN` | ✅ 있으면 |
| | 라이브러리 / SDK | ⛔ 스스로 실행되지 않는다 | ⛔ `UNKNOWN` | ✅ 테스트가 유일한 증거 |
| **NOT v0.1 RELEASE SUPPORTED** | 데스크톱 · 모바일 앱 자동화 | ⛔ | ⛔ | — |
| | 모노레포 / 복수 Software 경계 | ⛔ | ⛔ | — |
| **OPENABLE (약속 아님)** | 이해 못 한 저장소 | ⛔ | ⛔ | ⛔ |
| | | **몸은 그린다. 안은 `모름`.** 열린다는 것이지 지원한다는 것이 아니다 | | |

> Canon §12 는 CLI · SDK · 컴파일러 · 인프라 · 게임을 **전부 통과시켰다.**
> 막히는 것은 표상이 아니라 **증거**다. 그래서 **열리는 범위는 넓고 약속하는 범위는 좁다.**

---

## 5. 주장과 측정은 **다른 테이블**이다 (A1b 정정)

A1a 는 `claim_source` 컬럼 하나로 한 테이블 안에서 구분했다. **PM 이 이것을 기각했다.**
같은 테이블에 있으면 언젠가 조인 한 번, `UPDATE` 한 줄로 섞인다.

```
AgentEvent / AgentClaim   에이전트가 '말한 것'.   검증 진실이 아니다
Evidence                  JuQode 가 '측정한 것'.  PASS / FAIL / UNKNOWN
```

| | |
|---|---|
| `Evidence` 는 무엇인가 | **검증 시도와 그 결과**다. 에이전트의 문장이 아니다 |
| `claim_source` 컬럼 | **삭제한다.** Evidence 행은 전부 측정된 것이다 |
| 에이전트의 말은 | **설명에 쓸 수 있다** — Outcome 문장의 재료 |
| 그러나 | **절대 검증 진실이 될 수 없다** |

주장을 Evidence 로 승격하려면 **행을 새로 써야 하고, 그러려면 측정이 있어야 한다.**

---

## 6. 미결

- 어떤 스택까지 실제로 관측되는지는 **구현해 봐야 안다**
- **실행 중 외부 동시 편집**은 JuQode 것으로 귀속하지 않는다 — 소유권 `UNKNOWN` (A1-13 HARD RULE)
- 스크린샷을 어떤 시점에 어떤 라우트에서 찍는지는 미설계
