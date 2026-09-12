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
const tables = [...src.matchAll(/Table (\w+) \{(.*?)\n\}/gs)];
const attrs = new Map();     // '표.컬럼' -> 인라인 속성
const soleUnique = new Set(); // 단독 pk/unique 인 컬럼만

for (const [, name, body] of tables) {
  for (const raw of body.trim().split('\n')) {
    const m = /^\s*(\w+) [\w()]+(?: \[(.*)\])?\s*$/.exec(raw);
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

console.log(bad.length
  ? bad.join('\n')
  : `검증 통과 · 표 ${tables.length}개 · 관계 ${[...src.matchAll(/^Ref:/gm)].length}개`);
process.exit(bad.length ? 1 : 0);
