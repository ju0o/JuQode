# JuQode

> ## Developers Code. Vibe Coders Qode.

```
Question  →  Quest  →  Queue  →  Quick  →  Qode
```

**JuQode is a Software Creation Interface, not an IDE.**

전통적인 개발자는 Code를 읽고, 이해하고, 직접 수정한다.
바이브 코더는 Code를 읽기보다 AI에게 반복적으로 묻는다.

> "이게 뭐야?" · "왜 안 돼?" · "이거 해줘." · "어디가 바뀌었어?" · "문제 없어?" · "다 됐어?"

그 행위는 Code가 아니다. 그것을 **Qode**라고 부른다.

---

## What "Q" means

| Q | 의미 |
|---|---|
| **Question** | Qode는 질문에서 시작한다 |
| **Quest** | 모든 개발은 해결해야 하는 문제와 목표다 |
| **Queue** | 현재 Quest에 필요한 Context와 Skill만 compact하게 담는다 |
| **Quick** | Quest를 빠르게 해결한다 |
| **Qode** | 위 전체가 하나의 행위가 된다 |

---

## 이 저장소의 역할

**이 저장소는 JuQode의 Code 저장소다.**

| Repository | 현재 상태 | 담는 것 |
|---|---|---|
| **JuQode** (이 repo) | 현재 Private | **Code / 구현**, 코드와 함께 사는 기술 명세 · Format Spec |
| JuQode-Private | Private | **Markdown / 기획** — Strategy · PRD · UX · Roadmap |

분리 기준은 공개/비공개가 아니라 **Code vs 기획**이다.
Product 정의 · UX 설계 · 사업 관련 문서는 이 저장소에 두지 않는다.

향후 Open Source로 전환될 수 있으나, 그 시점의 점검 항목은
`JuQode-Private/docs/00_PROJECT_CHARTER.md` §2에 정의되어 있다.

---

## Status

**현재: Phase 3 — Lovable Functional Prototype. 첫 인터랙티브 코드가 있다.**

Product Planning은 **동결(Planning Freeze)** 되었다.

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | Product SSOT | ✅ 완료 |
| 1 | Visual Product Planning | ✅ 완료 |
| 1.5 | **Planning Freeze** | ✅ 완료 |
| 2 | Primary Interface Design | ✅ 완료 |
| 2.5 | Lovable Handoff | ✅ 완료 |
| **3** | **Lovable Functional Prototype** | **진행 중 → [`prototype/`](prototype/)** |
| 4 | MVP Architecture Freeze | 대기 ← **기술 명세가 여기서 나온다** |
| 5 | Supabase / Data Layer | 대기 |
| 6 | First Qode Real Integration | 대기 ← **코드가 여기서 실제로 동작한다** |
| 7 | QA / Dogfood | 대기 |
| **v0.1** | **First Qode MVP Release** | — |

v0.1 이후의 V1 / V2 / Later는 별도 Roadmap으로 계속된다.

**순서가 고정된 이유:** Design → 기능적 인터랙션 Prototype → Architecture Freeze
→ Data Layer → 실제 Agent 통합 → QA → Release.
Backend / Data Architecture가 UX를 끌고 가기 전에 실제 제품 인터랙션을 검증한다.

→ [prototype/README.md](prototype/README.md) · [docs/README.md](docs/README.md)

**`prototype/`** — 인터랙션 검증용 프론트엔드 프로토타입. 빌드 없이 `index.html`을 열면 된다.
Backend · DB · Git · 실제 Coding Agent 없음. Working / Result는 시뮬레이션이다.

---

## What JuQode is not

JuQode를 다음 중 하나로 축소하지 않는다.

- Claude Code GUI
- 쉬운 VS Code
- Context Manager 앱
- Git GUI
- Agent Animation 앱
- Visual Diff Tool

각각은 JuQode의 일부가 될 수 있지만, JuQode 자체는 아니다.
