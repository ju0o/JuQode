'use strict';
/* WBS-21 · Persistence — local embedded SQLite (D-129).
 *
 * Messages in this file are ENGLISH on purpose: they are developer diagnostics, never shown.
 * What reaches the user is `DbError.code`, which the renderer turns into approved copy.
 *
 * `schema.sql` in this directory is a VERBATIM copy of Canon `docs/data/schema.sql`
 * (JuQode-Private). It is the source of truth for the model; do not edit it here.
 * Engine: `node:sqlite`, which ships inside the Electron 44 Node 24 runtime — no native
 * module, no electron-rebuild, no ABI coupling. Measured: SQLite 3.53.4 under Electron 44.3.0.
 *
 * Three acceptance rules from `21` WBS-21 live in this file:
 *   1. migrations apply FORWARD ONLY on an existing DB
 *   2. a corrupt file is REFUSED — never silently replaced with a fresh one
 *   3. the D-117 partial unique index is enforced by the engine, not by app code
 *
 * Rule 2 used to be enforced by three checks that a half-written store passes: an integrity
 * check, the presence of `schema_version`, and a version ceiling. A first run killed partway
 * through `schema.sql` leaves exactly that — `schema_version` seeded, `project` missing —
 * and the file was then ADOPTED, after which the first query threw and the window stayed
 * blank forever. Two changes make that unreachable: the first run is one transaction, so a
 * store is either whole or absent, and adoption now requires the schema's own tables to be
 * there. Nothing here trusts a file because it is merely valid SQLite.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

/* schema.sql seeds schema_version = 1 itself. Later versions are appended here and are
 * applied in order; a version is never re-run and never rolled back. */
const MIGRATIONS = [
  /* 2 — `change_group.source_ref`. D-114 says a 확인됨 claim names the evidence it rests on, and
   * `interpretation_answer` even carries a CHECK to that effect; `change_group` had nowhere to
   * put it, so the reference was computed, asserted on in a test, and then dropped on the floor.
   * A group re-read from the store carried a ✓ 확인됨 chip citing nothing. CANON_FINDINGS CF-13.
   *
   * SQLite cannot ADD a CHECK to an existing table, so the constraint is not declared here; the
   * repository layer refuses the same shape and `tests/explain.test.js` holds it to that.
   *
   * `schema.sql` stays at the shape `20` publishes and is NOT edited to include this column: it
   * seeds version 1, so a fresh store runs this migration exactly like an old one. One path,
   * exercised on every first run, instead of a second path only old stores ever take. */
  { to: 2, sql: 'alter table change_group add column source_ref text;' },
  /* 3 — two more Quick Command rules. `20`'s `quick_command_rule` is a foreign key, so a rule
   * cannot be added to `qc/rules.js` alone; the store has to agree or every run of it is
   * rejected by the engine.
   *
   * F-17 said the set was CLOSED at six, and `19` §C4's validated corpus lists `커밋해줘` and
   * `배포해줘` as 미인식 on purpose. Both are reopened here by PM judgment (2026-09-12): a
   * product for non-developers that can READ the Git state but never write one leaves its user
   * with no way to mark a point to return to, and no way to put what they built in front of
   * anyone. Canon `19` §C4 and `20` must be updated to match — see
   * `docs/design/BACKEND_A.md` §Canon 변경 요청. Until they are, this migration is the only
   * place the new ids exist, and `schema.sql` stays the verbatim copy `20` publishes. */
  /* `or ignore`: a migration that cannot be applied twice is a migration that turns a store
   * into `db-corrupt` the first time anything replays it. There is nothing to lose by being
   * idempotent — the rows are a fixed lookup set, not user data. */
  { to: 3, sql: "insert or ignore into quick_command_rule values ('qc.git.commit'),('qc.deploy');" },
  /* 4 — the durable planning parent for one or more execution attempts. This is deliberately
   * additive: existing Work rows remain unlinked and are not reinterpreted as Tasks. */
  { to: 4, sql: `create table task (
    id uuid primary key,
    project_id uuid not null references project(id) on delete restrict,
    goal text not null check (length(trim(goal)) > 0),
    dependencies text not null default '[]',
    acceptance_criteria text not null default '[]',
    status text not null default 'open' check (status in ('open','in_progress','blocked','complete')),
    verdict text not null default 'unverified' check (verdict in ('unverified','pass','fail')),
    created_at timestamptz not null,
    updated_at timestamptz not null
  );
  create index task_project_created on task(project_id, created_at);` },
  /* 5 — connect new Works to their Task and make process identity durable for restart recovery.
   * Nullable fields keep every historical Work intact; v6 project ownership remains deferred. */
  { to: 5, sql: `create table app_session (
    id uuid primary key,
    started_at timestamptz not null,
    app_version text not null,
    platform text not null,
    ended_at timestamptz
  );
  alter table work add column task_id uuid references task(id) on delete restrict;
  alter table work add column runner_session_id uuid;
  alter table work add column runner_pid integer;
  alter table work add column runner_started_at timestamptz;
  create index work_task_recent on work(task_id, started_at desc);
  alter table quick_command_run add column runner_session_id uuid;
  alter table quick_command_run add column runner_pid integer;
  alter table quick_command_run add column runner_started_at timestamptz;` },
  /* 6 — reserve local Project ownership identity without adding login or changing path identity. */
  { to: 6, sql: `alter table project add column owner_id uuid;` },
  /* 7 — immutable record of the declared context attached to one Work/Run. Contents are safe
   * snapshots or digests; the JSON never stores raw secret material. */
  { to: 7, sql: `create table run_context_bundle (
    id uuid primary key,
    work_id uuid not null unique references work(id) on delete restrict,
    bundle_schema_version integer not null check (bundle_schema_version > 0),
    created_at timestamptz not null,
    builder_version text not null,
    content_digest text not null,
    bundle_json text not null
  );
  create trigger run_context_bundle_immutable_update
    before update on run_context_bundle begin
      select raise(abort, 'Run ContextBundle is immutable');
    end;
  create trigger run_context_bundle_immutable_delete
    before delete on run_context_bundle begin
      select raise(abort, 'Run ContextBundle is immutable');
    end;` },
  /* 8 — Task Runs have durable pre-spawn identity and request idempotency. Legacy Work keeps
   * its existing path and default running state; Task Runs begin in `starting`. */
  { to: 8, sql: `insert or ignore into work_status values ('starting');
  alter table work add column idempotency_key text;
  alter table work add column attempt integer not null default 1 check (attempt > 0);
  alter table work add column retry_of_work_id uuid references work(id) on delete restrict;
  alter table work add column failure_reason text;
  create unique index work_project_idempotency on work(project_id, idempotency_key)
    where idempotency_key is not null;` },
  /* 9 — immutable observed evidence linked to one Run. Agent prose remains in work_result;
   * these rows describe measurements made from the event stream and before/after comparison. */
  { to: 9, sql: `create table run_evidence (
    id uuid primary key,
    work_id uuid not null references work(id) on delete restrict,
    kind text not null check (kind in ('changed_files','test_command')),
    source_ref text not null,
    observed_at timestamptz not null,
    summary text not null,
    content_digest text not null,
    details_json text not null,
    unique (work_id, kind, source_ref)
  );
  create index run_evidence_work_time on run_evidence(work_id, observed_at);
  create trigger run_evidence_immutable_update before update on run_evidence begin
    select raise(abort, 'Run evidence is immutable');
  end;
  create trigger run_evidence_immutable_delete before delete on run_evidence begin
    select raise(abort, 'Run evidence is immutable');
  end;` },
  /* 10 — append-only human evidence review, one row per criterion decision and Run. A Task
   * becomes complete only when every current criterion is reviewed PASS against one Run. */
  { to: 10, sql: `create table task_criterion_review (
    id uuid primary key,
    task_id uuid not null references task(id) on delete restrict,
    work_id uuid not null references work(id) on delete restrict,
    criterion_id text not null,
    criterion_digest text not null,
    task_spec_digest text not null,
    verdict text not null check (verdict in ('pass','fail')),
    evidence_ids text not null,
    reviewed_at timestamptz not null
  );
  create index task_criterion_review_latest on task_criterion_review(task_id, criterion_id, reviewed_at);
  create trigger task_criterion_review_immutable_update before update on task_criterion_review begin
    select raise(abort, 'Task criterion review is immutable');
  end;
  create trigger task_criterion_review_immutable_delete before delete on task_criterion_review begin
    select raise(abort, 'Task criterion review is immutable');
  end;` },
  /* 11 — make the one selected Product Agent explicit on new Task Runs. Historical Work rows
   * stay null rather than receiving a guessed identity from a later schema default. */
  { to: 11, sql: `alter table work add column agent_code text;` },
  /* 12 — a Task retry has one durable successor per source Run, plus its explicit human reason.
   * The unique partial index makes a replay after a lost IPC response return the same Run. */
  { to: 12, sql: `alter table work add column retry_reason text;
  create unique index work_one_retry_successor on work(retry_of_work_id)
    where retry_of_work_id is not null;` },
  /* 13 — tie each new Run to the JuQode app launch that owns its child process. A launch
   * boundary lets restart reconciliation close stale Task Runs as unknown without re-spawning. */
  { to: 13, sql: `alter table work add column app_session_id uuid references app_session(id) on delete restrict;
  create index work_app_session on work(app_session_id, status);` },
  /* 14 — keep non-content manifest snapshots durable. Task Runs use these hashes and paths
   * instead of persisting source diffs, so changed-file evidence can still be rebuilt after an
   * app restart without retaining source text. Existing Work history remains unchanged. */
  { to: 14, sql: `alter table evidence_basis add column manifest_json text;` },
];
/* A getter, not a constant: computed at module load it could never see a migration a test
 * pushes, so the whole migrate loop below was unreachable from any test. */
const latest = () => 1 + MIGRATIONS.length;

/* A schema_version at the current version must not make a store with a missing migrated table
 * look complete. Keep base tables separate so an older valid store can migrate before the
 * post-migration completeness check includes newly added tables. */
const tableNames = (sql) => [...sql.matchAll(/^create table\s+(?:if not exists\s+)?([A-Za-z_][\w]*)/gim)]
  .map((m) => m[1].toLowerCase());
const BASE_EXPECTED_TABLES = Object.freeze(tableNames(fs.readFileSync(SCHEMA_FILE, 'utf8')));
const EXPECTED_TABLES = Object.freeze([...new Set([
  ...BASE_EXPECTED_TABLES,
  ...MIGRATIONS.flatMap((m) => tableNames(m.sql)),
])]);

class DbError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'DbError';
    this.code = code;      // 'db-corrupt' | 'db-newer' | 'db-unreadable'
    if (cause) this.cause = cause;
  }
}

function openDb(file) {
  const fresh = file !== ':memory:' && !fs.existsSync(file);
  if (fresh) fs.mkdirSync(path.dirname(file), { recursive: true });

  let db;
  try {
    db = new DatabaseSync(file);
    db.exec('pragma foreign_keys = on');
    db.exec('pragma busy_timeout = 5000');   // SQLite's default is zero: a contended write fails instantly
  } catch (e) {
    throw new DbError('db-unreadable', `cannot open database file: ${file}`, e);
  }

  try {
    if (fresh || isEmpty(db)) {
      /* One transaction: `exec` autocommits per statement, so without this a crash midway
       * leaves a partial store on disk that looks adoptable. Either all 26 base tables or none. */
      db.exec('begin');
      try {
        db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
        db.exec('commit');
      } catch (e) {
        try { db.exec('rollback'); } catch { /* SQLite may have rolled back already */ }
        throw e;
      }
      /* …and then the SAME migrations an existing store gets. `schema.sql` is the shape `20`
       * publishes and stays at version 1; everything since is a migration. Running them here
       * too means there is ONE upgrade path, exercised on every first run, rather than a second
       * path that only stores older than the current build ever take — and a divergence between
       * a fresh store and a migrated one would be invisible until a user hit it. */
      migrate(db, file);
    } else {
      migrate(db, file);
    }
  } catch (e) {
    db.close();
    /* Anything the engine refused on an existing file means we do not understand it.
     * We do not delete it and we do not start a fresh one on top of it. */
    throw e instanceof DbError ? e : new DbError('db-corrupt', `cannot read database file: ${file}`, e);
  }

  /* WAL only AFTER the file has been accepted. Setting it earlier rewrites the header of a
   * file we may be about to refuse — and "refusing leaves it byte-identical" would be false. */
  if (file !== ':memory:') db.exec('pragma journal_mode = wal');
  return db;
}

function isEmpty(db) {
  return db.prepare("select count(*) n from sqlite_master where type = 'table'").get().n === 0;
}

function migrate(db, file) {
  /* A file that is not this product's database must not be adopted or overwritten.
   * integrity_check runs first because a truncated file can still answer some queries. */
  /* `quick_check` skips the index cross-checks that make `integrity_check` walk every page.
   * This runs before the window is created, and the store is designed to grow to hold the
   * raw event stream, so a full walk would become unbounded startup time. */
  let ok;
  try {
    ok = db.prepare('pragma quick_check').get();
  } catch (e) {
    throw new DbError('db-corrupt', `database file failed quick_check: ${file}`, e);
  }
  const verdict = ok && (ok.quick_check ?? Object.values(ok)[0]);
  if (verdict !== 'ok') throw new DbError('db-corrupt', `database file failed quick_check: ${file}`);

  /* Being valid SQLite with a `schema_version` table does not make a file OUR store. */
  const present = new Set(
    db.prepare("select lower(name) n from sqlite_master where type = 'table'").all().map((r) => r.n)
  );
  const missing = BASE_EXPECTED_TABLES.filter((t) => !present.has(t));
  if (missing.length) {
    throw new DbError('db-corrupt',
      `not a complete JuQode database — ${missing.length} table(s) missing, first: ${missing[0]}: ${file}`);
  }

  let at;
  try {
    at = db.prepare('select max(version) v from schema_version').get().v;
  } catch (e) {
    throw new DbError('db-corrupt', `not a JuQode database (no schema_version): ${file}`, e);
  }
  if (at == null) throw new DbError('db-corrupt', `not a JuQode database (no schema_version): ${file}`);
  /* Forward only cuts both ways: a version below the seed is not a store this build wrote. */
  if (at < 1) throw new DbError('db-corrupt', `schema version ${at} is below the seeded version: ${file}`);

  /* Forward only. A DB written by a newer build is left untouched — downgrading it would
   * mean guessing what the newer schema meant. */
  if (at > latest()) {
    throw new DbError('db-newer', `database is at schema version ${at}; this build knows ${latest()}. Forward only — refusing to downgrade.`);
  }

  for (const m of MIGRATIONS) {
    if (m.to <= at) continue;
    db.exec('begin');
    try {
      db.exec(m.sql);
      db.prepare('insert into schema_version values (?, ?)').run(m.to, new Date().toISOString());
      db.exec('commit');
    } catch (e) {
      /* SQLite auto-rolls-back on some errors; an unguarded rollback then throws
       * "cannot rollback - no transaction is active" and MASKS the real failure. */
      try { db.exec('rollback'); } catch { /* already rolled back */ }
      throw new DbError('db-corrupt', `migration to ${m.to} failed`, e);
    }
  }

  const finalPresent = new Set(
    db.prepare("select lower(name) n from sqlite_master where type = 'table'").all().map((r) => r.n)
  );
  const missingAfterMigrations = EXPECTED_TABLES.filter((t) => !finalPresent.has(t));
  if (missingAfterMigrations.length) {
    throw new DbError('db-corrupt',
      `not a complete JuQode database after migrations — ${missingAfterMigrations.length} table(s) missing, first: ${missingAfterMigrations[0]}: ${file}`);
  }
}

module.exports = {
  openDb, DbError, MIGRATIONS, SCHEMA_FILE, EXPECTED_TABLES,
  get LATEST() { return latest(); },
};
