# SPEC_RECONCILE — X-1 판정 기록

> **Owner/PM 판정 2026-09-13.** 대상: `2026-09-13_0226_WBS_REMAINING.md`
> 판정 = **조건부 승인.** 아래가 계획에 반영되기 전에는 광범위한 V1 구현을 시작하지 않는다.
> 이 문서는 **판정의 기록**이다. 판정을 만들지 않는다 — 받은 것을 적고, 그것이 어느 파일의
> 어느 줄을 바꾸는지만 잇는다.

---

## 1. X-1 — 여섯 건 전부 판정됨

원래 질문: `BACKEND_A.md` §3(09-12 10:17 · 서버 3표)과 `erd.dbml`(09-12 11:41 · 서버 21표)이
서로 다른 서버를 그린다. 어느 쪽이 맞나.

| # | 쟁점 | **판정** | 근거 | 반영 작업 |
|---|---|---|---|---|
| **a** | 서버 3표 vs 21표 | **ERD** | 리뷰를 통과한 21표 모델이 설계 목표다 | X-2 · X-7 · P1-2 |
| **b** | `usage_day` 칸 1개 vs 3개 | **A안** | 제품의 활성 하루 상한은 **`works` 하나**다 | X-7 · P2-5 |
| **c** | 멱등 키 | **ERD · 필수** | 재시도가 상한을 두 번 먹어서는 안 된다 | X-2 · P1-3 · P3-6 |
| **d** | 장치 신뢰 경계 | **ERD** | 남의 계정 장치를 댄 요청은 거부된다 | X-2 · P1-3 · P3-6 |
| **e** | `policy` 오버라이드 컬럼 | **A안** | D-A3 의 「상한 하나」 제품 계약이 이긴다 | X-7 · P1-2 |
| **f** | `plan.narrative_engine = none` | **A안** | 서버 등급이 **사용자 자기 Claude 능력**을 가르지 않는다 | X-7 · P1-2 · P1-7 |

### 판정문 그대로

- **a** — "Use the reviewed 21-table server model as the design target. First reconcile
  BACKEND_A.md and WBS_IMPLEMENTATION.md. **Do not start P1-2 against the stale 3-table text.**"
- **b** — "The Product has ONE active daily quota: **works**. Do NOT create separate Product
  quota semantics for `qc_runs` / `narrative_calls`. If usage/audit observability needs their
  kinds, `audit_usage` may record them, but they are **not separate user-facing plan limits**."
- **c** — "Keep `(device_id, kind, client_ref)` UNIQUE. **Retry must not consume quota twice.**"
- **d** — "A client-supplied device belonging to another account **must be rejected**."
- **e** — "D-A3's single-limit Product contract wins. Do not put **unused speculative**
  quota/engine override fields into the active V1 production schema merely because the ERD
  currently contains them. Reconcile ERD to the approved Product meaning."
- **f** — "DO NOT disable Project Interpretation narrative based on Free/Paid plan when
  narration runs through the user's own Claude subscription. The server plan does not gate the
  user's own Claude capability. If JuQode later provides hosted inference, that is a separate
  future Product decision."

---

## 2. 판정을 스키마로 옮긴 것 — **확인 요청 3건**

판정문은 제품 의미를 정했다. 컬럼 단위로 옮기려면 한 걸음이 더 필요하고, 그 걸음은 해석이다.
**아래는 적용 예정안이고, 틀렸다면 X-7 착수 전에 잡아야 한다.**

### 확인 ① — `policy` 에서 무엇이 「투기적」인가 (X-1e)

| 컬럼 | 적용 예정 | 왜 |
|---|---|---|
| `daily_work_limit_override` | **남긴다** | 투기적이지 않다. 관리자 수동 조정 경로이고 P1-4 · P1-7 이 이것을 잰다. D-A3 의 「상한 하나」가 바로 이 상한이다 |
| `narrative_engine_override` | **뺀다** | X-1f 가 서술층 등급 제어를 폐기했다 — 오버라이드할 대상이 없다 |
| `allow_file_edit` · `allow_terminal` · `allow_deploy` | **뺀다** | D-A3 가 V2~V3 로 미룬 것. 아무도 읽지 않는 컬럼이다 |

> `allow_*` 셋은 **`plan` 에도** 있다 (`plan.allow_terminal`). 같은 이유로 뺀다.

### 확인 ② — `usage_day` 의 칸 (X-1b)

적용 예정: **`usage_day` = `(user_id, day)` + `works` + `updated_at`.**
`qc_runs` · `narrative_calls` 컬럼은 **뺀다** — 제품 상한이 아닌데 칸을 두면 다음 사람이
상한으로 읽는다. 종류별 관측은 `audit_usage.kind`(`work` · `qc` · `narrative`)가 그대로 한다.
`audit_kind` 룩업은 **셋 다 남는다** — 판정문이 "audit_usage may record them" 이라고 적었다.

### 확인 ③ — `plan` 에서 서술 관련 칸 (X-1f)

적용 예정: `plan.narrative_engine` · `plan.monthly_narrative_calls` · 룩업 `engine` 표를
**V1 프로덕션 스키마에서 뺀다.** 호스팅 추론은 별도 제품 결정이므로, 그때 다시 들어온다.

**뺀 결과 21표 → 19표** (`engine` 룩업 1 + …). 정확한 수는 X-7 이 `check-dbml.mjs` 로 확정한다.

---

## 3. 마이그레이션 번호 — 확정

| 버전 | 내용 | 작업 | 언제 |
|---|---|---|---|
| 1 | `schema.sql` 26표 seed | — | 적용됨 |
| 2 | `change_group.source_ref` | — | 적용됨 |
| 3 | `quick_command_rule` +2행 | — | 적용됨 |
| **4** | 프로세스 추적 (`app_session` + `runner_*`) | **X-6** | **MVP 인증 전** |
| **5** | `project.owner_id` + `unique(owner_id, path)` | **P1-5** | V1 |

**번호는 재사용하지 않는다.** 반영해야 할 곳: `ERD.md` §2 ✅ · `WBS_REMAINING.md` ✅ ·
`BACKEND_A.md` §4② (아직 "마이그레이션 3" 이라고 적혀 있다 — X-2 가 고친다).

---

## 4. 나머지 판정 넷

| | 판정 | 반영 |
|---|---|---|
| **M-3 순서** | **승인 — 도그푸드가 R 트랙보다 먼저.** 비개발자의 실제 오해가 R 의 1차 입력이다. 첫 도그푸드 참가자는 **고치기 전 R-10 코호트**를 겸할 수 있다. **P4-4 는 다른 코호트** — 고친 뒤 · 설치본 | `WBS_REMAINING.md` §4 · §12 |
| **Windows 게이트** | **정정.** 승인된 MVP Canon 은 **Windows 10 1809+ 와 Windows 11 둘 다**를 요구한다. 한 대로 닫지 않는다 | `WBS_REMAINING.md` §2 · 아래 §5 |
| **실행 단계** | Phase A(지금) → Phase B(사람) → Phase C(MVP 교정·인증) → **그 뒤에야** V1 | `WBS_REMAINING.md` §12 |
| **V1 보류** | X 의 계획·정합 작업은 계속. **P1 · P2 · P3 · P4 프로덕션 구현은 보류.** 예외: MVP 인증에 독립적으로 필요한 교정 — **X-6 은 PM 이 「기존 MVP 프로세스 재조정 진실성 결함의 수정」이라고 확인하면 V1 이전에 진행 가능** | `WBS_REMAINING.md` §3 · §12 |

---

## 5. Windows — 두 상태를 절대 섞지 않는다

| 상태 | 뜻 | 언제 말할 수 있나 |
|---|---|---|
| `WINDOWS_VALIDATION_STARTED` | 대상 환경 **최소 하나** 확보 · 실행됨 | 한 환경의 로그가 있을 때 |
| `MVP_WINDOWS_CERTIFIED` | **Windows 10 1809+ 와 Windows 11 둘 다** 실행 · 증거 있음 | 두 환경의 로그가 **각각** 있을 때 |

- VM 허용 — 대상 OS 의 진짜 동작을 내놓는다면. ConPTY · `PATHEXT` · NTFS 대소문자는 VM 에서도 진짜다.
- **한 호스트의 결과를 둘로 보고하지 않는다.** 이 런의 규율 그대로다 — *측정하지 않은 것을
  측정했다고 말하지 않는다.*
- `DEFERRED_VALIDATION.md` 의 DV 행은 **환경별로** 닫힌다. 한 환경만 PASS 면 그 행은 여전히
  `IMPLEMENTED_PENDING_VALIDATION` 이고, 어느 환경이 통과했는지 옆에 적는다.

---

## 6. 이 판정이 **열지 않은** 게이트

| 게이트 | 상태 |
|---|---|
| **G-A** 비개발자 테스터 | 여전히 닫힘. M-3 이 기다린다 |
| **G-B** Windows 두 환경 | 여전히 닫힘. **요구가 하나에서 둘로 늘었다** |
| **G-C** Canon 판정 (`18`/`15` 개정) | 여전히 닫힘. P0-3 이 요청서를 낸다 |
| **G-D** Supabase 승격 | 결정됨 · **V1 보류로 실행이 뒤로 밀렸다** |
| **G-F** X-6 을 MVP 인증 전에 할 것인가 | **신규 · PM 확인 대기** (§4 V1 보류의 예외 조항) |
| **G-G** §2 의 확인 ①②③ | **신규 · Owner 확인 대기** (판정→컬럼 해석) |
