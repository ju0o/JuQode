# A1 · Persistence — PROPOSED

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

> ## ⛔ 실행되는 마이그레이션을 만들지 않았다
>
> 아래 SQL 은 **논리 모델**이다. 제품에 적용되지 않았고 적용해서도 안 된다.
> 목적은 오직 하나 — **테이블 · PK · FK · 인덱스 · 상태값 · 버전 · 마이그레이션 전략에 답하는 것.**

---

## 1. 후보 비교

| | SQLite 단독 | 파일 문서만 | 임베디드 KV | **하이브리드** |
|---|---|---|---|---|
| 관계 질의 | ✅ | ❌ 전수 스캔 | ❌ | ✅ |
| 큰 원본 | ❌ DB 가 부푼다 | ✅ | ❌ | ✅ 파일시스템 |
| 사람이 읽는다 | ❌ | ✅ | ❌ | ✅ Export |
| 원자적 다중 쓰기 | ✅ | ❌ | 부분 | ✅ |
| 손상 국소성 | ❌ 한 파일 | ✅ | ❌ | ✅ |
| **판정** | 미래 비용 높음 | 성공기준 6과 충돌 | **경쟁자 아님** | **제안** |

> **파일 문서만** 을 고르면 JuQode 는 말 그대로 **파일 복사와 같은 것**이 된다.
> 그런데 v0.1 성공기준 6이 *"Context 조작이 파일/Markdown 복사보다 **명백히** 편해야 한다"* 이다.

---

## 2. 실측 — 무엇이 실제로 되는가

| 항목 | 결과 |
|---|---|
| SQLite | 3.46.1 |
| WAL / 외래키 | ✔ / ✔ |
| JSON1 · **JSON 값에 생성컬럼 인덱스** | ✔ / ✔ |
| FTS5 (Context 본문 검색) | ✔ |
| \`integrity_check\` | ✔ |
| 네이티브 모듈 설치 | **0건** (Node 내장) |
| ⚠ | Node 는 내장 SQLite 를 **experimental** 로 표시한다 |

> **바인딩 선택은 데스크톱 런타임 선택에 묶여 있다.** 따로 결정할 수 없다.
> Electron → 네이티브 리빌드 또는 실험적 내장 / Tauri → \`rusqlite\` (성숙 · 리빌드 없음)

---

## 3. 논리 SQL 모델 (PROPOSED · 실행 금지)

**"전부 JSON" 을 하지 않는다.** 네 가지를 명시적으로 가른다.

| 층 | 무엇이 들어가는가 |
|---|---|
| **관계 컬럼** | 질의 · 정렬 · 강제가 필요한 것 |
| **JSON payload** | 에이전트/도구마다 모양이 다른 것 |
| **RAW 파일 아티팩트** | 크고 삭제하지 않는 원본 |
| **Repository / Git 진실** | 코드와 안전. **DB 에 복사하지 않는다** |

```sql
-- ⛔ PROPOSED. 실행하지 않는다.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;          -- 마이그레이션 훅

CREATE TABLE project (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL,
  signature     TEXT NOT NULL,     -- 경로가 아닌 동일성. 폴더 이동을 견딘다
  name          TEXT NOT NULL,
  vcs           TEXT NOT NULL CHECK (vcs IN ('GIT','SHADOW','NONE')),
  last_opened   INTEGER
);
CREATE UNIQUE INDEX project_sig ON project(signature);

CREATE TABLE software_boundary (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  model_version INTEGER NOT NULL,
  inferred_at   INTEGER NOT NULL
);

CREATE TABLE semantic_place (
  id            TEXT PRIMARY KEY,   -- 내부 전용. 사용자에게 개체로 노출되지 않는다
  boundary_id   TEXT NOT NULL REFERENCES software_boundary(id) ON DELETE CASCADE,
  mapping_sig   TEXT NOT NULL,      -- 재스캔에도 정정이 살아남게 하는 서명
  mass          REAL NOT NULL,
  direction     REAL NOT NULL,      -- 의미의 방향 (Realm 독립 값)
  confidence    TEXT NOT NULL CHECK (confidence IN ('KNOWN','UNKNOWN'))
);
CREATE INDEX place_sig ON semantic_place(mapping_sig);

-- 겹침은 분할이 아니다 → N:N
CREATE TABLE semantic_source_mapping (
  place_id      TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  source_path   TEXT NOT NULL,
  weight        REAL NOT NULL,
  PRIMARY KEY (place_id, source_path)
);
CREATE INDEX mapping_by_path ON semantic_source_mapping(source_path);

CREATE TABLE semantic_relation (
  from_place    TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  to_place      TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  PRIMARY KEY (from_place, to_place, kind)
);

-- 이름은 자리보다 오래 산다. 그래서 별도 테이블이다
CREATE TABLE place_naming (
  id            TEXT PRIMARY KEY,
  mapping_sig   TEXT NOT NULL,      -- place_id 가 아니다 — 재스캔을 견디는 쪽에 묶는다
  name          TEXT NOT NULL,
  origin        TEXT NOT NULL CHECK (origin IN ('USER','AI','LOCAL_FALLBACK')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX naming_by_sig ON place_naming(mapping_sig);

CREATE TABLE context_block (
  id            TEXT PRIMARY KEY,                                  -- ★ 필수 5
  project_id    TEXT REFERENCES project(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,                                  -- ★
  scope         TEXT NOT NULL CHECK (scope IN ('LOCAL','PERSONAL','PORTABLE','VAULT')),  -- ★
  origin        TEXT NOT NULL CHECK (origin IN ('USER','EXTRACTED','IMPORTED','PACK')),  -- ★
  portable      INTEGER NOT NULL DEFAULT 0,                        -- ★
  vault         INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL,
  summary       TEXT,
  body          TEXT NOT NULL,
  approved      INTEGER NOT NULL DEFAULT 0,   -- 자동 생성분은 승인 전 활성화 금지
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE context_version (
  block_id      TEXT NOT NULL REFERENCES context_block(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (block_id, version)
);

CREATE TABLE qode (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  place_id      TEXT REFERENCES semantic_place(id),   -- NULL = Whole-Software Say (POINT 는 선택)
  intent_text   TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN
                  ('SETTLED','DISTURBED','SETTLING','UNSETTLED','UNKNOWN')),
  created_at    INTEGER NOT NULL
);
-- 각 Context 가 왜 포함됐는가 — reason 이 없으면 "왜 이렇게 했어?" 에 답할 수 없다
CREATE TABLE qode_context (
  qode_id       TEXT NOT NULL REFERENCES qode(id) ON DELETE CASCADE,
  block_id      TEXT NOT NULL REFERENCES context_block(id),
  reason        TEXT NOT NULL,
  PRIMARY KEY (qode_id, block_id)
);

CREATE TABLE execution (
  id            TEXT PRIMARY KEY,
  qode_id       TEXT REFERENCES qode(id) ON DELETE CASCADE,   -- RUN 은 NULL 이다
  kind          TEXT NOT NULL CHECK (kind IN ('QODE','RUN')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  exit_code     INTEGER,
  -- 행동은 섞이지 않는다: RUN 은 Qode 를 가질 수 없다
  CHECK (kind <> 'RUN' OR qode_id IS NULL)
);
CREATE INDEX exec_by_qode ON execution(qode_id);

CREATE TABLE agent_event (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,            -- 단조 증가 → 재생이 결정적이다
  ts            INTEGER NOT NULL,
  type          TEXT NOT NULL,
  payload       TEXT,                        -- JSON. 도구마다 다른 것만 여기
  raw_ref       TEXT,                        -- 파싱 실패 줄 포함 원본 스트림
  place_id      TEXT GENERATED ALWAYS AS (json_extract(payload,'$.place_id')) VIRTUAL
);
CREATE UNIQUE INDEX event_seq ON agent_event(execution_id, seq);
CREATE INDEX event_by_place ON agent_event(place_id);   -- JSON 안의 값도 인덱싱된다(실측 확인)

CREATE TABLE artifact (
  id            TEXT PRIMARY KEY,     -- 내용 해시
  kind          TEXT NOT NULL,        -- AGENT_LOG | DIFF | SCREENSHOT | TEST_OUTPUT
  rel_path      TEXT NOT NULL,        -- 파일시스템. DB 에 내용을 넣지 않는다
  bytes         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE evidence (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN
                      ('TEST','BUILD','GIT','RUNTIME','SCREENSHOT')),
  status            TEXT NOT NULL CHECK (status IN ('PASS','FAIL','UNKNOWN')),
  claim_source      TEXT NOT NULL CHECK (claim_source IN ('AGENT_CLAIM','MEASURED')),
  what_would_verify TEXT,
  artifact_id       TEXT REFERENCES artifact(id),
  -- UNKNOWN 은 반드시 행동 가능해야 한다. UI 관례가 아니라 스키마의 일이다
  CHECK (status <> 'UNKNOWN' OR what_would_verify IS NOT NULL),
  -- 주장은 사실이 아니다: 에이전트의 주장만으로 PASS 를 만들 수 없다
  CHECK (claim_source <> 'AGENT_CLAIM' OR status <> 'PASS')
);
CREATE INDEX evidence_unresolved ON evidence(status) WHERE status <> 'PASS';

CREATE TABLE observation (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT REFERENCES execution(id) ON DELETE SET NULL,
  place_id      TEXT REFERENCES semantic_place(id),
  source        TEXT NOT NULL CHECK (source IN
                  ('RUNTIME','TEST','BUILD','STATIC','AGENT','USER')),
  signature     TEXT NOT NULL,        -- 같은 실패를 묶는 키
  artifact_id   TEXT REFERENCES artifact(id),
  observed_at   INTEGER NOT NULL,
  problem_id    TEXT REFERENCES problem(id) ON DELETE SET NULL
);
CREATE INDEX obs_dedupe ON observation(place_id, signature);

CREATE TABLE problem (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  signature     TEXT NOT NULL,
  human_text    TEXT NOT NULL,        -- 사람 말 한 줄. 스택 트레이스가 아니다
  kind          TEXT NOT NULL CHECK (kind IN ('misalign','break')),  -- 색이 아니라 결의 거동
  severity      INTEGER NOT NULL,     -- 정렬은 심각도 순 (시간순 아님)
  occurrences   INTEGER NOT NULL DEFAULT 1,   -- 화면의 "3번 중 2번" 이 여기서 나온다
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  resolved_at   INTEGER
);
CREATE UNIQUE INDEX problem_dedupe ON problem(place_id, signature) WHERE resolved_at IS NULL;

CREATE TABLE attention_item (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('INFO','ATTENTION','CRITICAL')),
  category      TEXT NOT NULL CHECK (category IN ('OVERREACH','ASSUMPTION')), -- 분리해서 표시
  text          TEXT,
  -- 중요한 것이 Discovery 에 의존하지 않게 강제한다
  CHECK (level <> 'CRITICAL' OR text IS NOT NULL)
);

CREATE TABLE safety_record (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('PRE_QODE','DISCARDED')),
  git_ref         TEXT NOT NULL,      -- refs/juqode/... 진실은 Git 에 있다
  reversibility   TEXT NOT NULL CHECK (reversibility IN
                    ('reversible','irreversible','destructive')),
  created_at      INTEGER NOT NULL
);

CREATE TABLE software_time_point (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id),
  git_ref       TEXT NOT NULL,        -- refs/juqode/equilibrium/*
  human_text    TEXT NOT NULL,        -- "Google 로그인 추가"
  settled_at    INTEGER NOT NULL      -- 확인된 평형만 점이 된다
);
CREATE INDEX time_desc ON software_time_point(settled_at DESC);  -- 최신이 위다

CREATE VIRTUAL TABLE context_fts USING fts5(body, content='context_block', content_rowid='rowid');
```

---

## 4. 마이그레이션 전략 (PROPOSED)

| | |
|---|---|
| 버전 훅 | \`PRAGMA user_version\` (실측 동작 확인) |
| 방향 | **전진만.** 다운 마이그레이션을 만들지 않는다 |
| 실패 시 | 롤백하고 **이전 버전으로 계속 동작**한다. 열기가 실패하지 않는다 |
| **최후 수단** | **DB 를 버리고 재구성한다** |

> **재구성이 안전한 이유:** JuQode DB 는 **사용자의 코드를 담지 않는다.**
> 코드는 Repository 에, 안전은 Git 에 있다. DB 가 깨지면 잃는 것은 **JuQode 의 이해**뿐이고 다시 만들 수 있다.
> **예외 — Context 는 사용자의 자산이다.** 이것만은 재구성할 수 없으므로 **사람이 읽는 형식으로 별도 Export** 를 유지한다 (D-024).

---

## 5. 저장 위치 · 이동 · 프라이버시

| | |
|---|---|
| **어디에** | OS 앱 데이터 디렉터리. **프로젝트 폴더 안이 아니다** — 사용자의 저장소를 더럽히지 않는다 |
| **프로젝트 이동** | 경로가 아니라 **서명**으로 동일성을 잡는다. 못 찾으면 **묻는다** (발명하지 않는다) |
| **오프라인** | 전부 로컬. 네트워크는 Agent 호출에만 |
| **프라이버시** | 사용자 코드 본문을 DB 에 복사하지 않는다. 참조만 둔다 |
| **비밀** | **DB 에 넣지 않는다.** OS 자격증명 저장소 |

---

## 6. 미결

- 바인딩 선택이 **데스크톱 런타임 결정에 묶여 있다**
- 대형 저장소에서의 실제 쓰기량 · 아티팩트 증가 속도를 측정하지 않았다
- 아티팩트 보존 정책(무한 보존 vs 상한)은 D-010 과 디스크 사이의 미결이다
