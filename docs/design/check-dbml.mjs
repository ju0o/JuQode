/* erd.dbml 이 dbdiagram.io 가 거절하는 모양을 갖고 있지 않은지 본다.
 *
 * 왜 필요한가: dbdiagram 의 관계 연산자는 양쪽의 nullability 와 유일성을 검사한다.
 *   A.x > B.y  → A.x 는 NOT NULL 이어야 하고 단독 unique 가 아니어야 하며 B.y 는 unique 여야 한다
 *   A.x - B.y  → 양쪽 다 unique 여야 한다
 * 그리고 복합 PK 를 컬럼마다 [pk] 로 적으면 **각 컬럼이 단독 unique 로 읽힌다.**
 * 실측으로 확인한 것: 복합 인덱스에 든 컬럼은 단독 unique 로 보지 않는다 — 그래서
 * `(work_id, seq) [unique]` 를 가진 work_signal.work_id 는 `>` 를 써도 통과한다.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./erd.dbml', import.meta.url), 'utf8');
/* 컬럼 한 줄. dbdiagram 은 예약어를 컬럼 이름으로 쓸 때 "text" 처럼 따옴표를 친다 —
 * 따옴표를 벗기지 않으면 그 컬럼은 이 파일 전체에서 존재하지 않는 것이 된다. */
const COL = /^\s*"?(\w+)"? [\w()]+(?: \[(.*)\])?\s*$/;
const tables = [...src.matchAll(/Table (\w+) \{(.*?)\n\}/gs)];
const attrs = new Map();     // '표.컬럼' -> 인라인 속성
const soleUnique = new Set(); // 단독 pk/unique 인 컬럼만

for (const [, name, body] of tables) {
  for (const raw of body.trim().split('\n')) {
    const m = COL.exec(raw);
    if (!m) continue;
    const a = m[2] ?? '';
    attrs.set(`${name}.${m[1]}`, a);
    if (/\bpk\b|\bunique\b/.test(a)) soleUnique.add(`${name}.${m[1]}`);
  }
  /* indexes 블록: 컬럼이 하나뿐인 pk/unique 만 단독 유일성이다. */
  for (const m of body.matchAll(/^\s*(?:\(([^)]+)\)|(\w+))\s*\[([^\]]*)\]/gm)) {
    if (!/\bpk\b|\bunique\b/.test(m[3])) continue;
    const cols = (m[1] ?? m[2]).split(',').map((c) => c.trim());
    if (cols.length === 1) soleUnique.add(`${name}.${cols[0]}`);
    for (const c of cols) if (!attrs.has(`${name}.${c}`)) attrs.set(`${name}.${c}`, 'not null');
  }
}

const bad = [];
for (const m of src.matchAll(/^Ref: ([\w.]+) ([<>-]) ([\w.]+)/gm)) {
  const [, child, op, parent] = m;
  const ca = attrs.get(child), pa = attrs.get(parent);
  if (ca === undefined) { bad.push(`없는 컬럼: ${child}`); continue; }
  if (pa === undefined) { bad.push(`없는 컬럼: ${parent}`); continue; }
  if (op === '>') {
    if (!/not null|\bpk\b/.test(ca)) bad.push(`${child} 는 nullable 인데 > 를 쓴다`);
    if (soleUnique.has(child)) bad.push(`${child} 는 단독 unique 인데 > 를 쓴다 (- 를 쓸 것)`);
    if (!soleUnique.has(parent)) bad.push(`부모 ${parent} 가 단독 unique 가 아니다`);
  }
  if (op === '-') for (const [side, k] of [[child, child], [parent, parent]]) {
    if (!soleUnique.has(k)) bad.push(`1:1 의 ${side} 가 단독 unique 가 아니다`);
  }
}
for (const [, name, body] of tables) {
  const inline = body.split('\n').filter((l) => /\[(?:[^\]]*,\s*)?pk(?:\s*,|\])/.test(l));
  if (inline.length > 1) bad.push(`${name}: 인라인 [pk] 가 ${inline.length} 개 — 복합키는 indexes 블록으로`);
}

/* dbdiagram 은 따옴표 문자열 안의 '' 를 이스케이프로 읽지 않는다 — 거기서 문자열이 끝났다고
 * 보고 「A Note can only contain one quoted string」 으로 거절한다. 실측(2026-09-12).
 * 그래서 Note 안에는 홑따옴표를 **한 개도** 두지 않는다. 값을 감싸야 하면 「」 를 쓴다. */
for (const [i, line] of src.split('\n').entries()) {
  const m = /(?:Note: |\[note: )'(.*)'/.exec(line);
  if (m && m[1].includes("'")) bad.push(`${i + 1}행: Note 안에 홑따옴표가 있다 — dbdiagram 이 거절한다`);
  if (line.includes("''")) bad.push(`${i + 1}행: '' 는 dbdiagram 에서 이스케이프가 아니다`);
}
const grouped = new Set([...src.matchAll(/^  (\w+)$/gm)].map((m) => m[1]));
const ungrouped = tables.map(([, n]) => n).filter((n) => !grouped.has(n));
if (ungrouped.length) bad.push(`TableGroup 에 없는 표: ${ungrouped.join(', ')}`);

/* ---------------------------------------------------------------------------
 * X-3 · 그림이 **실제 스키마와 같은가**.
 *
 * 위의 검사는 dbdiagram 문법만 본다. `DBDIAGRAM.md` 가 적어 둔 대로 erd.dbml 은 사본이고,
 * 사본이 원본과 갈라지는 것은 여태 아무도 재지 않았다.
 *
 * 대조는 **MVP 표만** 한다. V1 절반과 `제안` 표는 아직 어디에도 없어서 대조할 원본이 없다 —
 * 컬럼 단위로도 같다(`note: 'V1'` · `note: '제안'` 인 컬럼은 건너뛴다).
 *
 * 원본이 둘이라는 것이 이 검사의 어려운 점이다: `schema.sql` 은 버전 1 의 Postgres 방언이고
 * 그 뒤의 변경은 전부 `db.js` 의 SQLite `MIGRATIONS` 에 있다. 그림은 **마이그레이션까지
 * 적용된 지금**을 그리므로, 둘을 합친 뒤에 비교한다.
 * ------------------------------------------------------------------------ */
const DB_DIR = new URL('../../app/main/db/', import.meta.url);
const sqlSrc = readFileSync(new URL('schema.sql', DB_DIR), 'utf8');
const dbSrc = readFileSync(new URL('db.js', DB_DIR), 'utf8');

/* `create table x ( … );` 의 본문. 본문 안에 check(...) 가 들어 있어 정규식 하나로는 끝을 못
 * 찾는다 — 괄호 깊이를 세고, 따옴표 안의 괄호는 세지 않는다. */
function tableBodies(text) {
  const out = new Map();
  for (const m of text.matchAll(/create table\s+(?:if not exists\s+)?(\w+)\s*\(/gi)) {
    const start = m.index + m[0].length;
    let i = start, depth = 1;
    for (; i < text.length && depth; i++) {
      /* 주석 먼저. `-- user's words` 의 아포스트로피가 문자열 시작으로 읽히면 표 끝의 `)` 까지
       * 삼킨다 — 실제로 quick_command_run 이 그렇게 잘렸다. */
      if (text[i] === '-' && text[i + 1] === '-') { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
      if (text[i] === "'") { while (++i < text.length && text[i] !== "'"); continue; }
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
    }
    out.set(m[1].toLowerCase(), text.slice(start, i - 1));
  }
  return out;
}

/* 본문을 최상위 쉼표로 자른다. 표 제약(primary key (...) · check (...) · unique (...))은 컬럼이
 * 아니다. `-- 주석` 안에는 쉼표도 괄호도 있으므로 먼저 버린다. */
function columnsOf(body) {
  const cols = new Map();      // 컬럼 -> not null 인가
  const add = (raw) => {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t || /^(primary|unique|check|foreign|constraint)\b/i.test(t)) return;
    const m = /^(\w+)\s+\w/.exec(t);
    if (m) cols.set(m[1].toLowerCase(), /\bnot null\b|\bprimary key\b/i.test(t));
  };
  let part = '', depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "'") { const j = body.indexOf("'", i + 1); part += body.slice(i, j + 1); i = j; continue; }
    if (c === '-' && body[i + 1] === '-') { const j = body.indexOf('\n', i); i = j < 0 ? body.length : j; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) { add(part); part = ''; continue; }
    part += c;
  }
  add(part);
  return cols;
}

const real = new Map([...tableBodies(sqlSrc)].map(([n, b]) => [n, columnsOf(b)]));
/* 마이그레이션을 그 위에 얹는다. 그림은 마이그레이션 뒤의 표를 그린다. */
for (const m of dbSrc.matchAll(/alter table (\w+) add column (\w+)([^;']*)/gi)) {
  const t = real.get(m[1].toLowerCase());
  if (!t) { bad.push(`X-3 마이그레이션이 없는 표를 고친다: ${m[1]}`); continue; }
  t.set(m[2].toLowerCase(), /\bnot null\b/i.test(m[3]));
}

const mvp = new Set();
for (const g of src.matchAll(/TableGroup "([^"]+)" \{([^}]*)\}/g)) {
  if (!g[1].startsWith('MVP')) continue;
  for (const n of g[2].match(/\w+/g) ?? []) mvp.add(n);
}

let compared = 0;
for (const [, name, body] of tables) {
  if (!mvp.has(name)) continue;
  const drawn = new Map();
  for (const raw of body.trim().split('\n')) {
    const m = COL.exec(raw);
    if (!m) continue;
    const a = m[2] ?? '';
    if (/note: '(V1|제안)/.test(a)) continue;        // 아직 존재하지 않는 것은 대조하지 않는다
    drawn.set(m[1].toLowerCase(), /not null|\bpk\b/.test(a));
  }
  /* indexes 블록의 복합 pk 도 not null 이다 — 위에서 attrs 에 넣은 것과 같은 규칙. */
  for (const m of body.matchAll(/^\s*(?:\(([^)]+)\)|(\w+))\s*\[([^\]]*)\]/gm)) {
    if (!/\bpk\b/.test(m[3])) continue;
    for (const c of (m[1] ?? m[2]).split(',')) {
      const k = c.trim().toLowerCase();
      if (drawn.has(k)) drawn.set(k, true);
    }
  }
  const got = real.get(name);
  if (!got) { bad.push(`X-3 ${name}: 그림에 있는데 schema.sql 에 없다`); continue; }
  compared += 1;
  for (const [c, nn] of drawn) {
    if (!got.has(c)) bad.push(`X-3 ${name}.${c}: 그림에만 있다 — 스키마에 없는 컬럼이다`);
    else if (got.get(c) !== nn) bad.push(`X-3 ${name}.${c}: not null 이 다르다 (그림 ${nn} · 스키마 ${got.get(c)})`);
  }
  for (const c of got.keys()) if (!drawn.has(c)) bad.push(`X-3 ${name}.${c}: 스키마에만 있다 — 그림이 낡았다`);
}
for (const t of real.keys()) if (!mvp.has(t)) bad.push(`X-3 ${t}: schema.sql 에 있는데 MVP TableGroup 에 없다`);

console.log(bad.length
  ? bad.join('\n')
  : `검증 통과 · 표 ${tables.length}개 · 관계 ${[...src.matchAll(/^Ref:/gm)].length}개 · MVP ${compared}표를 schema.sql 과 대조`);
process.exit(bad.length ? 1 : 0);
