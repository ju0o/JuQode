# Qode Runtime — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_QODE_RUNTIME_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

---

## 1. Qode ≠ Execution

```
Qode        사용자 의도 + 대상(자리) + 준비된 맥락
Execution   한 번의 실제 시도.  kind ∈ { QODE, RUN }
```

> ## **`RUN` 은 Qode 를 만들지 않는다.**
> RUN 실행은 `qode_id` 가 **NULL** 이다 — 두 행동이 안 섞였다는 증거다.

**분리의 근거는 미래의 병렬 작업이 아니다.** v0.1 안에 이미 둘이 있다.

| # | v0.1 안의 사실 | 하나의 엔티티면 무엇이 깨지는가 |
|---|---|---|
| 1 | **`RUN` 은 Qode 가 아니다** — 관측이며 증거와 교란을 만든다 | RUN 이 **가짜 Qode 를 만들어야 한다** |
| 2 | **되돌리기의 되돌리기** 가 보장된다 | 복원 지점 둘이 **의도가 아니라 시도**에 붙는다 |

---

## 2. 상태 모델

```
SETTLED ── Qode 시작 ─→ DISTURBED ── 실행 완료 ─→ SETTLING ──증거──→ SETTLED′
   ↑                        │                          │
   │                        │ 실행 실패                 └──────────→ UNKNOWN
   └── 이전 평형으로 ────── UNSETTLED
```

> **증거만이 `SETTLING` 을 `SETTLED` 로 바꾼다. 시간 경과로는 안 된다.**
> **에이전트의 주장은 절대 Software 를 평형으로 만들 수 없다.**

---

## 3. 실행 경계

```
Trusted Local Runtime
   │ ① Qode 직전 안전 스냅샷 (트리 둘)
   │ ② 어댑터를 통해 에이전트를 띄운다
   ▼
Claude Code
   ├─ Permission Enforcement   (DEFAULT DENY)
   └─ Built-in OS Sandbox      (필수)
```

> **부모 프로세스의 `cwd` · `env` 제한은 위생이지 보안 경계가 아니다.**
> 강제는 Provider 계층이 한다 → `../security/LOCAL_SECURITY.md`

**에이전트의 stdout 은 데이터로만 취급한다. 절대 명령으로 해석하지 않는다.**
**파싱 실패한 줄도 버리지 않는다** — 에이전트는 사람 말도 섞어 뱉는다.

---

## 4. Agent 경계

```
probe()    이 기계에서 쓸 수 있는가 · 권한/샌드박스가 실제로 걸렸는가
start()    Qode 를 시작한다
cancel()   취소한다
events()   구조화된 이벤트 스트림
```

| | |
|---|---|
| **어댑터** | **정확히 둘 — `ClaudeCodeAdapter` · `MockAgentAdapter`** |
| **목적** | **결정적 제품 QA 와 런타임 경계** |
| **만들지 않는 것** | 레지스트리 · Provider UI · 다중 Provider UX · 모델 설정 UI |

> `probe()` 가 **R1 Gate** 다 — 샌드박스와 권한이 실제로 걸렸음을 실행 전에 확인한다.

---

## 5. 되묻기 — 기본은 근거 있는 가정으로 진행

| 되묻는 경우 | 판정 |
|---|---|
| ① 행동이 **비가역 / 파괴적** | `reversibility ∈ {irreversible, destructive}` |
| ② **대상이 실질적으로 모호** | Point + Intent + 지금의 관측 + Context + 저장소 사실의 **합** |
| ③ **본질적 선택인데 근거 있고 되돌릴 수 있는 기본값이 없다** | 저장소·맥락에 선례가 없다 |

> **가리킴의 세기만으로 판정하지 않는다.**
> **자리를 집지 않은 Whole-Software Say 는 유효하다.**
> 그 외에는 묻지 않는다. 가정한 것은 결과의 `확인할 것` 에 **초과 변경과 분리해서** 쌓인다.
>
> **확인 모달 남발은 실패다.** 되물음의 가치는 희소성에서 나온다.
