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


> ## 🔄 A1b 개정 — PM 판정 반영
>
> A1a 는 **PASS** 했다. 논리 저장 구조는 채택되었고, **바인딩은 여전히 A1-14 에 묶여 있다.**
> **여전히 `PROPOSED` 이며 아무것도 동결되지 않았다.**

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

### ⚠ A1b 정정 — A1a 는 잘못된 런타임에서 쟀다

**PM 지시:** *"`node:sqlite` 가 experimental 이라는 것을 보편적 현재 사실처럼 반복하지 마라.
후보 Electron 런타임 안에서 직접 확인하라."*

| 항목 | 시스템 Node 22.22 (A1a) | **Electron 33 안 (A1b 실측)** |
|---|---|---|
| Node 버전 | 22.22.1 | **20.18.3** (Electron 이 번들한 것) |
| `node:sqlite` | 있음 (experimental) | **`No such built-in module` — 아예 없다** |
| WAL · FK · JSON1 · 생성컬럼 인덱스 · FTS5 | 전부 ✔ | **해당 없음** |

> **A1a 의 "네이티브 모듈 설치 0건"은 Worker 머신의 시스템 Node 결과였다. 후보 런타임의 사실이 아니었다.**

| 런타임 | SQLite 경로 | 리빌드 | 성숙도 |
|---|---|---|---|
| **Electron 33** | `better-sqlite3` (네이티브) | **필요** | 성숙 |
| **Tauri v2** | `rusqlite` (Rust · 정적 링크) | 불필요 | 성숙 |
| (참고) 최신 Node 단독 | `node:sqlite` | 불필요 | **experimental** |

**SQLite 자체의 능력**(WAL · FK · JSON1 · JSON 값 생성컬럼 인덱스 · FTS5 · `integrity_check`)은
시스템 Node 에서 전부 확인되었다. **문제는 능력이 아니라 어떤 바인딩으로 닿느냐다.**

> **바인딩 선택은 A1-14 에 묶여 있다. 따로 결정할 수 없다.**

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

-- A1b: 안정된 동일성. 지문에서 파생하지 않는다
CREATE TABLE semantic_place (
  id                  TEXT PRIMARY KEY,   -- 영구. 내부 전용. 사용자에게 개체로 노출되지 않는다
  boundary_id         TEXT NOT NULL REFERENCES software_boundary(id) ON DELETE CASCADE,
  current_revision_id TEXT,               -- → semantic_place_revision
  mass                REAL NOT NULL,
  direction           REAL NOT NULL,      -- 의미의 방향 (Realm 독립 값)
  -- confidence 는 '뜻을 아는가' 다. '지금 그리는가' 가 아니다.
  -- 렌더링 예산(5~7) 밖이라는 이유로 UNKNOWN 을 쓰지 않는다
  confidence          TEXT NOT NULL CHECK (confidence IN ('KNOWN','UNKNOWN'))
);

-- A1b 신설: 매핑의 변화를 동일성과 분리한다
CREATE TABLE semantic_place_revision (
  id                  TEXT PRIMARY KEY,
  place_id            TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  mapping_fingerprint TEXT NOT NULL,      -- 재식별 '신호'. 영구 동일성이 아니다
  model_version       INTEGER NOT NULL,
  reidentified_conf   REAL,               -- 이 revision 을 같은 자리로 본 확신도
  created_at          INTEGER NOT NULL
);
CREATE INDEX rev_by_place ON semantic_place_revision(place_id);
CREATE INDEX rev_by_fp    ON semantic_place_revision(mapping_fingerprint);

-- 겹침은 분할이 아니다 → N:N. revision 에 매달린다
CREATE TABLE semantic_source_mapping (
  revision_id   TEXT NOT NULL REFERENCES semantic_place_revision(id) ON DELETE CASCADE,
  source_path   TEXT NOT NULL,
  weight        REAL NOT NULL,
  PRIMARY KEY (revision_id, source_path)
);
CREATE INDEX mapping_by_path ON semantic_source_mapping(source_path);

CREATE TABLE semantic_relation (
  from_place    TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  to_place      TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  PRIMARY KEY (from_place, to_place, kind)
);

-- A1b 정정: 지문이 아니라 '자리'에 묶는다. 지문에 묶으면 리팩터 한 번에 정정이 증발한다
CREATE TABLE place_naming (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- A1b: 세 출처. USER_CORRECTION 은 인용을 요구하지 않는다
  origin        TEXT NOT NULL CHECK (origin IN ('LOCAL_FACT','AI_INFERENCE','USER_CORRECTION')),
  cites         TEXT,               -- AI_INFERENCE 면 로컬 사실 인용(JSON). 없으면 저장하지 않는다
  created_at    INTEGER NOT NULL,
  CHECK (origin <> 'AI_INFERENCE' OR cites IS NOT NULL)
);
CREATE INDEX naming_by_place ON place_naming(place_id);

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
  -- A1b 정정: body 를 여기 두지 않는다. "현재 본문"의 주인이 둘이면 반드시 갈라진다
  current_version INTEGER NOT NULL,
  approved      INTEGER NOT NULL DEFAULT 0,   -- 자동 생성분은 승인 전 활성화 금지
  active        INTEGER NOT NULL DEFAULT 1
);
-- 본문은 오직 여기에만 산다
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

-- A1b 신설: 에이전트가 '말한 것'. Evidence 가 아니다
CREATE TABLE agent_claim (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,       -- 설명의 재료. 검증 진실이 아니다
  about_place   TEXT REFERENCES semantic_place(id),
  artifact_id   TEXT,                -- 원본 발화
  created_at    INTEGER NOT NULL
);

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

-- A1b 정정: 이 테이블은 '측정한 것'만 담는다.
-- claim_source 를 삭제했다 — 에이전트의 발화가 들어갈 컬럼이 아예 없다
CREATE TABLE evidence (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN
                      ('TEST','BUILD','GIT','RUNTIME','SCREENSHOT')),
  status            TEXT NOT NULL CHECK (status IN ('PASS','FAIL','UNKNOWN')),
  what_would_verify TEXT,
  artifact_id       TEXT REFERENCES artifact(id),
  measured_at       INTEGER NOT NULL,
  -- UNKNOWN 은 반드시 행동 가능해야 한다. 빈 문자열도 막는다
  CHECK (status <> 'UNKNOWN' OR (what_would_verify IS NOT NULL AND length(trim(what_would_verify)) > 0))
);
CREATE INDEX evidence_unresolved ON evidence(status) WHERE status <> 'PASS';

CREATE TABLE observation (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT REFERENCES execution(id) ON DELETE SET NULL,
  place_id      TEXT REFERENCES semantic_place(id),
  -- v0.1 활성: RUNTIME · TEST · BUILD. STATIC / USER 는 자리만 두고 켜지 않는다
  source        TEXT NOT NULL CHECK (source IN
                  ('RUNTIME','TEST','BUILD','STATIC','AGENT','USER')),
  signature     TEXT NOT NULL,        -- 같은 실패를 묶는 키
  artifact_id   TEXT REFERENCES artifact(id),
  observed_at   INTEGER NOT NULL
);
CREATE INDEX obs_dedupe ON observation(place_id, signature);

-- A1b 정정: nullable FK 는 "모든 Problem 에 Observation 이 있다" 를 증명하지 못한다.
-- 관계를 1급으로 만들고, 불변식은 트랜잭션과 점검이 강제한다
CREATE TABLE problem_observation (
  problem_id     TEXT NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES observation(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, observation_id)
);

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

-- A1b 정정: 트리 둘. 워킹트리 하나만 찍으면 복원이 사용자 스테이징을 파괴한다
CREATE TABLE safety_record (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('PRE_QODE','DISCARDED')),
  work_ref        TEXT NOT NULL,      -- refs/juqode/safety/<exec>/work  (미추적 포함)
  index_ref       TEXT NOT NULL,      -- refs/juqode/safety/<exec>/index (사용자 스테이징)
  git_ref         TEXT NOT NULL,      -- 대표 ref. 진실은 Git 에 있다
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

-- A1b 신설: 실행 중 저장소가 변했는데 Agent Event 로 설명되지 않으면 소유권은 UNKNOWN 이다.
-- 그런 상태는 화해되기 전까지 SETTLED 가 될 수 없다 → 시간축에 점이 찍히지 않는다
CREATE TABLE repo_delta_attribution (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  ownership     TEXT NOT NULL CHECK (ownership IN ('AGENT','USER','UNKNOWN')),
  evidence_ref  TEXT,                 -- AGENT 면 이것을 설명하는 agent_event
  reconciled_at INTEGER,
  CHECK (ownership <> 'AGENT' OR evidence_ref IS NOT NULL)
);
CREATE INDEX time_desc ON software_time_point(settled_at DESC);  -- 최신이 위다

CREATE VIRTUAL TABLE context_fts USING fts5(body, content='context_version', content_rowid='rowid');
```

---

## 3.1 스키마가 강제하는 것과 강제하지 못하는 것 — A1b 정직성 표

| 규칙 | 무엇이 강제하는가 |
|---|---|
| `UNKNOWN` 은 `what_would_verify` 없이 저장 불가 | **CHECK 제약** ✔ |
| 에이전트 발화가 Evidence 가 되는 것 | **테이블 분리** ✔ — 컬럼 자체가 없다 |
| `CRITICAL` 은 `text` 필수 | **CHECK 제약** ✔ |
| RUN 은 `qode_id` 를 가질 수 없다 | **CHECK 제약** ✔ |
| `AI_INFERENCE` 는 인용 필수 | **CHECK 제약** ✔ |
| **모든 Problem 에 Observation 이 최소 하나** | **✘ 스키마가 못 한다.** 트랜잭션 불변식 + 고아 점검 |
| **자리 정정이 리팩터를 견딘다** | **✘ 스키마가 못 한다.** 재식별 확신도 로직 |
| **에이전트가 루트 밖에 못 쓴다** | **✘ 스키마 밖이다.** Provider 권한 계층 |

> **"스키마가 막아준다"고 쓰지 않는다. 무엇이 막는지 이름을 댄다.**

---

## 4. 마이그레이션 전략 (PROPOSED)

| | |
|---|---|
| 버전 훅 | `PRAGMA user_version` (실측 동작 확인) |
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
