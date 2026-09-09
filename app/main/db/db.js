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
];
/* A getter, not a constant: computed at module load it could never see a migration a test
 * pushes, so the whole migrate loop below was unreachable from any test. */
const latest = () => 1 + MIGRATIONS.length;

/* Read from the schema itself, so it cannot drift from what the schema creates. */
const EXPECTED_TABLES = Object.freeze(
  [...fs.readFileSync(SCHEMA_FILE, 'utf8').matchAll(/^create table\s+(?:if not exists\s+)?([A-Za-z_][\w]*)/gim)]
    .map((m) => m[1].toLowerCase())
);

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
       * leaves a partial store on disk that looks adoptable. Either all 26 tables or none. */
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
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
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
}

module.exports = {
  openDb, DbError, MIGRATIONS, SCHEMA_FILE, EXPECTED_TABLES,
  get LATEST() { return latest(); },
};
