# ERD — JuQode 데이터 모델 (2026-09-12 기준)

> 상태: **현행 반영 (AS-IS + 확정 변경)**. `app/main/db/schema.sql` 은 Canon `docs/data/schema.sql` 의
> **축자 복사본**이며 이 저장소에서 편집하지 않는다. 스키마 변경은 전부 `app/main/db/db.js` 의
> `MIGRATIONS` 로 들어간다 — 이 문서는 **스키마 + 마이그레이션의 합**을 그린다.

---

## 0. 저장소는 두 군데다

| | 로컬 SQLite | 서버 Postgres (Supabase) |
|---|---|---|
| 위치 | `userData/juqode.db` | Supabase 프로젝트 |
| 엔진 | `node:sqlite` (Electron 44 내장) | Postgres 17 |
| 담는 것 | 프로젝트 · 해석 · Work · 증거 · 변경 · Quick Command | 계정 · 정책 · 사용량 |
| 나가는 것 | **아무것도 나가지 않는다** | 로그인 · 정책 읽기 · 작업 카운트 +1 |

**코드 · diff · 파일 경로 · 프롬프트 · 에이전트 출력은 서버로 가지 않는다.** (A안 §2)

---

## 1. 로컬 — 개체 관계

```
                        ┌────────────┐
                        │  project   │  path (unique) · name · first/last_opened_at
                        └─────┬──────┘
             ┌────────────────┼──────────────────────┐
             │ restrict       │ restrict             │ restrict
    ┌────────▼───────┐  ┌─────▼──────┐      ┌────────▼──────────┐
    │ interpretation │  │    work    │      │ quick_command_run │
    │ is_current ⊤1  │  │ status     │      │ rule_id ──────────┼──▶ quick_command_rule
    └────────┬───────┘  │ outcome    │      │ status ───────────┼──▶ qc_status
      cascade│          └─────┬──────┘      └───────────────────┘
   ┌─────────┴─────────┐      │ cascade
   │                   │      ├──────────────┬───────────────┬──────────────┐
┌──▼──────────────┐ ┌──▼────────────────┐ ┌──▼───────────┐ ┌─▼──────────┐ ┌─▼──────────┐
│interpretation_  │ │interpretation_    │ │    step      │ │work_signal │ │evidence_   │
│    answer       │ │   read_file       │ │ state ──▶ …  │ │ kind ──▶ … │ │  basis     │
│ q 1..6          │ │ path              │ └──────────────┘ └────────────┘ │ phase ⊤1   │
│ confidence ──▶  │ └───────────────────┘                                 │ kind ──▶ … │
└─────────────────┘                                                       └────────────┘
                             │ cascade
        ┌────────────────────┼─────────────────────┬──────────────────┐
   ┌────▼────────┐    ┌──────▼──────┐       ┌──────▼──────┐    ┌──────▼──────┐
   │ work_result │    │  raw_diff   │       │change_group │    │             │
   │ (1:1 work)  │    │ file·patch  │◀──┐   │ ord·title   │    │             │
   └────┬────────┘    └─────────────┘   │   │ source_ref  │←── 마이그레이션 2
        │ cascade                       │   │ confidence  │
   ┌────▼─────────┐ ┌──────────────┐    │   └──────┬──────┘
   │ result_claim │ │ result_item  │    │          │ cascade
   │ confidence   │ │ done/not_done│    ├──────────┼──────────────┐
   └──────────────┘ └──────────────┘    │   ┌──────▼───────────┐ ┌▼─────────────┐
                                        └───│change_group_file │ │  code_block  │
                                            └──────────────────┘ │ kind ──▶ …   │
                                                                 └──────────────┘

룩업(코드) 테이블 8개: work_status · work_outcome · step_state · confidence ·
                       signal_kind · block_kind · qc_status · evidence_kind
앵커: schema_version (version, applied_at)
```

### 읽는 법
- `restrict` = **프로젝트는 지워지지 않는다** (F-18 · D-129). History 가 사라지지 않는다는 약속이 FK 로 적혀 있다.
- `cascade` = Work 가 지워지면 그 아래는 전부 따라간다.
- `⊤1` = 부분 유니크 인덱스로 **하나만** 강제:
  - `interpretation_one_current` — 프로젝트당 현재 해석 1개
  - `work_one_active_per_project` — **D-117 · 프로젝트당 진행 중 Work 1개** (앱 코드가 아니라 엔진이 강제)
  - `evidence_basis unique(work_id, phase)` — Work·단계당 기준 1개

---

## 2. 마이그레이션 이력

| 버전 | 내용 | 이유 |
|---|---|---|
| 1 | `schema.sql` 26개 테이블 seed | Canon `20` |
| 2 | `change_group.source_ref` 추가 | D-114: 확인됨 주장은 근거를 지목한다 (CF-13) |
| **3** | `quick_command_rule` 에 `qc.git.commit` · `qc.deploy` 추가 | **PM 판정 2026-09-12** — F-17 의 닫힌 6개를 8개로 (아래 §4) |

> **앞으로 적용될 것 — 번호가 확정됐다 (Owner/PM 판정 2026-09-13 · `SPEC_RECONCILE.md` §2):**
>
> | 버전 | 내용 | 언제 |
> |---|---|---|
> | **4** | 프로세스 추적 — `app_session` + `work`·`quick_command_run` 의 `runner_session_id`·`runner_pid`·`runner_started_at` (X-6) | **MVP 인증 전** (기존 재조정 진실성 결함 수정) |
> | **5** | `project.owner_id` + `unique(owner_id, path)` (P1-5) | V1 · **MVP 인증 후** |
>
> 번호는 재사용하지 않는다. 마이그레이션 5 는 SQLite 가 유니크 제약 해제에 테이블 재작성을
> 요구하므로 `project_new` → 복사 → `rename` 형태가 된다.

---

## 3. 서버 (Supabase)

> ⚠️ **이 절과 `erd.dbml` 의 V1 절반은 Owner/PM 판정(2026-09-13)에 아직 맞춰지지 않았다.**
> 판정 전문은 `SPEC_RECONCILE.md`. 반영 작업은 **X-7** 이고, 그 전에는 P1-2 를 시작하지 않는다.
> 판정이 바꾸는 것 셋:
> - **`usage_day` 는 `works` 하나만** 제품 상한이다 (X-1b). `qc_runs` · `narrative_calls` 는
>   사용자에게 보이는 등급 상한이 **아니다** — 종류가 필요하면 `audit_usage.kind` 가 적는다.
> - **`policy` 의 투기적 컬럼 넷**(`narrative_engine_override` · `allow_file_edit` ·
>   `allow_terminal` · `allow_deploy`)은 V1 프로덕션 스키마에 넣지 않는다 (X-1e · D-A3).
>   `daily_work_limit_override` 는 **남는다** — 관리자 수동 조정 경로다.
> - **`plan.narrative_engine` · `monthly_narrative_calls` 로 서술층을 막지 않는다** (X-1f).
>   서술은 사용자 **자기** Claude 구독으로 돈다 — 서버 등급이 가를 대상이 아니다.
>
> 아래 그림과 표는 **판정 이전 상태**로 남겨 둔다. 무엇을 알고 결정했는지가 결정만큼 중요하다.

```
auth.users (Supabase 관리)
     │ 1:1
┌────▼──────┐
│  profile  │ role(admin/member) · status(active/suspended)
└─┬───┬───┬─┘
  │   │   │
  │   │   └──────────────┬──────────────┬───────────────┐
  │   │            ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐
  │   │            │  policy   │  │ usage_day │  │ audit_work  │
  │   │            │ 개인 오버 │  │ (user,day)│  │ 요약만      │
  │   │            │ 라이드    │  │ works     │  └─────────────┘
  │   │            └───────────┘  └───────────┘
  │   │
  │   └── device ──── auth_event          (로그인 연동)
  │
  └── subscription ──▶ plan               (구독 연동)
           │            daily_work_limit
           │            seat_limit
           └──▶ payment            ← V1 에서는 비어 있다
                billing_webhook    ← V1 에서는 비어 있다
```

### 하루 상한이 정해지는 순서
1. `subscription.status = 'active'` 인 구독의 `plan.daily_work_limit`
2. `policy.daily_work_limit_override` 가 있으면 그것이 이긴다 (관리자 수동 조정)
3. 둘 다 없으면 무료 등급의 기본값

판정과 카운트는 RPC `consume_work()` 이 **한 트랜잭션에서** 한다 — 데스크톱 앱은 사용자 손 안에 있으므로 클라이언트가 센 숫자는 신뢰 대상이 아니다. 전문은 `BACKEND_A.md` §3.

### 확정된 범위 (2026-09-12)
| 항목 | 결정 |
|---|---|
| 구독 | **연동만.** 무료·유료 등급 구분(`plan` · `subscription`)까지. 실제 결제는 나중 — `payment` · `billing_webhook` 은 선언만 하고 비워 둔다 |
| 에이전트 토큰 | 각자 자기 Claude 구독. 서버는 자격증명을 만지지 않는다 |
| 오프라인 | 마지막으로 읽은 정책으로 **7일** 동작. 그 동안 상한을 넘을 수 있고, 다음 접속 때 정산된다 |
| Supabase 프로젝트 | 프로토타입 `xkydfvbwgwcoenbpzdew` 를 정리해 프로덕션으로 승격 |

## 4. 스키마에 **의도적으로 없는 것**

`schema.sql` 꼬리말이 직접 적어 둔 목록이고, 지금도 유효하다:

> users / teams / billing / cost usage / **undo-rollback state** / intent queue / terminal sessions / full project source

- **users/teams** — A안이 서버로 옮긴다. 로컬 스키마에는 `project.owner_id` 만 들어온다 (마이그레이션 4).
- **undo-rollback state** — 여전히 없고, **있을 필요가 없다.** 2026-09-12 에 들어온 되돌리기(WBS-19b)는 새 상태를 만들지 않는다: `evidence_basis.ref` 가 가리키는 before 트리에서 파일을 다시 써 낼 뿐이다. 되돌리기는 **저장된 상태가 아니라 이미 있는 증거의 사용**이다.
- **terminal sessions** — 셸 세션은 프로세스의 것이고 저장소의 것이 아니다. 앱이 죽으면 세션도 죽는다.

---

## 5. Canon 변경 요청 (JuQode-Private)

이 저장소의 구현이 Canon 보다 앞서 있는 지점. **Canon 이 갱신되기 전까지 구현과 SSOT 가 다르다.**

| # | Canon 문서 | 지금 적힌 것 | 실제 구현 | 근거 |
|---|---|---|---|---|
| CF-22 | `18` `work.unwantedBody` · `rules.noRollback` | "되돌리기 버튼은 없어요" | 작업 단위 되돌리기 있음 | D-115 는 **전역 undo** 에 대한 판정이었고 그것은 그대로 유효. 좁은 주장은 증거가 감당한다 |
| CF-23 | `15` SC-01 · `18` `brief.*` | 빈 폴더 상태 없음 / 첫 실행 안내 없음 | 둘 다 있음 | `15` 가 배제한 것(생성·템플릿·클론)은 아무것도 추가하지 않았다 |
| **F-17** | `19` §C4 · `20` `quick_command_rule` | 규칙 6개 · 말뭉치가 `커밋해줘`·`배포해줘` 를 미인식으로 확정 | 규칙 8개 | **PM 판정 2026-09-12.** `19` §C4 말뭉치 재검증 필요 |
| **write class** | `19` §C4 | write 등급 규칙은 MVP 에서 제외 | `qc.git.commit` = write, `qc.deploy` = deploy(신설 등급) | 동상 |
