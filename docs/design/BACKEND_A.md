# 백엔드 A안 설계 — 로그인 · 계정별 권한 · 감사

> 🛑 **§3 은 낡았다 — 구현 근거로 쓰지 말 것.** (Owner/PM 판정 2026-09-13)
>
> §3 은 서버를 **3표**로 그리고 멱등 키도 장치 검증도 없다. 판정 X-1a 는 **ERD 의 21표 모델**을
> 설계 목표로 확정했고, X-1c(멱등 필수) · X-1d(장치 신뢰 경계)를 요구한다.
> **`P1-2` 를 이 3표 텍스트에서 시작하지 않는다.**
> §3 재작성은 **X-2** 이고, 판정 전문은 `SPEC_RECONCILE.md`, 남은 작업은 `WBS_REMAINING.md` 다.
> 판정이 **그대로 둔** 것: §0 의 D-A1~D-A7 · §2 의 약속 · §4 의 데스크톱 변경 순서 ·
> §5 의 비용 판단. 낡은 것은 **§3 의 스키마와 RPC 본문뿐**이다.

> 상태: **제안 (PROPOSAL)**. Product SSOT 는 `JuQode-Private/docs/current/` 이고 이 문서는 Canon 이 아니다.
> 작성 근거: 2026-09-12 코드 실측 + 창업자 결정 4건.

---

## 0. 확정된 결정

| # | 질문 | 결정 | 파급 |
|---|---|---|---|
| D-A1 | 에이전트 토큰 비용 | **각자 자기 구독.** 사용자가 자기 기계에 Claude Code 를 깔고 자기 계정으로 로그인한다 | 서버는 **자격증명을 일절 만지지 않는다.** 토큰 프록시·사용량 미터링 불필요 → A안 최대 비용 항목이 0 |
| D-A2 | 인증 백엔드 | **Supabase Auth** (이메일+비밀번호 / 매직링크) | Auth + Postgres + 관리자 대시보드가 한 번에. 관리자 화면을 만들지 않는다 |
| D-A3 | V1 권한 항목 | **하루 작업 수 상한 하나만.** 파일 수정 허용·터미널 on/off·경로 제한은 V2~V3 | `policy` 테이블은 열려 있되 V1 은 컬럼 하나만 읽는다 |
| D-A4 | 계정 구조 | **관리자 1 + 평면적 개인 계정.** 조직 없음 | `owner_id` 만 넣고 `org_id` 는 넣지 않는다. 나중에 붙일 수 있게 설계만 |
| D-A5 | 구독 | **연동만, 결제는 나중.** 무료·유료 등급 구분까지 | `plan` · `subscription` 은 채우고 `payment` · `billing_webhook` 은 선언만. 결제사(토스·스트라이프) 연동은 별도 판정 |
| D-A6 | 오프라인 | **마지막 정책으로 7일 허용** | 로컬 앱이 네트워크 때문에 멈추면 제품 퇴보. 그 동안 상한을 넘을 수 있고 다음 접속 때 정산한다 — 감수하는 구멍이고, 화면이 그렇게 말한다 |
| D-A7 | Supabase 프로젝트 | **프로토타입 `xkydfvbwgwcoenbpzdew` 를 승격** | night_run_v0 스키마와 개방 RLS 를 전부 걷어낸 뒤 프로덕션으로 쓴다. 비용 0, 프로토타입 데이터는 사라진다 |

**A안 한 줄 정의** — 코드도 에이전트도 사용자 기계에 그대로 있고, 서버는 *누구인지 · 오늘 몇 번 썼는지* 만 안다.

---

## 1. 지금 코드가 깨는 지점 (실측)

| 가정 | 위치 | 서버에서 깨지는 이유 |
|---|---|---|
| 사용자는 하나 | `app/main/db/schema.sql` — `project`·`work`·`interpretation` 에 소유자 컬럼 없음. `project.path` 가 전역 `unique` | 두 계정이 같은 경로를 열면 같은 행을 공유 |
| 신원 = OS 계정 | `app/main/term/session.js` — 사용자의 로그인 셸을 그대로 spawn | A안에서는 **문제 아님** (사용자 자기 기계). B안이었다면 치명적 |
| 외부 네트워크 전면 차단 | `app/main/security.js` `enforceLocalOnly()` | **로그인 요청 자체가 취소된다.** 여기가 1번 작업 |
| 도구 승인이 전역 | `app/main/claude/session.js` `allowSpec()` | 계정 정책이 붙을 자리. 다행히 **함수 하나**에 모여 있다 |
| 저장소 = 로컬 SQLite | `app/main/db/db.js` | A안에서는 **그대로 둔다.** 서버 DB 는 별도 |

이미 맞게 되어 있는 것:
- `app/preload/index.js` — named 채널 26개, generic invoke 없음. 인증 채널 3개를 같은 규율로 추가하면 된다.
- `schema.sql` 이 `uuid`/`timestamptz` Postgres 방언 → 서버 스키마와 어휘가 같다.
- D-133 거부→승인→재개 루프가 이미 있다. 정책 거부는 **새 UI 가 아니라 기존 거부 카드**를 재사용한다.

---

## 2. 대상 아키텍처

```
[사용자 기계]                                    [Supabase]
  JuQode 데스크톱
    renderer  ──preload 채널──▶ main
                                 │
                                 ├─▶ claude CLI (사용자 자기 구독)   ← 서버 관여 없음
                                 ├─▶ 사용자 폴더 · evidence git      ← 서버 관여 없음
                                 ├─▶ juqode.db (로컬 SQLite)         ← 서버 관여 없음
                                 │
                                 └─▶ HTTPS ──▶ Auth (로그인/세션)
                                              ▶ profile · policy (읽기)
                                              ▶ usage_day (작업 1건당 1회 기록)
```

**서버로 나가는 것은 세 가지뿐이다: 로그인, 내 정책 읽기, 작업 카운트 +1.**
코드·diff·파일 경로·프롬프트·에이전트 출력은 **절대 나가지 않는다.** 이건 성능이 아니라 제품 약속이다 (`19` §S 의 연장).

---

## 3. 서버 스키마 (Supabase · 테이블 3개)

```sql
-- auth.users 는 Supabase 가 관리한다. 우리 테이블은 그것을 가리킨다.

create table public.profile (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('admin','member')),
  status     text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

-- D-A3: V1 은 daily_work_limit 하나만 읽는다. 나머지 컬럼은 V2~V3 자리.
create table public.policy (
  user_id          uuid primary key references public.profile(id) on delete cascade,
  daily_work_limit integer not null default 20,
  updated_at       timestamptz not null default now()
);

-- 하루 한 행. 상한 판정도 감사 기록도 이 한 테이블이 한다.
create table public.usage_day (
  user_id uuid not null references public.profile(id) on delete cascade,
  day     date not null,
  works   integer not null default 0,
  primary key (user_id, day)
);

alter table public.profile   enable row level security;
alter table public.policy    enable row level security;
alter table public.usage_day enable row level security;

-- 본인 행만 읽는다. 쓰기는 아래 RPC 를 통해서만.
create policy own_profile on public.profile   for select using (auth.uid() = id);
create policy own_policy  on public.policy    for select using (auth.uid() = user_id);
create policy own_usage   on public.usage_day for select using (auth.uid() = user_id);
```

**상한 판정 + 카운트를 한 번에 하는 RPC 하나.** 클라이언트가 세는 게 아니라 DB 가 센다 — 데스크톱 앱은 사용자 손 안에 있으므로 클라이언트 카운트는 신뢰 대상이 아니다.

```sql
create or replace function public.consume_work()
returns table (allowed boolean, used integer, "limit" integer)
language plpgsql security definer set search_path = public as $$
declare lim integer; cur integer;
begin
  select coalesce(p.daily_work_limit, 20) into lim
    from policy p where p.user_id = auth.uid();
  if lim is null then lim := 20; end if;

  -- 정지된 계정은 상한과 무관하게 거부
  if exists (select 1 from profile where id = auth.uid() and status <> 'active') then
    return query select false, 0, lim; return;
  end if;

  insert into usage_day (user_id, day, works) values (auth.uid(), current_date, 0)
    on conflict (user_id, day) do nothing;

  select works into cur from usage_day
    where user_id = auth.uid() and day = current_date for update;

  if cur >= lim then
    return query select false, cur, lim; return;
  end if;

  update usage_day set works = works + 1
    where user_id = auth.uid() and day = current_date returning works into cur;
  return query select true, cur, lim;
end $$;
```

관리자 화면은 **만들지 않는다.** Supabase Studio 의 테이블 편집기가 V1 관리자 화면이다 (`policy.daily_work_limit` 수정, `profile.status` 를 `suspended` 로).

---

## 4. 데스크톱 변경 (작업 순서 = 의존성 순)

### ① 네트워크 구멍 하나 — `app/main/security.js`
`enforceLocalOnly()` 는 `file:`/`devtools:`/`data:`/`blob:`/`about:` 만 통과시킨다. **정확히 한 origin** 을 허용리스트에 추가한다.

```js
// 프로젝트 origin 하나. 와일드카드 금지 — 목록이 짧다는 것이 이 함수의 전부다.
const AUTH_ORIGIN = process.env.JUQODE_AUTH_ORIGIN || 'https://<ref>.supabase.co';
const local = url.startsWith('file:') || ... || url.startsWith(AUTH_ORIGIN + '/');
```
`attempts` 기록은 그대로 둔다 — "외부 요청 0" 을 주장하던 e2e 는 "허용된 하나 외 0" 으로 바뀐다. **테스트를 지우지 말고 문장을 바꿀 것.**

### ② 마이그레이션 3 — `app/main/db/db.js` `MIGRATIONS`
```js
{ to: 3, sql: `
  alter table project add column owner_id text;
  drop index if exists sqlite_autoindex_project_1;   -- path unique 해제는 테이블 재작성 필요
` },
```
> ⚠ SQLite 는 `unique` 제약 제거에 테이블 재작성이 필요하다. 실제 마이그레이션은 `project_new` 생성 → 복사 → `drop`/`rename`, `unique(owner_id, path)` 로. 기존 행의 `owner_id` 는 **최초 로그인한 계정으로 채운다** (1인 기계였으므로 그 계정의 것이 맞다).
> 모든 project 읽기(`repo.js:16,21`)에 `owner_id` 조건이 붙어야 한다. 빠뜨리면 계정 전환 시 남의 프로젝트가 보인다.

### ③ 로그인 게이트 — `app/main/auth.js` (신규) + 채널 3개
```
juqode:auth-me      → { ok, user|null, policy|null }   부팅 시
juqode:auth-login   → 이메일/비번 또는 매직링크
juqode:auth-logout
```
- 토큰은 **`safeStorage`** (Electron 내장, OS 키체인) 로 `userData` 에 암호화 저장. `keytar` 같은 네이티브 의존성 추가 금지.
- `juqode:boot` 보다 **먼저** 신원이 정해진다. 미로그인이면 SC-01 대신 로그인 화면.
- **오프라인 유예 (D-A6 확정)**: 토큰이 살아 있고 마지막 성공 검증이 7일 이내면 로그인 없이 동작한다. 사용자 기계에서 도는 로컬 앱이 네트워크가 끊겼다고 못 쓰게 되는 것은 제품 퇴보다. 유예 중에는 정책을 **마지막으로 본 값**으로 쓰고, 화면이 그렇게 말한다.

### ④ 정책 게이트 — 한 곳
`app/main/work/supervisor.js` 의 preflight 4단계 앞에 **0단계**를 넣는다:

```
0. consume_work() 가 allowed=true 인가? → 아니면 상한 카드 (신규)
1. Claude Code 사용 가능?     → 사용 불가 카드 (WBS-09)
2. 다른 Work 없음?            → 가드 카드 (WBS-07)
3. before-basis 가능?          → 확립 불가 카드 (WBS-08)
4. 세션이 실제로 말했는가?     → 시작 실패 카드 (WBS-10)
```
0단계가 1번보다 앞인 이유: **카운트를 소모하지 않고 거절하는 것이 사용자에게 이롭다.** ✱ 단, `consume_work()` 는 성공 시 카운트를 올리므로 1~4 에서 실패하면 되돌려야 한다 → V1 은 **소모를 4단계 직후(= `work` 행 생성 직전)로 옮긴다.** `20` 의 "History = 시작된 Work" 와 카운트가 같은 정의를 쓴다.

> 도구 단위 권한(`allowSpec()`)은 **V1 에서 손대지 않는다.** D-A3 가 그렇게 정했다. V2 에서 파일수정/터미널 정책이 생기면 그때 이 함수 하나에 붙는다.

### ⑤ 상한 카드 — `app/renderer/copy.js`
문구는 Canon 에 먼저 적힌 뒤 구현한다 (이 저장소의 기존 규율). 담아야 할 사실 셋:
- 오늘 몇 / 몇 인가
- 언제 초기화되는가 (자정, 사용자 로컬 기준이 아니라 **서버 `current_date`** 라는 것)
- 누구에게 말해야 늘어나는가

---

## 5. 비용 판단 (2026-09-12 실측)

| 항목 | Free | 100명 MOU 기준 |
|---|---|---|
| Monthly Active Users | **50,000** | 100명 → 0.2% |
| Database Size | 500 MB / 프로젝트 | 3개 테이블, 행 크기 수십 바이트 → 무시 가능 |
| Egress | 5 GB | 요청 3종 × 하루 수십 건 → 무시 가능 |
| 무료 프로젝트 수 | **2개** | ⚠ **이미 2개 사용 중** (`JuQode` 프로토타입, `Doggy`) |
| 자동 일시정지 | 7일 저활동 시 | 실사용자가 있으면 발생 안 함. MOU 이전 조용한 기간에는 발생 가능 |

**결론: 100명까지 $0.** Pro($25/mo)가 필요해지는 실제 조건은 사용자 수가 아니라 ① 일시정지를 못 견딜 때 ② 일일 백업/PITR 이 필요해질 때다.

**결정됨 (D-A7 · 2026-09-12):** 프로토타입 프로젝트 `xkydfvbwgwcoenbpzdew` 를 **프로덕션으로 승격한다.**
착수 시 순서 — ① `night_run_v0` 스키마와 `public` 미러를 드롭 ② 개방 RLS 정책을 전부 삭제 ③ `get_advisors(security)` 가 빌 때까지 확인 ④ 그 뒤에야 `profile` 이하를 만든다.
프로토타입 데이터는 사라진다. 되살릴 것이 있으면 드롭 전에 받아 둘 것.

> Firebase 도 가능하지만 **권하지 않는다.** `schema.sql` 이 이미 Postgres 방언이고, 상한 판정이 트랜잭션+`for update` 로 깔끔하게 끝난다. Firestore 였다면 같은 판정에 트랜잭션 재시도 로직을 직접 써야 한다.

---

## 6. V1 에서 하지 않는 것

조직/역할 RBAC · SSO · 요금제/결제 · 원격 파일시스템 · 컨테이너 격리 · 토큰 프록시 · 자체 관리자 화면 · 사용량 그래프.
**추가 시점:** 계정이 두 자리가 되고 "누가 무엇을 못 하게" 가 실제 민원으로 올라올 때.

---

## 7. V2~V3 방향 (창업자 구상 · 아직 설계 아님)

- **클라우드 Context 저장** — 프로젝트 해석·Brief·History 를 계정에 묶어 기계 간 이동. 주의: 이 순간 **코드 파생물이 서버로 나간다.** §2 의 약속이 바뀌므로 별도 동의가 필요하다.
- **Skill 공유** — 계정/조직 단위 Quick Command 규칙 배포. 현재 `qc/rules.js` 가 **닫힌 집합(F-17)** 인 것이 전제라서, 공유는 규칙 집합을 여는 결정이다. F-17 재판정 필요.
- **무료 모델 제공 (OpenCode 등)** — README 3번 능력이 "Claude Code ONLY" 다. 이걸 여는 것은 MVP 정의 변경이며, `claude/session.js` 의 stream-json·D-133 전제가 전부 모델별로 갈라진다. **가장 비싼 항목이고 가장 나중이다.**

---

## 8. 착수 체크리스트

- [ ] 무료 프로젝트 슬롯 확보 (§5 의 1/2/3 중 택일) — **창업자**
- [ ] Supabase 스키마 + RPC 적용 (§3)
- [ ] `security.js` origin 하나 허용 + e2e 문장 수정
- [ ] 마이그레이션 3 (`owner_id`) + `repo.js` 프로젝트 읽기 전부에 조건 추가
- [ ] `auth.js` + 채널 3개 + `safeStorage`
- [ ] supervisor preflight 0단계 + 상한 카드 문구 (Canon 먼저)
