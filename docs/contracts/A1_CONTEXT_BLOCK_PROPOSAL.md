# A1 · Context Block Format — PROPOSED

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


> ## 🔄 A1b 개정 — PM 판정 반영
>
> A1a 는 **PASS** 했다. 이 문서는 그 뒤 PM 이 지시한 정정을 반영한 판이다.
> **여전히 `PROPOSED` 이며 아무것도 동결되지 않았다.**

---

## 1. Context 는 Core Product Primitive 다

Bonus 도 P2 도 아니다. **사용자가 시간을 들여 쌓는 자산**이며, 그 품질이 결과 품질을 직접 결정한다.

> **Context 가 제품 모델에서 빠지면 JuQode 는 "Agent 실행기"가 된다.**

---

## 2. v0.1 필수 5필드 — 없으면 나중에 못 붙인다

```
id        ★  안정된 식별자
version   ★  History / Sync / Restore 의 전제
scope     ★  LOCAL | PERSONAL | PORTABLE | VAULT
origin    ★  USER | EXTRACTED | IMPORTED | PACK
portable  ★  Cloud 를 막지 않기 위한 플래그
```

**Cloud Sync 를 v0.1 에서 구현하지 않더라도 이 다섯이 없으면 나중에 Cloud / History / 승인 UX 를 붙일 수 없다.**

---

## 3. Export 형식 (PROPOSED) — 사람이 읽을 수 있어야 한다

D-024: **Export 는 절대 유료화하지 않는다.** 사용자가 자기 Context 를 언제든 밖으로 가져갈 수 있어야 한다.
그래서 형식은 **사람이 읽고 손으로 고칠 수 있어야** 한다.

```markdown
---
id: ctx_7f3a
version: 3
scope: LOCAL
origin: USER
portable: false
vault: false
name: 인증 방식
tags: [auth, supabase]
---

Supabase Auth 를 쓴다. Google OAuth 를 쓰고 Callback 은 /auth/cb 다.
```

| 왜 이 형식인가 | |
|---|---|
| frontmatter + 본문 | 필수 5필드는 기계가 읽고 본문은 사람이 읽는다 |
| Markdown | 사용자가 이미 아는 형식. 새로 가르치지 않는다 |
| 한 블록 = 한 파일 | Import/Export 가 파일 복사만큼 단순하다 |

> ### ⚠ A1b 정정 — "현재 본문"의 주인은 하나여야 한다
>
> A1a 의 스키마는 `context_block.body` 와 `context_version.body` 를 **둘 다** 두었다.
> **주인이 둘인 현재 본문은 반드시 갈라진다.**
>
> **본문은 오직 `ContextVersion` 에만 산다.** `ContextBlock` 은 `current_version` 으로 가리킬 뿐이다.
> 전문 검색(FTS)도 **버전 테이블**에 붙는다.

> **⚠ 주의 — 이것이 저장 형식이라는 뜻이 아니다.**
> 저장은 관계 질의가 필요하다. 이것은 **경계에서의 형식**이다.
> Context 를 **긴 Markdown 파일 하나**(`CLAUDE.md` 스타일)로 두는 것은 명시적으로 금지되어 있다.

---

## 4. 왜 포함됐는가 — `reason` 은 선택이 아니다

Queue 에 들어간 각 Context 는 **왜 포함됐는지**를 기록한다.

> `reason` 이 없으면 **"왜 이렇게 했어?"** 에 답할 수 없다.
> Context 가 **보이는 인과관계**를 가져야 사용자가 Context 를 신뢰하고 관리한다.

---

## 5. 자동 생성분은 승인 없이 활성화하지 않는다

`approved` 플래그. **"JuQode 가 알아낸 것"과 "사용자가 승인한 것"은 구분되어야 한다.**
(v0.1 은 사용자 직접 생성만. 추출·Import·Pack 은 V1)

---

## 6. 미결

- Scope 충돌 해소 규칙의 구체 형태 — *"충돌이 발생하면 조용히 덮지 않는다"* 만 정해져 있다
- Import 검증 (외부에서 온 Context 를 어디까지 믿는가) → 보안 문서 참조
