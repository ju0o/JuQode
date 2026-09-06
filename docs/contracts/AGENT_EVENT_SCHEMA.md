# Agent Event Schema — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_AGENT_EVENT_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. 목적은 데이터가 아니라 강제다

> **Agent Event 를 구조화해서 저장하고, Visual 은 그것을 렌더링한 결과일 뿐이다.**
> **Event 없이 움직이는 Visual 을 만들 수 없게 구조로 강제한다.**

---

## 2. 봉투

```
AgentEvent
├─ id
├─ execution_id   →  실행에 붙는다. Qode 가 아니다
├─ seq            →  실행 안에서 단조 증가. 재생이 결정적이다
├─ ts
├─ type           →  agent.started | file.read | file.edited | command.run | agent.finished ...
├─ payload        →  JSON. 도구마다 다른 것만 (생성컬럼으로 인덱싱 가능)
└─ raw_ref        →  원본 스트림. 필수 경로다

AgentClaim        →  에이전트가 '말한 것'. 검증 진실이 아니다
```

> **에이전트는 JSON 이 아닌 사람 말도 섞어 뱉는다.**
> **파싱 실패한 줄과 stderr 도 원본 스트림에 그대로 보존한다** — 버리면 Raw 보존 규칙 위반이다.

---

## 3. 귀속(attribution)의 근거이기도 하다

실행 중 저장소가 변했는데 **그 경로가 Agent Event 에 나타나지 않으면
그 변경은 JuQode 의 것이 아니다.**

```
소유권 = UNKNOWN  →  화해되기 전까지 SETTLED 가 될 수 없다
```

**"스냅샷 이후의 차이는 전부 JuQode 의 것" 이라고 주장하지 않는다** — 사용자가 그 사이 편집할 수 있다.

---

## 4. 몸의 움직임과의 계약

| Event | 몸에서 | 근거 |
|---|---|---|
| `agent.started` | 대상 자리가 **DISTURBED** — **그 자리만** 흔들린다 | 전역 스피너 없음 |
| `file.edited` | 해당 자리의 질량/결이 갱신된다 | L1 |
| `command.run` | 실행 중 표시 — **진행률 없음** | No Fake Motion |
| `agent.finished` | **SETTLING.** 아직 `SETTLED` 가 아니다 | 증거만이 바꾼다 |
| **이벤트 없음** | **화면은 완전히 고요하다** | D-014 |

**실측:** 실제 정지 이후 **TRUE IDLE 에서 앱이 요청한 프레임은 0** 이었다.

> 금지: 진행률 막대 · 퍼센트 · 스피너 · Agent 아바타 · "일하는 척" 연출.

---

## 5. 미결

- `type` 어휘의 최종 목록 — 실제 에이전트 출력을 보고 정한다 (**R1**)
- 이벤트 폭주 시의 표본 추출 정책. **단 원본은 항상 전부 보존한다**
