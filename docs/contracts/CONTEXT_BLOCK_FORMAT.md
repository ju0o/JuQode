# Context Block Format — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_CONTEXT_BLOCK_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. Context 는 Core Product Primitive 다

사용자가 시간을 들여 쌓는 **자산**이며 그 품질이 결과 품질을 직접 결정한다.

> **Context 가 제품 모델에서 빠지면 JuQode 는 "Agent 실행기"가 된다.**

---

## 2. v0.1 필수 5필드

```
id        ★  안정된 식별자
version   ★  History / Sync / Restore 의 전제
scope     ★  LOCAL | PERSONAL | PORTABLE | VAULT
origin    ★  USER | EXTRACTED | IMPORTED | PACK
portable  ★  Cloud 를 막지 않기 위한 플래그
```

**이 다섯이 없으면 나중에 Cloud / History / 승인 UX 를 붙일 수 없다.**

---

## 3. 현재 본문의 주인은 하나다

**본문은 오직 `ContextVersion` 에만 산다.** `ContextBlock` 은 `current_version` 으로 가리킬 뿐이다.
전문 검색(FTS)도 **버전 테이블**에 붙는다.

> 주인이 둘인 "현재 본문" 은 반드시 갈라진다.

---

## 4. Export 형식 — 사람이 읽을 수 있어야 한다

**Export 는 절대 유료화하지 않는다.** 사용자가 자기 Context 를 언제든 밖으로 가져갈 수 있어야 한다.

```markdown
---
id: ctx_7f3a
version: 3
scope: LOCAL
origin: USER
portable: false
name: 인증 방식
---

Supabase Auth 를 쓴다. Google OAuth 를 쓰고 Callback 은 /auth/cb 다.
```

| 왜 이 형식인가 | |
|---|---|
| frontmatter + 본문 | 필수 필드는 기계가, 본문은 사람이 읽는다 |
| Markdown | 사용자가 이미 아는 형식 |
| 한 블록 = 한 파일 | Import/Export 가 파일 복사만큼 단순하다 |

> **⚠ 이것은 경계에서의 형식이지 저장 형식이 아니다.**
> Context 를 **긴 Markdown 파일 하나**(`CLAUDE.md` 스타일)로 두는 것은 금지되어 있다.

---

## 5. `reason` 은 선택이 아니다

Queue 에 들어간 각 Context 는 **왜 포함됐는지**를 기록한다.

> `reason` 이 없으면 **"왜 이렇게 했어?"** 에 답할 수 없다.

---

## 6. 자동 생성분은 승인 없이 활성화하지 않는다

`approved` 플래그. **"JuQode 가 알아낸 것"과 "사용자가 승인한 것"은 구분되어야 한다.**
(v0.1 은 사용자 직접 생성만. 추출·Import·Pack 은 V1)

---

## 7. 미결

- Scope 충돌 해소 규칙의 구체 형태 — *"충돌이 발생하면 조용히 덮지 않는다"* 만 정해져 있다
- **`04` §7 성공기준 6** (Context 가 파일 복사보다 편한가) — **QA 에서만 판정된다**
