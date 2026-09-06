# A1 · Agent Event Schema — PROPOSED

> ## 📜 SUPERSEDED / HISTORICAL
>
> | | |
> |---|---|
> | **Status** | **SUPERSEDED / HISTORICAL** |
> | **Superseded By** | [`AGENT_EVENT_SCHEMA.md`](AGENT_EVENT_SCHEMA.md) — **현재 기준은 그쪽이다** |
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

## 1. 이 스키마의 목적은 데이터가 아니라 강제다

> **D-014 — Agent Event 를 구조화해서 저장하고, Visual 은 그것을 렌더링한 결과일 뿐이다.**
> **Event 없이 움직이는 Visual 을 만들 수 없게 구조로 강제한다.**

스키마가 없으면 이 강제가 불가능하고, 화면은 다시 **연출**이 된다.

---

## 2. 봉투 + payload (PROPOSED)

```
AgentEvent
├─ id
├─ execution_id   →  실행에 붙는다. Qode 가 아니다
├─ seq            →  실행 안에서 단조 증가. 재생이 결정적이다
├─ ts
├─ type           →  agent.started | file.read | file.edited | command.run | agent.finished ...
├─ payload        →  JSON. 도구마다 다른 것만 여기 (생성컬럼으로 인덱싱 가능)
└─ raw_ref        →  원본 스트림. 필수 경로다
```

> ### A1b — 이 표는 귀속(attribution)의 근거이기도 하다
>
> 실행 중 저장소가 변했는데 **그 경로가 Agent Event 에 나타나지 않으면
> 그 변경은 JuQode 의 것이 아니다.** 소유권은 `UNKNOWN` 이고,
> **화해되기 전까지 `SETTLED` 가 될 수 없다.**
> A1a 는 *"스냅샷 이후의 차이는 전부 JuQode 의 것"* 이라고 적었다 — **사용자가 그 사이 편집할 수 있으므로 거짓이다.**

| 무엇을 컬럼으로 올리는가 | 왜 |
|---|---|
| `seq` · `ts` · `type` | 질의하고 정렬하고 재생해야 한다 |
| `execution_id` | 참조 무결성 |
| 나머지 | 도구마다 모양이 다르다 → JSON |

---

## 3. 실측이 찾은 것 — 에이전트는 JSON 만 뱉지 않는다

실제로 자식 프로세스를 띄워 확인했다.

```
구조화 이벤트   5줄
파싱 실패      1줄  ← "이건 JSON 이 아니다 — 에이전트는 사람 말도 섞어 뱉는다"
stderr        1줄
```

> **파싱 실패한 줄을 버리면 D-010(Raw 는 삭제하지 않는다) 위반이다.**
> `raw_ref` 는 선택 항목이 아니라 **필수 경로**이고, 파싱 실패 줄과 stderr 도 원본 스트림에 그대로 보존한다.

---

## 4. 몸의 움직임과의 계약

| Event | 몸에서 무슨 일이 일어나는가 | 근거 |
|---|---|---|
| `agent.started` | 대상 자리가 **DISTURBED** — **그 자리만** 흔들린다 | L3 · 전역 스피너 없음 |
| `file.edited` | 해당 자리의 질량/결이 갱신된다 | L1 |
| `command.run` | 실행 중 표시 — **진행률 없음** | No Fake Motion |
| `agent.finished` | **SETTLING.** 아직 `SETTLED` 가 아니다 | E2 — 증거만이 바꾼다 |
| **이벤트 없음** | **화면은 완전히 고요하다** | D-014 |

> ### ⚠ A1b.1 정정 — A1b 의 "유휴 0 프레임" 주장은 틀렸다
>
> A1b 의 커밋된 원본은 **유휴 96 프레임**이었고 `canon_check` 에 ⚠ 가 붙어 있었다.
> **산문이 자기 증거를 배반했다.**

**A1b.1 재측정 — TRUE IDLE 을 다시 정의하고 쟀다.**

> **TRUE IDLE** = 정당한 전이/가라앉음이 전부 끝나고(연속 1,000ms 무프레임 확인)
> 새 제품 사건이 없는 상태. **고정 시간을 기다리지 않고 정지를 기다린 뒤 잰다.**

| 방법 | Electron 44.2.0 · 유효한 런 3회 |
|---|---|
| **TRUE IDLE** (9초 창) | **0 · 0 · 0 프레임** |
| **결과 이후 TRUE IDLE** (6초 창) | **0 · 0 · 0 프레임** |
| **A1b 방법 재현** (전이 뒤 고정 1,500ms) | **90 · 90 · 90 프레임** |

**판정: TRUE IDLE 은 0 에 도달한다. D-014 는 유지된다.**
**A1b 의 96 은 측정 방법 오류였다** — 가라앉음이 최대 2,750ms 까지 살아 있는데
1,500ms 만 기다리고 그 다음을 유휴라고 불렀다. 90 프레임으로 재현했다.

> **함정:** 창이 가려지면 Chromium 이 rAF 를 통째로 억제해 모든 값이 0 이 된다.
> 그것을 "고요함" 으로 읽으면 **반대 방향의 같은 거짓말**이다.
> 그래서 활성 상태가 실제로 60fps 인 런만 채택했다.

> 금지: 진행률 막대 · 퍼센트 · 스피너 · Agent 아바타 · "일하는 척" 연출.

---

## 5. 미결

- `type` 어휘의 최종 목록 — 실제 에이전트 출력을 보고 정해야 한다
- 이벤트 폭주(초당 수백 줄) 시의 표본 추출 정책. **단 원본은 항상 전부 보존한다**
