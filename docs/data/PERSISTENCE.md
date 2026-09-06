# Persistence — v0.1

> | | |
> |---|---|
> | **Status** | **CANON** |
> | **Product Version** | **v0.1 MVP** |
> | **Architecture Frozen** | **YES** |
> | **Founder Approval** | **APPROVED** |
> | **Last Reviewed** | 2026-09-06 |
> | **Product SSOT** | `JuQode-Private/docs/current/15_ARCHITECTURE_FREEZE_V01.md` |
> | **Supersedes** | `A1_PERSISTENCE_PROPOSAL.md` (추론 이력으로 보존) |
>
> **구현 착수는 PM 이 원격 A1c 커밋을 확인한 뒤에만 가능하다.**
> **아키텍처가 동결된 것과 구현이 허가된 것은 다르다.**

> ## ⛔ 실행되는 마이그레이션이 아니다
> 아래 SQL 은 **논리 모델**이다. 제품 DB 는 D1 에서 만든다.

---

## 1. 저장 구조

| 무엇 | 어디 |
|---|---|
| 사용자 코드 · 파일 | **Repository** |
| 이전 평형 · 버려진 상태 · 시간축 | **Git** |
| 관계 · 메타 | **SQLite** |
| 큰 Raw 원본 | **파일시스템** (내용 해시 이름) |
| 비밀 | **OS 자격증명 저장소** |

| | |
|---|---|
| **런타임** | **Electron 44.x** |
| **SQLite 접근** | **번들 `node:sqlite`** |
| **네이티브 애드온** | **쓰지 않는다.** 구현 증거가 내장 런타임을 못 쓴다고 증명하기 전까지 |
| **구조** | **DB 접근은 하나의 로컬 영속성 서비스 뒤에.** 플러그인 체계를 만들지 않는다 |
| **저장 위치** | OS 앱 데이터 디렉터리. **프로젝트 폴더 안이 아니다** |
| **프로젝트 이동** | 경로가 아니라 **서명**으로 동일성을 잡는다. 못 찾으면 **묻는다** |

**실측 확인 (Electron 44.2.0 / Node 24.20.0 / SQLite 3.53.4)**

WAL ✔ · 외래키 ✔ · JSON1 ✔ · JSON 값 생성컬럼 인덱스 ✔ · FTS5 ✔ ·
`user_version` ✔ · `integrity_check` `ok` · **experimental 경고 없음**

---

## 2. 논리 SQL 모델 (실행 금지)

**"전부 JSON" 을 하지 않는다.** 넷을 명시적으로 가른다 —
**관계 컬럼** / **JSON payload** / **RAW 파일 아티팩트** / **Repository·Git 진실**.

```sql
-- ⛔ 논리 모델. 제품에 적용하지 않는다.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

-- 자리: 안정된 동일성. 지문에서 파생하지 않는다
CREATE TABLE semantic_place (
  id                  TEXT PRIMARY KEY,   -- 영구. 사용자에게 개체로 노출되지 않는다
  boundary_id         TEXT NOT NULL REFERENCES software_boundary(id) ON DELETE CASCADE,
  current_revision_id TEXT,
  mass                REAL NOT NULL,
  direction           REAL NOT NULL,
  -- '뜻을 아는가' 다. '지금 그리는가' 가 아니다.
  -- 렌더링 예산(5~7) 밖이라는 이유로 UNKNOWN 을 쓰지 않는다
  confidence          TEXT NOT NULL CHECK (confidence IN ('KNOWN','UNKNOWN'))
);

CREATE TABLE semantic_place_revision (
  id                  TEXT PRIMARY KEY,
  place_id            TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  mapping_fingerprint TEXT NOT NULL,      -- 재식별 '신호'. 영구 동일성이 아니다
  model_version       INTEGER NOT NULL,
  reidentified_conf   REAL,
  created_at          INTEGER NOT NULL
);

-- 겹침은 분할이 아니다 → N:N. revision 에 매달린다
CREATE TABLE semantic_source_mapping (
  revision_id   TEXT NOT NULL REFERENCES semantic_place_revision(id) ON DELETE CASCADE,
  source_path   TEXT NOT NULL,
  weight        REAL NOT NULL,
  PRIMARY KEY (revision_id, source_path)
);

-- 이름은 '자리' 에 붙는다. 지문에 붙이면 리팩터 한 번에 증발한다
CREATE TABLE place_naming (
  id            TEXT PRIMARY KEY,
  place_id      TEXT NOT NULL REFERENCES semantic_place(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  origin        TEXT NOT NULL CHECK (origin IN ('LOCAL_FACT','AI_INFERENCE','USER_CORRECTION')),
  cites         TEXT,               -- AI_INFERENCE 면 로컬 사실 인용(JSON)
  created_at    INTEGER NOT NULL,
  CHECK (origin <> 'AI_INFERENCE' OR cites IS NOT NULL)
);

CREATE TABLE context_block (
  id              TEXT PRIMARY KEY,                                -- ★ 필수 5
  project_id      TEXT REFERENCES project(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,                                -- ★
  scope           TEXT NOT NULL CHECK (scope IN ('LOCAL','PERSONAL','PORTABLE','VAULT')), -- ★
  origin          TEXT NOT NULL CHECK (origin IN ('USER','EXTRACTED','IMPORTED','PACK')), -- ★
  portable        INTEGER NOT NULL DEFAULT 0,                      -- ★
  name            TEXT NOT NULL,
  -- 본문을 여기 두지 않는다. "현재 본문" 의 주인이 둘이면 반드시 갈라진다
  current_version INTEGER NOT NULL,
  approved        INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE context_version (
  block_id      TEXT NOT NULL REFERENCES context_block(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,      -- 본문은 오직 여기
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (block_id, version)
);

CREATE TABLE execution (
  id            TEXT PRIMARY KEY,
  qode_id       TEXT REFERENCES qode(id) ON DELETE CASCADE,   -- RUN 은 NULL
  kind          TEXT NOT NULL CHECK (kind IN ('QODE','RUN')),
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  exit_code     INTEGER,
  -- 행동은 섞이지 않는다
  CHECK (kind <> 'RUN' OR qode_id IS NULL)
);

-- 에이전트가 '말한 것'. Evidence 가 아니다
CREATE TABLE agent_claim (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  about_place   TEXT REFERENCES semantic_place(id),
  artifact_id   TEXT,
  created_at    INTEGER NOT NULL
);

-- '측정한 것' 만 담는다. 에이전트 발화가 들어갈 컬럼이 없다
CREATE TABLE evidence (
  id                TEXT PRIMARY KEY,
  execution_id      TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('TEST','BUILD','GIT','RUNTIME','SCREENSHOT')),
  status            TEXT NOT NULL CHECK (status IN ('PASS','FAIL','UNKNOWN')),
  what_would_verify TEXT,
  artifact_id       TEXT REFERENCES artifact(id),
  measured_at       INTEGER NOT NULL,
  -- UNKNOWN 은 반드시 행동 가능해야 한다. 빈 문자열도 막는다
  CHECK (status <> 'UNKNOWN' OR (what_would_verify IS NOT NULL
         AND length(trim(what_would_verify)) > 0))
);

-- 관계를 1급으로. 불변식은 트랜잭션과 점검이 강제한다
CREATE TABLE problem_observation (
  problem_id     TEXT NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES observation(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, observation_id)
);

-- 트리 둘. 워킹트리 하나만 찍으면 복원이 사용자 스테이징을 파괴한다
CREATE TABLE safety_record (
  id              TEXT PRIMARY KEY,
  execution_id    TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('PRE_QODE','DISCARDED')),
  work_ref        TEXT NOT NULL,      -- refs/juqode/safety/<exec>/work
  index_ref       TEXT NOT NULL,      -- refs/juqode/safety/<exec>/index
  reversibility   TEXT NOT NULL CHECK (reversibility IN
                    ('reversible','irreversible','destructive')),
  created_at      INTEGER NOT NULL
);

-- 실행 중 설명되지 않는 차이는 JuQode 것이 아니다
CREATE TABLE repo_delta_attribution (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES execution(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  ownership     TEXT NOT NULL CHECK (ownership IN ('AGENT','USER','UNKNOWN')),
  evidence_ref  TEXT,
  reconciled_at INTEGER,
  CHECK (ownership <> 'AGENT' OR evidence_ref IS NOT NULL)
);
```

---

## 3. 스키마가 강제하는 것과 못 하는 것

| 규칙 | 무엇이 강제하는가 |
|---|---|
| `UNKNOWN` 은 `what_would_verify` 없이 저장 불가 | **CHECK** ✔ |
| 에이전트 발화가 Evidence 가 되는 것 | **테이블 분리** ✔ |
| RUN 은 `qode_id` 를 가질 수 없다 | **CHECK** ✔ |
| `AI_INFERENCE` 는 인용 필수 | **CHECK** ✔ |
| **모든 Problem 에 Observation 최소 하나** | **✘ 스키마가 못 한다.** 트랜잭션 불변식 + 고아 점검 |
| **자리 정정이 리팩터를 견딘다** | **✘ 스키마가 못 한다.** 재식별 확신도 로직 |
| **에이전트가 루트 밖에 못 쓴다** | **✘ 스키마 밖.** Provider 권한 + 샌드박스 |

> **"스키마가 막아준다"고 쓰지 않는다. 무엇이 막는지 이름을 댄다.**

---

## 4. 마이그레이션

| | |
|---|---|
| 버전 훅 | `PRAGMA user_version` |
| 방향 | **전진만.** 다운 마이그레이션을 만들지 않는다 |
| 실패 시 | 롤백하고 **이전 버전으로 계속 동작.** 열기가 실패하지 않는다 |
| **최후 수단** | **DB 를 버리고 재구성한다** |

> **재구성이 안전한 이유:** DB 는 사용자의 코드를 담지 않는다.
> **예외 — Context 는 사용자 자산이다.** 사람이 읽는 형식으로 별도 Export 를 유지한다.

---

## 5. 미결

- **대형 저장소의 실제 쓰기량 · 아티팩트 증가 속도** (**D1 / E1**)
- **아티팩트 보존 정책** — 무한 보존 vs 상한
