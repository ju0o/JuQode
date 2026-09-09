-- ============================================================================
-- CANDIDATE CANON · DBC1 · NOT APPROVED FOR PRODUCTION until the Founder ERD Gate (F-G*) passes
-- JuQode — CANONICAL DATA MODEL CANDIDATE (candidate canonical model (DBC1))
-- DECISIONS: D-109 · D-114 · D-117 · D-118 · D-119 · D-120 · D-121 · D-124 · D-126 · D-129
-- ENGINE: local embedded SQLite (D-129). 아래 DDL 은 SQLite/Postgres 양쪽에서 실행되지만 대상 엔진은 SQLite 다.
-- STATUS: CANDIDATE · SQLite 3.46 실행 검증 완료 · Postgres 재검증은 WBS-21 · Founder ERD Gate pending
--
-- Derived from: 10_DATA_REQUIREMENTS.md + 11_PROTOTYPE_TO_CANONICAL_DATA_RECONCILIATION.md
--               + 01_V1_BASELINE_AUDIT.md items M-13..M-18 (applied below, marked "V2 M-xx").
-- Dialect: standard SQL with minimal Postgres-isms (uuid, timestamptz; no jsonb, no arrays, no
--          Supabase features). The engine IS decided — local embedded SQLite (D-129, Q-08 closed).
--          The DDL stays Postgres-runnable so a future server-side move is not blocked, but nothing
--          in the product may assume Postgres. (F-22: earlier revisions said the choice was open here.)
-- Postgres caveat: `order by ended_at desc` defaults to NULLS FIRST on Postgres and NULLS LAST on SQLite.
--          Every ordering query must say `nulls last` explicitly. SQLite rejects the clause inside a
--          CREATE INDEX, so it is a query-level rule, not an index-level one (F-07).
-- Validation: whole file + data/schema_smoke.sql executed on SQLite 3.46 with PRAGMA foreign_keys=on:
--          26 tables created; all nine "expect FAIL" statements raised and nothing else did.
--          Postgres 15 has NOT been re-run against this revision — the earlier Postgres run predates
--          F-08/F-09/F-17/F-18/F-19 and no longer describes this file (F-06). Re-run it at WBS-21.

-- ---------- lookup vocabularies (reference strategy: small tables, not CHECKs) ----------
create table work_status      (code text primary key);  -- lifecycle
insert into work_status values ('running'),('input_waiting'),('permission_waiting'),('cancel_requested'),('ended');
-- D-124 · OPUS-D F-08: a `work` row exists only once the Claude Code session actually started.
-- Pre-start states (요청 접수 · 증거 기준 확인 · 시작 실패) are transient UI, never rows — so there is no
-- 'requested'/'evidence_check' code and started_at is NOT NULL.

-- V2 M-13: + ended_unknown.  V2 M-14: evidence_blocked / start_failed removed (those attempts are not Works).
create table work_outcome     (code text primary key);  -- how it ended
insert into work_outcome values ('complete'),('partial'),('failed'),('cancelled_nochange'),('cancelled_partial'),('ended_unknown'); -- ended_unknown: D-124 — 저장되는 여섯 번째 outcome 이다 (D-117 슬롯 해제용). 화면의 여섯 번째 칩은 아니다(A-15, Founder 미결)

create table step_state       (code text primary key);
insert into step_state values ('done'),('running'),('declared_next'),('not_executed');

create table confidence       (code text primary key);  -- D-114 · JuTell-compatible
insert into confidence values ('confirmed'),('expected'),('unconfirmed');

create table signal_kind      (code text primary key);
insert into signal_kind values ('session_start'),('status'),('step'),('file_change'),('tool_use'),('tool_result'),
  ('input_request'),('answer'),('permission_denied'),('permission_granted'),('cancel_request'),('cancel_confirmed'),
  ('rate_limit'),('finish'),('reconciled'),('evidence_gap'),('orphan_process'),('raw');
-- 실제 CLI 이벤트 계약에서 유도했다 (19 §C3-L): system:init → session_start · system:status → status ·
-- assistant tool_use / user tool_result · system:permission_denied → permission_denied ·
-- 사용자가 허용해 재개하면 permission_granted · result → finish. permission_* 를 코드로 둔 이유는
-- "JuQode 가 대신 승인하지 않았다"(D-116)를 payload 파싱 없이 질의하기 위해서다 (F-10).

create table block_kind       (code text primary key);
insert into block_kind values ('add'),('modify'),('delete'),('rename'),('unblocked');

create table qc_status        (code text primary key);
insert into qc_status values ('running'),('long_running'),('success'),('failed'),('unknown'),('stopped');
-- F-12: 설명만 하고 실행하지 않은 Quick Command 는 행이 되지 않는다 (시작되지 않은 Work 와 같은 규칙).
-- 미인식 · 지금 안 됨 도 행이 아니라 일시 카드다.

-- V2 M-18: evidence-basis mechanism is a lookup, not a CHECK. The two seeded values are the Q-19
-- option inventory only — T1 decides which mechanism(s) exist; adding/removing a value is a data change.
create table evidence_kind    (code text primary key);
insert into evidence_kind values ('git_tree'),('hash_manifest');

-- ---------- PROJECT ----------
create table schema_version (            -- D-129: 번호 붙은 마이그레이션의 앵커
  version    integer primary key,
  applied_at timestamptz not null
);
insert into schema_version values (1, '2026-09-08T00:00:00Z');

create table project (
  id              uuid primary key,
  path            text not null unique,              -- natural key on this machine (Q-08 caveat)
  name            text not null,
  first_opened_at timestamptz not null,
  last_opened_at  timestamptz not null
);

-- ---------- INTERPRETATION (C1) ----------
create table interpretation (
  id            uuid primary key,
  project_id    uuid not null references project(id) on delete restrict,   -- F-18: 프로젝트 삭제 경로가 없다 (D-129)
  status        text not null check (status in ('interpreting','interpreted','partial','failed')),
  source_hash   text,                                -- manifest/tree hash at interpretation time → stale = hash differs (derived)
  is_current    boolean not null default true,
  skipped_note  text,                                -- F-13: 상한(2,000 파일 / 5 MB)을 넘겨 읽지 않은 부분.
                                                     -- null = 전부 읽음. 있으면 여섯 답이 '확인 못함' 인 이유가 된다 (19 §C1)
  created_at    timestamptz not null,
  ended_at      timestamptz
);
create unique index interpretation_one_current on interpretation(project_id) where is_current;
-- startup reconciliation (V2 M-13): an interpretation still 'interpreting' whose process is gone
-- becomes status='failed', ended_at=now(). Nothing is invented for the six answers.

create table interpretation_answer (
  interpretation_id uuid not null references interpretation(id) on delete cascade,
  q                 smallint not null check (q between 1 and 6),   -- the six questions (09 §4)
  text              text,                                           -- null = 확인 못함 with no text
  confidence        text not null references confidence(code),
  source_ref        text,                                           -- V2 M-17: the fact cited (file path / path:line / manifest key); required for 'confirmed'
  primary key (interpretation_id, q),
  check (confidence <> 'confirmed' or source_ref is not null)
);

create table interpretation_read_file (
  interpretation_id uuid not null references interpretation(id) on delete cascade,
  path              text not null,
  primary key (interpretation_id, path)
);

-- ---------- WORK (C2 · C3) ----------
-- A row exists only for a Work that actually started (V2 M-14): evidence-blocked and start-failed
-- attempts are shown transiently and never persisted; History = Works that started.
create table work (
  id            uuid primary key,
  project_id    uuid not null references project(id) on delete restrict,   -- F-C2-04: History 는 사라지지 않는다
  intent        text not null,                       -- the user's words = the Work's name
  status        text not null references work_status(code),
  outcome       text references work_outcome(code),  -- set only when status = 'ended'
  requested_at  timestamptz not null,
  started_at    timestamptz not null,               -- 세션이 실제로 시작된 시각 (행이 존재한다 = 시작되었다)
  ended_at      timestamptz,
  stream_ref    text,                                -- D-129: Work 종료 시 저장한 원문 스트림 파일 참조
  signals_truncated boolean not null default false,  -- D-129: work_signal 이 보존 정책으로 잘렸는가
  check ((status = 'ended') = (outcome is not null)),
  check ((status = 'ended') = (ended_at is not null))   -- V2 M-14
);
create index work_project_recent on work(project_id, ended_at desc);
-- F-07: Postgres 의 `order by ended_at desc` 는 기본이 NULLS FIRST 라 진행 중 Work(ended_at is null)가 맨 앞에 온다.
-- 엔진 간 동일 순서를 원하면 인덱스가 아니라 모든 쿼리에서 `nulls last` 를 명시할 것. (SQLite 는 인덱스 절에서 미지원)
-- D-117: at most one non-ended Work per project
create unique index work_one_active_per_project on work(project_id) where status <> 'ended';
-- startup reconciliation (V2 M-13): at app start, and whenever the supervisor finds a Work's process
-- gone, every work with status <> 'ended' whose process cannot be found is closed as
--   status='ended', outcome='ended_unknown', ended_at=now()
-- plus one work_signal(source='juqode', kind='finish', payload='ended_unknown') and every step still
-- 'running' / 'declared_next' → 'not_executed'. Nothing else is inferred (no result, no claims).
-- Without this rule a lost process pins work_one_active_per_project forever.

create table step (
  id           uuid primary key,
  work_id      uuid not null references work(id) on delete cascade,
  ord          smallint not null,
  title        text not null,
  state        text not null references step_state(code),
  declared_at  timestamptz not null,
  updated_at   timestamptz not null,
  unique (work_id, ord)
);

-- observed agent / user / product events — evidence + liveness + 기술 출력 disclosure
create table work_signal (
  id           uuid primary key,
  work_id      uuid not null references work(id) on delete cascade,
  seq          bigint not null,
  source       text not null check (source in ('claude','juqode','user')),
  kind         text not null references signal_kind(code),
  payload      text,                                 -- raw text / JSON string; never rendered first
  observed_at  timestamptz not null,
  unique (work_id, seq)
);
create index work_signal_latest on work_signal(work_id, observed_at desc);

-- D-121: the before/after basis every diff of this Work is computed against (1:1 per work/phase;
-- raw_diff rows reach their basis through work_id — there is no basis_id column, see 11 §M-19)
create table evidence_basis (
  id           uuid primary key,
  work_id      uuid not null references work(id) on delete cascade,
  phase        text not null check (phase in ('before','after')),
  kind         text not null references evidence_kind(code),   -- V2 M-18: lookup; mechanism is T1 (Q-19)
  ref          text not null,                        -- tree id or manifest hash (blobs live outside the DB)
  excluded     text,                                 -- F-13: 기준에서 제외한 경로 목록 (중첩 .git · .env* · *.pem · node_modules).
                                                     -- null = 제외 없음. SC-03 머리말 / SC-04 꼬리말이 이걸 그대로 보고한다 (D-126, 19 §E)
  created_at   timestamptz not null,
  unique (work_id, phase)
);

-- ---------- RESULT (D-114) ----------
-- V2 M-16: how_far / what_remains dropped — 된 것 / 안 된 것 live in result_item only.
create table work_result (
  work_id       uuid primary key references work(id) on delete cascade,
  summary       text not null,
  what_failed   text,
  created_at    timestamptz not null
);
create table result_claim (
  id          uuid primary key,
  work_id     uuid not null references work_result(work_id) on delete cascade,
  ord         smallint not null,
  text        text not null,
  confidence  text not null references confidence(code),
  unique (work_id, ord)
);
create table result_item (
  id       uuid primary key,
  work_id  uuid not null references work_result(work_id) on delete cascade,
  kind     text not null check (kind in ('done','not_done')),  -- partial results: 된 것 / 안 된 것
  ord      smallint not null,
  text     text not null,
  unique (work_id, kind, ord)
);

-- ---------- CHANGE (C5) ----------
create table raw_diff (
  id            uuid primary key,
  work_id       uuid not null references work(id) on delete cascade,
  file          text not null,
  displayable   boolean not null,                    -- false: binary etc. → 표시 불가
  unified_head  text,                                -- 화면에 싣는 bounded head (기본 256 KB 상한)
  unified_ref   text,                                -- D-129: 상한을 넘는 원문 diff 의 blob 파일 참조
  before_hash   text,
  after_hash    text,
  unique (work_id, file)
);

create table change_group (
  id           uuid primary key,
  work_id      uuid not null references work(id) on delete cascade,
  ord          smallint not null,
  title        text not null,
  what         text,
  why          text,
  affects      text,
  confidence   text references confidence(code),
  explainable  boolean not null default true,        -- false → 설명 불가 (route down)
  unique (work_id, ord)
);
create table change_group_file (
  change_group_id uuid not null references change_group(id) on delete cascade,
  raw_diff_id     uuid not null references raw_diff(id) on delete cascade,
  primary key (change_group_id, raw_diff_id)
);

-- V2 M-15: a block knows where it sits inside its diff (hunk index + after-side line range);
-- null for kind='unblocked' or when the diff is not displayable.
create table code_block (
  id               uuid primary key,
  change_group_id  uuid not null references change_group(id) on delete cascade,
  raw_diff_id      uuid not null references raw_diff(id) on delete restrict,  -- F-19: 소유자는 change_group 하나뿐 (D-121)
  ord              smallint not null,
  kind             text not null references block_kind(code),
  name             text,                             -- e.g. '함수 refreshToken()' ; null when unblocked
  explanation      text,
  hunk_ord         smallint,                         -- 0-based hunk index inside raw_diff.unified
  line_start       integer,                          -- after-side line numbers, inclusive
  line_end         integer,
  unique (change_group_id, ord),
  check (line_end is null or line_start is null or line_end >= line_start)
);

-- ---------- QUICK COMMAND (C4) ----------
create table quick_command_rule (code text primary key);   -- F-17: 규칙 집합은 닫혀 있다 (19 §C4)
insert into quick_command_rule values ('qc.dev.start'),('qc.dev.stop'),('qc.build'),('qc.test'),('qc.git.status'),('qc.terminal.open');

create table quick_command_run (
  id           uuid primary key,
  project_id   uuid not null references project(id) on delete restrict,   -- F-18
  phrase       text not null,                        -- user's words
  rule_id      text not null references quick_command_rule(code),   -- F-17: 닫힌 6개 집합 (Q-02, 19 §C4)
  command      text not null,                        -- what was actually run
  status       text not null references qc_status(code),
  output_head  text,                                 -- bounded inline output
  output_ref   text,                                 -- blob ref for the full output (evidence)
  exit_code    integer,
  started_at   timestamptz,
  ended_at     timestamptz,
  stopped_at   timestamptz,
  created_at   timestamptz not null
);
create index qc_project_recent on quick_command_run(project_id, created_at desc);
-- startup reconciliation (V2 M-13): a run still 'running' / 'long_running' whose process is gone
-- becomes status='unknown' (exit_code stays null; output_head/output_ref keep what was observed).

-- ---------- deliberately absent ----------
-- users / teams / billing / cost usage / undo-rollback state / intent queue / terminal sessions / full project source
-- evidence_blocked / start_failed attempts (never started → not Works, V2 M-14)
