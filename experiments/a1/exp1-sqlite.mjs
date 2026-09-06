/* A1 실험 1 — 저장 계층 후보 검증 (일회용)
 * 묻는 것: 네이티브 모듈 설치 없이 SQLite 를 쓸 수 있는가?
 *          WAL / JSON1 / FTS5 / 외래키가 실제로 켜지는가?
 * 버릴 것: 이 파일과 /tmp 의 산출물. 제품 코드가 아니다. */
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';

const P = '/tmp/juqode-a1-exp1.db';
try { rmSync(P, { force: true }); } catch {}
const db = new DatabaseSync(P);
const q = (s) => db.prepare(s).get();

const out = {};
out.sqlite_version = q('SELECT sqlite_version() AS v').v;
out.journal_mode   = db.prepare('PRAGMA journal_mode=WAL').get().journal_mode;
db.exec('PRAGMA foreign_keys=ON');
out.foreign_keys   = q('PRAGMA foreign_keys').foreign_keys;

// JSON1 — Evidence / Agent Event payload 를 JSON 컬럼에 둘 수 있는가
try {
  out.json1 = q(`SELECT json_extract('{"a":{"b":7}}','$.a.b') AS v`).v;
} catch (e) { out.json1 = 'FAIL: ' + e.message; }

// 생성 컬럼으로 JSON 안의 값을 인덱싱할 수 있는가 (JSON 남용을 막는 핵심 능력)
try {
  db.exec(`CREATE TABLE ev(id INTEGER PRIMARY KEY, payload TEXT,
             kind TEXT GENERATED ALWAYS AS (json_extract(payload,'$.kind')) VIRTUAL);
           CREATE INDEX ev_kind ON ev(kind);`);
  db.prepare('INSERT INTO ev(payload) VALUES(?)').run('{"kind":"test.pass"}');
  out.generated_column_index = q(`SELECT kind AS v FROM ev`).v;
} catch (e) { out.generated_column_index = 'FAIL: ' + e.message; }

// FTS5 — Context 본문 검색
try {
  db.exec(`CREATE VIRTUAL TABLE ctx USING fts5(body)`);
  db.prepare('INSERT INTO ctx(body) VALUES(?)').run('Supabase Auth 콜백은 /auth/cb 이다');
  out.fts5 = q(`SELECT count(*) AS v FROM ctx WHERE ctx MATCH 'Supabase'`).v;
} catch (e) { out.fts5 = 'FAIL: ' + e.message; }

// 사용자 버전 = 마이그레이션 훅
db.exec('PRAGMA user_version=1');
out.user_version = q('PRAGMA user_version').user_version;

// 손상 복구 경로가 존재하는가
out.integrity_check = q('PRAGMA integrity_check').integrity_check;

db.close();
console.log(JSON.stringify(out, null, 2));
