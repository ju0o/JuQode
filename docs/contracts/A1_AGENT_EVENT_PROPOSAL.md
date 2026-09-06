# A1 · Agent Event Schema — PROPOSED

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

> 금지: 진행률 막대 · 퍼센트 · 스피너 · Agent 아바타 · "일하는 척" 연출.

---

## 5. 미결

- `type` 어휘의 최종 목록 — 실제 에이전트 출력을 보고 정해야 한다
- 이벤트 폭주(초당 수백 줄) 시의 표본 추출 정책. **단 원본은 항상 전부 보존한다**
