# A1 · Qode Runtime — PROPOSED

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

## 1. Qode 와 Execution 은 같은 것이 아니다 (PROPOSED)

```
Qode        의도 + 대상(자리) + 준비된 Context/Skill
Execution   한 번의 시도. kind ∈ { QODE, RUN }
```

**분리의 근거는 "미래의 병렬 작업"이 아니다.** 병렬은 v0.1 밖이다.
근거는 **v0.1 안에 이미 있는 두 가지 사실**이다.

| # | v0.1 안의 사실 | 하나의 엔티티면 무엇이 깨지는가 |
|---|---|---|
| **1** | **`RUN` 은 Qode 가 아니다** — 관측이며 증거와 교란을 만든다 | RUN 이 **가짜 Qode 를 만들어야 한다** → *"행동은 섞이지 않는다"* 위반 |
| **2** | **되돌리기의 되돌리기** 가 보장된다 | 한 번의 되돌리기에 **복원 지점 두 개**가 필요하다. 그것은 의도가 아니라 **시도**에 붙는다 |

> `RUN` 실행은 `qode_id` 가 **NULL** 이다. 그것이 두 행동이 안 섞였다는 증거다.

---

## 2. 상태 흐름은 Canon 그대로다

```
SETTLED ── Qode 시작 ─→ DISTURBED ── 실행 완료 ─→ SETTLING ──증거──→ SETTLED′
   ↑                        │                          │
   │                        │ 실행 실패                 └──────────→ UNKNOWN
   └── 이전 평형으로 ────── UNSETTLED
```

> **증거만이 `SETTLING` 을 `SETTLED` 로 바꾼다. 시간 경과로는 안 된다.**
> 이것을 스키마로 강제한다 — 에이전트의 **주장(`AGENT_CLAIM`)은 `SETTLED` 를 만들 수 없다.**

---

## 3. 실행 경계 (PROPOSED)

```
신뢰 런타임
   │ ① Qode 직전 스냅샷을 뜬다 (사용자 상태 불변)
   │ ② 에이전트를 자식 프로세스로 띄운다
   ▼
에이전트 프로세스 (격리)
   cwd = 프로젝트 루트 · env 상속 없음
   stdout 은 데이터로만 취급 — 절대 명령으로 해석하지 않는다
   취소 가능 · 부모와 함께 죽는다
```

**실측:** 자식 프로세스 + 줄단위 JSON 스트리밍이 성립한다.
그리고 **에이전트는 JSON 이 아닌 사람 말도 섞어 뱉는다** — 파싱 실패 줄을 버리면 D-010 위반이다.
→ 원본 스트림을 통째로 보존한다.

---

## 4. Provider 경계 — 왜 두는가

v0.1 은 Provider 가 **하나**다. 그런데도 얇은 이음매를 두자고 제안한다.
**근거는 미래 확장이 아니라 측정 가능성이다.**

> 실제 에이전트는 매번 다른 결과를 낸다.
> 그러면 QA 에서 **측정하는 것이 제품인지 그날의 에이전트인지 알 수 없다.**

```
start(qode, workdir, context) → 이벤트 스트림
cancel(execution)
```

**그 이상은 v0.1 에서 정의하지 않는다.** 모델 선택 · 토큰 · 프롬프트 형식은 이음매 밖이다.

---

## 5. 되묻기는 두 조건에서만

| 발동 조건 | 무엇으로 판정하는가 |
|---|---|
| 행동이 **경계를 넘는다** | `reversibility ∈ {irreversible, destructive}` |
| **대상 자리가 모호하다** | 지배력 계산에서 상위 두 자리의 세기 차가 임계 이하 |

그 외에는 묻지 않는다. 가정한 것은 결과의 `확인할 것` 에 **초과 변경과 분리해서** 쌓인다.

> **확인 모달 남발은 실패다.** 되물음의 가치는 희소성에서 나온다.
