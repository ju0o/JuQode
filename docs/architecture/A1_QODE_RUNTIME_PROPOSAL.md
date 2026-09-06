# A1 · Qode Runtime — PROPOSED

> ## 📜 SUPERSEDED / HISTORICAL
>
> | | |
> |---|---|
> | **Status** | **SUPERSEDED / HISTORICAL** |
> | **Superseded By** | [`QODE_RUNTIME.md`](QODE_RUNTIME.md) — **현재 기준은 그쪽이다** |
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

> ## ⚠ A1b 정정 — 이 그림은 보안 경계가 아니다
>
> A1a 는 `cwd` 고정과 `env` 제거를 격리처럼 적었다. **실측이 그것을 반증했다.**
> 같은 구성에서 가짜 악성 자식 프로세스는 **`../` 쓰기 · 심링크 탈출 · 무시된 `.env` 조용한 수정 ·
> 사용자 git ref 생성 · `.git/index` 삭제 · `cd /` 를 전부 성공시켰다.**
> **막힌 것은 환경변수 누출 하나뿐이다.**
>
> **강제는 Provider 권한 계층에서 한다** → `security/A1_LOCAL_SECURITY_PROPOSAL.md`
> 위 그림은 **위생(hygiene)**이지 경계가 아니다.

---

## 4. Provider 경계 — 왜 두는가

v0.1 은 Provider 가 **하나**다. 그런데도 얇은 이음매를 두자고 제안한다.
**근거는 미래 확장이 아니라 측정 가능성이다.**

> 실제 에이전트는 매번 다른 결과를 낸다.
> 그러면 QA 에서 **측정하는 것이 제품인지 그날의 에이전트인지 알 수 없다.**

```
probe()    이 기계에서 쓸 수 있는가 · 권한 계층이 실제로 걸렸는가
start()    Qode 를 시작한다
cancel()   취소한다
events()   구조화된 이벤트 스트림
```

**구현체는 정확히 둘이다 — `ClaudeCodeAdapter` · `MockAgentAdapter`.**
**레지스트리도 플러그인 체계도 만들지 않는다.**

**모델 / Provider 설정 UI 를 노출하지 않는다.** 사용자에게 그것은 존재하지 않는 개념이다 (원칙 4).

---

## 5. 되묻기는 두 조건에서만

기본값은 **`근거 있는 가정으로 진행한다`(PROCEED WITH GROUNDED ASSUMPTION)** 이다.

| 발동 조건 | 무엇으로 판정하는가 |
|---|---|
| ① 행동이 **경계를 넘는다** | `reversibility ∈ {irreversible, destructive}` |
| ② **대상이 실질적으로 모호하다** | 아래의 합성 신뢰도 |
| ③ **본질적인 제품/아키텍처 선택인데 근거 있고 되돌릴 수 있는 기본값이 저장소·맥락에 없다** | 선례가 없다 (A1b 신설) |

> **A1b 정정 — 가리킴의 세기만으로 판정하지 않는다.**
> ```
> 대상 신뢰도 = Point(가리킴) + Intent(말) + 지금의 관측 + Context + 저장소 사실
> ```
> 다섯 중 하나만 강해도 대상은 정해질 수 있다. **합이 낮을 때만 되묻는다.**
> **자리를 집지 않은 Whole-Software Say 는 그대로 유효하다.**

그 외에는 묻지 않는다. 가정한 것은 결과의 `확인할 것` 에 **초과 변경과 분리해서** 쌓인다.

> **확인 모달 남발은 실패다.** 되물음의 가치는 희소성에서 나온다.
